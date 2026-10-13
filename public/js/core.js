/* BananaBet core: fake auth, play-money balance, stats, router, shared UI.
   Front end only — everything lives in localStorage, nothing talks to a server. */
(function () {
  'use strict';

  const START_BALANCE = 100000;
  const LS_USERS = 'bb.users';
  const LS_SESSION = 'bb.session';

  /* ---------- tiny helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const h = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  const round2 = (n) => Math.round(n * 100) / 100;
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtMult = (x) => (x >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(2)) + '×';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sfx = (name, arg) => { if (window.BB && BB.audio) BB.audio.sfx(name, arg); };
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
  const pad2 = (n) => String(n).padStart(2, '0');
  const dayKey = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  const stamp = (t) => { const d = new Date(t); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
  function ago(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  /* Animation frames that keep running when the browser stops delivering them.
     Embedded previews and background tabs can pause requestAnimationFrame entirely, which used to
     freeze Crash and Plinko mid-round and leave the balance showing an old number. */
  let frameSeq = 0;
  const frames = new Map();
  function frame(fn) {
    const id = ++frameSeq;
    const run = (t) => {
      const f = frames.get(id);
      if (!f) return;
      frames.delete(id);
      cancelAnimationFrame(f.raf);
      clearTimeout(f.timer);
      fn(typeof t === 'number' ? t : performance.now());
    };
    frames.set(id, { raf: requestAnimationFrame(run), timer: setTimeout(run, 110) });
    return id;
  }
  function unframe(id) {
    const f = frames.get(id);
    if (!f) return;
    frames.delete(id);
    cancelAnimationFrame(f.raf);
    clearTimeout(f.timer);
  }

  /* Cosmetic randomness only (fake feed, animations). Game results come from BB.fair. */
  function rand() {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] / 4294967296;
  }
  const randInt = (n) => Math.floor(rand() * n);

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
  };

  function copyText(text, quiet) {
    const fallback = () => {
      const t = document.createElement('textarea');
      t.value = text; t.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      t.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback); else fallback();
    if (!quiet) toast('Copied to clipboard.', 'ok');
  }

  /* ---------- icons (24px stroke set) ---------- */
  const ICONS = {
    wallet: '<path d="M4 7.500A2.500 2.500 0 0 1 6.500 5H17a2 2 0 0 1 2 2v1.500"/><path d="M4 7.500V17a2.500 2.500 0 0 0 2.500 2.500h11A2.500 2.500 0 0 0 20 17v-6a2.500 2.500 0 0 0-2.500-2.500h-11A2.500 2.500 0 0 1 4 7.500z"/><path d="M16 14h.01"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.500 2h-15z"/><path d="M10 20.500a2 2 0 0 0 4 0"/>',
    user: '<circle cx="12" cy="8.500" r="3.500"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    gear: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    clock: '<circle cx="12" cy="12" r="8.500"/><path d="M12 7.500V12l3 2"/>',
    chart: '<path d="M5 19v-8M12 19V5M19 19v-6"/>',
    crown: '<path d="M4.500 17.500l-1.500-9 5 4 4-7 4 7 5-4-1.500 9z"/>',
    shield: '<path d="M12 2.500l8 3v6c0 5-3.400 8.700-8 10-4.600-1.300-8-5-8-10v-6z"/><path d="M8.500 12l2.500 2.500 4.500-5"/>',
    logout: '<path d="M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4M15 8l4 4-4 4M19 12h-9"/>',
    star: '<path d="M12 3.500l2.600 5.400 5.900.8-4.300 4.100 1 5.800-5.200-2.700-5.200 2.700 1-5.800-4.300-4.100 5.900-.8z"/>',
    info: '<circle cx="12" cy="12" r="8.500"/><path d="M12 11v5M12 8h.01"/>',
    gift: '<rect x="4" y="10.500" width="16" height="9.500" rx="1.500"/><path d="M3 7h18v3.500H3zM12 7v13M12 7c-1.500-3-5-3.500-5-1.500S10 7 12 7zm0 0c1.500-3 5-3.500 5-1.500S14 7 12 7z"/>',
    down: '<path d="M12 4v12M6.500 11l5.500 5.500 5.500-5.500M5 20h14"/>',
    up: '<path d="M12 20V8M6.500 13L12 7.500l5.500 5.500M5 4h14"/>',
    expand: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    copy: '<rect x="8.500" y="8.500" width="11" height="11" rx="2"/><path d="M5 15V6a1 1 0 0 1 1-1h9"/>',
    check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
    pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
    drop: '<path d="M12 3.500c3 4 5.500 6.800 5.500 10a5.500 5.500 0 0 1-11 0c0-3.200 2.500-6 5.500-10z"/>',
    home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>',
    sound: '<path d="M4 9.500h3.500L12 5.500v13l-4.500-4H4z"/><path d="M15.500 8.500a5 5 0 0 1 0 7M18 6a8.500 8.500 0 0 1 0 12"/>',
    reset: '<path d="M5 12a7 7 0 1 0 2.200-5.100"/><path d="M5 4.500v3.500h3.500"/>',
    caret: '<path d="M7 10l5 5 5-5"/>',
    bolt: '<path d="M13 3L5 13.500h6L10 21l8-10.500h-6z"/>',
  };
  const ic = (name, size) => `<svg viewBox="0 0 24 24" width="${size || 18}" height="${size || 18}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  /* ---------- VIP ladder (driven by total play coins wagered) ---------- */
  const LEVELS = [
    { name: 'Rookie', at: 0, rake: 0.05, daily: 250, bonus: 0, color: '#8c94a8' },
    { name: 'Bronze', at: 10000, rake: 0.07, daily: 500, bonus: 500, color: '#d6935a' },
    { name: 'Silver', at: 50000, rake: 0.1, daily: 1000, bonus: 2000, color: '#cfd6e4' },
    { name: 'Gold', at: 250000, rake: 0.12, daily: 2500, bonus: 7500, color: '#ffc93c' },
    { name: 'Platinum', at: 1000000, rake: 0.15, daily: 5000, bonus: 25000, color: '#7fe0ff' },
    { name: 'Diamond', at: 5000000, rake: 0.2, daily: 10000, bonus: 100000, color: '#c9a7ff' },
  ];
  function levelOf(wagered) { let i = 0; while (i + 1 < LEVELS.length && wagered >= LEVELS[i + 1].at) i++; return i; }
  function vipInfo(u) {
    const w = u ? u.stats.wagered : 0, i = levelOf(w), cur = LEVELS[i], next = LEVELS[i + 1] || null;
    return { i, cur, next, wagered: w, pct: next ? clamp(((w - cur.at) / (next.at - cur.at)) * 100, 0, 100) : 100, left: next ? Math.max(0, next.at - w) : 0 };
  }

  const AVATARS = [['#ffd95c', '#ff7a1c'], ['#4df5a4', '#0f9d6a'], ['#7cc4ff', '#3b5bff'], ['#ff8fb1', '#e02a6a'], ['#c9a7ff', '#6b3fe0'], ['#5ff0f0', '#0e8fa3'], ['#ffb199', '#e0452a'], ['#e5e9f2', '#8c94a8']];
  function avatarHTML(u, cls) {
    const a = AVATARS[u.avatar] || AVATARS[0];
    return `<span class="avatar${cls ? ' ' + cls : ''}" style="--a1:${a[0]};--a2:${a[1]}">${esc((u.name || '?')[0].toUpperCase())}</span>`;
  }

  /* ---------- fake users (demo only: plain text in localStorage, never do this for real auth) ---------- */
  /** Fill in anything a saved account is missing, so older saves keep working. */
  function prep(u, key) {
    if (!u || typeof u !== 'object') return;
    if (typeof u.balance !== 'number' || !isFinite(u.balance)) u.balance = START_BALANCE;
    u.email = u.email || key;
    u.joined = u.joined || Date.now();
    u.avatar = clamp(u.avatar | 0, 0, AVATARS.length - 1);
    u.prefs = Object.assign({ ghost: false, hideBal: false, hotkeys: true, calm: false, feed: true, coin: 'BTC' }, u.prefs);
    u.stats = Object.assign({ bets: 0, wins: 0, losses: 0, pushes: 0, wagered: 0, paid: 0, big: null, top: null, games: {} }, u.stats);
    ['tx', 'hist', 'favs', 'recent', 'notes'].forEach((k) => { if (!Array.isArray(u[k])) u[k] = []; });
    u.vip = Object.assign({ level: 0, rake: 0, claimed: 0, daily: 0 }, u.vip);
    u.limits = Object.assign({ daily: 0, remind: 0, breakUntil: 0 }, u.limits);
    u.sec = Object.assign({ tfa: false }, u.sec);
    if (!u.day || typeof u.day !== 'object') u.day = { d: '', w: 0 };
  }
  const txId = () => 'T' + Date.now().toString(36).toUpperCase() + randInt(46656).toString(36).toUpperCase().padStart(3, '0');
  function pushTx(u, tx) {
    tx.id = tx.id || txId();
    tx.t = tx.t || Date.now();
    u.tx.unshift(tx);
    if (u.tx.length > 300) u.tx.length = 300;
    return tx;
  }
  function pushNote(u, title, body, kind) {
    u.notes.unshift({ t: Date.now(), title, body, kind: kind || 'info', read: false });
    if (u.notes.length > 30) u.notes.length = 30;
  }
  function welcome(u) {
    pushTx(u, { type: 'bonus', note: 'Welcome balance', usd: START_BALANCE, status: 'completed' });
    pushNote(u, 'Welcome to BananaBet', 'Your account starts with 100,000.00 play coins. Nothing here is real money.', 'gift');
  }

  let users = store.get(LS_USERS, null) || {};
  if (!users.admin) { users.admin = { name: 'admin', pass: 'admin', balance: START_BALANCE }; prep(users.admin, 'admin'); welcome(users.admin); }
  Object.keys(users).forEach((k) => prep(users[k], k));
  let session = store.get(LS_SESSION, null);
  if (session && !users[session]) session = null;
  let since = Date.now();

  const saveUsers = () => store.set(LS_USERS, users);
  const user = () => (session ? users[session] : null);
  const isAuthed = () => !!session;
  const balance = () => (session ? users[session].balance : 0);
  /** Re-read accounts from storage (another tab may have changed them). */
  function refresh() {
    const all = store.get(LS_USERS, null);
    if (!all) return;
    users = all;
    Object.keys(users).forEach((k) => prep(users[k], k));
    if (session && !users[session]) session = null;
  }

  /* ---------- balance ---------- */
  let shown = 0;
  let balAnim = 0;

  function paintBalance(flash) {
    const el = $('#bal-amt');
    if (!el) return;
    const u = user();
    if (u && u.prefs.hideBal) { unframe(balAnim); shown = balance(); el.textContent = '••••••'; }
    else {
      const from = shown, to = balance(), t0 = performance.now();
      unframe(balAnim);
      const step = (now) => {
        const p = Math.min(1, (now - t0) / 380);
        const e = 1 - Math.pow(1 - p, 3);
        shown = from + (to - from) * e;
        el.textContent = fmt(shown);
        if (p < 1) balAnim = frame(step);
        else { shown = to; el.textContent = fmt(to); }
      };
      el.textContent = fmt(from);
      balAnim = frame(step);
    }
    if (flash) {
      const pill = $('#bal-pill');
      pill.classList.remove('up', 'down');
      void pill.offsetWidth;
      pill.classList.add(flash);
    }
  }

  /** A small "+98.00" that drifts off the balance when it changes. */
  function floatDelta(delta) {
    const pill = $('#bal-pill'), u = user();
    if (!pill || !delta || (u && u.prefs.hideBal) || document.body.classList.contains('calm')) return;
    while (pill.querySelectorAll('.bal-float').length >= 3) pill.querySelector('.bal-float').remove();
    const el = h(`<span class="bal-float ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta))}</span>`);
    pill.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  /** Gold coins raining through a box — used for big wins. */
  function coins(box, count) {
    if (!box || document.body.classList.contains('calm')) return;
    const layer = h('<div class="coin-rain"></div>');
    for (let i = 0; i < (count || 24); i++) {
      const c = document.createElement('i');
      c.className = 'coin';
      const size = 14 + rand() * 16;
      c.style.cssText = `left:${rand() * 100}%;width:${size}px;height:${size}px;animation-duration:${1.1 + rand() * 0.9}s;animation-delay:${rand() * 0.5}s;--sway:${rand() * 80 - 40}px`;
      layer.appendChild(c);
    }
    box.appendChild(layer);
    setTimeout(() => layer.remove(), 2700);
  }

  function setBalance(v, flash) {
    if (!session) return;
    const before = users[session].balance;
    users[session].balance = round2(Math.max(0, v));
    saveUsers();
    paintBalance(flash);
    if (flash) floatDelta(round2(users[session].balance - before));
    emit('bb:balance');
  }
  /** Add coins to the balance (rewards, deposits, refunds). */
  function credit(amount, quiet) { if (amount > 0) setBalance(balance() + amount, quiet ? null : 'up'); }

  /** Remove coins (withdrawals). Returns false if the balance can't cover it. */
  function debit(amount) {
    amount = round2(amount);
    if (!session || !(amount > 0) || amount > balance()) return false;
    setBalance(balance() - amount, 'down');
    return true;
  }

  /** Take a wager off the balance. Returns false (and tells the player why) if it can't. */
  function placeBet(amount) {
    if (!session) { openAuth('login'); return false; }
    const u = user();
    amount = round2(amount);
    if (!(amount > 0)) { toast('Enter a bet amount first.', 'err'); return false; }
    if (u.limits.breakUntil > Date.now()) { toast(`You're on a break until ${stamp(u.limits.breakUntil)}.`, 'err'); return false; }
    const today = dayKey();
    if (u.day.d !== today) u.day = { d: today, w: 0 };
    if (u.limits.daily > 0 && u.day.w + amount > u.limits.daily) { toast('That bet would pass your daily wager limit.', 'err'); return false; }
    if (amount > balance()) { toast('Not enough balance — open the wallet to top up.', 'err'); nudge($('.wallet-btn')); return false; }
    u.day.w = round2(u.day.w + amount);
    setBalance(balance() - amount, 'down');
    sfx('bet');
    emit('bb:placed', { amount });
    return true;
  }

  /** Credit a payout (stake included). */
  function win(amount, quiet) {
    if (amount > 0) setBalance(balance() + amount, quiet ? null : 'up');
  }

  /** Top the play balance back up to the starting amount. */
  function faucet() {
    if (!session) { openAuth('login'); return false; }
    if (balance() >= START_BALANCE) { toast('The faucet only tops you up to 100,000.00 — you already have that.', ''); return false; }
    const add = round2(START_BALANCE - balance());
    pushTx(user(), { type: 'faucet', note: 'Demo faucet', usd: add, status: 'completed' });
    setBalance(START_BALANCE, 'up');
    emit('bb:tx');
    toast(`Faucet: +${fmt(add)} play coins.`, 'ok');
    return true;
  }

  /* ---------- bet log + lifetime stats ---------- */
  const bets = [];
  const live = { profit: 0, wagered: 0, wins: 0, losses: 0, pts: [0] };

  function track(u, b) {
    const s = u.stats, net = round2(b.payout - b.wager);
    s.bets++;
    s.wagered = round2(s.wagered + b.wager);
    s.paid = round2(s.paid + b.payout);
    if (net > 0) s.wins++; else if (net < 0) s.losses++; else s.pushes++;
    const gs = s.games[b.id] || (s.games[b.id] = { bets: 0, wagered: 0, paid: 0, wins: 0 });
    gs.bets++; gs.wagered = round2(gs.wagered + b.wager); gs.paid = round2(gs.paid + b.payout); if (net > 0) gs.wins++;
    if (net > 0 && (!s.big || net > s.big.net)) s.big = { id: b.id, net, mult: b.mult, t: b.t };
    if (b.payout > 0 && (!s.top || b.mult > s.top.mult)) s.top = { id: b.id, mult: b.mult, t: b.t };
    const fs = BB.fair && BB.fair.state ? BB.fair.state() : null;
    u.hist.unshift({ id: b.id, w: b.wager, m: b.mult, p: b.payout, n: b.nonce || 0, g: fs ? fs.gen || 0 : 0, t: b.t });
    if (u.hist.length > 200) u.hist.length = 200;

    live.wagered = round2(live.wagered + b.wager);
    live.profit = round2(live.profit + net);
    if (net > 0) live.wins++; else if (net < 0) live.losses++;
    live.pts.push(live.profit);
    if (live.pts.length > 120) live.pts.shift();

    // rewards: rakeback accrues on every bet, levels unlock as the wagered total grows
    u.vip.rake = Math.round((u.vip.rake + (b.wager * LEVELS[levelOf(s.wagered)].rake) / 100) * 10000) / 10000;
    const target = levelOf(s.wagered);
    let levelled = false;
    while (u.vip.level < target) {
      u.vip.level++;
      const L = LEVELS[u.vip.level];
      if (L.bonus) { u.balance = round2(u.balance + L.bonus); u.vip.claimed = round2(u.vip.claimed + L.bonus); pushTx(u, { type: 'bonus', note: L.name + ' level-up bonus', usd: L.bonus, status: 'completed' }); }
      pushNote(u, `You reached ${L.name}`, `Rakeback is now ${L.rake}% and your daily bonus is ${fmt(L.daily)}.${L.bonus ? ' ' + fmt(L.bonus) + ' bonus coins were added.' : ''}`, 'vip');
      toast(`Level up: ${L.name}${L.bonus ? ' — +' + fmt(L.bonus) + ' bonus coins' : ''}`, 'ok');
      levelled = true;
    }
    saveUsers();
    if (levelled) { paintBalance('up'); emit('bb:balance'); emit('bb:tx'); paintChrome(); sfx('bigwin'); }
    paintNavVip();
    paintLive();
  }

  function logBet(gameId, wager, mult, payout, who, nonce) {
    const g = games[gameId], u = user();
    const row = { game: g ? g.name : gameId, id: gameId, user: who || (u ? (u.prefs.ghost ? 'Hidden' : u.name) : 'guest'), mine: !who, wager, mult, payout, nonce, t: Date.now() };
    bets.unshift(row);
    if (bets.length > 80) bets.pop();
    if (row.mine && u) track(u, row);
    if (row.mine) {
      // every settled round flashes the edge of the stage; big wins get a shower of coins
      const st = $('#g-stage'), net = payout - wager;
      if (st && net !== 0) { st.classList.remove('fx-win', 'fx-lose'); void st.offsetWidth; st.classList.add(net > 0 ? 'fx-win' : 'fx-lose'); }
      if (st && payout > 0 && mult >= 10) coins(st, mult >= 50 ? 44 : 26);
    }
    emit('bb:bet', row);
  }

  /** Your own settled bets, newest first (kept across reloads). */
  function history() {
    const u = user();
    return u ? u.hist.map((r) => ({ game: games[r.id] ? games[r.id].name : r.id, id: r.id, user: u.name, mine: true, wager: r.w, mult: r.m, payout: r.p, nonce: r.n, gen: r.g, t: r.t })) : [];
  }

  function betRow(b, withUser) {
    const net = round2(b.payout - b.wager);
    return `<div class="tr${b.mine ? ' mine' : ''}">
      <span class="td g"><i class="gi">${games[b.id] ? games[b.id].icon : ''}</i>${esc(b.game)}${b.nonce ? `<small class="nonce" title="Bet nonce — use it in the fairness verifier">#${b.nonce}</small>` : ''}</span>
      ${withUser ? `<span class="td u">${esc(b.user)}</span>` : ''}
      <span class="td n"><i class="coin sm"></i>${fmt(b.wager)}</span>
      <span class="td m">${fmtMult(b.mult)}</span>
      <span class="td n ${net > 0 ? 'pos' : 'neg'}">${net > 0 ? '+' : ''}${fmt(net)}</span>
    </div>`;
  }

  function addTx(tx) {
    const u = user();
    if (!u) return null;
    pushTx(u, tx);
    saveUsers();
    emit('bb:tx');
    return tx;
  }

  function notify(title, body, kind) {
    const u = user();
    if (!u) return;
    pushNote(u, title, body, kind);
    saveUsers();
    paintBell();
  }

  /* ---------- toasts ---------- */
  function toast(msg, type) {
    const box = $('#toasts');
    while (box.children.length >= 4) box.firstElementChild.remove();
    const el = h(`<div class="toast ${type || ''}">${esc(msg)}</div>`);
    box.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2900);
    setTimeout(() => el.remove(), 3300);
  }

  /** Brief attention pulse, e.g. on the Bet button when a tile is clicked with no round running. */
  function nudge(el) {
    if (!el) return;
    el.classList.remove('nudge');
    void el.offsetWidth;
    el.classList.add('nudge');
    setTimeout(() => el.classList.remove('nudge'), 500);
  }

  /** Gold confetti burst inside a positioned container. */
  function confetti(box, count) {
    if (!box) return;
    const layer = h('<div class="confetti"></div>');
    const cols = ['#ffc93c', '#ff9d1c', '#fff6c4', '#2fe08a', '#ffffff'];
    for (let i = 0; i < (count || 60); i++) {
      const p = document.createElement('i');
      const ang = rand() * Math.PI * 2, dist = 120 + rand() * 260;
      p.style.cssText = `--dx:${Math.cos(ang) * dist}px;--dy:${Math.sin(ang) * dist - 80}px;--r:${rand() * 720 - 360}deg;background:${cols[randInt(cols.length)]};animation-delay:${rand() * 120}ms;width:${6 + rand() * 6}px;height:${8 + rand() * 8}px`;
      layer.appendChild(p);
    }
    box.appendChild(layer);
    setTimeout(() => layer.remove(), 2200);
  }

  /* ---------- modals ---------- */
  function showModal(node) {
    closePop();
    $('#modal-root').appendChild(node);
    document.body.classList.add('modal-open');
    node.addEventListener('mousedown', (e) => { if (e.target === node) hideModal(node); });
    const x = $('.modal-x', node);
    if (x) x.addEventListener('click', () => hideModal(node));
    setTimeout(() => node.classList.add('in'), 20);
    return node;
  }

  function hideModal(node) {
    if (node && node.parentNode) node.remove();
    if (!$('#modal-root').children.length) document.body.classList.remove('modal-open');
  }

  /** Yes/no dialog. Resolves true only when the confirm button is pressed. */
  function confirmBox(o) {
    return new Promise((resolve) => {
      const m = h(`<div class="modal-back"><div class="modal single small" role="alertdialog" aria-modal="true" aria-label="${esc(o.title)}">
        <div class="modal-body"><h2 class="modal-title">${esc(o.title)}</h2><p class="confirm-text">${esc(o.body || '')}</p>
        <div class="confirm-btns"><button class="btn ghost" data-v="0">${esc(o.cancel || 'Cancel')}</button><button class="btn ${o.danger ? 'danger' : 'primary'}" data-v="1">${esc(o.ok || 'Confirm')}</button></div></div></div></div>`);
      let done = false;
      const finish = (v) => { if (done) return; done = true; obs.disconnect(); hideModal(m); resolve(v); };
      const obs = new MutationObserver(() => { if (!m.isConnected) finish(false); }); // Escape or a click outside counts as "no"
      m.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) finish(b.dataset.v === '1'); });
      showModal(m);
      obs.observe($('#modal-root'), { childList: true });
    });
  }

  /* ---------- popovers (account menu, notifications) ---------- */
  let popEl = null;
  function popOutside(e) { if (popEl && !popEl.contains(e.target) && !e.target.closest('[data-pop]')) closePop(); }
  function closePop() {
    if (popEl) { popEl.remove(); popEl = null; }
    document.removeEventListener('mousedown', popOutside, true);
  }
  /** Show a popover; calling it again with the same id closes it (toggle). */
  function openPop(id, node) {
    const same = popEl && popEl.id === id;
    closePop();
    const snd = $('#snd-pop');
    if (snd) snd.remove();
    if (same) return null;
    node.id = id;
    popEl = node;
    document.body.appendChild(node);
    setTimeout(() => document.addEventListener('mousedown', popOutside, true), 0);
    node.addEventListener('click', (e) => { if (e.target.closest('a, [data-open], [data-close]')) closePop(); });
    return node;
  }

  function openAuth(tab) {
    closeAuth();
    const m = h(`
      <div class="modal-back" id="auth">
        <div class="modal" role="dialog" aria-modal="true" aria-label="Log in or register">
          <button class="modal-x" aria-label="Close">&times;</button>
          <div class="modal-art">
            <div class="modal-art-in">
              <div class="art-coin"><i class="coin xl"></i></div>
              <h2>100,000<br><span>free play coins</span></h2>
              <p>House originals. Instant rounds. Zero real money.</p>
            </div>
          </div>
          <div class="modal-body">
            <div class="tabs">
              <button type="button" data-tab="login">Log in</button>
              <button type="button" data-tab="register">Register</button>
            </div>
            <form id="f-login" novalidate>
              <label class="field"><span class="field-l">Email</span><input name="email" type="text" autocomplete="username" placeholder="admin"></label>
              <label class="field"><span class="field-l">Password</span><input name="pass" type="password" autocomplete="current-password" placeholder="admin"></label>
              <div class="form-err"></div>
              <button class="btn primary block lg">Log in</button>
              <p class="hint">Demo account: email <code>admin</code> · password <code>admin</code></p>
            </form>
            <form id="f-register" novalidate hidden>
              <label class="field"><span class="field-l">Username</span><input name="name" type="text" autocomplete="nickname" placeholder="highroller" maxlength="16"></label>
              <label class="field"><span class="field-l">Email</span><input name="email" type="text" autocomplete="username" placeholder="you@example.com"></label>
              <label class="field"><span class="field-l">Password</span><input name="pass" type="password" autocomplete="new-password" placeholder="At least 4 characters"></label>
              <div class="form-err"></div>
              <button class="btn primary block lg">Create account</button>
              <p class="hint">Accounts are fake and stay in this browser only.</p>
            </form>
          </div>
        </div>
      </div>`);

    const setTab = (t) => {
      $$('.tabs button', m).forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
      $('#f-login', m).hidden = t !== 'login';
      $('#f-register', m).hidden = t !== 'register';
      const first = $(t === 'login' ? '#f-login input' : '#f-register input', m);
      setTimeout(() => first && first.focus(), 40);
    };
    $$('.tabs button', m).forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    const fail = (f, msg, field) => {
      $('.form-err', f).textContent = msg;
      $$('input', f).forEach((i) => i.classList.toggle('bad', i === field));
      if (field) field.focus();
      nudge($('.btn', f));
    };

    $('#f-login', m).addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const key = f.email.value.trim().toLowerCase();
      if (!key) return fail(f, 'Enter your email.', f.email);
      if (!f.pass.value) return fail(f, 'Enter your password.', f.pass);
      const u = users[key];
      if (!u || u.pass !== f.pass.value) return fail(f, 'Wrong email or password.', f.pass);
      signIn(key);
    });

    $('#f-register', m).addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const name = f.name.value.trim();
      const key = f.email.value.trim().toLowerCase();
      if (name.length < 2) return fail(f, 'Pick a username (2+ characters).', f.name);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) return fail(f, 'Enter a valid email address.', f.email);
      if (f.pass.value.length < 4) return fail(f, 'Password needs at least 4 characters.', f.pass);
      if (users[key]) return fail(f, 'That email is already registered.', f.email);
      users[key] = { name, pass: f.pass.value, balance: START_BALANCE };
      prep(users[key], key);
      welcome(users[key]);
      saveUsers();
      signIn(key);
    });

    showModal(m);
    setTab(tab === 'register' ? 'register' : 'login');
  }

  function closeAuth() { hideModal($('#auth')); }

  function signIn(key) {
    session = key;
    since = Date.now();
    store.set(LS_SESSION, key);
    closeAuth();
    shown = 0;
    paintChrome();
    if (current && current.isGame) { paintNav('g:' + current.id); paintMyBets(); paintFav(); } else { leave(); route(); }
    toast(`Welcome, ${user().name}. Your balance is play money.`, 'ok');
  }

  function signOut() {
    leave(); // settle or refund any round in progress while the session still exists
    session = null;
    store.del(LS_SESSION);
    const ls = $('#live-stats');
    if (ls) ls.remove();
    paintChrome();
    route();
  }

  /** Wipe the signed-in account back to a fresh 100,000-coin start (keeps the login). */
  function resetAccount() {
    const u = user();
    if (!u) return;
    leave();
    ['stats', 'tx', 'hist', 'notes', 'vip', 'day', 'recent', 'favs', 'limits', 'fair'].forEach((k) => { delete u[k]; });
    u.balance = START_BALANCE;
    prep(u, session);
    welcome(u);
    saveUsers();
    live.profit = 0; live.wagered = 0; live.wins = 0; live.losses = 0; live.pts = [0];
    shown = 0;
    paintChrome();
    emit('bb:balance');
    route();
  }
  function deleteAccount() {
    const k = session;
    if (!k || k === 'admin') return;
    signOut();
    delete users[k];
    saveUsers();
  }

  /* ---------- top bar + sidebar ---------- */
  const NOTE_ICON = { dep: 'down', wd: 'up', vip: 'crown', gift: 'gift', info: 'info', lock: 'lock' };

  function paintBell() {
    const n = $('#bell-n'), u = user();
    if (!n || !u) return;
    const c = u.notes.filter((x) => !x.read).length;
    n.hidden = !c;
    n.textContent = c > 9 ? '9+' : c;
  }

  function bellPop() {
    const u = user();
    const rows = u.notes.length
      ? u.notes.map((n) => `<div class="note${n.read ? '' : ' new'}"><i class="note-ic ${n.kind}">${ic(NOTE_ICON[n.kind] || 'info', 17)}</i><div><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small>${ago(n.t)}</small></div></div>`).join('')
      : '<div class="empty">Nothing yet. Deposits, withdrawals and rewards will show up here.</div>';
    const p = openPop('bell-pop', h(`<div class="pop bell-pop" role="dialog" aria-label="Notifications">
      <div class="pop-h"><b>Notifications</b>${u.notes.length ? '<button type="button" id="notes-clear">Clear all</button>' : ''}</div>
      <div class="notes">${rows}</div></div>`));
    if (!p) return;
    u.notes.forEach((n) => { n.read = true; });
    saveUsers();
    paintBell();
    const c = $('#notes-clear', p);
    if (c) c.addEventListener('click', () => { user().notes = []; saveUsers(); closePop(); paintBell(); });
  }

  function userMenu() {
    const u = user(), v = vipInfo(u);
    const item = (href, icon, label, attr) => `<a class="um-item" href="${href}" ${attr || ''}><i>${ic(icon, 18)}</i>${label}</a>`;
    openPop('user-menu', h(`<div class="pop user-menu" role="menu" aria-label="Account menu">
      <a class="um-head" href="#/vip">
        ${avatarHTML(u, 'lg')}
        <span class="um-who"><b>${esc(u.name)}</b><small style="color:${v.cur.color}">${v.cur.name}${v.next ? ` · ${v.pct.toFixed(0)}% to ${v.next.name}` : ' · top level'}</small>
          <span class="bar"><i style="width:${v.pct}%;background:${v.cur.color}"></i></span></span>
      </a>
      ${item('#', 'wallet', 'Wallet', 'data-open="wallet"')}
      ${item('#/vip', 'crown', 'VIP &amp; rewards')}
      ${item('#/account/transactions', 'swap', 'Transactions')}
      ${item('#/account/bets', 'clock', 'Bet history')}
      ${item('#/account/stats', 'chart', 'Statistics')}
      ${item('#/account/profile', 'gear', 'Settings')}
      ${item('#', 'shield', 'Provably fair', 'data-open="fair"')}
      <div class="um-sep"></div>
      ${item('#', 'logout', 'Log out', 'data-open="logout"')}
    </div>`));
  }

  function paintChrome() {
    const wallet = $('#wallet');
    const account = $('#account');
    closePop();
    const u = user();
    document.body.classList.toggle('calm', !!(u && u.prefs.calm));
    document.body.classList.toggle('authed', !!u);
    if (u) {
      const v = vipInfo(u);
      wallet.innerHTML = `
        <div class="wallet-group">
          <div class="balance" id="bal-pill" title="Play-money balance"><i class="coin"></i><span id="bal-amt">${fmt(shown)}</span></div>
          <button class="btn primary wallet-btn" data-open="wallet" aria-label="Open wallet">${ic('wallet', 18)}<span>Wallet</span></button>
        </div>`;
      account.innerHTML = `
        <button class="tool-btn" id="bell" data-pop aria-label="Notifications" title="Notifications">${ic('bell', 19)}<i class="badge" id="bell-n" hidden></i></button>
        <button class="user" id="user-btn" data-pop aria-haspopup="menu" aria-label="Account menu">
          ${avatarHTML(u)}
          <span class="user-meta"><b>${esc(u.name)}</b><small style="color:${v.cur.color}">${v.cur.name}</small></span>
          <span class="caret">${ic('caret', 16)}</span>
        </button>`;
      $('#bell').addEventListener('click', bellPop);
      $('#user-btn').addEventListener('click', userMenu);
      paintBalance();
      paintBell();
    } else {
      wallet.innerHTML = '';
      account.innerHTML = `
        <button class="btn ghost" data-auth="login">Log in</button>
        <button class="btn primary" data-auth="register">Register</button>`;
    }
  }

  function navVipHTML() {
    const u = user();
    if (!u) return '';
    const v = vipInfo(u);
    return `<span class="nv-top"><b style="color:${v.cur.color}">${ic('crown', 15)}${v.cur.name}</b><small>${v.next ? v.pct.toFixed(v.pct < 10 ? 1 : 0) + '%' : 'MAX'}</small></span>
      <span class="bar"><i style="width:${v.pct}%;background:${v.cur.color}"></i></span>
      <small>${v.next ? fmt(v.left) + ' to ' + v.next.name : 'Top level reached'}</small>`;
  }
  function paintNavVip() { const el = $('#nav-vip'); if (el) el.innerHTML = navVipHTML(); }

  const navClosed = store.get('bb.nav', null) || {};
  function paintNav(active) {
    active = active || '';
    const item = (on, href, icon, label, attr) => `<a class="nav-item${on ? ' on' : ''}" href="${href}"${attr ? ' ' + attr : ''}><i class="ni">${icon}</i>${label}</a>`;
    const acct = active.indexOf('p:account') === 0, isTx = active === 'p:account/transactions';
    const group = ([cat, label]) => {
      const ids = order.filter((id) => games[id].cat === cat), open = !navClosed[cat] || ids.some((id) => active === 'g:' + id);
      return `<div class="nav-group${open ? '' : ' closed'}">
        <button type="button" class="nav-h" data-toggle="${cat}" aria-expanded="${open}"><span>${label}</span><small>${ids.length}</small>${ic('caret', 14)}</button>
        <div class="nav-list">${ids.map((id) => `<a class="nav-item${active === 'g:' + id ? ' on' : ''}" href="#/g/${id}"><i class="ni">${games[id].icon}</i><span class="nav-t">${games[id].name}</span>${games[id].badge ? `<em class="nav-badge ${games[id].badge.toLowerCase()}">${games[id].badge}</em>` : ''}</a>`).join('')}</div></div>`;
    };
    const ag = active.indexOf('g:') === 0 ? games[active.slice(2)] : null;
    const top = active.indexOf('p:slots') === 0 || (ag && ag.cat === 'slots') ? 'p:slots' : active === 'p:vip' ? 'p:vip' : active === 'p:lobby/originals' ? 'p:lobby/originals' : active.indexOf('p:account') === 0 ? 'none' : '';
    $$('.topnav a').forEach((a) => a.classList.toggle('on', a.dataset.k === top));
    $('#nav').innerHTML =
      item(!active, '#/', ic('home', 20), 'Lobby') +
      item(active === 'p:lobby/fav', '#/lobby/fav', ic('star', 20), 'Favourites') +
      item(active.indexOf('p:slots') === 0, '#/slots', ic('bolt', 20), 'Slots lobby') +
      (session ? `<a class="nav-vip" id="nav-vip" href="#/vip">${navVipHTML()}</a>` : '') +
      CATS.map(group).join('') +
      '<div class="nav-h plain">Account</div>' +
      item(false, '#', ic('wallet', 20), 'Wallet', 'data-open="wallet"') +
      item(active === 'p:vip', '#/vip', ic('crown', 20), 'VIP &amp; rewards') +
      item(isTx, '#/account/transactions', ic('swap', 20), 'Transactions') +
      item(acct && !isTx, '#/account/profile', ic('gear', 20), 'Settings') +
      '<div class="nav-h plain">Platform</div>' +
      item(false, '#', ic('shield', 20), 'Provably fair', 'data-open="fair"') +
      item(false, '#', ic('sound', 20), 'Music &amp; sound', 'data-open="sound"');
  }

  /* ---------- games, pages + router ---------- */
  const games = {};
  const order = [];
  const pages = {};
  let current = null;
  let lobby = null;
  let leaveHooks = [];

  const CATS = [['slots', 'Slots'], ['table', 'Table games'], ['instant', 'Instant win'], ['cashout', 'Climb & cash out']];
  const DEFAULT_CAT = { blackjack: 'table', roulette: 'table', crash: 'cashout', mines: 'cashout', towers: 'cashout' };
  function registerGame(g) { g.cat = g.cat || DEFAULT_CAT[g.id] || 'instant'; g.provider = g.provider || 'originals'; g.isGame = true; games[g.id] = g; order.push(g.id); }
  /** The studio behind a game (house originals unless the game says otherwise). */
  function provOf(g) { return (BB.providers && BB.providers[g.provider]) || { name: 'BananaBet Originals', short: 'Originals', color: '#ffc93c', mark: 'B' }; }
  /** A non-game screen at #/<id>/<sub>. p = { mount(view, sub), update?(sub), unmount?() } */
  function registerPage(id, p) { p.pageId = id; pages[id] = p; }
  function setLobby(l) { lobby = l; registerPage('lobby', l); }
  /** Run a cleanup when the current view is left. */
  function onLeave(fn) { leaveHooks.push(fn); }

  function leave() {
    autoStop();
    if (current && current.unmount) { try { current.unmount(); } catch (e) { console.error(e); } }
    current = null;
    leaveHooks.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    leaveHooks = [];
  }

  function paintMyBets() {
    const box = $('#mybets');
    if (!box) return;
    const mine = history().slice(0, 8);
    box.innerHTML = mine.length
      ? `<div class="tr th"><span class="td g">Game</span><span class="td n">Bet</span><span class="td m">Multiplier</span><span class="td n">Profit</span></div>` + mine.map((b) => betRow(b, false)).join('')
      : `<div class="empty">Your bets will show up here.</div>`;
  }

  /* favourites + recently played */
  const isFav = (id) => { const u = user(); return !!u && u.favs.indexOf(id) >= 0; };
  function toggleFav(id) {
    const u = user();
    if (!u) { openAuth('login'); return false; }
    const i = u.favs.indexOf(id);
    if (i >= 0) u.favs.splice(i, 1); else u.favs.unshift(id);
    saveUsers();
    sfx('click');
    return i < 0;
  }
  function paintFav() {
    const b = $('#gf-fav');
    if (!b || !current || !current.isGame) return;
    const on = isFav(current.id);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
    b.title = on ? 'Remove from favourites' : 'Add to favourites';
  }
  function touchRecent(id) {
    const u = user();
    if (!u) return;
    u.recent = [id].concat(u.recent.filter((x) => x !== id)).slice(0, 8);
    saveUsers();
  }

  /* live stats card: profit / wagered / wins / losses since it was last reset */
  function paintLive() {
    const box = $('#live-stats');
    if (!box) return;
    const set = (k, v, cls) => { const el = $(`[data-k="${k}"]`, box); el.textContent = v; if (cls != null) el.className = cls; };
    set('profit', (live.profit > 0 ? '+' : '') + fmt(live.profit), live.profit > 0 ? 'pos' : live.profit < 0 ? 'minus' : '');
    set('wagered', fmt(live.wagered));
    set('wins', live.wins);
    set('losses', live.losses);
    const cv = $('canvas', box), dpr = Math.min(2, window.devicePixelRatio || 1), W = 228, H = 64;
    cv.width = W * dpr; cv.height = H * dpr;
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    const pts = live.pts, lo = Math.min.apply(null, pts.concat(0)), hi = Math.max.apply(null, pts.concat(0)), span = hi - lo || 1;
    const X = (i) => (pts.length > 1 ? (i / (pts.length - 1)) * W : W / 2), Y = (v) => H - 4 - ((v - lo) / span) * (H - 8);
    c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 1; c.setLineDash([3, 4]);
    c.beginPath(); c.moveTo(0, Y(0)); c.lineTo(W, Y(0)); c.stroke(); c.setLineDash([]);
    if (pts.length > 1) {
      c.beginPath();
      pts.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
      c.strokeStyle = live.profit >= 0 ? '#2fe08a' : '#ff4d67'; c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
    }
  }
  function toggleLive() {
    const old = $('#live-stats');
    if (old) { old.remove(); return; }
    const box = h(`<div class="livecard" id="live-stats" role="dialog" aria-label="Live stats">
      <div class="live-h">${ic('chart', 16)}<b>Live stats</b><button type="button" id="live-reset" title="Reset" aria-label="Reset stats">${ic('reset', 15)}</button><button type="button" id="live-x" aria-label="Close">&times;</button></div>
      <div class="live-grid">
        <div><small>Profit</small><b data-k="profit">0.00</b></div><div><small>Wagered</small><b data-k="wagered">0.00</b></div>
        <div><small>Wins</small><b data-k="wins" class="pos">0</b></div><div><small>Losses</small><b data-k="losses" class="minus">0</b></div>
      </div><canvas></canvas></div>`);
    document.body.appendChild(box);
    $('#live-x', box).addEventListener('click', () => box.remove());
    $('#live-reset', box).addEventListener('click', () => { live.profit = 0; live.wagered = 0; live.wins = 0; live.losses = 0; live.pts = [0]; paintLive(); });
    paintLive();
  }

  function openRules() {
    const g = current && current.isGame ? current : null;
    if (!g) return;
    const r = (BB.rules && BB.rules[g.id]) || { how: ['Place a bet and play the round.'] };
    const u = user(), keys = !u || u.prefs.hotkeys;
    showModal(h(`<div class="modal-back" id="rules"><div class="modal single" role="dialog" aria-modal="true" aria-label="How to play ${esc(g.name)}">
      <button class="modal-x" aria-label="Close">&times;</button>
      <div class="modal-body">
        <h2 class="modal-title"><span class="rules-ic" style="--c1:${g.colors[0]};--c2:${g.colors[1]}"><i>${g.icon}</i></span>${esc(g.name)}</h2>
        <ol class="rules-list">${r.how.map((x) => `<li>${x}</li>`).join('')}</ol>
        <div class="rules-facts">
          <div><small>Return to player</small><b>${g.rtp}%</b></div>
          <div><small>House edge</small><b>${(100 - parseFloat(g.rtp)).toFixed(1)}%</b></div>
          <div><small>Top payout</small><b>${r.max || '—'}</b></div>
        </div>
        ${r.risk ? `<p class="rules-risk"><b>Risk:</b> ${r.risk}</p>` : ''}
        <p class="fair-note">${keys ? 'Shortcuts: <code>Space</code> bet · <code>A</code> halve the bet · <code>S</code> double it. ' : ''}Every result comes from your seed pair — open <a href="#" data-open="fair" style="color:var(--win)">Provably fair</a> to check a bet.</p>
      </div></div></div>`));
  }

  function route() {
    const hash = location.hash || '#/';
    const gm = hash.match(/^#\/g\/([\w-]+)/);
    const pm = hash.match(/^#\/([a-z]+)(?:\/([\w-]+))?/);
    const g = gm && games[gm[1]];
    let p = null, sub;
    if (!g) { if (pm && pages[pm[1]]) { p = pages[pm[1]]; sub = pm[2]; } else p = lobby; }
    const navKey = g ? 'g:' + g.id : p && (p !== lobby || sub) ? 'p:' + p.pageId + (sub ? '/' + sub : '') : '';
    const view = $('#view');
    $$('#modal-root > *').forEach(hideModal);
    closePop();
    document.body.classList.remove('nav-open');
    // moving between tabs of the same page: swap the tab, keep the page
    if (p && current === p && p.update && view.firstChild) {
      paintNav(navKey);
      p.update(sub);
      return;
    }
    leave();
    document.body.classList.remove('theatre');
    view.innerHTML = '';
    paintNav(navKey);
    const bar = $('#route-bar');
    if (bar) { bar.classList.remove('go'); void bar.offsetWidth; bar.classList.add('go'); }
    if (g) {
      view.appendChild(h(`
        <div class="page">
          <div class="game-head">
            <a href="${g.cat === 'slots' ? '#/slots' : '#/'}" class="back${g.cat === 'slots' ? ' wide' : ''}" aria-label="${g.cat === 'slots' ? 'Back to all slots' : 'Back to lobby'}"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"/></svg>${g.cat === 'slots' ? '<span>All slots</span>' : ''}</a>
            <h1>${g.name}</h1>
            <span class="chip-tag" style="color:${provOf(g).color};background:${provOf(g).color}1f">${provOf(g).short}</span>
            <span class="rtp">RTP ${g.rtp}%</span>
          </div>
          <div class="game" data-game="${g.id}">
            <div class="game-panel" id="g-panel"></div>
            <div class="game-stage" id="g-stage"></div>
            <div class="game-foot">
              <div class="gf-l">
                <button class="gf-btn" id="gf-fav" aria-label="Favourite">${ic('star', 18)}</button>
                <button class="gf-btn" data-open="rules" title="How to play" aria-label="How to play">${ic('info', 18)}</button>
                <button class="gf-btn" id="gf-stats" title="Live stats" aria-label="Live stats">${ic('chart', 18)}</button>
                <button class="gf-btn" id="gf-theatre" title="Theatre mode" aria-label="Theatre mode">${ic('expand', 18)}</button>
              </div>
              <div class="gf-c">${g.provider === 'originals' ? 'BANANA<b>BET</b>' : esc(provOf(g).name)}</div>
              <div class="gf-r"><button class="fair-chip" data-open="fair" title="How results are generated">${ic('shield', 14)}Fairness</button></div>
            </div>
          </div>
          <section class="card-sec">
            <div class="sec-row"><h3>My bets</h3><a class="link" href="#/account/bets">Full history</a></div>
            <div class="table four" id="mybets"></div>
          </section>
        </div>`));
      current = g;
      $('#gf-fav').addEventListener('click', () => { toggleFav(g.id); paintFav(); });
      $('#gf-stats').addEventListener('click', toggleLive);
      $('#gf-theatre').addEventListener('click', (e) => { e.currentTarget.classList.toggle('on', document.body.classList.toggle('theatre')); });
      paintFav();
      touchRecent(g.id);
      g.mount($('#g-panel'), $('#g-stage'));
      if (!NO_AUTO[g.id]) addAuto($('#g-panel'));
      paintMyBets();
    } else if (p) {
      current = p;
      p.mount(view, sub);
    }
    window.scrollTo(0, 0);
  }

  /** Quick game finder (top-bar magnifier, or press "/"). */
  function openSearch() {
    hideModal($('#search'));
    const m = h(`<div class="modal-back" id="search"><div class="modal single search-modal" role="dialog" aria-modal="true" aria-label="Search games">
      <button class="modal-x" aria-label="Close">&times;</button>
      <div class="modal-body">
        <label class="search big"><svg viewBox="0 0 24 24" width="18" height="18"><circle cx="11" cy="11" r="6.500" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.500 4.500" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input type="search" id="q-all" placeholder="Search ${order.length} games and studios" autocomplete="off" aria-label="Search games"></label>
        <div class="search-res" id="q-res"></div>
      </div></div></div>`);
    const input = $('#q-all', m), res = $('#q-res', m);
    const paint = () => {
      const q = input.value.trim().toLowerCase();
      const list = order.filter((id) => { const g = games[id]; return !q || g.name.toLowerCase().includes(q) || provOf(g).name.toLowerCase().includes(q) || g.cat.includes(q); }).slice(0, q ? 12 : 8);
      res.innerHTML = (q ? '' : '<div class="search-h">Popular right now</div>') + (list.length
        ? list.map((id) => { const g = games[id]; return `<a class="sres" href="#/g/${id}"><span class="wthumb" style="--c1:${g.colors[0]};--c2:${g.colors[1]}"><i>${g.icon}</i></span><span><b>${esc(g.name)}</b><small>${esc(provOf(g).name)} · RTP ${g.rtp}%</small></span></a>`; }).join('')
        : '<div class="empty">No games match that.</div>');
    };
    input.addEventListener('input', paint);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = $('.sres', res); if (a) location.hash = a.getAttribute('href'); } });
    showModal(m);
    paint();
    setTimeout(() => input.focus(), 40);
  }

  /* ---------- autobet (games that settle in one press) ---------- */
  const NO_AUTO = { blackjack: 1, roulette: 1, hilo: 1, crash: 1, mines: 1, towers: 1, pump: 1 };
  let auto = null, lastAmount = null, placed = false;

  function autoPaint() {
    const el = $('#auto-stat');
    if (el && auto) el.innerHTML = `${auto.done} bet${auto.done === 1 ? '' : 's'} · <b class="${auto.profit > 0 ? 'pos' : auto.profit < 0 ? 'minus' : ''}">${auto.profit > 0 ? '+' : ''}${fmt(auto.profit)}</b>${auto.infinite ? '' : ' · ' + auto.left + ' left'}`;
  }
  function autoStop(why) {
    if (!auto) return;
    clearTimeout(auto.timer);
    const base = auto.base;
    auto = null;
    if (lastAmount && base && $('#g-panel .amount')) lastAmount.set(base); // put the bet back to where it started
    const box = $('#g-auto');
    if (box) {
      $('#auto-go').textContent = 'Start autobet';
      $('#auto-go').className = 'btn green lg block';
      $$('input', box).forEach((i) => { i.disabled = false; });
    }
    if (why) toast(why, '');
  }
  /** Press the game's own button as soon as it is ready; stop if the bet is refused. */
  function autoNext(tries) {
    if (!auto) return;
    const btn = $('#g-panel .btn.lg');
    if (!btn || !current || current.id !== auto.id) { autoStop(); return; }
    if (btn.disabled) {
      if ((tries || 0) > 400) { autoStop('Autobet stopped — the game is not ready.'); return; }
      auto.timer = setTimeout(() => autoNext((tries || 0) + 1), 100);
      return;
    }
    placed = false;
    btn.click();
    if (!placed) autoStop('Autobet stopped.');
  }
  function autoStart() {
    if (!session) { openAuth('login'); return; }
    const num = (id) => { const v = parseFloat($('#' + id).value); return isFinite(v) && v > 0 ? v : 0; };
    const n = Math.floor(num('auto-n'));
    auto = { left: n, infinite: !n, onWin: num('auto-win'), onLoss: num('auto-loss'), stopP: num('auto-sp'), stopL: num('auto-sl'), base: lastAmount ? lastAmount.get() : 0, done: 0, profit: 0, id: current.id, timer: 0 };
    $('#auto-go').textContent = 'Stop autobet';
    $('#auto-go').className = 'btn danger lg block';
    $$('#g-auto input').forEach((i) => { i.disabled = true; });
    autoPaint();
    autoNext();
  }
  function autoSettled(b) {
    if (!auto || !b.mine || b.id !== auto.id) return;
    const net = round2(b.payout - b.wager);
    auto.done++;
    auto.profit = round2(auto.profit + net);
    if (!auto.infinite) auto.left--;
    autoPaint();
    if (!auto.infinite && auto.left <= 0) { autoStop('Autobet finished.'); return; }
    if (auto.stopP && auto.profit >= auto.stopP) { autoStop('Autobet stopped — profit target reached.'); return; }
    if (auto.stopL && auto.profit <= -auto.stopL) { autoStop('Autobet stopped — loss limit reached.'); return; }
    const a = auto;
    a.timer = setTimeout(() => {
      if (auto !== a) return;
      if (lastAmount && net !== 0) {
        const pct = net > 0 ? a.onWin : a.onLoss; // 0% means "go back to the starting bet"
        lastAmount.set(pct ? lastAmount.get() * (1 + pct / 100) : a.base);
      }
      autoNext();
    }, 280);
  }
  /** Adds the Manual / Auto switch and the autobet form to a game's bet panel. */
  function addAuto(panel) {
    panel.insertBefore(h('<div class="seg mode-seg" id="g-mode"><button type="button" data-v="manual" class="on">Manual</button><button type="button" data-v="auto">Auto</button></div>'), panel.firstChild);
    panel.appendChild(h(`<div class="auto-box" id="g-auto" hidden>
      <div class="row2">
        <label class="field"><span class="field-l">Number of bets</span><input type="text" inputmode="numeric" id="auto-n" value="10" maxlength="5" aria-label="Number of bets"></label>
        <label class="field"><span class="field-l">Stop at profit</span><input type="text" inputmode="decimal" id="auto-sp" placeholder="Off" maxlength="10" aria-label="Stop at profit"></label>
      </div>
      <div class="row2">
        <label class="field"><span class="field-l">On win, raise by %</span><input type="text" inputmode="decimal" id="auto-win" value="0" maxlength="6" aria-label="On win raise by percent"></label>
        <label class="field"><span class="field-l">On loss, raise by %</span><input type="text" inputmode="decimal" id="auto-loss" value="0" maxlength="6" aria-label="On loss raise by percent"></label>
      </div>
      <label class="field"><span class="field-l">Stop at loss</span><input type="text" inputmode="decimal" id="auto-sl" placeholder="Off" maxlength="10" aria-label="Stop at loss"></label>
      <button type="button" class="btn green lg block" id="auto-go">Start autobet</button>
      <p class="auto-stat" id="auto-stat">Set the bets to 0 to keep going until you stop it. A raise of 0% goes back to your starting bet.</p>
    </div>`));
    bindSeg($('#g-mode'), (v) => { autoStop(); $('#g-auto').hidden = v !== 'auto'; panel.classList.toggle('auto-on', v === 'auto'); });
    $('#auto-go').addEventListener('click', () => (auto ? autoStop('Autobet stopped.') : autoStart()));
    $$('#g-auto input').forEach((i) => i.addEventListener('input', () => { const c = i.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'); if (c !== i.value) i.value = c; }));
  }

  /** Placeholder for account-only pages when nobody is logged in. */
  function authGate(view, title, text) {
    view.appendChild(h(`<div class="page"><div class="gate">
      <i class="coin xl"></i><h1>${esc(title)}</h1><p>${esc(text)}</p>
      <div class="gate-btns"><button class="btn primary lg" data-auth="login">Log in</button><button class="btn ghost lg" data-auth="register">Create free account</button></div>
      <p class="hint">Demo account: email <code>admin</code> · password <code>admin</code></p>
    </div></div>`));
  }

  /* ---------- shared bet-amount control (with validation) ---------- */
  function amountField(opts) {
    opts = opts || {};
    const el = h(`
      <div class="field">
        <span class="field-l">${opts.label || 'Bet Amount'}</span>
        <div class="amount">
          <i class="coin"></i>
          <input type="text" inputmode="decimal" value="${(opts.value || 100).toFixed(2)}" aria-label="Bet amount" maxlength="12">
          <button type="button" data-k="half">½</button>
          <button type="button" data-k="dbl">2×</button>
          <button type="button" data-k="max">Max</button>
        </div>
        <small class="field-hint"></small>
      </div>`);
    const input = $('input', el), hint = $('.field-hint', el);
    const listeners = [];
    let locked = false;
    const get = () => {
      const v = parseFloat(String(input.value).replace(/,/g, ''));
      return isFinite(v) && v > 0 ? round2(v) : 0;
    };
    const check = () => {
      let msg = '';
      if (!locked) {
        if (get() <= 0) msg = 'Enter an amount above zero.';
        else if (session && get() > balance()) msg = 'More than your balance.';
      }
      el.classList.toggle('bad', !!msg);
      hint.textContent = msg;
    };
    const fire = () => { check(); listeners.forEach((f) => f(get())); };
    const set = (v) => { input.value = round2(Math.max(0, v)).toFixed(2); fire(); };
    el.addEventListener('click', (e) => {
      const k = e.target.dataset && e.target.dataset.k;
      if (!k || locked) return;
      sfx('click');
      const cap = session ? balance() : Infinity;
      if (k === 'half') set(Math.max(0.01, get() / 2));
      if (k === 'dbl') set(Math.min(get() * 2 || 1, Math.max(cap, 0.01)));
      if (k === 'max') { if (!session) { openAuth('login'); return; } set(balance()); }
    });
    input.addEventListener('input', () => {
      // digits and a single decimal point only
      const clean = input.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
      if (clean !== input.value) input.value = clean;
      fire();
    });
    input.addEventListener('blur', () => { input.value = get().toFixed(2); check(); });
    document.addEventListener('bb:balance', check);
    onLeave(() => document.removeEventListener('bb:balance', check));
    return (lastAmount = {
      el, get, set,
      lock(on) {
        locked = !!on;
        el.classList.toggle('locked', locked);
        input.disabled = locked;
        $$('button', el).forEach((b) => { b.disabled = locked; });
        check();
      },
      isLocked: () => locked,
      onChange(f) { listeners.push(f); },
    });
  }

  /* ---------- shared widgets ---------- */
  /** Segmented selector markup, e.g. a risk picker. opts = [[value, label], ...] */
  function segHTML(id, opts, cur) {
    return `<div class="seg" id="${id}">${opts.map((o) => `<button type="button" data-v="${o[0]}" class="${String(o[0]) === String(cur) ? 'on' : ''}">${o[1]}</button>`).join('')}</div>`;
  }
  function bindSeg(el, cb) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      $$('button', el).forEach((x) => x.classList.toggle('on', x === b));
      sfx('click');
      cb(b.dataset.v);
    });
  }
  function setSeg(el, value) { $$('button', el).forEach((x) => x.classList.toggle('on', x.dataset.v === String(value))); }

  const CARD_SUITS = ['♠︎', '♥︎', '♦︎', '♣︎'];
  const CARD_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const cards = {
    /** Infinite deck: each card is an independent draw. `i` is the rank index, 0 = ace ... 12 = king. */
    from(rng) { const n = rng.int(52), si = Math.floor(n / 13); return { i: n % 13, r: CARD_RANKS[n % 13], s: CARD_SUITS[si], red: si === 1 || si === 2 }; },
    el(c, down) {
      return h(`<div class="pcard${c.red ? ' red' : ''}${down ? ' down' : ''}"><div class="pcard-in">
        <div class="pcard-f"><span class="pc-r">${c.r}</span><span class="pc-s">${c.s}</span><span class="pc-big">${c.s}</span></div>
        <div class="pcard-b"></div></div></div>`);
    },
    text: (c) => c.r + c.s,
  };

  /* ---------- keyboard shortcuts on game pages ---------- */
  function hotkey(e) {
    if (e.key === 'Escape') {
      const top = $('#modal-root').lastElementChild;
      if (top) hideModal(top); else closePop();
      return;
    }
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '');
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !$('#modal-root').children.length) { e.preventDefault(); openSearch(); return; }
    if (!current || !current.isGame || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if ($('#modal-root').children.length || popEl) return;
    const u = user();
    if (u && !u.prefs.hotkeys) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
    const k = (e.key || '').toLowerCase();
    if (k === ' ') {
      const b = $('#g-panel').classList.contains('auto-on') ? $('#auto-go') : $('#g-panel .btn.lg:not(:disabled):not([hidden])');
      e.preventDefault();
      if (b) b.click();
    } else if (k === 'a' || k === 's') {
      const b = $(`#g-panel .amount [data-k="${k === 'a' ? 'half' : 'dbl'}"]:not(:disabled)`);
      if (b) b.click();
    }
  }

  /* ---------- boot ---------- */
  function start() {
    shown = balance(); // no count-up from zero on a plain reload
    paintChrome();
    const half = Math.ceil(order.length / 2);
    const links = (ids) => ids.map((id) => `<a href="#/g/${id}">${games[id].name}</a>`).join('');
    if ($('#fg1')) { $('#fg1').innerHTML = '<h4>Games</h4>' + links(order.slice(0, half)); $('#fg2').innerHTML = '<h4>More games</h4>' + links(order.slice(half)); }
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-auth]');
      if (a) { openAuth(a.dataset.auth); return; }
      const c = e.target.closest('[data-copy-text]');
      if (c) { copyText(c.dataset.copyText); return; }
      const o = e.target.closest('[data-open]');
      if (o) {
        e.preventDefault();
        document.body.classList.remove('nav-open');
        const k = o.dataset.open;
        if (k === 'fair' && BB.fair) BB.fair.open();
        else if (k === 'sound' && BB.audio) BB.audio.panel(true);
        else if (k === 'wallet' || k === 'withdraw') { if (!session) openAuth('login'); else if (BB.wallet) BB.wallet.open(k === 'withdraw' ? 'withdraw' : 'deposit'); }
        else if (k === 'faucet') faucet();
        else if (k === 'search') openSearch();
        else if (k === 'rules') openRules();
        else if (k === 'logout') signOut();
        return;
      }
      // a mouse click shouldn't leave focus parked on a game button, or Space would re-press it
      if (e.detail > 0) { const b = e.target.closest('.game button'); if (b && document.activeElement === b) b.blur(); }
    });
    document.addEventListener('keydown', hotkey);
    $('#nav').addEventListener('click', (e) => {
      const t = e.target.closest('[data-toggle]');
      if (!t) return;
      const g = t.parentElement, closed = g.classList.toggle('closed');
      navClosed[t.dataset.toggle] = closed;
      t.setAttribute('aria-expanded', !closed);
      store.set('bb.nav', navClosed);
    });
    document.addEventListener('bb:bet', (e) => { if (e.detail && e.detail.mine) { paintMyBets(); autoSettled(e.detail); } });
    document.addEventListener('bb:placed', () => { placed = true; });
    $('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
    $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
    const snd = $('#snd-btn');
    if (snd) snd.addEventListener('click', closePop, true);
    window.addEventListener('hashchange', route);
    // Closing or reloading the tab mid-round shouldn't eat the stake.
    window.addEventListener('pagehide', leave);
    // Keep several open tabs in step so one can't overwrite the other's balance.
    window.addEventListener('storage', (e) => {
      if (e.key === LS_USERS && e.newValue) {
        try { users = JSON.parse(e.newValue) || users; } catch (err) { return; }
        Object.keys(users).forEach((k) => prep(users[k], k));
        if (session && !users[session]) session = null;
        paintBalance();
        paintBell();
        emit('bb:balance');
        emit('bb:tx');
      }
      if (e.key === LS_SESSION) {
        let s = null;
        try { s = e.newValue ? JSON.parse(e.newValue) : null; } catch (err) { return; }
        if (s === session || (s && !users[s])) return;
        leave();
        session = s;
        shown = balance();
        paintChrome();
        route();
      }
    });
    // optional "reality check" reminder (set under Settings → Limits)
    setInterval(() => {
      const u = user();
      if (!u || !u.limits.remind) return;
      if (Date.now() - since >= u.limits.remind * 60000) { since = Date.now(); toast(`Reality check: you've been playing for ${u.limits.remind} minutes.`, ''); }
    }, 20000);
    route();
  }

  window.BB = {
    start, registerGame, registerPage, setLobby, onLeave, games, order, bets, betRow, history, live,
    placeBet, win, credit, debit, faucet, coins, frame, unframe, logBet, balance, isAuthed, openAuth, signOut, toast, nudge, confetti, showModal, hideModal, confirm: confirmBox,
    user, saveUsers, refresh, addTx, notify, resetAccount, deleteAccount, dayKey, paintChrome, paintBalance, reroute: route, authGate, closePop,
    isFav, toggleFav, provOf, openSearch, vipInfo, levels: LEVELS, avatars: AVATARS, avatarHTML, icon: ic, START_BALANCE,
    fmt, fmtMult, esc, round2, clamp, sleep, rand, randInt, sfx, stamp, ago, copyText, emit, $, $$, h,
    users: () => users, sessionKey: () => session, sessionSince: () => since,
    ui: { amount: amountField, seg: segHTML, bindSeg, setSeg }, cards, cats: CATS,
  };
})();
