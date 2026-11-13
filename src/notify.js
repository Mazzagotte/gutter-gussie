// Optional email to the club when a new application arrives.
// Needs the "send_email" binding named EMAIL (see wrangler.jsonc), Cloudflare Email Routing turned on for
// mazzagotte.dev, and NOTIFY_TO set to an address verified in Email Routing. Without them this does nothing.

const enc = (s) => `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(s)))}?=`;
const b64Lines = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/.{1,76}/g, '$&\r\n');
};

export async function notifyNewApplication(env, app) {
  const to = String(env.NOTIFY_TO || '').trim();
  if (!env.EMAIL || !to) return false;
  const from = String(env.NOTIFY_FROM || 'applications@mazzagotte.dev').trim();
  const { EmailMessage } = await import('cloudflare:email');

  const proof = app.proof_method === 'mail' ? 'Mailing proof with fee' : `${app.file_total} file${app.file_total === 1 ? '' : 's'} uploaded`;
  const body = [
    `New Gutter Gussie membership application ${app.ref}`,
    '',
    `Name:        ${app.full_name}`,
    `Email:       ${app.email}`,
    `Phone:       ${app.phone}`,
    `Club/assoc.: ${app.association}`,
    `Score:       ${app.score} scratch ${app.score_type} on ${app.score_date}`,
    `Event:       ${app.event_name} (secretary/director: ${app.director})`,
    `Proof:       ${proof}`,
    '',
    'Review it here: https://guttergussie.mazzagotte.dev/admin',
    '',
    'This email has no proof files or addresses attached; they stay in the club admin.',
  ].join('\r\n');

  const raw = [
    `From: ${enc('Gutter Gussie Applications')} <${from}>`,
    `To: <${to}>`,
    `Subject: ${enc(`New membership application: ${app.full_name} (${app.ref})`)}`,
    `Message-ID: <${crypto.randomUUID()}@mazzagotte.dev>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64Lines(body),
  ].join('\r\n');

  await env.EMAIL.send(new EmailMessage(from, to, raw));
  return true;
}
