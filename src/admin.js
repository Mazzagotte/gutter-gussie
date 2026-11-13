// Club admin API (behind Cloudflare Access): review applications, download proof, edit site settings.
import { deleteApplicationData, logApplication } from './applications.js';
import { HttpError, json, readJson, str } from './util.js';

const STATUSES = ['new', 'approved', 'declined'];
export const SETTING_KEYS = {
  tournament_name: 150, tournament_start: 10, tournament_end: 10, tournament_location: 200, tournament_deadline: 10,
  tournament_fee: 100, tournament_entry_url: 500, tournament_details: 1000, payment_instructions: 600,
};

export async function readSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const { key, value } of results) if (key in SETTING_KEYS) out[key] = value;
  return out;
}

const SUMMARY_COLS = `id, ref, status, full_name, email, city, association, score, score_type, score_date, proof_method,
  proof_ok, fee_paid, member_number, submitted_at, updated_at,
  (SELECT COUNT(*) FROM application_files f WHERE f.application_id = applications.id) AS files`;

async function list(env, url) {
  const status = url.searchParams.get('status') || 'all';
  const q = str(url.searchParams.get('q'), 100).toLowerCase();
  const where = ["status != 'uploading'"];
  const args = [];
  if (STATUSES.includes(status)) { where.push('status = ?'); args.push(status); }
  if (q) {
    where.push('(lower(full_name) LIKE ? OR lower(email) LIKE ? OR lower(ref) LIKE ? OR lower(city) LIKE ? OR lower(association) LIKE ? OR member_number LIKE ?)');
    const like = `%${q.replace(/[%_]/g, '')}%`;
    args.push(like, like, like, like, like, like);
  }
  const { results } = await env.DB.prepare(`SELECT ${SUMMARY_COLS} FROM applications WHERE ${where.join(' AND ')} ORDER BY submitted_at DESC LIMIT 500`).bind(...args).all();
  const counts = await env.DB.prepare(
    "SELECT status, COUNT(*) AS n FROM applications WHERE status != 'uploading' GROUP BY status"
  ).all();
  const c = { new: 0, approved: 0, declined: 0 };
  for (const r of counts.results) c[r.status] = r.n;
  c.all = c.new + c.approved + c.declined;
  return { applications: results, counts: c };
}

async function detail(env, id) {
  const app = await env.DB.prepare("SELECT * FROM applications WHERE id = ? AND status != 'uploading'").bind(id).first();
  if (!app) throw new HttpError(404, 'No such application');
  delete app.upload_token;
  delete app.ip_hash;
  const files = await env.DB.prepare('SELECT id, name, type, size, created_at FROM application_files WHERE application_id = ? ORDER BY id').bind(id).all();
  const log = await env.DB.prepare('SELECT actor, text, created_at FROM application_log WHERE application_id = ? ORDER BY created_at DESC, id DESC').bind(id).all();
  return { application: app, files: files.results, log: log.results };
}

async function update(env, id, body, admin) {
  const app = await env.DB.prepare("SELECT * FROM applications WHERE id = ? AND status != 'uploading'").bind(id).first();
  if (!app) throw new HttpError(404, 'No such application');
  const sets = [];
  const args = [];
  const notes = [];
  if ('status' in body) {
    if (!STATUSES.includes(body.status)) throw new HttpError(400, 'Unknown status');
    if (body.status !== app.status) {
      sets.push('status = ?'); args.push(body.status);
      notes.push({ new: 'Moved back to New', approved: 'Approved membership', declined: 'Declined application' }[body.status]);
    }
  }
  for (const [key, on, off] of [['proof_ok', 'Marked proof checked', 'Unmarked proof checked'], ['fee_paid', 'Marked $20 fee received', 'Unmarked fee received']]) {
    if (key in body) {
      const v = body[key] ? 1 : 0;
      if (v !== app[key]) { sets.push(`${key} = ?`); args.push(v); notes.push(v ? on : off); }
    }
  }
  if ('member_number' in body) {
    const v = str(body.member_number, 30);
    if (v !== app.member_number) { sets.push('member_number = ?'); args.push(v); notes.push(v ? `Member card number set to ${v}` : 'Cleared member card number'); }
  }
  if ('admin_notes' in body) {
    const v = str(body.admin_notes, 4000);
    if (v !== app.admin_notes) { sets.push('admin_notes = ?'); args.push(v); notes.push('Updated notes'); }
  }
  if (sets.length) {
    sets.push('updated_at = ?'); args.push(Date.now());
    await env.DB.prepare(`UPDATE applications SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id).run();
    for (const n of notes) await logApplication(env, id, admin.email || 'admin', n);
  }
  return detail(env, id);
}

async function file(env, fileId, download) {
  const f = await env.DB.prepare(
    "SELECT f.* FROM application_files f JOIN applications a ON a.id = f.application_id WHERE f.id = ? AND a.status != 'uploading'"
  ).bind(fileId).first();
  if (!f) throw new HttpError(404, 'No such file');
  const obj = await env.PROOFS.get(f.key);
  if (!obj) throw new HttpError(404, 'That file is missing from storage');
  const viewable = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/.test(f.type);
  const disposition = download || !viewable ? 'attachment' : 'inline';
  const safeName = f.name.replace(/["\\\r\n]/g, '_');
  return new Response(obj.body, {
    headers: {
      'content-type': viewable ? f.type : 'application/octet-stream',
      'content-disposition': `${disposition}; filename="${safeName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'content-length': String(obj.size),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      // Uploaded files are never trusted as active content. (PDFs skip the sandbox: Chrome won't render a sandboxed PDF.)
      ...(f.type === 'application/pdf' && disposition === 'inline' ? {} : { 'content-security-policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" }),
    },
  });
}

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // keep spreadsheet formulas from running
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function exportCsv(env, url) {
  const status = url.searchParams.get('status') || 'all';
  const where = STATUSES.includes(status) ? 'status = ?' : "status != 'uploading'";
  const stmt = env.DB.prepare(`SELECT * FROM applications WHERE ${where} ORDER BY submitted_at`);
  const { results } = await (STATUSES.includes(status) ? stmt.bind(status) : stmt).all();
  const cols = [
    ['Reference', 'ref'], ['Status', 'status'], ['Member #', 'member_number'], ['Submitted', 'submitted_at'], ['Full name', 'full_name'],
    ['Email', 'email'], ['Phone', 'phone'], ['Street', 'street'], ['Address line 2', 'address_line2'], ['City', 'city'], ['State', 'state'],
    ['ZIP', 'zip'], ['Club / association', 'association'], ['League or tournament', 'event_name'], ['Secretary / director', 'director'],
    ['Score date', 'score_date'], ['Score type', 'score_type'], ['Score', 'score'], ['Proof method', 'proof_method'],
    ['Proof checked', 'proof_ok'], ['Fee received', 'fee_paid'], ['Notes', 'admin_notes'],
  ];
  const fmt = (k, v) => (k === 'submitted_at' && v ? new Date(v).toISOString().slice(0, 10) : (k === 'proof_ok' || k === 'fee_paid') ? (v ? 'Yes' : 'No') : v);
  const lines = [cols.map(([h]) => csvCell(h)).join(',')];
  for (const r of results) lines.push(cols.map(([, k]) => csvCell(fmt(k, r[k]))).join(','));
  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="gutter-gussie-applications-${status}.csv"`,
      'cache-control': 'private, no-store',
    },
  });
}

async function saveSettings(env, body) {
  const stmts = [];
  for (const [key, max] of Object.entries(SETTING_KEYS)) {
    if (!(key in body)) continue;
    let v = str(body[key], max + 1);
    if (v.length > max) throw new HttpError(400, `${key.replace(/_/g, ' ')} is too long`);
    if (/_(start|end|deadline)$/.test(key) && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, 'Dates must be YYYY-MM-DD');
    if (key === 'tournament_entry_url' && v) {
      try { const u = new URL(v); if (!/^https?:$/.test(u.protocol)) throw new Error(); v = u.href; } catch { throw new HttpError(400, 'The entry link must start with https://'); }
    }
    stmts.push(env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, v));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return readSettings(env);
}

export async function handleAdminApi(request, env, admin) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin/, '') || '/';
  const method = request.method;
  // Writes must come from our own admin page (CSRF guard on top of Access).
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'Bad origin');
    if (!origin && request.headers.get('x-requested-with') !== 'gg-admin') throw new HttpError(403, 'Bad origin');
  }
  let m;
  if (method === 'GET' && path === '/me') return json({ email: admin.email });
  if (method === 'GET' && path === '/applications') return json(await list(env, url));
  if (method === 'GET' && path === '/export.csv') return exportCsv(env, url);
  if (method === 'GET' && path === '/settings') return json(await readSettings(env));
  if (method === 'PUT' && path === '/settings') return json(await saveSettings(env, await readJson(request)));
  if ((m = path.match(/^\/files\/(\d+)$/)) && method === 'GET') return file(env, Number(m[1]), url.searchParams.get('download') === '1');
  if ((m = path.match(/^\/applications\/([0-9a-f-]{36})$/))) {
    if (method === 'GET') return json(await detail(env, m[1]));
    if (method === 'PATCH') return json(await update(env, m[1], await readJson(request), admin));
    if (method === 'DELETE') {
      const exists = await env.DB.prepare("SELECT 1 FROM applications WHERE id = ? AND status != 'uploading'").bind(m[1]).first();
      if (!exists) throw new HttpError(404, 'No such application');
      await deleteApplicationData(env, m[1]);
      return json({ ok: true });
    }
  }
  throw new HttpError(404, 'Not found');
}
