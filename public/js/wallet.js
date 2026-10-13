/* Wallet — a MOCK crypto cashier.
   Nothing here touches a blockchain or a payment provider:
   - deposits are simulated with a button and "confirm" on a timer
   - withdrawals just move a number and are sent nowhere
   - rates are fixed demo numbers, not market prices
   - every address is deliberately invalid: each one contains a character its own encoding forbids
     ("o" in bech32, "O" in base58, "M"/"O" in hex), so no real wallet will accept it by mistake. */
(function () {
  'use strict';
  const { $, $$, h, fmt, esc, round2 } = BB;
  const H = window.BBHash;

  const COINS = [
    { id: 'BTC', name: 'Bitcoin', color: '#f7931a', rate: 67500, dp: 8, nets: [{ id: 'BTC', name: 'Bitcoin', conf: 2, fee: 0.00012 }] },
    { id: 'ETH', name: 'Ethereum', color: '#627eea', rate: 3250, dp: 6, nets: [{ id: 'ERC20', name: 'Ethereum (ERC-20)', conf: 6, fee: 0.0011 }] },
    { id: 'LTC', name: 'Litecoin', color: '#4a6fb5', rate: 84, dp: 6, nets: [{ id: 'LTC', name: 'Litecoin', conf: 4, fee: 0.001 }] },
    { id: 'USDT', name: 'Tether', color: '#26a17b', rate: 1, dp: 2, nets: [{ id: 'TRC20', name: 'Tron (TRC-20)', conf: 10, fee: 1.5 }, { id: 'ERC20', name: 'Ethereum (ERC-20)', conf: 6, fee: 4.5 }] },
    { id: 'SOL', name: 'Solana', color: '#9945ff', rate: 152, dp: 5, nets: [{ id: 'SOL', name: 'Solana', conf: 1, fee: 0.0005 }] },
    { id: 'DOGE', name: 'Dogecoin', color: '#c2a633', rate: 0.16, dp: 2, nets: [{ id: 'DOGE', name: 'Dogecoin', conf: 6, fee: 2 }] },
    { id: 'TRX', name: 'TRON', color: '#ef2d48', rate: 0.13, dp: 2, nets: [{ id: 'TRX', name: 'Tron', conf: 10, fee: 1.1 }] },
    { id: 'XRP', name: 'XRP', color: '#5b6478', rate: 0.58, dp: 2, tag: true, nets: [{ id: 'XRP', name: 'XRP Ledger', conf: 1, fee: 0.2 }] },
  ];
  const byId = {};
  COINS.forEach((c) => { byId[c.id] = c; });
  const netOf = (c, id) => c.nets.find((n) => n.id === id) || c.nets[0];

  const T = (ch) => `<text x="12" y="16.700" font-size="13.500" font-weight="800" text-anchor="middle" fill="#fff" font-family="Arial,Helvetica,sans-serif">${ch}</text>`;
  const GLYPH = {
    BTC: T('B') + '<path d="M10.300 5v2M13.100 5v2M10.300 17v2M13.100 17v2" stroke="#fff" stroke-width="1.500" stroke-linecap="round"/>',
    ETH: '<path d="M12 4.300l4.700 7.700L12 14.800 7.300 12z" fill="#fff"/><path d="M12 19.700l4.700-6.300L12 16.200l-4.700-2.800z" fill="#fff" opacity=".72"/>',
    LTC: T('Ł'),
    USDT: '<path d="M7.200 7.600h9.600M12 7.600v10" stroke="#fff" stroke-width="2.500" stroke-linecap="round"/><ellipse cx="12" cy="11.500" rx="5.800" ry="1.500" fill="none" stroke="#fff" stroke-width="1.200"/>',
    SOL: '<path d="M8 7.300h9.500L16 9.200H6.500zM6.500 11h9.500l1.500 1.900H8zM8 14.800h9.500L16 16.700H6.500z" fill="#fff"/>',
    DOGE: T('Ð'),
    TRX: '<path d="M5.800 6.800l10.700 2 2 2.300-6.900 8.300zM16.500 8.800l-4.700 3.900M5.800 6.800l6 5.900-.2 6.700" fill="none" stroke="#fff" stroke-width="1.400" stroke-linejoin="round"/>',
    XRP: '<path d="M6.500 6.800l3.300 3.100a3.200 3.200 0 0 0 4.400 0l3.300-3.100M6.500 17.200l3.300-3.100a3.200 3.200 0 0 1 4.400 0l3.300 3.100" fill="none" stroke="#fff" stroke-width="1.900" stroke-linecap="round"/>',
  };
  const icon = (id, size) => `<svg class="cico" viewBox="0 0 24 24" width="${size || 22}" height="${size || 22}" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="${byId[id] ? byId[id].color : '#555'}"/>${GLYPH[id] || ''}</svg>`;

  /* ---------- amounts ---------- */
  const toCoin = (usd, c) => usd / c.rate;
  function fmtCoin(v, c) {
    const p = Number(v).toFixed(c.dp).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '').split('.');
    p[0] = Number(p[0]).toLocaleString('en-US');
    p[1] = ((p[1] || '') + '00').slice(0, Math.max(2, (p[1] || '').length));
    return p.join('.');
  }

  /* ---------- demo addresses + ids ---------- */
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const BECH = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const HEX = '0123456789abcdef';
  /** Deterministic characters from a seed, so a user's deposit address stays the same. */
  function chars(seed, alphabet, n) {
    let out = '', block = 0, buf = [];
    while (out.length < n) {
      if (!buf.length) buf = Array.from(H.sha256(H.utf8(seed + '#' + block++)));
      out += alphabet[buf.shift() % alphabet.length];
    }
    return out;
  }
  const randomChars = (alphabet, n) => chars(BB.rand() + ':' + Date.now() + ':' + BB.rand(), alphabet, n);
  function demoAddress(net, seed) {
    const s = 'addr:' + seed + ':' + net;
    switch (net) {
      case 'BTC': return 'bc1qdemo' + chars(s, BECH, 34);
      case 'LTC': return 'ltc1qdemo' + chars(s, BECH, 34);
      case 'ERC20': return '0xDEMO' + chars(s, HEX, 36);
      case 'SOL': return 'DEMO' + chars(s, B58, 40);
      case 'DOGE': return 'DDEMO' + chars(s, B58, 29);
      case 'XRP': return 'rDEMO' + chars(s, B58, 29);
      default: return 'TDEMO' + chars(s, B58, 29); // TRC20 / TRX
    }
  }
  const address = (net) => demoAddress(net, BB.sessionKey() || 'guest');
  const memoTag = () => String(100000 + (parseInt(chars('tag:' + (BB.sessionKey() || 'guest'), '0123456789', 6), 10) % 900000));
  function fakeHash(net) {
    if (net === 'ERC20') return '0x' + randomChars(HEX, 64);
    if (net === 'SOL') return randomChars(B58, 88);
    if (net === 'XRP') return randomChars(HEX, 64).toUpperCase();
    return randomChars(HEX, 64);
  }
  const short = (s, a, b) => (s && s.length > (a || 8) + (b || 6) + 2 ? s.slice(0, a || 8) + '…' + s.slice(-(b || 6)) : s || '');

  /** Looks like a QR code, scans as nothing — there is no real address to encode. */
  function qrSVG(text) {
    const n = 25, q = 2;
    let bits = [], block = 0;
    const next = () => { if (!bits.length) bits = Array.from(H.sha256(H.utf8('qr:' + text + ':' + block++))); return bits.shift(); };
    const finder = (x, y, fx, fy) => {
      const dx = x - fx, dy = y - fy;
      if (dx < -1 || dx > 7 || dy < -1 || dy > 7) return null;
      if (dx < 0 || dx > 6 || dy < 0 || dy > 6) return false;
      return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
    };
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let on = finder(x, y, 0, 0);
      if (on === null) on = finder(x, y, n - 7, 0);
      if (on === null) on = finder(x, y, 0, n - 7);
      if (on === null) on = x >= 7 && x <= 17 && y >= 10 && y <= 14 ? false : next() % 2 === 0;
      if (on) d += `M${x + q} ${y + q}h1v1h-1z`;
    }
    const s = n + q * 2;
    return `<svg viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" aria-hidden="true"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#0b0c11"/></svg>`;
  }

  /* ---------- transactions ---------- */
  const DEP_MS = 9000;      // a simulated deposit takes about this long to "confirm"
  const WD_REVIEW = 4500;   // withdrawals can be cancelled during this window
  const WD_SEND = 5500;
  const MAX_BALANCE = 1e9;
  const isOpen = (t) => t.status === 'pending' || t.status === 'confirming' || t.status === 'processing';

  const TYPE = {
    deposit: { label: 'Deposit', ic: 'down', sign: 1 },
    withdrawal: { label: 'Withdrawal', ic: 'up', sign: -1 },
    faucet: { label: 'Faucet', ic: 'drop', sign: 1 },
    rakeback: { label: 'Rakeback', ic: 'gift', sign: 1 },
    bonus: { label: 'Bonus', ic: 'gift', sign: 1 },
  };

  function statusHTML(t) {
    if (t.status === 'completed') return '<span class="st ok">Completed</span>';
    if (t.status === 'cancelled') return '<span class="st off">Cancelled</span>';
    if (t.type === 'deposit') return `<span class="st wait"><i class="spin"></i>Confirming ${t.confs || 0}/${t.need}</span>`;
    if (t.status === 'processing') return '<span class="st wait"><i class="spin"></i>Broadcasting</span>';
    return '<span class="st hold">Pending review</span>';
  }

  function tick() {
    let u = BB.user();
    if (!u || !u.tx.some(isOpen)) return;
    BB.refresh(); // stay in step with other tabs, so a deposit is never credited twice
    u = BB.user();
    if (!u) return;
    const now = Date.now();
    let changed = false;
    u.tx.forEach((t) => {
      if (!isOpen(t)) return;
      const el = now - t.t;
      if (t.type === 'deposit') {
        const confs = Math.min(t.need, Math.floor(el / t.per));
        if (confs !== t.confs) { t.confs = confs; t.status = 'confirming'; changed = true; }
        if (confs >= t.need) {
          t.status = 'completed'; t.done = now; changed = true;
          BB.credit(t.usd);
          BB.notify('Deposit confirmed', `${fmtCoin(t.amt, byId[t.coin])} ${t.coin} arrived — ${fmt(t.usd)} coins added.`, 'dep');
          BB.toast(`Deposit confirmed: +${fmt(t.usd)} coins.`, 'ok');
          BB.sfx('cashout');
        }
      } else if (t.type === 'withdrawal') {
        if (t.status === 'pending' && el >= WD_REVIEW) { t.status = 'processing'; t.hash = fakeHash(t.net); changed = true; }
        if (t.status === 'processing' && el >= WD_REVIEW + WD_SEND) {
          t.status = 'completed'; t.done = now; changed = true;
          BB.notify('Withdrawal sent', `${fmtCoin(t.amt, byId[t.coin])} ${t.coin} to ${short(t.addr)} is complete.`, 'wd');
          BB.toast(`Withdrawal of ${fmtCoin(t.amt, byId[t.coin])} ${t.coin} completed.`, 'ok');
        }
      }
    });
    if (changed) { BB.saveUsers(); BB.emit('bb:tx'); }
  }
  setInterval(tick, 600);

  function deposit(coinId, netId, usd) {
    const c = byId[coinId], n = netOf(c, netId);
    return BB.addTx({ type: 'deposit', coin: c.id, net: n.id, amt: toCoin(usd, c), usd: round2(usd), addr: address(n.id), hash: fakeHash(n.id), status: 'pending', confs: 0, need: n.conf, per: Math.round(DEP_MS / n.conf) });
  }

  function withdraw(coinId, netId, usd, addr, tag) {
    const c = byId[coinId], n = netOf(c, netId);
    usd = round2(usd);
    if (!BB.debit(usd)) return null;
    return BB.addTx({ type: 'withdrawal', coin: c.id, net: n.id, amt: Math.max(0, toCoin(usd, c) - n.fee), fee: n.fee, usd, addr, tag: tag || '', status: 'pending' });
  }

  function cancel(id) {
    BB.refresh();
    const u = BB.user(), t = u && u.tx.find((x) => x.id === id);
    if (!t || t.type !== 'withdrawal' || t.status !== 'pending') { BB.toast('That withdrawal can no longer be cancelled.', 'err'); return false; }
    t.status = 'cancelled';
    t.done = Date.now();
    BB.credit(t.usd);
    BB.saveUsers();
    BB.emit('bb:tx');
    BB.toast(`Withdrawal cancelled — ${fmt(t.usd)} coins returned.`, 'ok');
    return true;
  }

  /** One line of the activity list (used in the cashier and on the transactions page). */
  function rowHTML(t, full) {
    const ty = TYPE[t.type] || TYPE.bonus, c = t.coin ? byId[t.coin] : null;
    const sub = c ? `${c.id} · ${netOf(c, t.net).name}` : esc(t.note || 'Play coins');
    const crypto = c ? `${fmtCoin(t.amt, c)} ${c.id}` : '';
    const idCell = t.hash && t.status !== 'pending'
      ? `<code title="${esc(t.hash)}">${esc(short(t.hash, 6, 4))}</code><button type="button" class="mini-btn" data-copy-text="${esc(t.hash)}" aria-label="Copy transaction ID">${BB.icon('copy', 14)}</button>`
      : t.type === 'withdrawal' && t.status === 'pending' ? `<button type="button" class="btn ghost sm" data-cancel="${t.id}">Cancel</button>` : '<span class="faint">—</span>';
    return `<div class="tx-row${full ? ' full' : ''}" data-tx="${t.id}">
      <span class="tx-type"><i class="tx-ic ${t.type}">${c ? icon(c.id, 30) : BB.icon(ty.ic, 16)}</i><span><b>${ty.label}</b><small>${sub}</small></span></span>
      ${full ? `<span class="tx-date">${BB.stamp(t.t)}</span>` : ''}
      <span class="tx-amt ${ty.sign > 0 ? (t.status === 'cancelled' ? '' : 'pos') : ''}"><b>${ty.sign > 0 ? '+' : '−'}${fmt(t.usd)}</b>${crypto ? `<small>${crypto}</small>` : ''}</span>
      <span class="tx-st">${statusHTML(t)}</span>
      ${full ? `<span class="tx-id">${idCell}</span>` : t.type === 'withdrawal' && t.status === 'pending' ? `<span class="tx-id">${idCell}</span>` : ''}
    </div>`;
  }

  /* ---------- cashier modal ---------- */
  const st = { tab: 'deposit', coin: 'BTC', net: 'BTC', dep: '1,000.00', wd: '' };
  const num = (s) => { const v = parseFloat(String(s).replace(/,/g, '')); return isFinite(v) && v > 0 ? round2(v) : 0; };
  const cleanNum = (el) => { const c = el.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'); if (c !== el.value) el.value = c; };

  function open(tab) {
    const u = BB.user();
    if (!u) { BB.openAuth('login'); return; }
    BB.hideModal($('#cashier'));
    st.tab = tab === 'withdraw' ? 'withdraw' : 'deposit';
    if (byId[u.prefs.coin]) st.coin = u.prefs.coin;
    st.net = netOf(byId[st.coin], st.net).id;

    const m = h(`
      <div class="modal-back" id="cashier">
        <div class="modal single cash" role="dialog" aria-modal="true" aria-label="Wallet">
          <button class="modal-x" aria-label="Close">&times;</button>
          <div class="modal-body">
            <h2 class="modal-title">${BB.icon('wallet', 22)}Wallet<span class="demo-tag">Demo · no real funds</span></h2>
            <div class="tabs">
              <button type="button" data-tab="deposit">Deposit</button>
              <button type="button" data-tab="withdraw">Withdraw</button>
            </div>
            <div class="cash-bal"><span>Balance</span><b><i class="coin"></i><span id="cash-amt"></span></b><small id="cash-eq"></small></div>
            <div class="field"><span class="field-l">Currency</span>
              <div class="coin-grid" id="cash-coins">${COINS.map((c) => `<button type="button" data-c="${c.id}">${icon(c.id, 22)}<b>${c.id}</b><small>${c.name}</small></button>`).join('')}</div></div>
            <div class="field" id="cash-netf"><span class="field-l">Network</span><div id="cash-nets"></div></div>
            <div id="cash-pane"></div>
            <div class="cash-recent">
              <div class="sec-row"><h3>Recent activity</h3><a class="link" href="#/account/transactions">View all</a></div>
              <div id="cash-list"></div>
            </div>
            <p class="fair-note">This cashier is a mock-up. No blockchain is watched, nothing is sent anywhere, rates are fixed demo numbers and the addresses are intentionally invalid. Out of coins? <a href="#" data-open="faucet" class="link">Use the faucet</a>.</p>
          </div>
        </div>
      </div>`);

    const coin = () => byId[st.coin];
    const net = () => netOf(coin(), st.net);

    function paintBal() {
      $('#cash-amt', m).textContent = fmt(BB.balance());
      $('#cash-eq', m).textContent = `≈ ${fmtCoin(toCoin(BB.balance(), coin()), coin())} ${coin().id}`;
      const av = $('#wd-avail', m);
      if (av) av.textContent = fmt(BB.balance());
    }

    function paintList() {
      const list = BB.user().tx.filter((t) => t.type === 'deposit' || t.type === 'withdrawal').slice(0, 4);
      $('#cash-list', m).innerHTML = list.length ? list.map((t) => rowHTML(t, false)).join('') : '<div class="empty">No deposits or withdrawals yet.</div>';
    }

    function depositPane() {
      const c = coin(), n = net(), addr = address(n.id);
      return `
        <div class="dep">
          <div class="dep-qr">${qrSVG(addr)}<span>DEMO</span></div>
          <div class="dep-info">
            <div class="field"><span class="field-l">Your ${c.id} deposit address<em class="demo-pill">not a real address</em></span>
              <div class="copy"><input type="text" readonly value="${addr}" aria-label="Deposit address"><button type="button" data-copy-text="${addr}">Copy</button></div></div>
            ${c.tag ? `<div class="field"><span class="field-l">Destination tag</span><div class="copy"><input type="text" readonly value="${memoTag()}"><button type="button" data-copy-text="${memoTag()}">Copy</button></div></div>` : ''}
            <div class="facts">
              <div><small>Network</small><b>${n.name}</b></div>
              <div><small>Confirmations</small><b>${n.conf}</b></div>
              <div><small>Coins per ${c.id}</small><b>${c.rate >= 1 ? Number(c.rate).toLocaleString('en-US') : c.rate}</b></div>
            </div>
          </div>
        </div>
        <div class="sim">
          <div class="sim-h">${BB.icon('bolt', 16)}<b>Simulate an incoming deposit</b></div>
          <p>Nothing is watching the address above, so this button stands in for your wallet sending funds.</p>
          <div class="amount"><i class="coin"></i><input type="text" inputmode="decimal" id="dep-amt" value="${esc(st.dep)}" maxlength="12" aria-label="Deposit amount in coins"><span class="amt-eq" id="dep-eq"></span></div>
          <div class="quick" id="dep-quick">${[100, 1000, 10000, 50000].map((v) => `<button type="button" data-v="${v}">${v.toLocaleString('en-US')}</button>`).join('')}</div>
          <small class="field-hint" id="dep-err"></small>
          <button type="button" class="btn primary lg block" id="dep-go">Send test deposit</button>
        </div>`;
    }

    function withdrawPane() {
      const c = coin(), n = net(), tfa = BB.user().sec.tfa;
      return `
        <div class="field"><span class="field-l">${c.id} address<button type="button" class="link" id="wd-demo">Use a demo address</button></span>
          <input type="text" id="wd-addr" placeholder="Paste a ${c.id} address" spellcheck="false" autocomplete="off" maxlength="100"></div>
        ${c.tag ? '<div class="field"><span class="field-l">Destination tag <em style="font-style:normal;color:var(--dim)">optional</em></span><input type="text" id="wd-tag" inputmode="numeric" maxlength="10" placeholder="e.g. 123456"></div>' : ''}
        <div class="field"><span class="field-l">Amount<em style="font-style:normal;color:var(--dim)">Available <span id="wd-avail">${fmt(BB.balance())}</span></em></span>
          <div class="amount"><i class="coin"></i><input type="text" inputmode="decimal" id="wd-amt" value="${esc(st.wd)}" placeholder="0.00" maxlength="12" aria-label="Withdrawal amount in coins"><button type="button" id="wd-max">Max</button></div></div>
        <div class="wd-sum">
          <div><span>Network fee</span><b>${fmtCoin(n.fee, c)} ${c.id}<small>≈ ${fmt(n.fee * c.rate)}</small></b></div>
          <div><span>You receive</span><b id="wd-get">—</b></div>
        </div>
        ${tfa ? '<div class="field"><span class="field-l">Two-factor code</span><input type="text" id="wd-2fa" inputmode="numeric" maxlength="6" placeholder="6 digits (any code works in the demo)" autocomplete="off"></div>' : ''}
        <small class="field-hint" id="wd-err"></small>
        <button type="button" class="btn primary lg block" id="wd-go">Withdraw</button>`;
    }

    function paint() {
      const c = coin();
      $$('.tabs button', m).forEach((b) => b.classList.toggle('on', b.dataset.tab === st.tab));
      $$('#cash-coins button', m).forEach((b) => b.classList.toggle('on', b.dataset.c === st.coin));
      $('#cash-netf', m).hidden = c.nets.length < 2;
      $('#cash-nets', m).innerHTML = BB.ui.seg('cash-net', c.nets.map((n) => [n.id, n.name]), st.net);
      BB.ui.bindSeg($('#cash-net', m), (v) => { st.net = v; paint(); });
      $('#cash-pane', m).innerHTML = st.tab === 'deposit' ? depositPane() : withdrawPane();
      paintBal();
      if (st.tab === 'deposit') bindDeposit(); else bindWithdraw();
    }

    function bindDeposit() {
      const input = $('#dep-amt', m), err = $('#dep-err', m);
      const eq = () => { const v = num(input.value); $('#dep-eq', m).textContent = v ? `≈ ${fmtCoin(toCoin(v, coin()), coin())} ${coin().id}` : ''; };
      input.addEventListener('input', () => { cleanNum(input); st.dep = input.value; err.textContent = ''; eq(); });
      input.addEventListener('blur', () => { const v = num(input.value); if (v) { input.value = fmt(v); st.dep = input.value; } });
      input.addEventListener('focus', () => { input.value = String(num(input.value) || ''); input.select(); });
      $('#dep-quick', m).addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        input.value = fmt(Number(b.dataset.v)); st.dep = input.value; err.textContent = ''; eq();
        BB.sfx('click');
      });
      $('#dep-go', m).addEventListener('click', () => {
        const v = num(input.value);
        if (v < 10) { err.textContent = 'The minimum test deposit is 10.00 coins.'; BB.nudge($('#dep-go', m)); return; }
        if (v > 1000000) { err.textContent = 'One test deposit can be at most 1,000,000.00 coins.'; BB.nudge($('#dep-go', m)); return; }
        if (BB.balance() + v > MAX_BALANCE) { err.textContent = 'The demo balance is capped at 1,000,000,000.00 coins.'; return; }
        const t = deposit(st.coin, st.net, v);
        BB.sfx('bet');
        BB.toast(`Deposit detected: ${fmtCoin(t.amt, coin())} ${coin().id}. Waiting for ${t.need} confirmation${t.need === 1 ? '' : 's'}.`, '');
      });
      eq();
    }

    function bindWithdraw() {
      const c = coin(), n = net();
      const addr = $('#wd-addr', m), amt = $('#wd-amt', m), err = $('#wd-err', m);
      const feeUsd = n.fee * c.rate;
      const sum = () => {
        const v = num(amt.value), get = toCoin(v, c) - n.fee;
        $('#wd-get', m).innerHTML = v && get > 0 ? `${fmtCoin(get, c)} ${c.id}` : '—';
      };
      const fail = (msg, el) => { err.textContent = msg; if (el) { el.classList.add('bad'); el.focus(); } BB.nudge($('#wd-go', m)); };
      const clear = () => { err.textContent = ''; $$('input', $('#cash-pane', m)).forEach((i) => i.classList.remove('bad')); };
      addr.addEventListener('input', clear);
      amt.addEventListener('input', () => { cleanNum(amt); st.wd = amt.value; clear(); sum(); });
      $('#wd-max', m).addEventListener('click', () => { amt.value = BB.balance().toFixed(2); st.wd = amt.value; clear(); sum(); BB.sfx('click'); });
      $('#wd-demo', m).addEventListener('click', () => { addr.value = demoAddress(n.id, 'external:' + BB.rand()); clear(); });
      $('#wd-go', m).addEventListener('click', () => {
        clear();
        const a = addr.value.trim(), v = num(amt.value);
        if (!/^[A-Za-z0-9]{20,100}$/.test(a)) return fail(`Enter a ${c.id} address (letters and numbers, no spaces).`, addr);
        if (!v) return fail('Enter an amount to withdraw.', amt);
        if (v < 20) return fail('The minimum withdrawal is 20.00 coins.', amt);
        if (v > BB.balance()) return fail('That is more than your balance.', amt);
        if (v <= feeUsd) return fail(`The amount has to cover the ${fmt(feeUsd)} network fee.`, amt);
        const code = $('#wd-2fa', m);
        if (code && !/^\d{6}$/.test(code.value.trim())) return fail('Enter your 6-digit two-factor code.', code);
        const tagEl = $('#wd-tag', m);
        const t = withdraw(st.coin, st.net, v, a, tagEl ? tagEl.value.trim() : '');
        if (!t) return fail('That is more than your balance.', amt);
        st.wd = '';
        BB.toast(`Withdrawal requested: ${fmtCoin(t.amt, c)} ${c.id}. You can cancel while it is pending review.`, '');
        paint();
      });
      sum();
    }

    m.addEventListener('click', (e) => {
      const tb = e.target.closest('.tabs button');
      if (tb) { st.tab = tb.dataset.tab; BB.sfx('click'); paint(); return; }
      const cb = e.target.closest('#cash-coins button');
      if (cb) {
        st.coin = cb.dataset.c; st.net = byId[st.coin].nets[0].id;
        BB.user().prefs.coin = st.coin; BB.saveUsers();
        BB.sfx('click'); paint(); return;
      }
      const cx = e.target.closest('[data-cancel]');
      if (cx) cancel(cx.dataset.cancel);
    });

    const onTx = () => { if (!m.isConnected) { off(); return; } paintList(); };
    const onBal = () => { if (!m.isConnected) { off(); return; } paintBal(); };
    function off() { document.removeEventListener('bb:tx', onTx); document.removeEventListener('bb:balance', onBal); }
    document.addEventListener('bb:tx', onTx);
    document.addEventListener('bb:balance', onBal);

    BB.showModal(m);
    paint();
    paintList();
  }

  const coinsRow = $('#coins-row');
  if (coinsRow) coinsRow.innerHTML = '<span>Demo cashier</span>' + COINS.map((c) => `<i title="${c.name}">${icon(c.id, 26)}</i>`).join('') + '<em>simulated — no real crypto is accepted</em>';

  BB.wallet = { open, coins: COINS, coin: (id) => byId[id], icon, address, fmtCoin, toCoin, statusHTML, rowHTML, cancel, isOpen, short, types: TYPE, netName: (coinId, netId) => (byId[coinId] ? netOf(byId[coinId], netId).name : '') };
})();
