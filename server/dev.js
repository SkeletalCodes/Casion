/* Local preview: serves public/ and the API on one port, the same way Vercel does.
   Usage: DATABASE_URL=postgres://... npm run dev   (then open http://localhost:3000) */
const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env / .env.local if present (KEY=value lines), without overriding real env vars.
for (const f of ['.env', '.env.local']) {
  const p = path.join(__dirname, '..', f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const { handle } = require('./app');

const ROOT = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || process.argv[2] || 3000);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webp': 'image/webp',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handle(req, res);
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end('Forbidden'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`BananaBet running on http://localhost:${PORT}`);
  if (!require('./db').connectionString()) console.log('Note: DATABASE_URL is not set, so sign-up and login will not work until you add one (see README).');
});
