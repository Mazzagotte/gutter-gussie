# Idaho Gutter Gussie Club — guttergussie.mazzagotte.dev

Mockup of the club website. Static files only (no Worker code, no database). The membership form is a preview and doesn't send anything.

The working version (form that saves applications, proof uploads, club admin) is on the `membership-backend` branch for when it's needed.

## Files

| What | Where |
| --- | --- |
| Page markup (all six pages; the menu switches between them) | `public/index.html` |
| Styles | `public/styles.css` |
| Menu, page switching, form preview, Hall of Fame search | `public/site.js` |
| Fonts and images | `public/assets/` |

`index.html` opens directly in a browser too, no server needed.

Search engines are kept out (`robots.txt`, `noindex`) while it's a mockup.

## Cloudflare setup

Workers & Pages → **Create** → **Import a repository** → `Mazzagotte/gutter-gussie`

- Project name: `gutter-gussie`
- Build command: leave empty
- Deploy command: `npx wrangler deploy`

`wrangler.jsonc` attaches `guttergussie.mazzagotte.dev`. Every push to `main` redeploys.

## Local preview

```bash
npm install
npm run dev   # http://localhost:8787
```
