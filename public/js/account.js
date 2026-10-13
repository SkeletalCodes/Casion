/* Account area (#/account/<tab>): profile, security, preferences, transactions, bet history, statistics, limits.
   Plus the VIP & rewards page (#/vip). Your account, balance and saved settings live on the server. */
(function () {
  'use strict';
  const { $, $$, h, fmt, fmtMult, esc, round2 } = BB;
  const ic = BB.icon;

  const TABS = [
    ['profile', 'Profile', 'user'], ['security', 'Security', 'lock'], ['preferences', 'Preferences', 'gear'],
    ['transactions', 'Transactions', 'swap'], ['bets', 'Bet history', 'clock'], ['stats', 'Statistics', 'chart'], ['limits', 'Limits', 'pulse'],
  ];
  const DAY = 86400000;
  let tab = 'profile', timers = [], offs = [];
  const view = { txFilter: 'all', txPage: 0, betGame: '', betPage: 0 };

  function cleanup() { timers.forEach(clearInterval); timers = []; offs.forEach((f) => f()); offs = []; }
  function on(evt, fn) { document.addEventListener(evt, fn); offs.push(() => document.removeEventListener(evt, fn)); }
  function every(ms, fn) { timers.push(setInterval(fn, ms)); }

  const sw = (key, isOn, label) => `<button type="button" class="switch${isOn ? ' on' : ''}" role="switch" aria-checked="${!!isOn}" aria-label="${label}" data-sw="${key}"><i></i></button>`;
  const setRow = (title, desc, control) => `<div class="set-row"><div class="set-t"><b>${title}</b><small>${desc}</small></div>${control}</div>`;
  const monthYear = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  function pager(el, page, total, per, go) {
    const pages = Math.max(1, Math.ceil(total / per));
    el.innerHTML = pages < 2 ? '' : `<button type="button" class="btn ghost sm" data-p="-1"${page <= 0 ? ' disabled' : ''}>Previous</button><span>Page ${page + 1} of ${pages}</span><button type="button" class="btn ghost sm" data-p="1"${page >= pages - 1 ? ' disabled' : ''}>Next</button>`;
    el.onclick = (e) => { const b = e.target.closest('[data-p]'); if (b && !b.disabled) go(page + Number(b.dataset.p)); };
  }

  /* ---------- Profile ---------- */
  function profile(body) {
    const u = BB.user(), v = BB.vipInfo(u);
    let av = u.avatar;
    body.innerHTML = `
      <section class="card-sec">
        <h3>Profile</h3>
        <div class="form-grid">
          <label class="field"><span class="field-l">Username</span><input type="text" id="pf-name" maxlength="16" value="${esc(u.name)}" autocomplete="off" spellcheck="false"></label>
          <label class="field"><span class="field-l">Email</span><input type="text" value="${esc(u.email)}" disabled></label>
        </div>
        <div class="field"><span class="field-l">Avatar colour</span>
          <div class="av-pick" id="pf-av">${BB.avatars.map((a, i) => `<button type="button" data-i="${i}" class="${i === av ? 'on' : ''}" style="--a1:${a[0]};--a2:${a[1]}" aria-label="Avatar colour ${i + 1}">${esc(u.name[0].toUpperCase())}</button>`).join('')}</div></div>
        <div class="form-err" id="pf-err"></div>
        <button type="button" class="btn primary" id="pf-save">Save changes</button>
      </section>
      <section class="card-sec">
        <h3>At a glance</h3>
        <div class="stat-cards">
          <div class="stat"><small>Balance</small><b><i class="coin"></i>${fmt(BB.balance())}</b></div>
          <div class="stat"><small>Total wagered</small><b>${fmt(u.stats.wagered)}</b></div>
          <div class="stat"><small>VIP level</small><b style="color:${v.cur.color}">${v.cur.name}</b></div>
          <div class="stat"><small>Member since</small><b>${monthYear(u.joined)}</b></div>
        </div>
      </section>`;
    $('#pf-av').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      av = Number(b.dataset.i);
      $$('#pf-av button').forEach((x) => x.classList.toggle('on', x === b));
      BB.sfx('click');
    });
    $('#pf-save').addEventListener('click', async () => {
      const name = $('#pf-name').value.trim();
      if (!/^[A-Za-z0-9_.-]{2,16}$/.test(name)) { $('#pf-err').textContent = 'Usernames are 2–16 letters, numbers, dots, dashes or underscores.'; $('#pf-name').focus(); return; }
      if (name !== u.name) {
        try { await BB.api('POST', 'me/profile', { name }); } catch (e) { $('#pf-err').textContent = e.message; $('#pf-name').focus(); return; }
      }
      u.name = name;
      u.avatar = av;
      BB.saveUsers();
      BB.paintChrome();
      paintHead();
      profile(body);
      BB.toast('Profile saved.', 'ok');
    });
  }

  /* ---------- Security ---------- */
  function device() {
    const ua = navigator.userAgent;
    const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'this device';
    return br + ' on ' + os;
  }

  function tfaSetup(done) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let key = '';
    for (let i = 0; i < 16; i++) key += A[BB.randInt(32)] + (i % 4 === 3 && i < 15 ? ' ' : '');
    const m = h(`<div class="modal-back"><div class="modal single small" role="dialog" aria-modal="true" aria-label="Set up two-factor">
      <button class="modal-x" aria-label="Close">&times;</button>
      <div class="modal-body">
        <h2 class="modal-title">${ic('lock', 22)}Set up two-factor</h2>
        <p class="confirm-text">A real site would have you add this key to an authenticator app. This is a mock-up: the key is random and <b>any 6-digit code is accepted</b>.</p>
        <div class="field"><span class="field-l">Setup key</span><div class="copy"><input type="text" readonly value="${key}"><button type="button" data-copy-text="${key.replace(/ /g, '')}">Copy</button></div></div>
        <label class="field"><span class="field-l">6-digit code</span><input type="text" id="tfa-code" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="123456"></label>
        <div class="form-err" id="tfa-err"></div>
        <button type="button" class="btn primary block lg" id="tfa-ok">Turn on two-factor</button>
      </div></div></div>`);
    $('#tfa-ok', m).addEventListener('click', () => {
      if (!/^\d{6}$/.test($('#tfa-code', m).value.trim())) { $('#tfa-err', m).textContent = 'Enter 6 digits.'; $('#tfa-code', m).focus(); return; }
      BB.hideModal(m);
      done();
    });
    BB.showModal(m);
    setTimeout(() => $('#tfa-code', m).focus(), 60);
  }

  function security(body) {
    const u = BB.user(), isOwner = !!u.owner;
    body.innerHTML = `
      <section class="card-sec">
        <h3>Password</h3>
        <div class="form-grid three">
          <label class="field"><span class="field-l">Current password</span><input type="password" id="sc-cur" autocomplete="current-password"></label>
          <label class="field"><span class="field-l">New password</span><input type="password" id="sc-new" autocomplete="new-password"></label>
          <label class="field"><span class="field-l">Repeat new password</span><input type="password" id="sc-rep" autocomplete="new-password"></label>
        </div>
        <div class="form-err" id="sc-err"></div>
        <button type="button" class="btn primary" id="sc-save">Update password</button>
      </section>
      <section class="card-sec">
        <h3>Two-factor authentication</h3>
        ${setRow(u.sec.tfa ? 'Two-factor is on' : 'Two-factor is off', u.sec.tfa ? 'Withdrawals ask for a 6-digit code.' : 'Add a second step before withdrawals leave your account.',
          `<button type="button" class="btn ${u.sec.tfa ? 'ghost' : 'primary'} sm" id="sc-tfa">${u.sec.tfa ? 'Turn off' : 'Set up'}</button>`)}
      </section>
      <section class="card-sec">
        <h3>Sessions</h3>
        <div class="set-row"><div class="set-t"><b>${esc(device())}</b><small>This device · signed in ${BB.ago(BB.sessionSince())}</small></div><span class="st ok">Active</span></div>
        <button type="button" class="btn ghost sm" data-open="logout" style="margin-top:12px">${ic('logout', 16)}Log out</button>
      </section>
      <section class="card-sec danger">
        <h3>Danger zone</h3>
        ${setRow('Reset account', `Balance back to ${fmt(BB.START_BALANCE)} and all bets, transactions, stats and rewards wiped.`, '<button type="button" class="btn danger sm" id="sc-reset">Reset</button>')}
        ${isOwner ? '' : setRow('Delete account', 'Permanently removes your account and everything in it.', '<button type="button" class="btn danger sm" id="sc-del">Delete</button>')}
      </section>`;
    const err = (msg, el) => { $('#sc-err').textContent = msg; if (el) el.focus(); };
    $('#sc-save').addEventListener('click', async () => {
      const cur = $('#sc-cur'), nw = $('#sc-new'), rep = $('#sc-rep'), btn = $('#sc-save');
      if (!cur.value) return err('Enter your current password.', cur);
      if (nw.value.length < 8) return err('New password needs at least 8 characters.', nw);
      if (nw.value !== rep.value) return err('The two new passwords do not match.', rep);
      btn.disabled = true;
      try {
        await BB.api('POST', 'auth/password', { current: cur.value, next: nw.value });
      } catch (e) {
        btn.disabled = false;
        return err(e.message, e.data && e.data.field === 'current' ? cur : nw);
      }
      BB.notify('Password changed', 'Your password was updated from ' + device() + '. Other devices were signed out.', 'lock');
      security(body);
      BB.toast('Password updated.', 'ok');
    });
    $('#sc-tfa').addEventListener('click', () => {
      const flip = (v) => { u.sec.tfa = v; BB.saveUsers(); BB.notify(v ? 'Two-factor turned on' : 'Two-factor turned off', v ? 'Withdrawals now ask for a code.' : 'Withdrawals no longer ask for a code.', 'lock'); security(body); BB.toast(v ? 'Two-factor is on.' : 'Two-factor is off.', 'ok'); };
      if (u.sec.tfa) BB.confirm({ title: 'Turn off two-factor?', body: 'Withdrawals will stop asking for a code.', ok: 'Turn off', danger: true }).then((ok) => { if (ok) flip(false); });
      else tfaSetup(() => flip(true));
    });
    $('#sc-reset').addEventListener('click', () => {
      BB.confirm({ title: 'Reset your account?', body: `Your balance goes back to ${fmt(BB.START_BALANCE)} and your history, statistics, VIP progress and notifications are erased.`, ok: 'Reset account', danger: true })
        .then((ok) => { if (ok) BB.resetAccount().then((done) => { if (done) BB.toast('Account reset.', 'ok'); }); });
    });
    const del = $('#sc-del');
    if (del) del.addEventListener('click', deleteFlow);
  }

  /** Deleting is permanent, so it asks for the password first. */
  function deleteFlow() {
    const m = h(`<div class="modal-back"><div class="modal single small" role="alertdialog" aria-modal="true" aria-label="Delete account">
      <button class="modal-x" aria-label="Close">&times;</button>
      <div class="modal-body"><h2 class="modal-title">Delete your account?</h2>
        <p class="confirm-text">Your account, balance and history are removed for good. Enter your password to confirm.</p>
        <label class="field"><span class="field-l">Password</span><input type="password" id="del-pw" autocomplete="current-password"></label>
        <div class="form-err" id="del-err"></div>
        <div class="confirm-btns"><button type="button" class="btn ghost" id="del-no">Cancel</button><button type="button" class="btn danger" id="del-yes">Delete account</button></div>
      </div></div></div>`);
    BB.showModal(m);
    setTimeout(() => $('#del-pw', m).focus(), 60);
    $('#del-no', m).addEventListener('click', () => BB.hideModal(m));
    $('#del-yes', m).addEventListener('click', async () => {
      const pw = $('#del-pw', m).value;
      if (!pw) { $('#del-err', m).textContent = 'Enter your password.'; return; }
      $('#del-yes', m).disabled = true;
      try { await BB.api('DELETE', 'me', { password: pw }); } catch (e) { $('#del-err', m).textContent = e.message; $('#del-yes', m).disabled = false; return; }
      BB.hideModal(m);
      await BB.deleteAccount(pw, true);
      BB.toast('Account deleted.', 'ok');
    });
  }

  /* ---------- Preferences ---------- */
  function preferences(body) {
    const u = BB.user(), a = BB.audio ? BB.audio.state() : { music: false, sfx: false };
    body.innerHTML = `
      <section class="card-sec">
        <div class="sec-row"><h3>Sound</h3><button type="button" class="btn ghost sm" data-open="sound">${ic('sound', 16)}Open mixer</button></div>
        ${setRow('Music', 'Background tracks, synthesised in your browser.', sw('music', a.music, 'Music'))}
        ${setRow('Sound effects', 'Cards, chips, wins and the Keno heartbeat.', sw('sfx', a.sfx, 'Sound effects'))}
      </section>
      <section class="card-sec">
        <h3>Play</h3>
        ${setRow('Keyboard shortcuts', '<code>Space</code> bet · <code>A</code> halve the bet · <code>S</code> double it', sw('hotkeys', u.prefs.hotkeys, 'Keyboard shortcuts'))}
        ${setRow('Reduce motion', 'Tone down page transitions and decorative animation.', sw('calm', u.prefs.calm, 'Reduce motion'))}
        ${setRow('Live bet feed', "Show other players' bets in the lobby feed.", sw('feed', u.prefs.feed, 'Live bet feed'))}
      </section>
      <section class="card-sec">
        <h3>Privacy</h3>
        ${setRow('Streamer mode', 'Hide your balance in the top bar.', sw('hideBal', u.prefs.hideBal, 'Streamer mode'))}
        ${setRow('Ghost mode', 'Show your bets as “Hidden” in the live feed.', sw('ghost', u.prefs.ghost, 'Ghost mode'))}
      </section>`;
    body.onclick = (e) => {
      const b = e.target.closest('[data-sw]');
      if (!b) return;
      const k = b.dataset.sw, v = !b.classList.contains('on');
      b.classList.toggle('on', v);
      b.setAttribute('aria-checked', v);
      if (k === 'music') BB.audio.setMusic(v);
      else if (k === 'sfx') BB.audio.setSfx(v);
      else {
        u.prefs[k] = v;
        BB.saveUsers();
        if (k === 'calm') document.body.classList.toggle('calm', v);
        if (k === 'hideBal') BB.paintBalance();
        BB.sfx('click');
      }
    };
  }

  /* ---------- Transactions ---------- */
  const TX_FILTERS = [['all', 'All'], ['deposit', 'Deposits'], ['withdrawal', 'Withdrawals'], ['reward', 'Rewards']];
  const txMatch = (t) => view.txFilter === 'all' || t.type === view.txFilter || (view.txFilter === 'reward' && t.type !== 'deposit' && t.type !== 'withdrawal');

  function exportCSV() {
    const W = BB.wallet, q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const rows = [['id', 'type', 'date', 'currency', 'network', 'crypto_amount', 'coins', 'status', 'address', 'txid', 'note']];
    BB.user().tx.forEach((t) => rows.push([t.id, t.type, new Date(t.t).toISOString(), t.coin || '', t.coin ? W.netName(t.coin, t.net) : '', t.coin ? t.amt : '', t.usd, t.status, t.addr || '', t.hash || '', t.note || '']));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = 'bananabet-transactions.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function transactions(body) {
    const PER = 10;
    body.innerHTML = `
      <section class="card-sec">
        <div class="sec-row wrap"><h3>Transactions</h3>
          <div class="seg mini" id="tx-filter">${TX_FILTERS.map((f) => `<button type="button" data-v="${f[0]}" class="${f[0] === view.txFilter ? 'on' : ''}">${f[1]}</button>`).join('')}</div>
          <button type="button" class="btn ghost sm" id="tx-csv">${ic('down', 15)}CSV</button></div>
        <div class="tx-table" id="tx-table"></div>
        <div class="pager" id="tx-pager"></div>
      </section>
      <p class="fair-note">Deposits and withdrawals here are simulated — no blockchain is involved and the transaction IDs are random. <a href="#" class="link" data-open="wallet">Open the wallet</a> to try one.</p>`;
    const paint = () => {
      const all = BB.user().tx.filter(txMatch);
      view.txPage = Math.min(view.txPage, Math.max(0, Math.ceil(all.length / PER) - 1));
      const rows = all.slice(view.txPage * PER, view.txPage * PER + PER);
      $('#tx-table').innerHTML = rows.length
        ? '<div class="tx-row full th"><span>Type</span><span>Date</span><span class="ar">Amount</span><span>Status</span><span>Transaction ID</span></div>' + rows.map((t) => BB.wallet.rowHTML(t, true)).join('')
        : '<div class="empty">No transactions here yet.</div>';
      pager($('#tx-pager'), view.txPage, all.length, PER, (p) => { view.txPage = p; paint(); });
    };
    BB.ui.bindSeg($('#tx-filter'), (v) => { view.txFilter = v; view.txPage = 0; paint(); });
    $('#tx-csv').addEventListener('click', exportCSV);
    $('#tx-table').addEventListener('click', (e) => { const b = e.target.closest('[data-cancel]'); if (b) BB.wallet.cancel(b.dataset.cancel); });
    on('bb:tx', paint);
    paint();
  }

  /* ---------- Bet history ---------- */
  function betsTab(body) {
    const PER = 15;
    body.innerHTML = `
      <section class="card-sec">
        <div class="sec-row wrap"><h3>Bet history</h3>
          <select id="bh-game" class="input sm" aria-label="Filter by game"><option value="">All games</option>${BB.order.map((id) => `<option value="${id}"${id === view.betGame ? ' selected' : ''}>${BB.games[id].name}</option>`).join('')}</select></div>
        <div id="bh-table"></div>
        <div class="pager" id="bh-pager"></div>
      </section>
      <p class="fair-note">Your last 200 bets are kept in this browser. Verify re-runs a bet against its seed pair, once that pair's server seed has been revealed.</p>`;
    let rows = [];
    const paint = () => {
      const all = BB.history().filter((b) => !view.betGame || b.id === view.betGame);
      view.betPage = Math.min(view.betPage, Math.max(0, Math.ceil(all.length / PER) - 1));
      rows = all.slice(view.betPage * PER, view.betPage * PER + PER);
      $('#bh-table').innerHTML = rows.length
        ? '<div class="bh-row th"><span>Game</span><span>Time</span><span class="ar">Bet</span><span class="ar">Multiplier</span><span class="ar">Profit</span><span class="ar">Nonce</span></div>' + rows.map((b, i) => {
          const net = round2(b.payout - b.wager), g = BB.games[b.id];
          return `<div class="bh-row"><span class="bh-g"><i class="gi">${g ? g.icon : ''}</i><b>${esc(b.game)}</b></span><span class="faint">${BB.stamp(b.t)}</span>
            <span class="ar"><i class="coin sm"></i>${fmt(b.wager)}</span><span class="ar faint">${fmtMult(b.mult)}</span>
            <span class="ar ${net > 0 ? 'pos' : net < 0 ? 'faint' : ''}">${net > 0 ? '+' : ''}${fmt(net)}</span>
            <span class="ar">${b.nonce && g && g.verify ? `<button type="button" class="btn ghost sm" data-i="${i}">#${b.nonce} · Verify</button>` : '<span class="faint">—</span>'}</span></div>`;
        }).join('')
        : `<div class="empty">${view.betGame ? 'No bets on that game yet.' : 'No bets yet — go and play a round.'}</div>`;
      pager($('#bh-pager'), view.betPage, all.length, PER, (p) => { view.betPage = p; paint(); });
    };
    $('#bh-game').addEventListener('change', (e) => { view.betGame = e.target.value; view.betPage = 0; paint(); });
    $('#bh-table').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b && rows[b.dataset.i]) BB.fair.verifyBet(rows[b.dataset.i]); });
    paint();
  }

  /* ---------- Statistics ---------- */
  function drawProfit(cv, pts) {
    const box = cv.parentElement, W = box.clientWidth, H = 200, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!W) return;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    const lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), span = hi - lo || 1, pl = 8, pr = 8, pt = 14, pb = 14;
    const X = (i) => pl + (pts.length > 1 ? i / (pts.length - 1) : 0.5) * (W - pl - pr), Y = (v) => H - pb - ((v - lo) / span) * (H - pt - pb);
    c.strokeStyle = 'rgba(255,255,255,.14)'; c.setLineDash([4, 5]); c.lineWidth = 1;
    c.beginPath(); c.moveTo(pl, Y(0)); c.lineTo(W - pr, Y(0)); c.stroke(); c.setLineDash([]);
    const last = pts[pts.length - 1], col = last >= 0 ? '#2fe08a' : '#ff4d67';
    c.beginPath();
    pts.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
    c.strokeStyle = col; c.lineWidth = 2.5; c.lineJoin = 'round'; c.stroke();
    c.lineTo(X(pts.length - 1), Y(0)); c.lineTo(X(0), Y(0)); c.closePath();
    const g = c.createLinearGradient(0, pt, 0, H - pb);
    g.addColorStop(0, last >= 0 ? 'rgba(47,224,138,.22)' : 'rgba(255,77,103,.04)');
    g.addColorStop(1, last >= 0 ? 'rgba(47,224,138,.02)' : 'rgba(255,77,103,.22)');
    c.fillStyle = g; c.fill();
    c.fillStyle = col; c.beginPath(); c.arc(X(pts.length - 1), Y(last), 4, 0, 7); c.fill();
  }

  function stats(body) {
    const u = BB.user(), s = u.stats, profit = round2(s.paid - s.wagered);
    const decided = s.wins + s.losses;
    const gname = (id) => (BB.games[id] ? BB.games[id].name : id);
    const hist = BB.history().slice().reverse();
    const pts = [0];
    hist.forEach((b) => pts.push(round2(pts[pts.length - 1] + b.payout - b.wager)));
    const rows = Object.keys(s.games).sort((a, b) => s.games[b].wagered - s.games[a].wagered).map((id) => {
      const g = s.games[id], p = round2(g.paid - g.wagered);
      return `<div class="gs-row"><span class="bh-g"><i class="gi">${BB.games[id] ? BB.games[id].icon : ''}</i><b>${esc(gname(id))}</b></span><span class="ar">${g.bets.toLocaleString('en-US')}</span><span class="ar">${fmt(g.wagered)}</span>
        <span class="ar ${p > 0 ? 'pos' : p < 0 ? 'minus' : ''}">${p > 0 ? '+' : ''}${fmt(p)}</span><span class="ar faint">${g.wagered ? ((g.paid / g.wagered) * 100).toFixed(1) + '%' : '—'}</span></div>`;
    }).join('');
    body.innerHTML = `
      <section class="card-sec">
        <h3>Lifetime</h3>
        <div class="stat-cards six">
          <div class="stat"><small>Wagered</small><b><i class="coin"></i>${fmt(s.wagered)}</b></div>
          <div class="stat"><small>Bets</small><b>${s.bets.toLocaleString('en-US')}</b></div>
          <div class="stat"><small>Net profit</small><b class="${profit > 0 ? 'pos' : profit < 0 ? 'minus' : ''}">${profit > 0 ? '+' : ''}${fmt(profit)}</b></div>
          <div class="stat"><small>Win rate</small><b>${decided ? ((s.wins / decided) * 100).toFixed(1) + '%' : '—'}</b><em>${s.wins.toLocaleString('en-US')} W · ${s.losses.toLocaleString('en-US')} L${s.pushes ? ' · ' + s.pushes + ' P' : ''}</em></div>
          <div class="stat"><small>Biggest win</small><b>${s.big ? '+' + fmt(s.big.net) : '—'}</b><em>${s.big ? esc(gname(s.big.id)) + ' · ' + fmtMult(s.big.mult) : 'No wins yet'}</em></div>
          <div class="stat"><small>Top multiplier</small><b>${s.top ? fmtMult(s.top.mult) : '—'}</b><em>${s.top ? esc(gname(s.top.id)) : 'No wins yet'}</em></div>
        </div>
      </section>
      <section class="card-sec">
        <div class="sec-row"><h3>Profit over your last ${hist.length} bet${hist.length === 1 ? '' : 's'}</h3></div>
        ${hist.length ? '<div class="chart-box"><canvas id="st-cv"></canvas></div>' : '<div class="empty">Play a few rounds and your profit curve shows up here.</div>'}
      </section>
      <section class="card-sec">
        <h3>By game</h3>
        ${rows ? '<div class="gs-row th"><span>Game</span><span class="ar">Bets</span><span class="ar">Wagered</span><span class="ar">Profit</span><span class="ar">Returned</span></div>' + rows : '<div class="empty">Nothing played yet.</div>'}
      </section>`;
    const cv = $('#st-cv');
    if (cv) {
      const draw = () => drawProfit(cv, pts);
      draw();
      window.addEventListener('resize', draw);
      offs.push(() => window.removeEventListener('resize', draw));
    }
  }

  /* ---------- Limits ---------- */
  function left(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return (d ? d + 'd ' : '') + p(hh) + ':' + p(mm) + ':' + p(ss);
  }

  function limits(body) {
    const u = BB.user(), L = u.limits, onBreak = L.breakUntil > Date.now();
    const today = u.day && u.day.d === BB.dayKey() ? u.day.w : 0;
    body.innerHTML = `
      <section class="card-sec">
        <h3>Daily wager limit</h3>
        <p class="sec-p">Cap how many coins you can bet per day. Bets that would pass the cap are refused. Leave it empty for no limit.</p>
        <div class="form-inline">
          <div class="amount"><i class="coin"></i><input type="text" inputmode="decimal" id="lm-daily" maxlength="12" placeholder="No limit" value="${L.daily ? L.daily.toFixed(2) : ''}" aria-label="Daily wager limit"></div>
          <button type="button" class="btn primary" id="lm-save">Save limit</button>
        </div>
        <div class="meter"><div><span>Wagered today</span><b>${fmt(today)}${L.daily ? ' / ' + fmt(L.daily) : ''}</b></div>${L.daily ? `<span class="bar"><i style="width:${Math.min(100, (today / L.daily) * 100)}%"></i></span>` : ''}</div>
      </section>
      <section class="card-sec">
        <h3>Reality check</h3>
        <p class="sec-p">A reminder of how long you have been playing, at the interval you choose.</p>
        ${BB.ui.seg('lm-remind', [[0, 'Off'], [15, '15 min'], [30, '30 min'], [60, '60 min']], L.remind)}
      </section>
      <section class="card-sec">
        <h3>Take a break</h3>
        ${onBreak
          ? `<p class="sec-p">Betting is paused. You can still look around, deposit and withdraw.</p>
             <div class="break-on"><div><small>Break ends in</small><b id="lm-left">${left(L.breakUntil - Date.now())}</b></div><button type="button" class="btn ghost sm" id="lm-end">End break early</button></div>
             <p class="hint left">On a real site a break can't be ended early. This is a demo, so it can.</p>`
          : `<p class="sec-p">Pause betting for a while. During a break every game refuses new bets.</p>
             <div class="break-btns"><button type="button" class="btn ghost" data-b="1">1 hour</button><button type="button" class="btn ghost" data-b="24">24 hours</button><button type="button" class="btn ghost" data-b="168">7 days</button></div>`}
      </section>`;
    const input = $('#lm-daily');
    input.addEventListener('input', () => { const c = input.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'); if (c !== input.value) input.value = c; });
    $('#lm-save').addEventListener('click', () => {
      const v = parseFloat(input.value);
      L.daily = isFinite(v) && v > 0 ? round2(v) : 0;
      BB.saveUsers();
      limits(body);
      BB.toast(L.daily ? `Daily wager limit set to ${fmt(L.daily)}.` : 'Daily wager limit removed.', 'ok');
    });
    BB.ui.bindSeg($('#lm-remind'), (v) => { L.remind = Number(v); BB.saveUsers(); BB.toast(L.remind ? `Reality check every ${L.remind} minutes.` : 'Reality check off.', 'ok'); });
    $$('.break-btns button', body).forEach((b) => b.addEventListener('click', () => {
      const hrs = Number(b.dataset.b);
      BB.confirm({ title: `Take a ${b.textContent.trim()} break?`, body: 'You will not be able to place bets until it ends.', ok: 'Start break' }).then((ok) => {
        if (!ok) return;
        L.breakUntil = Date.now() + hrs * 3600000;
        BB.saveUsers();
        BB.notify('Break started', 'Betting is paused until ' + BB.stamp(L.breakUntil) + '.', 'lock');
        cleanup(); limits(body);
      });
    }));
    const end = $('#lm-end');
    if (end) {
      end.addEventListener('click', () => { L.breakUntil = 0; BB.saveUsers(); cleanup(); limits(body); BB.toast('Break ended.', 'ok'); });
      every(1000, () => {
        const el = $('#lm-left');
        if (!el) return;
        if (L.breakUntil <= Date.now()) { cleanup(); limits(body); return; }
        el.textContent = left(L.breakUntil - Date.now());
      });
    }
  }

  /* ---------- account shell ---------- */
  const RENDER = { profile, security, preferences, transactions, bets: betsTab, stats, limits };

  function paintHead() {
    const el = $('#acct-head'), u = BB.user();
    if (!el || !u) return;
    const v = BB.vipInfo(u);
    el.innerHTML = `${BB.avatarHTML(u, 'xl')}
      <div class="acct-who"><h1>${esc(u.name)}</h1>
        <p><span class="lv" style="color:${v.cur.color}">${ic('crown', 15)}${v.cur.name}</span><span>Member since ${monthYear(u.joined)}</span><span>${esc(u.email)}</span></p></div>
      <div class="acct-actions"><button type="button" class="btn primary" data-open="wallet">${ic('down', 17)}Deposit</button><button type="button" class="btn ghost" data-open="withdraw">${ic('up', 17)}Withdraw</button></div>`;
  }

  function paintTab() {
    cleanup();
    $('#acct-nav').innerHTML = TABS.map(([id, label, icon]) => `<a href="#/account/${id}" class="${id === tab ? 'on' : ''}">${ic(icon, 18)}<span>${label}</span></a>`).join('');
    const body = $('#acct-body');
    body.onclick = null;
    body.classList.remove('in'); void body.offsetWidth; body.classList.add('in');
    RENDER[tab](body);
    const on = $('#acct-nav a.on');
    if (on && on.scrollIntoView && window.innerWidth < 960) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  BB.registerPage('account', {
    mount(root, sub) {
      if (!BB.isAuthed()) { BB.authGate(root, 'Your account', 'Log in to see your transactions, bet history, statistics and settings.'); return; }
      tab = RENDER[sub] ? sub : 'profile';
      root.appendChild(h(`<div class="page acct">
        <div class="acct-head" id="acct-head"></div>
        <div class="acct-grid"><nav class="acct-nav" id="acct-nav" aria-label="Account sections"></nav><div class="acct-body" id="acct-body"></div></div>
      </div>`));
      paintHead();
      paintTab();
    },
    update(sub) {
      if (!$('#acct-body')) { const root = $('#view'); root.innerHTML = ''; this.mount(root, sub); return; }
      tab = RENDER[sub] ? sub : 'profile';
      paintHead();
      paintTab();
    },
    unmount() { cleanup(); },
  });

  /* ---------- VIP & rewards ---------- */
  function paintVip(root) {
    cleanup();
    const u = BB.user(), v = BB.vipInfo(u), L = v.cur;
    const rake = Math.floor(u.vip.rake * 100) / 100;
    const ready = () => Date.now() - u.vip.daily >= DAY;
    root.innerHTML = '';
    root.appendChild(h(`<div class="page vip">
      <section class="vip-hero" style="--lv:${L.color}">
        <div class="vip-badge">${ic('crown', 54)}</div>
        <div class="vip-main">
          <span class="kicker">Your level</span>
          <h1>${L.name}</h1>
          <div class="bar big"><i style="width:${v.pct}%"></i></div>
          <p><b>${fmt(v.wagered)}</b> wagered${v.next ? ` · <b>${fmt(v.left)}</b> to ${v.next.name}` : ' · top level reached'}</p>
        </div>
      </section>
      <div class="vip-cards">
        <div class="vip-card">
          <small>Rakeback</small><b><i class="coin"></i>${fmt(rake)}</b>
          <span>${L.rake}% of every bet comes back to you, win or lose.</span>
          <button type="button" class="btn primary" id="vip-rake"${rake >= 0.01 ? '' : ' disabled'}>Claim rakeback</button>
        </div>
        <div class="vip-card">
          <small>Daily bonus</small><b><i class="coin"></i>${fmt(L.daily)}</b>
          <span id="vip-daily-note"></span>
          <button type="button" class="btn primary" id="vip-daily">Claim bonus</button>
        </div>
        <div class="vip-card">
          <small>Rewards so far</small><b><i class="coin"></i>${fmt(u.vip.claimed)}</b>
          <span>Rakeback, daily bonuses and level-up bonuses you have collected.</span>
          <a class="btn ghost" href="#/account/transactions">Reward history</a>
        </div>
      </div>
      <div class="sec-head"><h2>Levels</h2><span class="pill">Based on total coins wagered</span></div>
      <div class="tiers">${BB.levels.map((t, i) => `
        <div class="tier${i === v.i ? ' cur' : i < v.i ? ' done' : ''}" style="--lv:${t.color}">
          <div class="tier-h"><i>${ic('crown', 20)}</i><b>${t.name}</b>${i === v.i ? '<em>You are here</em>' : i < v.i ? `<em class="ok">${ic('check', 13)}Reached</em>` : ''}</div>
          <small>${t.at ? fmt(t.at) + ' wagered' : 'Everyone starts here'}</small>
          <ul><li><span>Rakeback</span><b>${t.rake}%</b></li><li><span>Daily bonus</span><b>${fmt(t.daily)}</b></li><li><span>Level-up bonus</span><b>${t.bonus ? fmt(t.bonus) : '—'}</b></li></ul>
        </div>`).join('')}</div>
      <p class="fair-note">Rewards are play coins like everything else here. They have no cash value and can't be exchanged for anything.</p>
    </div>`));

    const tickDaily = () => {
      const note = $('#vip-daily-note'), btn = $('#vip-daily');
      if (!note) return;
      const ok = ready();
      btn.disabled = !ok;
      note.textContent = ok ? 'Ready to claim. Resets 24 hours after each claim.' : 'Next bonus in ' + left(u.vip.daily + DAY - Date.now());
    };
    tickDaily();
    every(1000, tickDaily);
    $('#vip-rake').addEventListener('click', () => {
      const amt = Math.floor(u.vip.rake * 100) / 100;
      if (amt < 0.01) return;
      u.vip.rake = Math.round((u.vip.rake - amt) * 10000) / 10000;
      u.vip.claimed = round2(u.vip.claimed + amt);
      BB.addTx({ type: 'rakeback', note: 'Rakeback claim', usd: amt, status: 'completed' });
      BB.credit(amt, false, 'rakeback');
      BB.sfx('cashout');
      BB.toast(`Rakeback claimed: +${fmt(amt)} coins.`, 'ok');
      paintVip(root);
    });
    $('#vip-daily').addEventListener('click', () => {
      if (!ready()) return;
      u.vip.daily = Date.now();
      u.vip.claimed = round2(u.vip.claimed + L.daily);
      BB.addTx({ type: 'bonus', note: 'Daily bonus', usd: L.daily, status: 'completed' });
      BB.credit(L.daily, false, 'daily', L.name);
      BB.sfx('win');
      BB.confetti($('.vip-cards'), 50);
      BB.toast(`Daily bonus claimed: +${fmt(L.daily)} coins.`, 'ok');
      const keep = $('.confetti');
      paintVip(root);
      if (keep) $('.vip-cards').appendChild(keep);
    });
  }

  BB.registerPage('vip', {
    mount(root) {
      if (!BB.isAuthed()) { BB.authGate(root, 'VIP & rewards', 'Log in to track your level, claim rakeback and collect a daily bonus.'); return; }
      paintVip(root);
    },
    unmount() { cleanup(); },
  });
})();
