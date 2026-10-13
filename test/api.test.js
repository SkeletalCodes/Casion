/* API tests against a real Postgres. Run with a throwaway database:
   TEST_DATABASE_URL=postgres://postgres@localhost:5432/casion_test npm test
   Every table is dropped and recreated first, so never point this at real data. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const URL_ = process.env.TEST_DATABASE_URL;
const OWNER = 'owner@example.com';

if (!URL_) {
  test('api (skipped: set TEST_DATABASE_URL to run)', { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = URL_;
  process.env.ADMIN_EMAILS = OWNER;
  process.env.ADMIN_SETUP_KEY = 'letmein-123';
  const db = require('../server/db');
  const { handle } = require('../server/app');
  let server, base;

  /** Tiny cookie-keeping client. */
  function client() {
    let cookie = '';
    return async (method, path, body, headers) => {
      const r = await fetch(base + '/api/' + path, {
        method,
        headers: Object.assign({ 'content-type': 'application/json', 'x-requested-with': 'bb', cookie }, headers || {}),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = r.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: r.status, body: await r.json() };
    };
  }
  const batch = () => 'b' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

  test.before(async () => {
    const { Pool } = require('pg');
    const p = new Pool({ connectionString: URL_ });
    await p.query('drop table if exists bets, ledger, sessions, op_batches, auth_fails, settings, users cascade');
    await p.end();
    server = http.createServer(handle);
    await new Promise((r) => server.listen(0, r));
    base = 'http://127.0.0.1:' + server.address().port;
  });
  test.after(async () => { server.close(); await db.close(); });

  test('register, session and me', async () => {
    const c = client();
    let r = await c('GET', 'me');
    assert.equal(r.status, 200);
    assert.equal(r.body.user, null);
    r = await c('POST', 'auth/register', { name: 'alice', email: 'Alice@Example.com', password: 'hunter22!' });
    assert.equal(r.status, 201);
    assert.equal(r.body.user.email, 'alice@example.com');
    assert.equal(r.body.user.balance, 100000);
    assert.equal(r.body.user.isAdmin, false);
    r = await c('GET', 'me');
    assert.equal(r.body.user.name, 'alice');
    r = await c('POST', 'auth/register', { name: 'alice2', email: 'alice@example.com', password: 'hunter22!' });
    assert.equal(r.status, 409);
    r = await c('POST', 'auth/register', { name: 'ALICE', email: 'other@example.com', password: 'hunter22!' });
    assert.equal(r.status, 409, 'usernames are unique regardless of case');
    r = await c('POST', 'auth/register', { name: 'bob', email: 'bob@example.com', password: 'short' });
    assert.equal(r.status, 400);
  });

  test('writes need the same-site header', async () => {
    const c = client();
    const r = await c('POST', 'auth/login', { email: 'alice@example.com', password: 'hunter22!' }, { 'x-requested-with': '' });
    assert.equal(r.status, 403);
  });

  test('login, wrong password, logout', async () => {
    const c = client();
    let r = await c('POST', 'auth/login', { email: 'alice@example.com', password: 'nope-nope' });
    assert.equal(r.status, 401);
    r = await c('POST', 'auth/login', { email: 'alice@example.com', password: 'hunter22!' });
    assert.equal(r.status, 200);
    r = await c('POST', 'auth/logout', {});
    r = await c('GET', 'me');
    assert.equal(r.body.user, null);
  });

  test('ops move the balance, refuse overdrafts and are applied once', async () => {
    const c = client();
    await c('POST', 'auth/login', { email: 'alice@example.com', password: 'hunter22!' });
    const id = batch();
    const ops = [{ k: 'stake', a: 100 }, { k: 'pay', a: 250 }, { k: 'bet', g: 'dice', w: 100, m: 2.5, p: 250 }];
    let r = await c('POST', 'ops', { id, ops });
    assert.equal(r.body.ok, true);
    assert.equal(r.body.balance, 100150);
    r = await c('POST', 'ops', { id, ops });
    assert.equal(r.body.duplicate, true);
    assert.equal(r.body.balance, 100150, 'a retried batch is not applied twice');
    r = await c('POST', 'ops', { id: batch(), ops: [{ k: 'stake', a: 50 }, { k: 'stake', a: 999999999 }, { k: 'pay', a: 5 }] });
    assert.equal(r.body.ok, false);
    assert.equal(r.body.balance, 100100, 'ops before the refused one apply, the rest are dropped');
    r = await c('POST', 'ops', { id: batch(), ops: [{ k: 'credit', a: 5000, r: 'faucet' }] });
    assert.equal(r.body.balance, 100100, 'faucet only tops up to the start balance');
    r = await c('POST', 'ops', { id: batch(), ops: [{ k: 'credit', a: 250, r: 'daily' }] });
    assert.equal(r.body.balance, 100350);
    r = await c('POST', 'ops', { id: batch(), ops: [{ k: 'credit', a: 250, r: 'daily' }] });
    assert.equal(r.body.ok, false, 'daily bonus once per day');
    r = await c('POST', 'ops', { id: batch(), ops: [{ k: 'credit', a: 1, r: 'free-money' }] });
    assert.equal(r.status, 400);
    r = await c('GET', 'feed');
    assert.equal(r.body.recent[0].game, 'dice');
    assert.equal(r.body.recent[0].mine, true);
  });

  test('state round-trips', async () => {
    const c = client();
    await c('POST', 'auth/login', { email: 'alice@example.com', password: 'hunter22!' });
    await c('PUT', 'me/state', { state: { favs: ['dice'], prefs: { ghost: true } } });
    const r = await c('GET', 'me');
    assert.deepEqual(r.body.user.state.favs, ['dice']);
    const f = await c('GET', 'feed');
    assert.equal(f.body.recent[0].name, null, 'ghost mode hides the name in the public feed');
  });

  test('owner email needs the setup key, then gets admin', async () => {
    const c = client();
    let r = await c('POST', 'auth/register', { name: 'owner', email: OWNER, password: 'ownerpass1' });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'setup_key');
    r = await c('POST', 'auth/register', { name: 'owner', email: OWNER, password: 'ownerpass1', setupKey: 'wrong' });
    assert.equal(r.status, 403);
    r = await c('POST', 'auth/register', { name: 'owner', email: OWNER, password: 'ownerpass1', setupKey: 'letmein-123' });
    assert.equal(r.status, 201);
    assert.equal(r.body.user.isAdmin, true);
    r = await c('GET', 'admin/overview');
    assert.equal(r.status, 200);
    assert.ok(r.body.users.total >= 2);
    // recovery: registering again with the key resets the password
    const c2 = client();
    r = await c2('POST', 'auth/register', { name: 'owner', email: OWNER, password: 'newownerpass', setupKey: 'letmein-123' });
    assert.equal(r.status, 200);
    assert.equal(r.body.recovered, true);
    r = await c2('POST', 'auth/login', { email: OWNER, password: 'newownerpass' });
    assert.equal(r.status, 200);
  });

  test('admin tools', async () => {
    const user = client(), admin = client();
    await user('POST', 'auth/login', { email: 'alice@example.com', password: 'hunter22!' });
    let r = await user('GET', 'admin/users');
    assert.equal(r.status, 403, 'players cannot reach admin routes');
    await admin('POST', 'auth/login', { email: OWNER, password: 'newownerpass' });
    r = await admin('GET', 'admin/users?q=alice');
    assert.equal(r.body.total, 1);
    const id = r.body.users[0].id;
    r = await admin('POST', `admin/users/${id}/balance`, { mode: 'add', amount: 1000, note: 'test' });
    assert.equal(r.body.delta, 1000);
    r = await admin('POST', `admin/users/${id}/balance`, { mode: 'set', amount: 42 });
    assert.equal(r.body.balance, 42);
    r = await user('GET', 'me');
    assert.equal(r.body.user.balance, 42);
    r = await admin('GET', `admin/users/${id}`);
    assert.equal(r.body.ledger[0].kind, 'admin');
    assert.equal(r.body.bets[0].game, 'dice');
    r = await admin('POST', `admin/users/${id}`, { banned: true, banReason: 'testing' });
    assert.equal(r.body.user.banned, true);
    r = await user('GET', 'me');
    assert.equal(r.body.user, null, 'a ban ends the session');
    r = await user('POST', 'auth/login', { email: 'alice@example.com', password: 'hunter22!' });
    assert.equal(r.status, 403);
    r = await admin('POST', `admin/users/${id}`, { banned: false });
    r = await admin('POST', 'admin/settings', { announcement: 'Hello players', signupsOpen: false, startBalance: 5000 });
    assert.equal(r.body.settings.announcement, 'Hello players');
    r = await client()('POST', 'auth/register', { name: 'late', email: 'late@example.com', password: 'latepass1' });
    assert.equal(r.status, 403, 'sign-ups can be closed');
    await admin('POST', 'admin/settings', { signupsOpen: true });
    r = await client()('POST', 'auth/register', { name: 'late', email: 'late@example.com', password: 'latepass1' });
    assert.equal(r.body.user.balance, 5000, 'new accounts get the configured start balance');
    const me = (await admin('GET', 'me')).body.user;
    r = await admin('DELETE', `admin/users/${me.id}`, {});
    assert.equal(r.status, 400, 'the owner cannot be deleted');
  });
}
