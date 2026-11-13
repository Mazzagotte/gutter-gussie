// Public membership application: create → upload proof files (one per request) → complete.
// Every rule the form checks in the browser is checked again here.
import { notifyNewApplication } from './notify.js';
import { HttpError, daysBetween, json, makeRef, randomToken, readJson, safeEqual, sha256, str, todayLocal } from './util.js';

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MIN_FILL_MS = 10_000;          // humans take longer than this to fill three steps
const PER_IP_HOUR = 5;
const PER_IP_DAY = 15;
const FILE_EXT = /\.(pdf|docx?|png|jpe?g|webp|heic|xlsx?|csv)$/i;
const TEXT_FIELDS = ['fullName', 'street', 'addressLine2', 'city', 'state', 'association', 'eventName', 'director'];
const LINK_PATTERN = /(https?:\/\/|www\.|\.(com|net|org|ru|xyz|info|top)\b|<\s*\/?[a-z]|\[url)/i;

const FIELDS = [
  // name, step, max length, required
  ['fullName', 0, 150, true], ['email', 0, 254, true], ['phone', 0, 40, true], ['street', 0, 200, true],
  ['addressLine2', 0, 150, false], ['city', 0, 100, true], ['state', 0, 60, true], ['zip', 0, 10, true],
  ['association', 0, 200, true], ['eventName', 1, 200, true], ['director', 1, 150, true], ['scoreDate', 1, 10, true],
  ['scoreType', 1, 10, true],
];

const bad = (field, step, message) => new HttpError(400, message, { field, step });

export function validateApplication(body, env, now = Date.now()) {
  const d = {};
  for (const [name, step, max, required] of FIELDS) {
    const v = str(body[name], max + 1);
    if (v.length > max) throw bad(name, step, 'That’s too long.');
    if (required && !v) throw bad(name, step, 'Please complete this field.');
    if (TEXT_FIELDS.includes(name) && LINK_PATTERN.test(v)) throw bad(name, step, 'Links and code aren’t allowed here.');
    d[name] = v;
  }
  if (!/^[\p{L}][\p{L} .,'’-]*$/u.test(d.fullName)) throw bad('fullName', 0, 'Enter your name using letters only.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) throw bad('email', 0, 'Enter a valid email address.');
  const digits = d.phone.replace(/\D/g, '');
  if (!/^1?\d{10}$/.test(digits)) throw bad('phone', 0, 'Enter a 10-digit phone number.');
  if (!/^[0-9]{5}(-[0-9]{4})?$/.test(d.zip)) throw bad('zip', 0, 'Enter a 5-digit ZIP code or ZIP+4.');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.scoreDate)) throw bad('scoreDate', 1, 'Choose the date of your score.');
  const age = daysBetween(d.scoreDate, todayLocal(env.TIMEZONE || 'America/Denver', now));
  // One day of slack either way for time zones.
  if (age < -1 || age > 366) throw bad('scoreDate', 1, 'Choose a date within the past 365 days, not a future date.');

  if (!['game', 'series'].includes(d.scoreType)) throw bad('scoreType', 1, 'Choose a score type.');
  const score = Number(body.score);
  const [min, max] = d.scoreType === 'game' ? [225, 300] : [550, 900];
  if (!Number.isInteger(score) || score < min || score > max) throw bad('score', 1, `Enter a score from ${min} to ${max}.`);
  d.score = score;

  d.proofMethod = body.proofMethod === 'mail' ? 'mail' : 'upload';
  const fileCount = Number(body.fileCount);
  if (d.proofMethod === 'upload' && (!Number.isInteger(fileCount) || fileCount < 1 || fileCount > MAX_FILES)) {
    throw bad('score-proof', 2, 'Choose at least one proof file, or select Mail proof.');
  }
  d.fileCount = d.proofMethod === 'upload' ? fileCount : 0;
  if (body.acknowledged !== true) throw bad('acknowledged', 2, 'Please acknowledge the fee and proof requirement.');
  d.phone = digits.length === 11 ? digits.slice(1) : digits;
  d.phone = `(${d.phone.slice(0, 3)}) ${d.phone.slice(3, 6)}-${d.phone.slice(6)}`;
  return d;
}

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true; // not configured (local development)
  if (!token || typeof token !== 'string' || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  if (!res.ok) return false;
  const out = await res.json().catch(() => ({}));
  return out.success === true && (!out.action || out.action === 'apply');
}

async function log(env, id, actor, textValue) {
  await env.DB.prepare('INSERT INTO application_log (application_id, actor, text, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, actor, textValue, Date.now()).run();
}
export { log as logApplication };

export async function createApplication(request, env) {
  const body = await readJson(request);
  // Bots: the hidden "website" field is filled, or the form was filled impossibly fast.
  if (str(body.website)) throw new HttpError(400, 'Something went wrong. Please try again.');
  if (!(Number(body.elapsedMs) >= MIN_FILL_MS)) {
    throw bad('acknowledged', 2, 'Please take a moment to look over your application, then send it again.');
  }
  const d = validateApplication(body, env);

  const ip = request.headers.get('cf-connecting-ip') || '';
  const ipHash = ip ? (await sha256('gg-ip:' + ip)).slice(0, 32) : '';
  if (ipHash) {
    const now = Date.now();
    const row = await env.DB.prepare(
      'SELECT SUM(created_at > ?) AS hour, COUNT(*) AS day FROM applications WHERE ip_hash = ? AND created_at > ?'
    ).bind(now - 3600_000, ipHash, now - 86400_000).first();
    if ((row?.hour || 0) >= PER_IP_HOUR || (row?.day || 0) >= PER_IP_DAY) {
      throw new HttpError(429, 'Too many applications from this connection. Please try again later or email the club.');
    }
  }

  if (!(await verifyTurnstile(env, body.turnstileToken, ip))) {
    throw bad('turnstile', 2, 'The human check didn’t go through. Please try it again.');
  }

  const id = crypto.randomUUID();
  const token = randomToken();
  const now = Date.now();
  let ref = makeRef();
  for (let tries = 0; tries < 3; tries++) {
    const clash = await env.DB.prepare('SELECT 1 FROM applications WHERE ref = ?').bind(ref).first();
    if (!clash) break;
    ref = makeRef();
  }
  await env.DB.prepare(
    `INSERT INTO applications (id, ref, status, full_name, email, phone, street, address_line2, city, state, zip, association,
       event_name, director, score_date, score_type, score, proof_method, file_count, upload_token, ip_hash, created_at, updated_at)
     VALUES (?, ?, 'uploading', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, ref, d.fullName, d.email, d.phone, d.street, d.addressLine2, d.city, d.state, d.zip, d.association,
    d.eventName, d.director, d.scoreDate, d.scoreType, d.score, d.proofMethod, d.fileCount, await sha256(token), ipHash, now, now).run();
  return json({ id, ref, uploadToken: token }, 201);
}

async function pendingApplication(request, env, id) {
  const token = request.headers.get('x-upload-token') || '';
  const app = await env.DB.prepare('SELECT * FROM applications WHERE id = ?').bind(id).first();
  if (!app || app.status !== 'uploading' || !app.upload_token || !token) throw new HttpError(404, 'This application can’t take files anymore.');
  if (!safeEqual(await sha256(token), app.upload_token)) throw new HttpError(404, 'This application can’t take files anymore.');
  if (Date.now() - app.created_at > 6 * 3600_000) throw new HttpError(410, 'This application expired. Please start again.');
  return app;
}

export async function uploadFile(request, env, id) {
  const app = await pendingApplication(request, env, id);
  if (app.proof_method !== 'upload') throw new HttpError(400, 'This application is set to mail proof.');
  let name = '';
  try { name = decodeURIComponent(request.headers.get('x-file-name') || ''); } catch { /* bad encoding */ }
  name = name.replace(/[\u0000-\u001f\\/]/g, '_').trim().slice(-120);
  if (!name || !FILE_EXT.test(name)) throw new HttpError(400, 'Choose a supported PDF, document, image, or spreadsheet.');
  const size = Number(request.headers.get('content-length') || 0);
  if (!size || !request.body) throw new HttpError(411, `“${name}” is empty.`);
  if (size > MAX_FILE_BYTES) throw new HttpError(413, `“${name}” is larger than 25 MB.`);

  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM application_files WHERE application_id = ?').bind(id).first();
  if (n >= Math.min(app.file_count, MAX_FILES)) throw new HttpError(400, `You can attach up to ${app.file_count} file${app.file_count === 1 ? '' : 's'}.`);

  const type = (request.headers.get('content-type') || 'application/octet-stream').split(';')[0].slice(0, 100);
  const key = `${id}/${crypto.randomUUID()}-${name.replace(/[^\w.\- ]+/g, '_')}`;
  const obj = await env.PROOFS.put(key, request.body, { httpMetadata: { contentType: type }, customMetadata: { name, application: app.ref } });
  if (!obj) throw new HttpError(500, `“${name}” didn’t upload.`);
  await env.DB.prepare('INSERT INTO application_files (application_id, key, name, type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, key, name, type, obj.size ?? size, Date.now()).run();
  return json({ ok: true }, 201);
}

export async function completeApplication(request, env, ctx, id) {
  const app = await pendingApplication(request, env, id);
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM application_files WHERE application_id = ?').bind(id).first();
  if (app.proof_method === 'upload' && n < 1) throw new HttpError(400, 'Your proof files didn’t arrive. Please send again.');
  const now = Date.now();
  await env.DB.prepare("UPDATE applications SET status = 'new', upload_token = NULL, submitted_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, id).run();
  await log(env, id, 'applicant', app.proof_method === 'mail' ? 'Application sent (proof by mail)' : `Application sent with ${n} proof file${n === 1 ? '' : 's'}`);
  ctx.waitUntil(notifyNewApplication(env, { ...app, file_total: n }).catch((e) => console.log('notify failed', e && e.message)));
  return json({ ok: true, ref: app.ref });
}

// Daily: remove applications that were started but never finished, and their files.
export async function cleanupAbandoned(env) {
  const cutoff = Date.now() - 2 * 86400_000;
  const { results } = await env.DB.prepare("SELECT id FROM applications WHERE status = 'uploading' AND created_at < ? LIMIT 200").bind(cutoff).all();
  for (const { id } of results) await deleteApplicationData(env, id);
  return results.length;
}

export async function deleteApplicationData(env, id) {
  const { results } = await env.DB.prepare('SELECT key FROM application_files WHERE application_id = ?').bind(id).all();
  if (results.length) await env.PROOFS.delete(results.map((r) => r.key));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM application_files WHERE application_id = ?').bind(id),
    env.DB.prepare('DELETE FROM application_log WHERE application_id = ?').bind(id),
    env.DB.prepare('DELETE FROM applications WHERE id = ?').bind(id),
  ]);
}
