/* BananaBet API. One request handler for every /api/* route, shared by the Vercel function
   (api/index.js) and the local dev server (server/dev.js).

   What lives here: accounts, sessions, the play-coin balance, the bet log, a ledger of every
   non-bet balance change, per-user saved state (prefs, favourites, VIP progress...) and the
   admin tools. Balances only change through /api/ops, inside a row-locked transaction. */
const crypto = require('crypto');
const db = require('./db');

const SESSION_COOKIE = 'bb_sid';
const SESSION_DAYS = 30;
const MAX_BODY = 400 * 1024;
const MAX_STATE = 240 * 1024;
const MAX_MONEY = 1e12;
const DEFAULT_ADMIN = 'james.lawsonjr2020@gmail.com';
const CREDIT_KINDS = new Set(['faucet', 'daily', 'rakeback', 'levelup', 'deposit', 'refund', 'bonus']);
const DEFAULT_SETTINGS = { announcement: '', signupsOpen: true, startBalance: 100000 };

/* ---------------- small helpers ---------------- */

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

const round2 = (n) => Math.round(n * 100) / 100;
const adminEmails = () => new Set(String(process.env.ADMIN_EMAILS || DEFAULT_ADMIN).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const isOwnerEmail = (email) => adminEmails().has(String(email || '').toLowerCase());
const isAdmin = (u) => !!u && (u.role === 'admin' || isOwnerEmail(u.email));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function money(v, field) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY) fail(400, `Invalid ${field || 'amount'}.`);
  return round2(n);
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (fwd || req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || '').slice(0, 64);
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || !!(req.socket && req.socket.encrypted);
}

function sessionCookie(req, token, maxAge) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    const s = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    if (s.length > MAX_BODY) fail(413, 'Request too large.');
    try { return s ? JSON.parse(s) : {}; } catch (e) { fail(400, 'Invalid JSON.'); }
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) fail(413, 'Request too large.');
    chunks.push(c);
  }
  const s = Buffer.concat(chunks).toString('utf8');
  try { return s ? JSON.parse(s) : {}; } catch (e) { fail(400, 'Invalid JSON.'); }
}

function send(res, status, body, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (headers) for (const k of Object.keys(headers)) res.setHeader(k, headers[k]);
  res.end(JSON.stringify(body));
}

/* ---------------- passwords ---------------- */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
function scrypt(pw, salt, o) {
  return new Promise((resolve, reject) => crypto.scrypt(pw, salt, o.keylen, { N: o.N, r: o.r, p: o.p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));
}
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const o = { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]), keylen: Buffer.from(parts[5], 'base64').length };
  const key = await scrypt(pw, Buffer.from(parts[4], 'base64'), o);
  return crypto.timingSafeEqual(key, Buffer.from(parts[5], 'base64'));
}
let dummyHash = null;
const burnTime = async (pw) => { dummyHash = dummyHash || (await hashPassword('not-a-real-password')); await verifyPassword(pw, dummyHash); };

function safeEqual(a, b) {
  const x = Buffer.from(sha256(String(a))), y = Buffer.from(sha256(String(b)));
  return crypto.timingSafeEqual(x, y);
}

/* ---------------- validation ---------------- */

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const NAME_RE = /^[A-Za-z0-9_.-]{2,16}$/;
function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e) || e.length > 254) fail(400, 'Enter a valid email address.', { field: 'email' });
  return e;
}
function cleanName(v) {
  const n = String(v || '').trim();
  if (!NAME_RE.test(n)) fail(400, 'Usernames are 2–16 letters, numbers, dots, dashes or underscores.', { field: 'name' });
  return n;
}
function cleanPassword(v, field) {
  const p = String(v || '');
  if (p.length < 8) fail(400, 'Passwords need at least 8 characters.', { field: field || 'password' });
  if (p.length > 200) fail(400, 'That password is too long.', { field: field || 'password' });
  return p;
}

/* ---------------- settings ---------------- */

let settingsCache = null;
let settingsAt = 0;
async function getSettings(fresh) {
  if (!fresh && settingsCache && Date.now() - settingsAt < 15000) return settingsCache;
  const { rows } = await db.query('select key, value from settings');
  const s = Object.assign({}, DEFAULT_SETTINGS);
  rows.forEach((r) => { if (r.key in s) s[r.key] = r.value; });
  settingsCache = s;
  settingsAt = Date.now();
  return s;
}
const publicSettings = (s) => ({ announcement: s.announcement, signupsOpen: s.signupsOpen, startBalance: s.startBalance });

/* ---------------- rate limiting (failed logins, sign-ups, setup-key guesses) ---------------- */

async function tooMany(key, max, minutes) {
  const { rows } = await db.query(`select count(*)::int as n from auth_fails where key = $1 and created_at > now() - make_interval(mins => $2)`, [key, minutes]);
  return rows[0].n >= max;
}
async function noteFail(key) {
  await db.query('insert into auth_fails (key) values ($1)', [key]);
  if (Math.random() < 0.05) await db.query(`delete from auth_fails where created_at < now() - interval '1 day'`);
}

/* ---------------- sessions ---------------- */

async function createSession(req, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query(
    `insert into sessions (token_hash, user_id, expires_at, ip, ua) values ($1, $2, now() + make_interval(days => $3), $4, $5)`,
    [sha256(token), userId, SESSION_DAYS, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 200)],
  );
  if (Math.random() < 0.05) await db.query('delete from sessions where expires_at < now()');
  return sessionCookie(req, token, SESSION_DAYS * 86400);
}

async function sessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || token.length > 100) return null;
  const { rows } = await db.query(
    `select u.*, s.token_hash from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()`,
    [sha256(token)],
  );
  const u = rows[0];
  if (!u) return null;
  if (!u.last_seen || Date.now() - new Date(u.last_seen).getTime() > 60000) {
    db.query('update users set last_seen = now(), last_ip = $2 where id = $1', [u.id, clientIp(req)]).catch(() => {});
  }
  return u;
}

function meView(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: isAdmin(u) ? 'admin' : u.role,
    isAdmin: isAdmin(u),
    owner: isOwnerEmail(u.email),
    balance: u.balance,
    createdAt: new Date(u.created_at).getTime(),
    banned: u.banned,
    state: u.state || {},
  };
}

/* ---------------- routes ---------------- */

const routes = [];
const route = (method, pattern, opts, fn) => {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, auth: opts.auth || null, fn });
};

route('GET', 'health', async () => {
  try { await db.query('select 1'); return { ok: true, db: true }; } catch (e) { return { ok: true, db: false, error: e.message }; }
});

route('GET', 'me', async ({ user }) => {
  const s = await getSettings();
  if (user && user.banned) return { user: null, banned: user.ban_reason || 'This account has been suspended.', settings: publicSettings(s) };
  return { user: user ? meView(user) : null, settings: publicSettings(s) };
});

route('POST', 'auth/register', async ({ req, body }) => {
  const ip = clientIp(req);
  const name = cleanName(body.name);
  const email = cleanEmail(body.email);
  const password = cleanPassword(body.password);
  const s = await getSettings(true);
  const owner = isOwnerEmail(email);
  if (await tooMany('reg:' + ip, 20, 60)) fail(429, 'Too many sign-ups from this network. Try again in an hour.');

  if (owner) {
    // The owner's address can't be claimed by whoever signs up first: it needs the setup key.
    const key = process.env.ADMIN_SETUP_KEY || '';
    if (!key) fail(403, 'This email belongs to the site owner. Set ADMIN_SETUP_KEY in Vercel, then enter it here to claim the account.', { code: 'setup_key' });
    if (await tooMany('setup:' + ip, 8, 60)) fail(429, 'Too many attempts. Try again in an hour.');
    if (!body.setupKey) fail(403, 'This email belongs to the site owner. Enter the admin setup key to claim it.', { code: 'setup_key' });
    if (!safeEqual(body.setupKey, key)) { await noteFail('setup:' + ip); fail(403, 'That setup key is wrong.', { code: 'setup_key', field: 'setupKey' }); }
  } else if (!s.signupsOpen) {
    fail(403, 'Sign-ups are closed right now.');
  }

  const hash = await hashPassword(password);
  const existing = (await db.query('select id from users where email = $1', [email])).rows[0];
  let id;
  if (existing && owner) {
    // Owner recovery: the setup key proves ownership, so reset the password and unlock the account.
    await db.query(`update users set pass_hash = $2, role = 'admin', banned = false, ban_reason = null where id = $1`, [existing.id, hash]);
    await db.query('delete from sessions where user_id = $1', [existing.id]);
    id = existing.id;
  } else {
    if (existing) fail(409, 'That email is already registered. Log in instead.', { field: 'email' });
    const taken = (await db.query('select 1 from users where lower(name) = lower($1)', [name])).rows[0];
    if (taken) fail(409, 'That username is taken.', { field: 'name' });
    await noteFail('reg:' + ip);
    const start = Number(s.startBalance) || DEFAULT_SETTINGS.startBalance;
    try {
      id = await db.tx(async (c) => {
        const { rows } = await c.query(
          `insert into users (email, name, pass_hash, role, balance, last_seen, last_ip) values ($1, $2, $3, $4, $5, now(), $6) returning id`,
          [email, name, hash, owner ? 'admin' : 'user', start, ip],
        );
        await c.query(`insert into ledger (user_id, kind, amount, balance_after, note) values ($1, 'welcome', $2, $2, 'Welcome balance')`, [rows[0].id, start]);
        return rows[0].id;
      });
    } catch (e) {
      if (e.code === '23505') fail(409, /name/.test(e.constraint || '') ? 'That username is taken.' : 'That email is already registered.');
      throw e;
    }
  }
  const cookie = await createSession(req, id);
  const user = (await db.query('select * from users where id = $1', [id])).rows[0];
  return { status: existing ? 200 : 201, headers: { 'Set-Cookie': cookie }, body: { user: meView(user), settings: publicSettings(s), recovered: !!existing } };
});

route('POST', 'auth/login', async ({ req, body }) => {
  const ip = clientIp(req);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) fail(400, 'Enter your email and password.');
  if (await tooMany('login-ip:' + ip, 40, 15) || await tooMany('login:' + email, 10, 15)) fail(429, 'Too many failed attempts. Wait 15 minutes and try again.');
  const u = (await db.query('select * from users where email = $1', [email])).rows[0];
  if (!u) { await burnTime(password); await noteFail('login-ip:' + ip); await noteFail('login:' + email); fail(401, 'Wrong email or password.'); }
  if (!(await verifyPassword(password, u.pass_hash))) { await noteFail('login-ip:' + ip); await noteFail('login:' + email); fail(401, 'Wrong email or password.'); }
  if (u.banned) fail(403, u.ban_reason ? `This account is suspended: ${u.ban_reason}` : 'This account has been suspended.');
  await db.query('delete from auth_fails where key = $1', ['login:' + email]);
  const cookie = await createSession(req, u.id);
  return { headers: { 'Set-Cookie': cookie }, body: { user: meView(u), settings: publicSettings(await getSettings()) } };
});

route('POST', 'auth/logout', async ({ req, user }) => {
  if (user) await db.query('delete from sessions where token_hash = $1', [user.token_hash]);
  return { headers: { 'Set-Cookie': sessionCookie(req, '', 0) }, body: { ok: true } };
});

route('POST', 'auth/password', { auth: 'user' }, async ({ user, body }) => {
  const next = cleanPassword(body.next, 'next');
  if (!(await verifyPassword(String(body.current || ''), user.pass_hash))) fail(400, 'Current password is wrong.', { field: 'current' });
  await db.query('update users set pass_hash = $2 where id = $1', [user.id, await hashPassword(next)]);
  // sign out every other device
  await db.query('delete from sessions where user_id = $1 and token_hash <> $2', [user.id, user.token_hash]);
  return { ok: true };
});

route('POST', 'me/profile', { auth: 'user' }, async ({ user, body }) => {
  const name = cleanName(body.name);
  if (name.toLowerCase() !== user.name.toLowerCase()) {
    const taken = (await db.query('select 1 from users where lower(name) = lower($1) and id <> $2', [name, user.id])).rows[0];
    if (taken) fail(409, 'That username is taken.', { field: 'name' });
  }
  await db.query('update users set name = $2 where id = $1', [user.id, name]);
  return { ok: true, name };
});

route('PUT', 'me/state', { auth: 'user' }, async ({ user, body }) => {
  const state = body && body.state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) fail(400, 'Invalid state.');
  const json = JSON.stringify(state);
  if (json.length > MAX_STATE) fail(413, 'Saved data is too large.');
  await db.query('update users set state = $2::jsonb where id = $1', [user.id, json]);
  return { ok: true };
});

route('POST', 'me/reset', { auth: 'user' }, async ({ user }) => {
  const s = await getSettings();
  const start = Number(s.startBalance) || DEFAULT_SETTINGS.startBalance;
  await db.tx(async (c) => {
    await c.query('delete from bets where user_id = $1', [user.id]);
    await c.query(`update users set balance = $2, state = '{}'::jsonb, bets = 0, wagered = 0, paid = 0, daily_at = null where id = $1`, [user.id, start]);
    await c.query(`insert into ledger (user_id, kind, amount, balance_after, note) values ($1, 'reset', $2, $2, 'Account reset')`, [user.id, start]);
  });
  const u = (await db.query('select * from users where id = $1', [user.id])).rows[0];
  return { user: meView(u) };
});

route('DELETE', 'me', { auth: 'user' }, async ({ req, user, body }) => {
  if (isOwnerEmail(user.email)) fail(400, "The owner account can't be deleted.");
  if (!(await verifyPassword(String(body.password || ''), user.pass_hash))) fail(400, 'Password is wrong.', { field: 'password' });
  await db.query('delete from users where id = $1', [user.id]);
  return { headers: { 'Set-Cookie': sessionCookie(req, '', 0) }, body: { ok: true } };
});

/* Balance changes. The browser queues them as it plays and sends them in batches:
   stake  {a}            take a wager off the balance (refused if it can't be covered)
   pay    {a}            pay a win or return a stake
   bet    {g, w, m, p}   record a settled round in the bet log
   credit {a, r}         faucet, daily bonus, rakeback, level-up bonus, (simulated) deposit, refund
   debit  {a, r}         (simulated) withdrawal
   A batch id makes retries safe: a batch is applied at most once. */
route('POST', 'ops', { auth: 'user' }, async ({ user, body }) => {
  const id = String(body.id || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) fail(400, 'Invalid batch id.');
  const ops = Array.isArray(body.ops) ? body.ops : null;
  if (!ops || !ops.length || ops.length > 250) fail(400, 'Invalid batch.');
  const s = await getSettings();
  const start = Number(s.startBalance) || DEFAULT_SETTINGS.startBalance;

  return db.tx(async (c) => {
    const u = (await c.query('select id, balance, bets, wagered, paid, daily_at, banned from users where id = $1 for update', [user.id])).rows[0];
    if (!u || u.banned) fail(403, 'This account has been suspended.');
    const done = (await c.query('select balance from op_batches where id = $1 and user_id = $2', [id, user.id])).rows[0];
    if (done) return { ok: true, balance: u.balance, duplicate: true };

    let bal = u.balance, nBets = u.bets, wagered = u.wagered, paid = u.paid, dailyAt = u.daily_at;
    const betRows = { g: [], w: [], p: [], m: [] };
    const ledger = [];
    let rejected = null;

    for (let i = 0; i < ops.length && !rejected; i++) {
      const op = ops[i] || {};
      switch (op.k) {
        case 'stake': {
          const a = money(op.a);
          if (a > bal + 0.001) { rejected = { i, error: 'Not enough balance for that bet.' }; break; }
          bal = round2(bal - a);
          break;
        }
        case 'pay': {
          bal = round2(bal + money(op.a));
          break;
        }
        case 'bet': {
          const g = String(op.g || '');
          if (!/^[a-z0-9-]{1,32}$/.test(g)) fail(400, 'Invalid game id.');
          const w = money(op.w, 'wager'), p = money(op.p, 'payout');
          const m = Number(op.m);
          if (!Number.isFinite(m) || m < 0 || m > 1e9) fail(400, 'Invalid multiplier.');
          betRows.g.push(g); betRows.w.push(w); betRows.p.push(p); betRows.m.push(Math.round(m * 10000) / 10000);
          nBets++; wagered = round2(wagered + w); paid = round2(paid + p);
          break;
        }
        case 'credit': {
          const r = String(op.r || 'bonus');
          if (!CREDIT_KINDS.has(r)) fail(400, 'Unknown credit type.');
          let a = Math.min(money(op.a), 1e9);
          if (r === 'faucet') a = round2(Math.max(0, Math.min(a, start - bal)));
          if (r === 'daily') {
            if (dailyAt && Date.now() - new Date(dailyAt).getTime() < 20 * 3600 * 1000) { rejected = { i, error: 'The daily bonus was already claimed.' }; break; }
            dailyAt = new Date();
          }
          if (a <= 0) break;
          bal = round2(bal + a);
          ledger.push([r, a, bal, String(op.n || '').slice(0, 120) || null]);
          break;
        }
        case 'debit': {
          const a = money(op.a);
          if (a > bal + 0.001) { rejected = { i, error: 'Not enough balance.' }; break; }
          bal = round2(bal - a);
          ledger.push([String(op.r || 'withdrawal').slice(0, 20), -a, bal, String(op.n || '').slice(0, 120) || null]);
          break;
        }
        default:
          fail(400, 'Unknown operation.');
      }
    }

    if (betRows.g.length) {
      await c.query(
        `insert into bets (user_id, game, wager, payout, mult) select $1, g, w, p, m from unnest($2::text[], $3::numeric[], $4::numeric[], $5::numeric[]) as t(g, w, p, m)`,
        [user.id, betRows.g, betRows.w, betRows.p, betRows.m],
      );
    }
    for (const [kind, amount, after, note] of ledger) {
      await c.query('insert into ledger (user_id, kind, amount, balance_after, note) values ($1, $2, $3, $4, $5)', [user.id, kind, amount, after, note]);
    }
    await c.query('update users set balance = $2, bets = $3, wagered = $4, paid = $5, daily_at = $6 where id = $1', [user.id, bal, nBets, wagered, paid, dailyAt]);
    await c.query('insert into op_batches (id, user_id, balance) values ($1, $2, $3)', [id, user.id, bal]);
    if (Math.random() < 0.02) await c.query(`delete from op_batches where created_at < now() - interval '2 days'`);
    return rejected ? { ok: false, balance: bal, rejected } : { ok: true, balance: bal };
  });
});

/* Public bet feed: the latest rounds and big wins from every player. */
route('GET', 'feed', async ({ user }) => {
  const me = user ? user.id : 0;
  const cols = `b.id, b.game, b.wager, b.payout, b.mult, extract(epoch from b.created_at) * 1000 as t,
    case when coalesce(u.state->'prefs'->>'ghost', 'false') = 'true' then null else u.name end as name, (u.id = $1) as mine`;
  const [recent, big] = await Promise.all([
    db.query(`select ${cols} from bets b join users u on u.id = b.user_id order by b.id desc limit 24`, [me]),
    db.query(`select ${cols} from bets b join users u on u.id = b.user_id where b.payout > 0 and b.mult >= 5 and b.created_at > now() - interval '30 days' order by b.id desc limit 24`, [me]),
  ]);
  const map = (r) => ({ id: r.id, game: r.game, wager: r.wager, payout: r.payout, mult: r.mult, t: Math.round(r.t), name: r.name, mine: r.mine });
  return { recent: recent.rows.map(map), big: big.rows.map(map) };
});

/* ---------------- admin ---------------- */

const USER_COLS = `id, email, name, role, balance, banned, ban_reason, bets, wagered, paid, created_at, last_seen, last_ip`;
function adminUserView(u) {
  return {
    id: u.id, email: u.email, name: u.name, role: isAdmin(u) ? 'admin' : u.role, owner: isOwnerEmail(u.email),
    balance: u.balance, banned: u.banned, banReason: u.ban_reason, bets: u.bets, wagered: u.wagered, paid: u.paid,
    profit: round2(u.paid - u.wagered), createdAt: u.created_at, lastSeen: u.last_seen, lastIp: u.last_ip,
  };
}

route('GET', 'admin/overview', { auth: 'admin' }, async () => {
  const q = (sql, p) => db.query(sql, p).then((r) => r.rows);
  const [users, bets, all, days, signups, games, recent, top] = await Promise.all([
    q(`select count(*)::int as total,
              count(*) filter (where created_at > now() - interval '24 hours')::int as new24,
              count(*) filter (where last_seen > now() - interval '24 hours')::int as active24,
              count(*) filter (where last_seen > now() - interval '5 minutes')::int as online,
              count(*) filter (where banned)::int as banned,
              coalesce(sum(balance), 0) as balances
       from users`),
    q(`select count(*)::int as n, coalesce(sum(wager), 0) as wagered, coalesce(sum(payout), 0) as paid
       from bets where created_at > now() - interval '24 hours'`),
    q(`select count(*)::int as n, coalesce(sum(wager), 0) as wagered, coalesce(sum(payout), 0) as paid from bets`),
    q(`select to_char(d, 'YYYY-MM-DD') as day, coalesce(b.n, 0)::int as bets, coalesce(b.w, 0) as wagered, coalesce(b.p, 0) as paid
       from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d
       left join (select date_trunc('day', created_at) as day, count(*) as n, sum(wager) as w, sum(payout) as p
                  from bets where created_at > now() - interval '14 days' group by 1) b on b.day = d
       order by d`),
    q(`select to_char(d, 'YYYY-MM-DD') as day, coalesce(x.n, 0)::int as n
       from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d
       left join (select date_trunc('day', created_at) as day, count(*) as n from users
                  where created_at > now() - interval '14 days' group by 1) x on x.day = d
       order by d`),
    q(`select game, count(*)::int as bets, sum(wager) as wagered, sum(wager) - sum(payout) as house
       from bets where created_at > now() - interval '7 days' group by game order by sum(wager) desc limit 10`),
    q(`select ${USER_COLS} from users order by created_at desc limit 6`),
    q(`select ${USER_COLS} from users order by wagered desc limit 6`),
  ]);
  return {
    users: users[0],
    day: { bets: bets[0].n, wagered: bets[0].wagered, paid: bets[0].paid, house: round2(bets[0].wagered - bets[0].paid) },
    all: { bets: all[0].n, wagered: all[0].wagered, paid: all[0].paid, house: round2(all[0].wagered - all[0].paid) },
    days, signups, games,
    recent: recent.map(adminUserView),
    top: top.map(adminUserView),
  };
});

const SORTS = { created: 'created_at', balance: 'balance', wagered: 'wagered', bets: 'bets', seen: 'last_seen', name: 'lower(name)' };
route('GET', 'admin/users', { auth: 'admin' }, async ({ query }) => {
  const q = String(query.q || '').trim().slice(0, 100);
  const sort = SORTS[query.sort] || 'created_at';
  const dir = query.dir === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const offset = Math.max(0, Number(query.offset) || 0);
  const filter = query.filter === 'banned' ? 'and banned' : query.filter === 'admins' ? `and role = 'admin'` : query.filter === 'online' ? `and last_seen > now() - interval '5 minutes'` : '';
  const where = `where ($1 = '' or email ilike '%' || $1 || '%' or name ilike '%' || $1 || '%' or id::text = $1) ${filter}`;
  const [rows, count] = await Promise.all([
    db.query(`select ${USER_COLS} from users ${where} order by ${sort} ${dir} nulls last, id desc limit $2 offset $3`, [q, limit, offset]),
    db.query(`select count(*)::int as n from users ${where}`, [q]),
  ]);
  return { users: rows.rows.map(adminUserView), total: count.rows[0].n };
});

async function loadUser(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) fail(400, 'Invalid user id.');
  const u = (await db.query('select * from users where id = $1', [n])).rows[0];
  if (!u) fail(404, 'User not found.');
  return u;
}

route('GET', 'admin/users/:id', { auth: 'admin' }, async ({ params }) => {
  const u = await loadUser(params.id);
  const [bets, ledger, sessions, games] = await Promise.all([
    db.query('select id, game, wager, payout, mult, created_at from bets where user_id = $1 order by id desc limit 30', [u.id]),
    db.query(`select l.id, l.kind, l.amount, l.balance_after, l.note, l.created_at, a.name as actor
              from ledger l left join users a on a.id = l.actor_id where l.user_id = $1 order by l.id desc limit 30`, [u.id]),
    db.query('select count(*)::int as n, max(created_at) as last from sessions where user_id = $1 and expires_at > now()', [u.id]),
    db.query(`select game, count(*)::int as bets, sum(wager) as wagered, sum(payout) - sum(wager) as profit
              from bets where user_id = $1 group by game order by sum(wager) desc limit 12`, [u.id]),
  ]);
  return { user: adminUserView(u), bets: bets.rows, ledger: ledger.rows, sessions: sessions.rows[0], games: games.rows };
});

route('POST', 'admin/users/:id', { auth: 'admin' }, async ({ user, params, body }) => {
  const u = await loadUser(params.id);
  const self = u.id === user.id;
  const sets = [], vals = [u.id];
  const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (body.name !== undefined) {
    const name = cleanName(body.name);
    const taken = (await db.query('select 1 from users where lower(name) = lower($1) and id <> $2', [name, u.id])).rows[0];
    if (taken) fail(409, 'That username is taken.');
    set('name', name);
  }
  if (body.role !== undefined) {
    if (!['user', 'admin'].includes(body.role)) fail(400, 'Invalid role.');
    if (self || isOwnerEmail(u.email)) fail(400, "You can't change the owner's or your own role.");
    set('role', body.role);
  }
  if (body.banned !== undefined) {
    if (self || isOwnerEmail(u.email)) fail(400, "You can't suspend the owner or yourself.");
    set('banned', !!body.banned);
    set('ban_reason', body.banned ? String(body.banReason || '').slice(0, 200) || null : null);
  }
  if (!sets.length) fail(400, 'Nothing to change.');
  await db.query(`update users set ${sets.join(', ')} where id = $1`, vals);
  if (body.banned) await db.query('delete from sessions where user_id = $1', [u.id]);
  return { user: adminUserView((await db.query('select * from users where id = $1', [u.id])).rows[0]) };
});

route('POST', 'admin/users/:id/balance', { auth: 'admin' }, async ({ user, params, body }) => {
  const target = await loadUser(params.id);
  const mode = body.mode === 'set' ? 'set' : 'add';
  const raw = Number(body.amount);
  if (!Number.isFinite(raw) || Math.abs(raw) > MAX_MONEY) fail(400, 'Enter an amount.');
  const note = String(body.note || '').trim().slice(0, 160) || null;
  const out = await db.tx(async (c) => {
    const cur = (await c.query('select balance from users where id = $1 for update', [target.id])).rows[0].balance;
    const next = round2(mode === 'set' ? Math.max(0, raw) : Math.max(0, cur + raw));
    const delta = round2(next - cur);
    if (delta === 0) fail(400, 'That would not change the balance.');
    await c.query('update users set balance = $2 where id = $1', [target.id, next]);
    await c.query(`insert into ledger (user_id, kind, amount, balance_after, note, actor_id) values ($1, 'admin', $2, $3, $4, $5)`, [target.id, delta, next, note, user.id]);
    return { balance: next, delta };
  });
  return out;
});

route('POST', 'admin/users/:id/logout', { auth: 'admin' }, async ({ params }) => {
  const u = await loadUser(params.id);
  const r = await db.query('delete from sessions where user_id = $1', [u.id]);
  return { ok: true, ended: r.rowCount };
});

route('POST', 'admin/users/:id/password', { auth: 'admin' }, async ({ user, params, body }) => {
  const u = await loadUser(params.id);
  if (isOwnerEmail(u.email) && u.id !== user.id) fail(400, "You can't reset the owner's password.");
  const pw = cleanPassword(body.password);
  await db.query('update users set pass_hash = $2 where id = $1', [u.id, await hashPassword(pw)]);
  await db.query('delete from sessions where user_id = $1', [u.id]);
  return { ok: true };
});

route('DELETE', 'admin/users/:id', { auth: 'admin' }, async ({ user, params }) => {
  const u = await loadUser(params.id);
  if (u.id === user.id || isOwnerEmail(u.email)) fail(400, "You can't delete the owner or yourself.");
  await db.query('delete from users where id = $1', [u.id]);
  return { ok: true };
});

route('GET', 'admin/bets', { auth: 'admin' }, async ({ query }) => {
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
  const offset = Math.max(0, Number(query.offset) || 0);
  const game = String(query.game || '').slice(0, 32);
  const uid = Number(query.user) || 0;
  const big = query.big === '1';
  const where = `where ($1 = '' or b.game = $1) and ($2 = 0 or b.user_id = $2) ${big ? 'and b.payout > 0 and b.mult >= 10' : ''}`;
  const [rows, count, gameList] = await Promise.all([
    db.query(`select b.id, b.game, b.wager, b.payout, b.mult, b.created_at, u.id as user_id, u.name from bets b join users u on u.id = b.user_id ${where} order by b.id desc limit $3 offset $4`, [game, uid, limit, offset]),
    db.query(`select count(*)::int as n from bets b ${where}`, [game, uid]),
    db.query('select distinct game from bets order by game'),
  ]);
  return { bets: rows.rows, total: count.rows[0].n, games: gameList.rows.map((r) => r.game) };
});

route('GET', 'admin/ledger', { auth: 'admin' }, async ({ query }) => {
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
  const offset = Math.max(0, Number(query.offset) || 0);
  const kind = String(query.kind || '').slice(0, 20);
  const where = `where ($1 = '' or l.kind = $1)`;
  const [rows, count] = await Promise.all([
    db.query(`select l.id, l.kind, l.amount, l.balance_after, l.note, l.created_at, u.id as user_id, u.name, a.name as actor
              from ledger l join users u on u.id = l.user_id left join users a on a.id = l.actor_id ${where} order by l.id desc limit $2 offset $3`, [kind, limit, offset]),
    db.query(`select count(*)::int as n from ledger l ${where}`, [kind]),
  ]);
  return { entries: rows.rows, total: count.rows[0].n };
});

route('GET', 'admin/settings', { auth: 'admin' }, async () => ({ settings: await getSettings(true) }));

route('POST', 'admin/settings', { auth: 'admin' }, async ({ body }) => {
  const next = {};
  if (body.announcement !== undefined) next.announcement = String(body.announcement || '').trim().slice(0, 280);
  if (body.signupsOpen !== undefined) next.signupsOpen = !!body.signupsOpen;
  if (body.startBalance !== undefined) {
    const n = Number(body.startBalance);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) fail(400, 'Starting balance must be between 0 and 1,000,000,000.');
    next.startBalance = round2(n);
  }
  for (const k of Object.keys(next)) {
    await db.query('insert into settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value', [k, JSON.stringify(next[k])]);
  }
  return { settings: await getSettings(true) };
});

/* ---------------- dispatcher ---------------- */

async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://local');
    let path = url.searchParams.get('__path');
    if (path === null) path = url.pathname.replace(/^\/api\/?/, '');
    path = path.replace(/^\/+|\/+$/g, '');
    const query = Object.fromEntries(url.searchParams.entries());
    const method = req.method === 'HEAD' ? 'GET' : req.method;

    const hit = routes.find((r) => r.method === method && r.re.test(path));
    if (!hit) {
      const other = routes.some((r) => r.re.test(path));
      return send(res, other ? 405 : 404, { error: other ? 'Method not allowed.' : 'Not found.' });
    }
    // Writes must come from our own page: browsers won't send this header cross-site without a CORS preflight we never grant.
    if (method !== 'GET' && req.headers['x-requested-with'] !== 'bb') return send(res, 403, { error: 'Missing request header.' });

    const m = path.match(hit.re);
    const params = {};
    hit.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    const body = method === 'GET' ? {} : await readBody(req);
    const user = await sessionUser(req);
    if (hit.auth && (!user || user.banned)) return send(res, 401, { error: 'Please log in.' });
    if (hit.auth === 'admin' && !isAdmin(user)) return send(res, 403, { error: 'Admins only.' });

    const out = await hit.fn({ req, res, user, body, params, query });
    if (out && out.body !== undefined && (out.headers || out.status)) return send(res, out.status || 200, out.body, out.headers);
    return send(res, 200, out || { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, Object.assign({ error: e.message }, e.extra || {}));
    if (e.status === 503) return send(res, 503, { error: e.message, code: 'no_db' });
    console.error(e);
    return send(res, 500, { error: 'Something went wrong on the server.' });
  }
}

module.exports = { handle, hashPassword, verifyPassword, isOwnerEmail };
