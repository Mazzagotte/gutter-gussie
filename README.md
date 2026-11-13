# Idaho Gutter Gussie Club — guttergussie.mazzagotte.dev

The club website, with a working membership application and a club admin to review it. Runs on Cloudflare Workers + D1 + R2, built the same way as mazzagotte.dev (plain JavaScript, no build step).

- **Public site** — Home, Join, Tournament, Our story, Hall of Fame, Contact (`public/index.html`, `site.js`, `styles.css`)
- **Membership application** — three steps, checked in the browser and again on the server; proof files (up to 5, 25 MB each) go to a private R2 bucket; Cloudflare Turnstile human check; applicants get a reference number like `GG-7K3QDM`
- **Club admin** (`/admin`, behind Cloudflare Access) — New / Approved / Declined lists, search, view and download proof, tick off *proof checked* and *$20 fee received*, record the member card number, notes, activity log per application, CSV export, delete
- **Site settings** in the admin — next tournament (name, dates, place, deadline, fee, entry link, details) and the fee payment/mailing instructions; the public pages pick them up within a minute
- Unfinished applications (started but never sent) and their files are removed after 2 days

## Set it up (in this order)

Already done: the D1 database `gutter-gussie` and the R2 bucket `gutter-gussie-proofs` exist, and their ids are in `wrangler.jsonc`.

### 1. Deploy

Cloudflare dashboard → **Workers & Pages → Create → Import a repository** → `Mazzagotte/gutter-gussie`. Keep the Worker name `gutter-gussie` and set:

- **Build command:** `npm run migrate` — creates and updates the database tables
- **Deploy command:** `npx wrangler deploy`

`wrangler.jsonc` attaches the custom domain `guttergussie.mazzagotte.dev`, so the site answers there after the first deploy.

### 2. Turn on the human check (Turnstile)

Cloudflare dashboard → **Turnstile → Add widget** → name `Gutter Gussie`, hostname `guttergussie.mazzagotte.dev`, mode **Managed**. Copy the site key and secret key into step 4.

### 3. Turn on the admin login (Cloudflare Access)

Same Zero Trust team as mazzagotte.dev.

1. **Zero Trust → Access → Applications → Add an application → Self-hosted**
   - Name `Gutter Gussie admin`, session 1 month
   - Destinations: domain `guttergussie.mazzagotte.dev` path `admin`, **and** domain `guttergussie.mazzagotte.dev` path `api/admin`
   - Policy: **Allow**, Include → **Emails** → you, Kelsey, Cami (anyone who reviews applications)
   - Login method: One-time PIN (codes by email) works for everyone without accounts
2. Copy the **Application Audience (AUD) Tag** into step 4.

Until `ACCESS_AUD` is set, `/admin` stays locked (it shows a "locked until Access is set up" message). The public site and the form work either way.

### 4. Variables

**Workers & Pages → gutter-gussie → Settings → Variables and Secrets**

| Name | Type | Value |
| --- | --- | --- |
| `ACCESS_AUD` | Text | the AUD tag from step 3 |
| `ADMIN_EMAILS` | Text | the same emails as the Access policy, comma-separated (an extra lock) |
| `TURNSTILE_SITE_KEY` | Text | Turnstile site key |
| `TURNSTILE_SECRET` | Secret | Turnstile secret key |

`keep_vars` in `wrangler.jsonc` keeps these when GitHub deploys run.

### 5. Optional: email the club when an application arrives

1. Cloudflare dashboard → **mazzagotte.dev → Email → Email Routing** → turn it on, and add `idahoguttergussieclub@gmail.com` as a **destination address** (the club confirms it from the email Cloudflare sends).
2. In `wrangler.jsonc`, uncomment the `send_email` line.
3. Add the variable `NOTIFY_TO` = `idahoguttergussieclub@gmail.com`.

The email lists the applicant, score and reference with a link to the admin. Mailing addresses and proof files stay in the admin.

### 6. Fill in the site settings

Open `https://guttergussie.mazzagotte.dev/admin#settings` and add the fee payment/mailing instructions (until then the site says "Contact the club for payment and mailing instructions") and the next tournament when it's known.

## How it works

| Piece | Where |
| --- | --- |
| Routing, admin gate, daily clean-up | `src/index.js` |
| Application create → upload files → complete, server-side checks, rate limits | `src/applications.js` |
| Admin API (list, detail, update, files, CSV, settings) | `src/admin.js` |
| Cloudflare Access token check (same as mazzagotte.dev) | `src/access.js` |
| New-application email | `src/notify.js` |
| Database | `migrations/0001_init.sql` |
| Admin page | `public/admin/` |

Sending an application is three requests so big scans don't hit request size limits:

1. `POST /api/applications` — the form fields, Turnstile token and time spent; returns an id, reference and a one-time upload token (stored hashed)
2. `PUT /api/applications/:id/files` — one per proof file, with `x-upload-token`
3. `POST /api/applications/:id/complete` — marks it New and (optionally) emails the club

If an upload fails, pressing Send again resumes without making a duplicate application.

Spam guards: hidden honeypot field, a minimum fill time, link/code filtering on text fields, Turnstile, and at most 5 applications per connection per hour (15 per day).

`/api/health` returns `gutter-gussie ok` after a database check; mazzagotte.dev watches it.

## Content notes

- The archival photos (emblem, 1977–78 championship photo, 2008 portraits) came from the club's illustrated history. Photographer credits and republication permission weren't established — confirm before promoting the site widely, and swap in higher-resolution copies if the club has them (`public/assets/`).
- Officers, Hall of Fame, history and result links are in `public/index.html`.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # DEV_NO_AUTH=1 opens /admin locally only
npm run db:local
npm run dev                      # http://localhost:8787 and http://localhost:8787/admin
```
