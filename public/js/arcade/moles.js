/* Whack-a-Mole — pick up to five of the nine holes, then three moles pop up.
   Every mole you were waiting on gets whacked; more hits, bigger payout.
   Payouts come from the hit odds (hypergeometric, 3 moles in 9 holes) scaled to a 97% return. */
(function () {
  'use strict';
  const { $, $$, h, fmt, fmtMult, sleep, round2 } = BB;

  const HOLES = 9, MOLES = 3, MAX_PICK = 5;
  const WEIGHT = [0, 1, 4, 25]; // relative size of the prize for 0, 1, 2, 3 hits

  const choose = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1); return r; };
  const chance = (k, hits) => (choose(MOLES, hits) * choose(HOLES - MOLES, k - hits)) / choose(HOLES, k);
  /** Pay table for k picks: multiplier for 0..3 hits. */
  const TABLE = {};
  for (let k = 1; k <= MAX_PICK; k++) {
    let ev = 0;
    for (let x = 0; x <= MOLES; x++) ev += chance(k, x) * WEIGHT[x];
    TABLE[k] = WEIGHT.map((w) => Math.floor(((w * 0.97) / ev) * 100) / 100);
  }

  let amount, picks = [], busy = false, alive = 0, pending = null;
  const history = [];

  function molesFrom(rng) {
    const pool = Array.from({ length: HOLES }, (_, i) => i), out = [];
    for (let i = 0; i < MOLES; i++) out.push(rng.pick(pool));
    return out;
  }

  const MOLE = `<svg viewBox="0 0 100 100"><ellipse cx="50" cy="66" rx="34" ry="40" fill="#8a5a3c"/><ellipse cx="50" cy="74" rx="22" ry="26" fill="#c99a72"/>
    <circle cx="37" cy="48" r="6" fill="#1a0f0a"/><circle cx="63" cy="48" r="6" fill="#1a0f0a"/><circle cx="39" cy="46" r="2" fill="#fff"/><circle cx="65" cy="46" r="2" fill="#fff"/>
    <ellipse cx="50" cy="60" rx="9" ry="6.500" fill="#ff8fb1"/><path d="M44 70h12v8a6 6 0 0 1-12 0z" fill="#fff"/><path d="M50 70v12" stroke="#ddd" stroke-width="1.500"/>
    <g stroke="#3b2618" stroke-width="2" stroke-linecap="round"><path d="M24 58l-12-3M24 63l-12 2M76 58l12-3M76 63l12 2"/></g></svg>`;
  const HAMMER = `<svg viewBox="0 0 100 100"><rect x="44" y="36" width="12" height="60" rx="5" fill="#b07a3a"/><rect x="14" y="8" width="72" height="34" rx="12" fill="#9b4dff"/><rect x="14" y="8" width="16" height="34" rx="8" fill="#f5c542"/><rect x="70" y="8" width="16" height="34" rx="8" fill="#f5c542"/></svg>`;

  function paintBoard() {
    $$('.wm-hole').forEach((el) => {
      const i = Number(el.dataset.i);
      el.classList.toggle('picked', picks.indexOf(i) >= 0);
    });
    const k = picks.length;
    $('#wm-count').textContent = `${k} of ${MAX_PICK} picked`;
    $('#wm-go').disabled = busy || !k;
    $('#wm-table').innerHTML = k
      ? `<div class="wm-th"><span>Hits</span>${TABLE[k].map((_, x) => (x <= k ? `<b>${x}</b>` : '')).join('')}</div>
         <div class="wm-tr"><span>Pays</span>${TABLE[k].map((m, x) => (x <= k ? `<em class="${m ? '' : 'zero'}" data-x="${x}">${fmtMult(m)}</em>` : '')).join('')}</div>
         <div class="wm-tr odds"><span>Chance</span>${TABLE[k].map((_, x) => (x <= k ? `<small>${(chance(k, x) * 100).toFixed(1)}%</small>` : '')).join('')}</div>`
      : '<p class="wm-empty">Pick the holes you think the moles will pop out of.</p>';
    $('#wm-max').textContent = k ? fmt(amount.get() * TABLE[k][Math.min(k, MOLES)]) : '0.00';
  }
  function paintHistory() {
    $('#wm-hist').innerHTML = history.slice(0, 12).map((r) => `<span class="hp ${r.m >= 1 ? 'good' : r.m > 0 ? '' : 'bad'}">${r.hits}/${r.k} · ${fmtMult(r.m)}</span>`).join('') || '<span class="hp">No rounds yet</span>';
  }
  function toggle(i) {
    if (busy) return;
    const at = picks.indexOf(i);
    if (at >= 0) picks.splice(at, 1);
    else if (picks.length < MAX_PICK) picks.push(i);
    else { BB.toast(`You can pick up to ${MAX_PICK} holes.`, ''); return; }
    BB.sfx('click');
    clearRound();
    paintBoard();
  }
  function clearRound() {
    $$('.wm-hole').forEach((el) => el.classList.remove('up', 'hit', 'miss', 'whack'));
    $('#wm-res').className = 'result-pop';
  }

  function settle(quiet) {
    if (!pending) return;
    const p = pending;
    pending = null;
    if (p.payout) BB.win(p.payout, quiet || p.mult < 1);
    BB.logBet('moles', p.bet, p.mult, p.payout, null, p.nonce);
  }

  async function play() {
    if (busy || !picks.length) return;
    const bet = amount.get();
    if (!BB.placeBet(bet)) return;
    const my = alive, rng = BB.fair.roll(), moles = molesFrom(rng), k = picks.length;
    const hits = moles.filter((m) => picks.indexOf(m) >= 0).length, mult = TABLE[k][hits];
    pending = { bet, mult, payout: round2(bet * mult), nonce: rng.nonce };
    busy = true;
    amount.lock(true);
    paintBoard();
    clearRound();
    const calm = BB.user() && BB.user().prefs.calm;
    for (const m of moles) {
      const el = $(`.wm-hole[data-i="${m}"]`);
      el.classList.add('up');
      BB.sfx('gem', 2);
      await sleep(calm ? 60 : 230);
      if (my !== alive) return;
    }
    await sleep(calm ? 60 : 200);
    if (my !== alive) return;
    picks.forEach((i) => {
      const el = $(`.wm-hole[data-i="${i}"]`);
      el.classList.add('whack', moles.indexOf(i) >= 0 ? 'hit' : 'miss');
    });
    BB.sfx(hits ? 'impact' : 'tick');
    await sleep(calm ? 60 : 260);
    if (my !== alive) return;
    settle(false);
    BB.sfx(mult >= 1 ? 'win' : 'lose');
    const pop = $('#wm-res');
    pop.className = 'result-pop show' + (mult >= 1 ? '' : mult > 0 ? ' push' : ' bad');
    pop.innerHTML = `<b>${hits} hit${hits === 1 ? '' : 's'}</b><span>${fmtMult(mult)}${mult ? ` · <i class="coin sm"></i>${fmt(bet * mult)}` : ''}</span>`;
    const cell = $(`#wm-table em[data-x="${hits}"]`);
    if (cell) cell.classList.add('hit');
    if (mult >= 10) BB.confetti($('.wm-wrap'), 60);
    history.unshift({ hits, k, m: mult });
    paintHistory();
    busy = false;
    amount.lock(false);
    paintBoard();
  }

  BB.registerGame({
    id: 'moles',
    name: 'Whack-a-Mole',
    cat: 'arcade',
    rtp: '97.0',
    badge: 'NEW',
    colors: ['#22c55e', '#0b2a16'],
    icon: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="20" rx="9" ry="2.500" fill="currentColor" opacity=".5"/><path d="M5.500 19.500v-6a6.500 6.500 0 0 1 13 0v6z" fill="currentColor"/><circle cx="9.500" cy="12" r="1.200" fill="#101218"/><circle cx="14.500" cy="12" r="1.200" fill="#101218"/></svg>',
    art: `<svg viewBox="0 0 200 200">
      <ellipse cx="100" cy="150" rx="76" ry="22" fill="#1a0b2e"/><ellipse cx="100" cy="146" rx="70" ry="17" fill="#000" opacity=".55"/>
      <g transform="translate(46 54) scale(1.08)">${MOLE}</g>
      <ellipse cx="100" cy="156" rx="78" ry="16" fill="none" stroke="#3a1e5c" stroke-width="10"/>
      <g transform="translate(108 6) rotate(28 50 50) scale(.86)">${HAMMER}</g>
    </svg>`,
    verify(rng) { return [['Moles pop from holes', molesFrom(rng).map((m) => m + 1).sort((a, b) => a - b).join(', ')]]; },

    mount(panel, stage) {
      busy = false; pending = null;
      amount = BB.ui.amount();
      panel.appendChild(amount.el);
      panel.appendChild(h(`<div>
        <div class="row2">
          <button type="button" class="btn ghost block" id="wm-auto">Auto pick</button>
          <button type="button" class="btn ghost block" id="wm-clear">Clear</button>
        </div>
        <div class="field" style="margin-top:12px"><span class="field-l">Three hits pay</span><div class="readout"><i class="coin"></i><span id="wm-max">0.00</span></div></div>
        <button class="btn primary lg block" id="wm-go">Whack!</button>
        <p class="panel-note">Pick 1 to 5 holes on the board. Three moles pop up from the nine holes — every one that appears in a hole you picked gets whacked. The table under the board shows what each number of hits pays.</p>
      </div>`));
      stage.appendChild(h(`<div class="wm-wrap">
        <div class="history" id="wm-hist"></div>
        <div class="wm-count" id="wm-count"></div>
        <div class="wm-field">${Array.from({ length: HOLES }, (_, i) => `<button type="button" class="wm-hole" data-i="${i}" aria-label="Hole ${i + 1}">
          <span class="wm-dirt"></span><span class="wm-mole">${MOLE}</span><span class="wm-front"></span><span class="wm-ham">${HAMMER}</span><span class="wm-pow">POW!</span><span class="wm-flag">${i + 1}</span></button>`).join('')}</div>
        <div class="wm-table" id="wm-table"></div>
        <div class="result-pop" id="wm-res"></div>
      </div>`));
      $('.wm-field').addEventListener('click', (e) => { const b = e.target.closest('.wm-hole'); if (b) toggle(Number(b.dataset.i)); });
      $('#wm-go').addEventListener('click', play);
      $('#wm-clear').addEventListener('click', () => { if (busy) return; picks = []; clearRound(); paintBoard(); });
      $('#wm-auto').addEventListener('click', () => {
        if (busy) return;
        const k = picks.length || 3, pool = Array.from({ length: HOLES }, (_, i) => i);
        picks = [];
        for (let i = 0; i < k; i++) picks.push(pool.splice(BB.randInt(pool.length), 1)[0]);
        BB.sfx('click');
        clearRound();
        paintBoard();
      });
      amount.onChange(paintBoard);
      if (!picks.length) picks = [0, 4, 8];
      paintBoard();
      paintHistory();
    },

    unmount() {
      alive++;
      settle(true);
      busy = false;
    },
  });
})();
