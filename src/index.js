// Idaho Gutter Gussie Club — guttergussie.mazzagotte.dev
// Public site = static files in public/. This Worker handles the membership application API
// and the club admin (/admin), which sits behind Cloudflare Access plus the token check in access.js.
import { verifyAccess } from './access.js';
import { handleAdminApi, readSettings } from './admin.js';
import { MAX_FILE_BYTES, cleanupAbandoned, completeApplication, createApplication, uploadFile } from './applications.js';
import { HttpError, json, text } from './util.js';

const NOT_CONFIGURED = `The club admin is locked until Cloudflare Access is set up.
Set ACCESS_AUD (and ADMIN_EMAILS) — see the README, "Turn on the admin login".`;

async function requireAdmin(request, env) {
  let admin;
  try {
    admin = await verifyAccess(request, env);
  } catch (e) {
    if (e.message === 'not-configured') throw new HttpError(503, NOT_CONFIGURED);
    throw e;
  }
  if (!admin) throw new HttpError(403, 'Not signed in. Open https://guttergussie.mazzagotte.dev/admin to sign in.');
  return admin;
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const { pathname: path } = url;
  const method = request.method;
  let m;

  // ---- public API ----
  if (path === '/api/health') {
    await env.DB.prepare('SELECT 1').first();
    return text('gutter-gussie ok');
  }
  if (path === '/api/site' && method === 'GET') {
    return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || '', maxFileBytes: MAX_FILE_BYTES, settings: await readSettings(env) },
      200, { 'cache-control': 'public, max-age=60' });
  }
  if (path === '/api/applications' && method === 'POST') return createApplication(request, env);
  if ((m = path.match(/^\/api\/applications\/([0-9a-f-]{36})\/files$/)) && method === 'PUT') return uploadFile(request, env, m[1]);
  if ((m = path.match(/^\/api\/applications\/([0-9a-f-]{36})\/complete$/)) && method === 'POST') return completeApplication(request, env, ctx, m[1]);

  // ---- club admin ----
  if (path.startsWith('/api/admin')) return handleAdminApi(request, env, await requireAdmin(request, env));
  if (path === '/admin' || path.startsWith('/admin/')) {
    try {
      await requireAdmin(request, env);
    } catch (e) {
      if (e instanceof HttpError) return text(e.message, e.status);
      throw e;
    }
    const res = await env.ASSETS.fetch(new Request(new URL(path === '/admin' ? '/admin/' : path, url), request));
    const out = new Response(res.body, res);
    out.headers.set('cache-control', 'private, no-store');
    out.headers.set('x-robots-tag', 'noindex, nofollow');
    return out;
  }
  if (path.startsWith('/api/')) throw new HttpError(404, 'Not found');
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
      console.log('error', e && e.stack);
      return json({ error: 'Something went wrong on our end. Please try again, or email the club.' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupAbandoned(env).then((n) => n && console.log(`removed ${n} unfinished applications`)).catch((e) => console.log('cleanup failed', e && e.stack)));
  },
};
