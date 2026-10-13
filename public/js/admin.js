/* Admin panel (#/admin/<tab>): site overview, players, bets, balance ledger and site settings.
   Only accounts the server marks as admin see the link; every call is checked again server-side. */
(function () {
  'use strict';
  const { $, $$, h, fmt, fmtMult, esc } = BB;
  const ic = BB.icon;

  const TABS = [['overview', 'Overview', 'dash'], ['users', 'Players', 'users'], ['bets', 'Bets', 'clock'], ['ledger', 'Ledger', 'swap'], ['settings', 'Settings', 'gear']];
  const KINDS = ['all', 'admin', 'deposit', 'withdrawal', 'refund', 'faucet', 'daily', 'rakeback', 'levelup', 'welcome', 'reset'];
  let tab = 'overview', timer = 0;
  const st = { q: '', filter: '', sort: 'created', dir: 'desc', page: 0, betGame: '', betBig: false, betUser: 0, betPage: 0, kind: 'all', ledPage: 0 };
  const PER = 25;

  const num = (v) => Number(v) || 0;
  const gameName = (id) => (BB.games[id] ? BB.games[id].name : id);
  const when = (t) => (t ? BB.stamp(new Date(t).getTime()) : '—');
  const seen = (t) => (t ? BB.ago(new Date(t).getTime()) : 'never');
  const signed = (n) => `<span class="${n > 0 ? 'pos' : n < 0 ? 'neg' : ''}">${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}</span>`;
  const compact = (n) => { const a = Math.abs(n); return (a >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K' : Math.round(n) + '').replace('.0', ''); };
  const initial = (name) => esc(String(name || '?')[0].toUpperCase());
  const hue = (id) => (Number(id) * 47) % 360;
  const avatar = (u) => `<span class="ad-av" style="--h:${hue(u.id || u.user_id)}">${initial(u.name)}</span>`;
  const loading = () => '<div class="ad-loading"><span></span><span></span><span></span></div>';
  const errBox = (e) => `<div class="empty">${esc(e.message || 'Could not load this.')}</div>`;

  function pager(total, page, per, go) {
    const pages = Math.max(1, Math.ceil(total / per));
    if (pages < 2) return '';
    return `<div class="ad-pager" data-pager><button type="button" class="btn ghost sm" data-p="${page - 1}"${page <= 0 ? ' disabled' : ''}>Previous</button><span>Page ${page + 1} of ${pages} · ${total.toLocaleString('en-US')} total</span><button type="button" class="btn ghost sm" data-p="${page + 1}"${page >= pages - 1 ? ' disabled' : ''}>Next</button></div>`;
  }
  function bindPager(box, go) {
    const p = $('[data-pager]', box);
    if (p) p.addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b && !b.disabled) go(Number(b.dataset.p)); });
  }

  /* ---------------- charts: single-series columns with a hover readout ---------------- */
  function columns(days, valueOf, opts) {
    const W = 560, H = 170, padL = 40, padB = 22, padT = 10;
    const vals = days.map(valueOf);
    const hasNeg = vals.some((v) => v < 0);
    const max = Math.max(1, ...vals.map((v) => Math.abs(v)));
    const niceMax = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); const m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; })();
    const lo = hasNeg ? -niceMax : 0, span = niceMax - lo;
    const y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / span);
    const slot = (W - padL) / days.length, bw = Math.min(24, slot - 6);
    const ticks = hasNeg ? [-niceMax, 0, niceMax] : [0, niceMax / 2, niceMax];
    let g = ticks.map((t) => `<line x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}" class="ch-grid${t === 0 ? ' zero' : ''}"/><text x="${padL - 8}" y="${y(t) + 4}" class="ch-tick" text-anchor="end">${compact(t)}</text>`).join('');
    days.forEach((d, i) => {
      const v = vals[i], x = padL + i * slot + (slot - bw) / 2, y0 = y(0), y1 = y(v), top = Math.min(y0, y1), hgt = Math.max(v === 0 ? 0 : 1.5, Math.abs(y1 - y0));
      const r = Math.min(4, hgt / 2, bw / 2), up = v >= 0;
      // rounded at the data end, square at the baseline
      const path = up
        ? `M${x},${top + hgt}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${top + hgt}Z`
        : `M${x},${top}V${top + hgt - r}Q${x},${top + hgt} ${x + r},${top + hgt}H${x + bw - r}Q${x + bw},${top + hgt} ${x + bw},${top + hgt - r}V${top}Z`;
      const fill = opts.color(v);
      const label = new Date(d.day + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      g += `<g class="ch-col" data-tip="${esc(label)}|${esc(opts.tip(v, d))}"><rect x="${padL + i * slot}" y="${padT}" width="${slot}" height="${H - padT - padB}" fill="transparent"/>${hgt ? `<path d="${path}" fill="${fill}"/>` : ''}</g>`;
      if (i % 3 === (days.length - 1) % 3) g += `<text x="${x + bw / 2}" y="${H - 6}" class="ch-tick" text-anchor="middle">${label}</text>`;
    });
    return `<div class="ch"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}">${g}</svg><div class="ch-tip" hidden></div></div>`;
  }
  function bindTips(root) {
    $$('.ch', root).forEach((ch) => {
      const tip = $('.ch-tip', ch);
      ch.addEventListener('pointermove', (e) => {
        const col = e.target.closest('.ch-col');
        $$('.ch-col', ch).forEach((c) => c.classList.toggle('hot', c === col));
        if (!col) { tip.hidden = true; return; }
        const [a, b] = col.dataset.tip.split('|');
        tip.innerHTML = `<small>${a}</small><b>${b}</b>`;
        tip.hidden = false;
        const r = ch.getBoundingClientRect();
        tip.style.left = Math.min(r.width - 150, Math.max(0, e.clientX - r.left + 12)) + 'px';
        tip.style.top = Math.max(0, e.clientY - r.top - 54) + 'px';
      });
      ch.addEventListener('pointerleave', () => { tip.hidden = true; $$('.ch-col', ch).forEach((c) => c.classList.remove('hot')); });
    });
  }

  /* ---------------- overview ---------------- */
  async function overview(body) {
    body.innerHTML = loading();
    let d;
    try { d = await BB.api('GET', 'admin/overview'); } catch (e) { body.innerHTML = errBox(e); return; }
    if (tab !== 'overview') return;
    const kpi = (label, value, sub, icon, cls) => `<div class="ad-kpi${cls ? ' ' + cls : ''}"><span class="ad-kpi-ic">${ic(icon, 18)}</span><small>${label}</small><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
    const u = d.users, day = d.day, all = d.all;
    const signups = d.signups.reduce((a, x) => a + x.n, 0);
    body.innerHTML = `
      <div class="ad-kpis">
        ${kpi('Players', u.total.toLocaleString('en-US'), `<span class="live-dot"></span>${u.online} online now · ${u.active24} active today`, 'users')}
        ${kpi('New sign-ups', u.new24.toLocaleString('en-US'), `${signups} in the last 14 days`, 'user')}
        ${kpi('Bets · 24h', day.bets.toLocaleString('en-US'), `${all.bets.toLocaleString('en-US')} all time`, 'clock')}
        ${kpi('Wagered · 24h', `<i class="coin"></i>${fmt(day.wagered)}`, `${fmt(all.wagered)} all time`, 'chart')}
        ${kpi('House result · 24h', signed(day.house), `${day.wagered ? ((day.house / day.wagered) * 100).toFixed(2) + '% of wagers' : 'no bets yet'}`, 'crown', day.house >= 0 ? 'good' : 'bad')}
        ${kpi('Coins held by players', `<i class="coin"></i>${fmt(u.balances)}`, `${u.banned} suspended account${u.banned === 1 ? '' : 's'}`, 'wallet')}
      </div>
      <div class="ad-grid2">
        <section class="card-sec"><div class="sec-row"><h3>Wagered per day</h3><small class="muted">Last 14 days · play coins</small></div>
          ${columns(d.days, (x) => num(x.wagered), { label: 'Coins wagered per day', color: () => '#b8860b', tip: (v, x) => `${fmt(v)} wagered · ${x.bets.toLocaleString('en-US')} bets` })}</section>
        <section class="card-sec"><div class="sec-row"><h3>House result per day</h3><small class="muted">Above the line the house won, below it players did</small></div>
          ${columns(d.days, (x) => num(x.wagered) - num(x.paid), { label: 'House profit per day', color: (v) => (v >= 0 ? '#2f9e66' : '#d9434f'), tip: (v) => (v >= 0 ? 'House won ' : 'Players won ') + fmt(Math.abs(v)) })}</section>
      </div>
      <div class="ad-grid3">
        <section class="card-sec"><div class="sec-row"><h3>Top games · 7 days</h3></div>
          ${d.games.length ? `<div class="ad-table"><div class="ad-tr th"><span>Game</span><span class="n">Bets</span><span class="n">Wagered</span><span class="n">House</span></div>
            ${d.games.map((g) => `<div class="ad-tr"><span class="ad-game">${BB.games[g.game] ? `<i class="gi">${BB.games[g.game].icon}</i>` : ''}${esc(gameName(g.game))}</span><span class="n">${g.bets.toLocaleString('en-US')}</span><span class="n">${compact(num(g.wagered))}</span><span class="n">${signed(num(g.house))}</span></div>`).join('')}</div>`
            : '<div class="empty">No bets in the last week.</div>'}</section>
        <section class="card-sec"><div class="sec-row"><h3>Newest players</h3><a class="link" href="#/admin/users">All players</a></div>
          ${d.recent.map((p) => `<button type="button" class="ad-person" data-user="${p.id}">${avatar(p)}<span><b>${esc(p.name)}</b><small>${esc(p.email)}</small></span><em>${seen(p.createdAt)}</em></button>`).join('') || '<div class="empty">No players yet.</div>'}</section>
        <section class="card-sec"><div class="sec-row"><h3>Biggest wagerers</h3></div>
          ${d.top.map((p) => `<button type="button" class="ad-person" data-user="${p.id}">${avatar(p)}<span><b>${esc(p.name)}</b><small>${fmt(p.wagered)} wagered</small></span><em>${signed(p.profit)}</em></button>`).join('') || '<div class="empty">No players yet.</div>'}</section>
      </div>`;
    bindTips(body);
  }

  /* ---------------- players ---------------- */
  function users(body) {
    body.innerHTML = `
      <div class="ad-tools">
        <label class="search"><svg viewBox="0 0 24 24" width="16" height="16"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input type="search" id="ad-q" placeholder="Search name, email or id" value="${esc(st.q)}" autocomplete="off" aria-label="Search players"></label>
        <div class="chips" id="ad-filter">${[['', 'All'], ['online', 'Online'], ['admins', 'Admins'], ['banned', 'Suspended']].map(([k, l]) => `<button type="button" class="chip${st.filter === k ? ' on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
        <select id="ad-sort" class="input sm" aria-label="Sort players">
          ${[['created', 'Newest'], ['seen', 'Last seen'], ['balance', 'Balance'], ['wagered', 'Wagered'], ['bets', 'Bets'], ['name', 'Name']].map(([k, l]) => `<option value="${k}"${st.sort === k ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <section class="card-sec ad-list" id="ad-users">${loading()}</section>`;
    let t = 0;
    $('#ad-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); st.page = 0; loadUsers(); }, 250); });
    $('#ad-filter').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; st.filter = b.dataset.f; st.page = 0; $$('#ad-filter .chip').forEach((c) => c.classList.toggle('on', c === b)); loadUsers(); });
    $('#ad-sort').addEventListener('change', (e) => { st.sort = e.target.value; st.dir = st.sort === 'name' ? 'asc' : 'desc'; st.page = 0; loadUsers(); });
    loadUsers();
  }
  async function loadUsers() {
    const box = $('#ad-users');
    if (!box) return;
    let r;
    try { r = await BB.api('GET', `admin/users?q=${encodeURIComponent(st.q)}&filter=${st.filter}&sort=${st.sort}&dir=${st.dir}&limit=${PER}&offset=${st.page * PER}`); } catch (e) { box.innerHTML = errBox(e); return; }
    if (!$('#ad-users')) return;
    box.innerHTML = r.users.length ? `<div class="ad-table users">
        <div class="ad-tr th"><span>Player</span><span class="n">Balance</span><span class="n">Wagered</span><span class="n">Profit</span><span class="n hide-s">Bets</span><span class="hide-s">Joined</span><span class="hide-s">Last seen</span><span>Status</span></div>
        ${r.users.map((u) => `<button type="button" class="ad-tr click" data-user="${u.id}">
          <span class="ad-who">${avatar(u)}<span><b>${esc(u.name)}</b><small>${esc(u.email)}</small></span></span>
          <span class="n"><i class="coin sm"></i>${fmt(u.balance)}</span><span class="n">${fmt(u.wagered)}</span><span class="n">${signed(u.profit)}</span>
          <span class="n hide-s">${u.bets.toLocaleString('en-US')}</span><span class="hide-s">${when(u.createdAt)}</span><span class="hide-s">${seen(u.lastSeen)}</span>
          <span>${u.banned ? '<em class="ad-chip bad">Suspended</em>' : u.role === 'admin' ? `<em class="ad-chip gold">${u.owner ? 'Owner' : 'Admin'}</em>` : u.lastSeen && Date.now() - new Date(u.lastSeen) < 300000 ? '<em class="ad-chip ok">Online</em>' : '<em class="ad-chip">Player</em>'}</span>
        </button>`).join('')}</div>${pager(r.total, st.page, PER)}`
      : '<div class="empty">No players match that.</div>';
    bindPager(box, (p) => { st.page = p; loadUsers(); });
  }

  /* ---------------- one player ---------------- */
  async function openUser(id) {
    const m = h(`<div class="modal-back" id="ad-user"><div class="modal single wide ad-drawer" role="dialog" aria-modal="true" aria-label="Player">
      <button class="modal-x" aria-label="Close">&times;</button><div class="modal-body" id="ad-ub">${loading()}</div></div></div>`);
    BB.hideModal($('#ad-user'));
    BB.showModal(m);
    paintUser(id);
  }
  async function paintUser(id) {
    const box = $('#ad-ub');
    if (!box) return;
    let d;
    try { d = await BB.api('GET', `admin/users/${id}`); } catch (e) { box.innerHTML = errBox(e); return; }
    const u = d.user, me = BB.user(), self = me && me.id === u.id, locked = u.owner || self;
    box.innerHTML = `
      <div class="ad-uhead">${avatar(u).replace('ad-av', 'ad-av xl')}
        <div><h2>${esc(u.name)} ${u.banned ? '<em class="ad-chip bad">Suspended</em>' : u.role === 'admin' ? `<em class="ad-chip gold">${u.owner ? 'Owner' : 'Admin'}</em>` : ''}</h2>
        <p>${esc(u.email)} · #${u.id} · joined ${when(u.createdAt)} · last seen ${seen(u.lastSeen)}${u.lastIp ? ' · ' + esc(u.lastIp) : ''}</p>
        ${u.banned && u.banReason ? `<p class="ad-ban">Reason: ${esc(u.banReason)}</p>` : ''}</div></div>
      <div class="ad-kpis small">
        <div class="ad-kpi"><small>Balance</small><b><i class="coin"></i>${fmt(u.balance)}</b></div>
        <div class="ad-kpi"><small>Wagered</small><b>${fmt(u.wagered)}</b></div>
        <div class="ad-kpi"><small>Player profit</small><b>${signed(u.profit)}</b></div>
        <div class="ad-kpi"><small>Bets</small><b>${u.bets.toLocaleString('en-US')}</b><em>${d.sessions.n} active session${d.sessions.n === 1 ? '' : 's'}</em></div>
      </div>
      <section class="ad-box">
        <h3>${ic('wallet', 17)}Adjust balance</h3>
        <div class="ad-bal">
          <div class="seg mini" id="ad-bmode"><button type="button" data-v="add" class="on">Add</button><button type="button" data-v="remove">Remove</button><button type="button" data-v="set">Set to</button></div>
          <div class="amount"><i class="coin"></i><input type="text" inputmode="decimal" id="ad-bamt" placeholder="0.00" aria-label="Amount"></div>
          <input type="text" class="input" id="ad-bnote" placeholder="Note (shown in the ledger)" maxlength="160" aria-label="Note">
          <button type="button" class="btn primary" id="ad-bgo">Apply</button>
        </div>
        <div class="form-err" id="ad-berr"></div>
      </section>
      <section class="ad-box">
        <h3>${ic('shield', 17)}Account</h3>
        <div class="ad-actions">
          ${locked ? '<p class="muted">The owner account and your own account can’t be suspended, demoted or deleted here.</p>' : `
          <button type="button" class="btn ghost sm" id="ad-ban">${ic('ban', 16)}${u.banned ? 'Lift suspension' : 'Suspend'}</button>
          <button type="button" class="btn ghost sm" id="ad-role">${ic('crown', 16)}${u.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>`}
          <button type="button" class="btn ghost sm" id="ad-rename">${ic('edit', 16)}Rename</button>
          <button type="button" class="btn ghost sm" id="ad-out">${ic('logout', 16)}Sign out everywhere</button>
          ${u.owner && !self ? '' : `<button type="button" class="btn ghost sm" id="ad-pw">${ic('lock', 16)}Set password</button>`}
          ${locked ? '' : `<button type="button" class="btn danger sm" id="ad-del">${ic('trash', 16)}Delete</button>`}
          <a class="btn ghost sm" href="#/admin/bets" id="ad-allbets">${ic('clock', 16)}All their bets</a>
        </div>
      </section>
      <div class="seg ad-utabs" id="ad-utabs"><button type="button" data-t="bets" class="on">Recent bets</button><button type="button" data-t="ledger">Ledger</button><button type="button" data-t="games">By game</button></div>
      <div id="ad-upane"></div>`;

    const panes = {
      bets: () => (d.bets.length ? `<div class="ad-table"><div class="ad-tr th"><span>Game</span><span class="n">Bet</span><span class="n">Multiplier</span><span class="n">Profit</span><span>When</span></div>
        ${d.bets.map((b) => `<div class="ad-tr"><span class="ad-game">${esc(gameName(b.game))}</span><span class="n">${fmt(b.wager)}</span><span class="n">${fmtMult(num(b.mult))}</span><span class="n">${signed(num(b.payout) - num(b.wager))}</span><span>${when(b.created_at)}</span></div>`).join('')}</div>` : '<div class="empty">No bets yet.</div>'),
      ledger: () => (d.ledger.length ? `<div class="ad-table"><div class="ad-tr th"><span>Type</span><span class="n">Amount</span><span class="n">Balance after</span><span>Note</span><span>When</span></div>
        ${d.ledger.map((l) => `<div class="ad-tr"><span><em class="ad-chip">${esc(l.kind)}</em></span><span class="n">${signed(num(l.amount))}</span><span class="n">${fmt(l.balance_after)}</span><span class="ad-note">${esc(l.note || '')}${l.actor ? ` <small>by ${esc(l.actor)}</small>` : ''}</span><span>${when(l.created_at)}</span></div>`).join('')}</div>` : '<div class="empty">No balance changes outside of bets.</div>'),
      games: () => (d.games.length ? `<div class="ad-table"><div class="ad-tr th"><span>Game</span><span class="n">Bets</span><span class="n">Wagered</span><span class="n">Player profit</span></div>
        ${d.games.map((g) => `<div class="ad-tr"><span class="ad-game">${esc(gameName(g.game))}</span><span class="n">${g.bets}</span><span class="n">${fmt(g.wagered)}</span><span class="n">${signed(num(g.profit))}</span></div>`).join('')}</div>` : '<div class="empty">No bets yet.</div>'),
    };
    const pane = (t) => { $('#ad-upane').innerHTML = panes[t](); $$('#ad-utabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t)); };
    $('#ad-utabs').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) pane(b.dataset.t); });
    pane('bets');

    let mode = 'add';
    BB.ui.bindSeg($('#ad-bmode'), (v) => { mode = v; });
    $('#ad-bamt').addEventListener('input', (e) => { const c = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'); if (c !== e.target.value) e.target.value = c; });
    $('#ad-bgo').addEventListener('click', async () => {
      const amt = parseFloat($('#ad-bamt').value), err = $('#ad-berr');
      if (!(amt >= 0) || (mode !== 'set' && !(amt > 0))) { err.textContent = 'Enter an amount.'; return; }
      const body = { mode: mode === 'set' ? 'set' : 'add', amount: mode === 'remove' ? -amt : amt, note: $('#ad-bnote').value.trim() };
      $('#ad-bgo').disabled = true;
      try {
        const r = await BB.api('POST', `admin/users/${u.id}/balance`, body);
        BB.toast(`${u.name}: balance ${r.delta > 0 ? '+' : '−'}${fmt(Math.abs(r.delta))} → ${fmt(r.balance)}`, 'ok');
        if (self) BB.refreshMe();
        paintUser(u.id);
        refreshList();
      } catch (e) { err.textContent = e.message; $('#ad-bgo').disabled = false; }
    });
    const act = async (fn, okMsg) => { try { await fn(); if (okMsg) BB.toast(okMsg, 'ok'); paintUser(u.id); refreshList(); } catch (e) { BB.toast(e.message, 'err'); } };
    const on = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('click', fn); };
    on('ad-ban', async () => {
      if (u.banned) return act(() => BB.api('POST', `admin/users/${u.id}`, { banned: false }), 'Suspension lifted.');
      const reason = await ask('Suspend ' + u.name + '?', 'They are signed out at once and can’t log in until you lift it.', 'Reason (shown to them)', 'text', 'Suspend', true);
      if (reason !== null) act(() => BB.api('POST', `admin/users/${u.id}`, { banned: true, banReason: reason }), `${u.name} is suspended.`);
    });
    on('ad-role', async () => {
      const make = u.role !== 'admin';
      if (await BB.confirm({ title: make ? `Make ${u.name} an admin?` : `Remove ${u.name}'s admin access?`, body: make ? 'Admins can see every player and change balances.' : 'They go back to being a normal player.', ok: make ? 'Make admin' : 'Remove admin', danger: make }))
        act(() => BB.api('POST', `admin/users/${u.id}`, { role: make ? 'admin' : 'user' }), make ? `${u.name} is now an admin.` : 'Admin access removed.');
    });
    on('ad-rename', async () => {
      const name = await ask('Rename ' + u.name, 'Usernames are 2–16 letters, numbers, dots, dashes or underscores.', 'New username', 'text', 'Rename', false, u.name);
      if (name) act(() => BB.api('POST', `admin/users/${u.id}`, { name }), 'Renamed.');
    });
    on('ad-out', () => act(async () => { const r = await BB.api('POST', `admin/users/${u.id}/logout`, {}); BB.toast(`Ended ${r.ended} session${r.ended === 1 ? '' : 's'}.`, 'ok'); }));
    on('ad-pw', async () => {
      const pw = await ask('Set a new password', `${u.name} will be signed out everywhere and must use this password next time.`, 'New password (8+ characters)', 'password', 'Set password');
      if (pw) act(() => BB.api('POST', `admin/users/${u.id}/password`, { password: pw }), 'Password changed.');
    });
    on('ad-del', async () => {
      if (await BB.confirm({ title: `Delete ${u.name}?`, body: 'Their account, balance, bets and ledger are removed for good.', ok: 'Delete player', danger: true })) {
        try { await BB.api('DELETE', `admin/users/${u.id}`, {}); BB.toast('Player deleted.', 'ok'); BB.hideModal($('#ad-user')); refreshList(); } catch (e) { BB.toast(e.message, 'err'); }
      }
    });
    on('ad-allbets', () => { st.betUser = u.id; st.betPage = 0; BB.hideModal($('#ad-user')); });
  }
  const refreshList = () => { if (tab === 'users') loadUsers(); if (tab === 'overview') overview($('#ad-body')); };

  /** Small prompt dialog. Resolves with the text, or null if cancelled. */
  function ask(title, text, label, type, ok, danger, value) {
    return new Promise((resolve) => {
      const m = h(`<div class="modal-back"><div class="modal single small" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-body"><h2 class="modal-title">${esc(title)}</h2><p class="confirm-text">${esc(text)}</p>
        <label class="field"><span class="field-l">${esc(label)}</span><input type="${type}" id="ask-v" value="${esc(value || '')}" autocomplete="off"></label>
        <div class="confirm-btns"><button type="button" class="btn ghost" data-v="0">Cancel</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${esc(ok)}</button></div></div></div></div>`);
      let done = false;
      const finish = (v) => { if (done) return; done = true; BB.hideModal(m); resolve(v); };
      m.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) finish(b.dataset.v === '1' ? $('#ask-v', m).value.trim() : null); });
      $('#ask-v', m).addEventListener('keydown', (e) => { if (e.key === 'Enter') finish($('#ask-v', m).value.trim()); });
      BB.showModal(m);
      const obs = new MutationObserver(() => { if (!m.isConnected) { obs.disconnect(); finish(null); } });
      obs.observe($('#modal-root'), { childList: true });
      setTimeout(() => $('#ask-v', m).focus(), 50);
    });
  }

  /* ---------------- bets ---------------- */
  function bets(body) {
    body.innerHTML = `<div class="ad-tools">
        <select id="ad-bgame" class="input sm" aria-label="Game"><option value="">All games</option></select>
        <button type="button" class="chip${st.betBig ? ' on' : ''}" id="ad-bbig">Wins of 10× or more</button>
        ${st.betUser ? `<button type="button" class="chip on" id="ad-buser">Player #${st.betUser} &times;</button>` : ''}
      </div>
      <section class="card-sec ad-list" id="ad-bets">${loading()}</section>`;
    $('#ad-bgame').addEventListener('change', (e) => { st.betGame = e.target.value; st.betPage = 0; loadBets(); });
    $('#ad-bbig').addEventListener('click', (e) => { st.betBig = !st.betBig; e.target.classList.toggle('on', st.betBig); st.betPage = 0; loadBets(); });
    const bu = $('#ad-buser');
    if (bu) bu.addEventListener('click', () => { st.betUser = 0; bets(body); });
    loadBets();
  }
  async function loadBets() {
    const box = $('#ad-bets');
    if (!box) return;
    let r;
    try { r = await BB.api('GET', `admin/bets?game=${encodeURIComponent(st.betGame)}&user=${st.betUser}&big=${st.betBig ? 1 : 0}&limit=50&offset=${st.betPage * 50}`); } catch (e) { box.innerHTML = errBox(e); return; }
    const sel = $('#ad-bgame');
    if (sel && sel.options.length <= 1) { sel.innerHTML = '<option value="">All games</option>' + r.games.map((g) => `<option value="${esc(g)}">${esc(gameName(g))}</option>`).join(''); sel.value = st.betGame; }
    box.innerHTML = r.bets.length ? `<div class="ad-table bets"><div class="ad-tr th"><span>When</span><span>Player</span><span>Game</span><span class="n">Bet</span><span class="n">Multiplier</span><span class="n">Payout</span><span class="n">Profit</span></div>
      ${r.bets.map((b) => `<div class="ad-tr"><span>${when(b.created_at)}</span><span><button type="button" class="link" data-user="${b.user_id}">${esc(b.name)}</button></span><span class="ad-game">${esc(gameName(b.game))}</span><span class="n">${fmt(b.wager)}</span><span class="n">${fmtMult(num(b.mult))}</span><span class="n">${fmt(b.payout)}</span><span class="n">${signed(num(b.payout) - num(b.wager))}</span></div>`).join('')}</div>${pager(r.total, st.betPage, 50)}`
      : '<div class="empty">No bets match that.</div>';
    bindPager(box, (p) => { st.betPage = p; loadBets(); });
  }

  /* ---------------- ledger ---------------- */
  function ledger(body) {
    body.innerHTML = `<div class="ad-tools"><div class="chips" id="ad-kinds">${KINDS.map((k) => `<button type="button" class="chip${st.kind === k ? ' on' : ''}" data-k="${k}">${k === 'all' ? 'Everything' : k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
      <p class="sec-p muted">Every balance change that isn't a bet: welcome coins, admin adjustments, (simulated) deposits and withdrawals, faucet top-ups and rewards.</p>
      <section class="card-sec ad-list" id="ad-led">${loading()}</section>`;
    $('#ad-kinds').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; st.kind = b.dataset.k; st.ledPage = 0; $$('#ad-kinds .chip').forEach((c) => c.classList.toggle('on', c === b)); loadLedger(); });
    loadLedger();
  }
  async function loadLedger() {
    const box = $('#ad-led');
    if (!box) return;
    let r;
    try { r = await BB.api('GET', `admin/ledger?kind=${st.kind === 'all' ? '' : st.kind}&limit=50&offset=${st.ledPage * 50}`); } catch (e) { box.innerHTML = errBox(e); return; }
    box.innerHTML = r.entries.length ? `<div class="ad-table ledger"><div class="ad-tr th"><span>When</span><span>Player</span><span>Type</span><span class="n">Amount</span><span class="n">Balance after</span><span>Note</span></div>
      ${r.entries.map((l) => `<div class="ad-tr"><span>${when(l.created_at)}</span><span><button type="button" class="link" data-user="${l.user_id}">${esc(l.name)}</button></span><span><em class="ad-chip">${esc(l.kind)}</em></span><span class="n">${signed(num(l.amount))}</span><span class="n">${fmt(l.balance_after)}</span><span class="ad-note">${esc(l.note || '')}${l.actor ? ` <small>by ${esc(l.actor)}</small>` : ''}</span></div>`).join('')}</div>${pager(r.total, st.ledPage, 50)}`
      : '<div class="empty">Nothing here yet.</div>';
    bindPager(box, (p) => { st.ledPage = p; loadLedger(); });
  }

  /* ---------------- settings ---------------- */
  async function settings(body) {
    body.innerHTML = loading();
    let s;
    try { s = (await BB.api('GET', 'admin/settings')).settings; } catch (e) { body.innerHTML = errBox(e); return; }
    if (tab !== 'settings') return;
    const me = BB.user();
    body.innerHTML = `
      <div class="ad-grid2">
        <section class="card-sec">
          <h3>Announcement</h3>
          <p class="sec-p">Shown in a bar across the top of the site for every visitor. Leave it empty to hide it.</p>
          <textarea class="input ad-area" id="as-ann" maxlength="280" placeholder="e.g. Double rakeback this weekend!">${esc(s.announcement || '')}</textarea>
          <small class="muted" id="as-count">${(s.announcement || '').length}/280</small>
        </section>
        <section class="card-sec">
          <h3>Players</h3>
          <div class="set-row"><div class="set-t"><b>Open sign-ups</b><small>When off, nobody new can register (the owner still can).</small></div>
            <button type="button" class="switch${s.signupsOpen ? ' on' : ''}" role="switch" aria-checked="${!!s.signupsOpen}" aria-label="Open sign-ups" id="as-open"><i></i></button></div>
          <div class="set-row"><div class="set-t"><b>Starting balance</b><small>Play coins every new account begins with. Also the faucet's top-up level.</small></div>
            <div class="amount sm"><i class="coin"></i><input type="text" inputmode="decimal" id="as-start" value="${Number(s.startBalance).toFixed(2)}" aria-label="Starting balance"></div></div>
        </section>
      </div>
      <div class="ad-save"><button type="button" class="btn primary lg" id="as-save">Save settings</button><span class="form-err" id="as-err"></span></div>
      <section class="card-sec">
        <h3>Admin access</h3>
        <p class="sec-p">You're signed in as <b>${esc(me.email)}</b>${me.owner ? ' — the owner account. It can’t be suspended, demoted or deleted from the panel.' : '.'} The owner address is set with the <code>ADMIN_EMAILS</code> environment variable in Vercel, and claiming it needs <code>ADMIN_SETUP_KEY</code>. You can make other players admins from their profile.</p>
      </section>`;
    $('#as-ann').addEventListener('input', (e) => { $('#as-count').textContent = e.target.value.length + '/280'; });
    $('#as-open').addEventListener('click', (e) => { const b = e.currentTarget, v = !b.classList.contains('on'); b.classList.toggle('on', v); b.setAttribute('aria-checked', v); });
    $('#as-save').addEventListener('click', async () => {
      const start = parseFloat($('#as-start').value);
      if (!(start >= 0)) { $('#as-err').textContent = 'Enter a starting balance.'; return; }
      $('#as-save').disabled = true;
      try {
        const r = await BB.api('POST', 'admin/settings', { announcement: $('#as-ann').value, signupsOpen: $('#as-open').classList.contains('on'), startBalance: start });
        BB.applySettings(r.settings);
        BB.toast('Settings saved.', 'ok');
        $('#as-err').textContent = '';
      } catch (e) { $('#as-err').textContent = e.message; }
      $('#as-save').disabled = false;
    });
  }

  /* ---------------- page ---------------- */
  const PAINT = { overview, users, bets, ledger, settings };
  function paint() {
    const body = $('#ad-body');
    $$('#ad-tabs a').forEach((a) => a.classList.toggle('on', a.dataset.t === tab));
    clearInterval(timer);
    PAINT[tab](body);
    if (tab === 'overview') timer = setInterval(() => { if (document.visibilityState === 'visible' && !$('#modal-root').children.length) overview(body); }, 30000);
  }

  BB.registerPage('admin', {
    mount(view, sub) {
      const u = BB.user();
      if (!u) { BB.authGate(view, 'Admin panel', 'Log in with an admin account to manage the site.'); return; }
      if (!u.isAdmin) { view.appendChild(h(`<div class="page"><div class="gate"><i class="coin xl"></i><h1>Admins only</h1><p>This page is for the site's administrators.</p><div class="gate-btns"><a class="btn primary lg" href="#/">Back to the lobby</a></div></div></div>`)); return; }
      tab = PAINT[sub] ? sub : 'overview';
      view.appendChild(h(`<div class="page admin-page">
        <div class="ad-head">
          <div><span class="kicker">${ic('dash', 15)}Control room</span><h1>Admin panel</h1><p>Signed in as ${esc(u.email)}${u.owner ? ' · owner' : ''}</p></div>
          <nav class="ad-tabs" id="ad-tabs">${TABS.map(([k, l, i]) => `<a href="#/admin/${k}" data-t="${k}">${ic(i, 17)}<span>${l}</span></a>`).join('')}</nav>
        </div>
        <div id="ad-body"></div>
      </div>`));
      $('.admin-page', view).addEventListener('click', (e) => { const b = e.target.closest('[data-user]'); if (b) { e.preventDefault(); openUser(b.dataset.user); } });
      paint();
    },
    update(sub) {
      if (!$('#ad-body')) return;
      tab = PAINT[sub] ? sub : 'overview';
      paint();
    },
    unmount() { clearInterval(timer); },
  });
})();
