# Casion

BananaBet — a static, play-money demo casino front end (plain HTML/CSS/JS, no build step).

## Run locally

```sh
python3 serve.py        # http://localhost:8765
```

Opening `index.html` directly in a browser also works.

## Deploy to Vercel

Import this repo in Vercel and deploy with the defaults — `vercel.json` marks it as a
static site with no framework, build or install step, served from the repo root.
Or from the CLI: `npx vercel --prod`.

Routing is hash-based (`#/slots`, `#/vip`, …), so no rewrites are needed.
When you change CSS/JS, bump the `?v=` number on the tags in `index.html` so browsers
pick up the new files.
