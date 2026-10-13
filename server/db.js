/* Postgres access. One pool per serverless instance; the schema is created on first use.
   Works with any Postgres: Neon / Vercel Postgres (DATABASE_URL or POSTGRES_URL), Supabase, or a local server. */
const { Pool, types } = require('pg');

// numeric -> JS number (balances are stored to the cent, well inside double precision)
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// bigint ids/counts -> number
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

const URL_ENV = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'DATABASE_URL_UNPOOLED'];

function connectionString() {
  for (const k of URL_ENV) if (process.env[k]) return process.env[k];
  return '';
}

let pool = null;
let ready = null;

function getPool() {
  if (pool) return pool;
  const cs = connectionString();
  if (!cs) {
    const err = new Error('Database is not configured. Add a Postgres database in Vercel (Storage → Neon) so DATABASE_URL is set.');
    err.status = 503;
    throw err;
  }
  const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(cs) || /host=\/|sslmode=disable/.test(cs);
  pool = new Pool({
    connectionString: cs,
    ssl: local ? false : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX || 3),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
  });
  pool.on('error', (e) => console.error('pg pool error', e.message));
  return pool;
}

const SCHEMA = `
create table if not exists users (
  id          bigserial primary key,
  email       text not null unique,
  name        text not null,
  pass_hash   text not null,
  role        text not null default 'user',
  balance     numeric(20,2) not null default 0,
  state       jsonb not null default '{}'::jsonb,
  banned      boolean not null default false,
  ban_reason  text,
  bets        integer not null default 0,
  wagered     numeric(20,2) not null default 0,
  paid        numeric(20,2) not null default 0,
  daily_at    timestamptz,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz,
  last_ip     text
);
create unique index if not exists users_name_lower on users (lower(name));

create table if not exists sessions (
  token_hash  text primary key,
  user_id     bigint not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  ip          text,
  ua          text
);
create index if not exists sessions_user on sessions (user_id);

create table if not exists bets (
  id          bigserial primary key,
  user_id     bigint not null references users(id) on delete cascade,
  game        text not null,
  wager       numeric(20,2) not null,
  payout      numeric(20,2) not null,
  mult        numeric(16,4) not null,
  created_at  timestamptz not null default now()
);
create index if not exists bets_created on bets (created_at desc);
create index if not exists bets_user on bets (user_id, created_at desc);

create table if not exists ledger (
  id            bigserial primary key,
  user_id       bigint not null references users(id) on delete cascade,
  kind          text not null,
  amount        numeric(20,2) not null,
  balance_after numeric(20,2) not null,
  note          text,
  actor_id      bigint,
  created_at    timestamptz not null default now()
);
create index if not exists ledger_user on ledger (user_id, created_at desc);
create index if not exists ledger_created on ledger (created_at desc);

create table if not exists op_batches (
  id          text primary key,
  user_id     bigint not null references users(id) on delete cascade,
  balance     numeric(20,2) not null,
  created_at  timestamptz not null default now()
);

create table if not exists auth_fails (
  key         text not null,
  created_at  timestamptz not null default now()
);
create index if not exists auth_fails_key on auth_fails (key, created_at);

create table if not exists settings (
  key   text primary key,
  value jsonb not null
);
`;

async function migrate() {
  if (!ready) {
    ready = getPool().query(SCHEMA).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function query(text, params) {
  await migrate();
  return getPool().query(text, params);
}

/** Run fn(client) inside a transaction. */
async function tx(fn) {
  await migrate();
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    try { await client.query('rollback'); } catch (_) { /* connection already gone */ }
    throw e;
  } finally {
    client.release();
  }
}

async function close() {
  if (pool) { const p = pool; pool = null; ready = null; await p.end(); }
}

module.exports = { query, tx, migrate, close, connectionString };
