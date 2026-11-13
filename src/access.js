// Second lock behind Cloudflare Access: every /admin page and /api/admin request must carry a valid Access token
// for the club admin application, signed by the Zero Trust team, and (when ADMIN_EMAILS is set) for a listed email.
// Cloudflare Access is the first lock; this check stops a mistaken policy change from exposing applicants' details.
// Same token check as mazzagotte.dev.
import { b64urlDecode } from './util.js';

const dec = new TextDecoder();
let certCache = { at: 0, team: '', keys: new Map() };

async function signingKeys(team) {
  const fresh = Date.now() - certCache.at < 3600_000 && certCache.team === team;
  if (fresh) return certCache.keys;
  const res = await fetch(`${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
  const { keys = [] } = await res.json();
  const map = new Map();
  for (const jwk of keys) {
    if (jwk.kty !== 'RSA') continue;
    map.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  certCache = { at: Date.now(), team, keys: map };
  return map;
}

function tokenFrom(request) {
  const header = request.headers.get('cf-access-jwt-assertion');
  if (header) return header;
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? m[1] : null;
}

// Returns { email } for a valid admin, or null. Throws only when Access isn't configured.
export async function verifyAccess(request, env) {
  // Local development only: needs DEV_NO_AUTH=1 AND an empty ACCESS_AUD. DEV_NO_AUTH is never set on the live site.
  if (env.DEV_NO_AUTH === '1' && !env.ACCESS_AUD) return { email: 'dev@localhost' };
  const team = (env.ACCESS_TEAM_DOMAIN || '').replace(/\/+$/, '');
  if (!team || !env.ACCESS_AUD) throw new Error('not-configured');

  const token = tokenFrom(request);
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header, claims;
  try {
    header = JSON.parse(dec.decode(b64urlDecode(parts[0])));
    claims = JSON.parse(dec.decode(b64urlDecode(parts[1])));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;

  let key = (await signingKeys(team)).get(header.kid);
  if (!key) {
    certCache.at = 0; // keys may have rotated; fetch once more
    key = (await signingKeys(team)).get(header.kid);
  }
  if (!key) return null;

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) return null;

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (claims.iss !== team) return null;
  if (typeof claims.exp !== 'number' || claims.exp < now) return null;
  const email = String(claims.email || '').toLowerCase();
  const allowed = String(env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(email)) return null;
  return { email: claims.email || '' };
}
