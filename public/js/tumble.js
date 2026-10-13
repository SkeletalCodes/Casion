/* Star Forge — a 6×5 "pay anywhere" slot with tumbling reels (an original game for this demo).
   Eight or more of the same symbol anywhere on the grid pays. Winning symbols vanish, the rest fall,
   and new ones drop in, until nothing pays. Multiplier orbs that are on the grid when a winning spin
   ends multiply that spin's win. Four or more scatters start free spins, where orb values add up into
   one multiplier that keeps growing for the rest of the round.
   Everything is drawn from the bet's seeded number stream, so a whole round is decided on the press. */
(function () {
  'use strict';
  const { $, $$, h, fmt, fmtMult, sleep, round2, esc } = BB;

  const COLS = 6, ROWS = 5, SC = 9, ORB = 10; // symbol ids: 0-8 pay (0 is the best), 9 scatter, 10 orb
  const NAMES = ['Star diamond', 'Emerald', 'Ruby', 'Topaz', 'Nova', 'Moon', 'Planet', 'Bolt', 'Comet dust', 'Rocket', 'Multiplier orb'];
  /* Multiples of the total bet for 8-9 / 10-11 / 12 or more of a symbol. */
  const PAYS = [[9, 22, 45], [2.2, 9, 22], [1.8, 4.5, 13], [1.3, 1.8, 10.5], [0.9, 1.3, 9], [0.7, 1, 7], [0.45, 0.9, 4.5], [0.35, 0.8, 3.5], [0.22, 0.65, 1.8]];
  /* Chance (%) of each symbol in a cell; the free-spins table carries more orbs. */
  const W_BASE = [5.5, 7, 8, 9, 11, 12, 13, 14, 16.3, 2.4, 1.8];
  const W_FREE = [5.4, 6.8, 7.8, 8.8, 10.8, 11.8, 12.8, 13.6, 13.6, 2.6, 6];
  const ORB_VALUES = [[2, 40], [3, 22], [5, 15], [8, 9], [10, 6], [15, 3.5], [25, 2.5], [50, 1.5], [100, 0.5]];
  const CFG = { rtp: '96.5', buyRtp: '97.3', scatterPay: { 4: 3, 5: 5, 6: 100 }, freeSpins: 10, retrigger: 5, maxSpins: 30, buy: 34, maxWin: 5000 };

  function draw(rng, free) {
    const w = free ? W_FREE : W_BASE;
    let x = rng.float() * 100, s = 0;
    for (; s < w.length - 1; s++) { x -= w[s]; if (x < 0) break; }
    if (s !== ORB) return { s };
    let y = rng.float() * 100, v = ORB_VALUES[ORB_VALUES.length - 1][0];
    for (let i = 0; i < ORB_VALUES.length; i++) { y -= ORB_VALUES[i][1]; if (y < 0) { v = ORB_VALUES[i][0]; break; } }
    return { s, v };
  }

  /** One spin: fill the grid, then tumble until nothing pays. Each column is stored top to bottom. */
  function spin(rng, free) {
    let cols = [];
    for (let c = 0; c < COLS; c++) { const col = []; for (let r = 0; r < ROWS; r++) col.push(draw(rng, free)); cols.push(col); }
    const steps = [];
    let base = 0;
    for (;;) {
      const count = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      cols.forEach((col) => col.forEach((x) => { if (x.s < SC) count[x.s]++; }));
      const wins = [];
      count.forEach((n, s) => { if (n >= 8) wins.push({ s, n, pay: PAYS[s][n >= 12 ? 2 : n >= 10 ? 1 : 0] }); });
      if (!wins.length) break;
      steps.push({ grid: cols, wins });
      base += wins.reduce((a, w) => a + w.pay, 0);
      const hit = {};
      wins.forEach((w) => { hit[w.s] = 1; });
      cols = cols.map((col) => {
        const keep = col.filter((x) => !hit[x.s]), add = [];
        for (let k = keep.length; k < ROWS; k++) add.unshift(draw(rng, free)); // the first one drawn lands lowest
        return add.concat(keep);
      });
    }
    let sc = 0;
    const orbs = [];
    cols.forEach((col) => col.forEach((x) => { if (x.s === SC) sc++; else if (x.s === ORB) orbs.push(x.v); }));
    return { steps, final: cols, base, sc, orbs };
  }

  /** A whole round: one paid spin (or a bought bonus) plus every free spin it leads to. */
  function play(rng, buy) {
    const spins = [];
    let total = 0, free = 0, gm = 0;
    if (!buy) {
      const sp = spin(rng, false);
      sp.mult = sp.base > 0 && sp.orbs.length ? sp.orbs.reduce((a, b) => a + b, 0) : 1;
      sp.scPay = sp.sc >= 4 ? CFG.scatterPay[Math.min(6, sp.sc)] : 0;
      sp.total = sp.base * sp.mult + sp.scPay;
      spins.push(sp);
      total = sp.total;
      if (sp.sc >= 4) free = CFG.freeSpins;
    } else free = CFG.freeSpins;
    let given = free;
    for (let i = 0; i < free && total < CFG.maxWin; i++) {
      const sp = spin(rng, true);
      sp.free = true;
      const hot = sp.base > 0 && sp.orbs.length > 0;
      if (hot) gm += sp.orbs.reduce((a, b) => a + b, 0); // orb values pile up for the rest of the round
      sp.mult = hot ? gm : 1;
      sp.gm = gm;
      sp.scPay = 0;
      sp.total = sp.base * sp.mult;
      if (sp.sc >= 3 && given < CFG.maxSpins) { sp.more = Math.min(CFG.retrigger, CFG.maxSpins - given); free += sp.more; given += sp.more; }
      spins.push(sp);
      total += sp.total;
    }
    return { spins, free: given, total: Math.min(CFG.maxWin, Math.round(total * 100) / 100), buy: !!buy };
  }

  BB.tumbleMath = { play, spin, PAYS, W_BASE, W_FREE, ORB_VALUES, CFG };

  /* ---------- artwork (drawn for this game) ---------- */
  const token = (bg, edge, glyph) => `<svg viewBox="0 0 48 48"><circle cx="24" cy="25" r="19" fill="${edge}"/><circle cx="24" cy="23" r="19" fill="${bg}"/><circle cx="24" cy="23" r="15.500" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1.500"/>${glyph}</svg>`;
  const ART = [
    '<svg viewBox="0 0 48 48"><path d="M24 4l8 12 12 3-9 9 2 14-13-6-13 6 2-14-9-9 12-3z" fill="#ff5cc8"/><path d="M24 4l8 12H16z" fill="#ffd1ef"/><path d="M4 19l12-3 8 12-13 0z" fill="#ff8fdb"/><path d="M44 19l-12-3-8 12 13 0z" fill="#e23aa8"/><path d="M11 42l2-14h22l2 14-13-6z" fill="#b8248a"/><path d="M16 16h16l-8 12z" fill="#ffb3e6"/></svg>',
    '<svg viewBox="0 0 48 48"><path d="M24 4l17 10v20L24 44 7 34V14z" fill="#2fe08a"/><path d="M24 4l17 10-17 8L7 14z" fill="#b8f7d6"/><path d="M7 14l17 8v22L7 34z" fill="#1fb96d"/><path d="M41 14l-17 8v22l17-10z" fill="#149454"/><path d="M24 12l8 5-8 4-8-4z" fill="#e6fff3" opacity=".8"/></svg>',
    '<svg viewBox="0 0 48 48"><path d="M15 5h18l10 10v18L33 43H15L5 33V15z" fill="#ff4d67"/><path d="M15 5h18l-4 9H19z" fill="#ffc2cb"/><path d="M5 15l10-10 4 9-5 5z" fill="#ff8a9c"/><path d="M43 15L33 5l-4 9 5 5z" fill="#e02a4a"/><path d="M14 19h20v10H14z" fill="#ff6a80"/><path d="M5 33l9-4h20l9 4-10 10H15z" fill="#b01f3a"/></svg>',
    '<svg viewBox="0 0 48 48"><path d="M24 5l20 36H4z" fill="#ffb52e"/><path d="M24 5l7 20H17z" fill="#ffe6ad"/><path d="M4 41l13-16h14l13 16z" fill="#e8930c"/><path d="M17 25h14l-7 16z" fill="#ffc95a"/></svg>',
    token('#7c5cff', '#4a2fc4', '<path d="M24 11l3.300 7.700 8.200.8-6.200 5.600 1.900 8.200L24 28.900l-7.200 4.400 1.900-8.200-6.200-5.600 8.200-.8z" fill="#fff"/>'),
    token('#22b8d6', '#0b7d96', '<path d="M29 12a12 12 0 1 0 4 20 10 10 0 0 1-4-20z" fill="#fff"/>'),
    token('#ff8a3d', '#c2560d', '<circle cx="24" cy="23" r="7.500" fill="#fff"/><ellipse cx="24" cy="23" rx="14" ry="4.500" fill="none" stroke="#fff" stroke-width="2.200" transform="rotate(-18 24 23)"/>'),
    token('#3fbf6f', '#1d8546', '<path d="M27 10L15 25h7l-3 12 13-16h-7z" fill="#fff"/>'),
    token('#8892ab', '#566078', '<circle cx="18" cy="19" r="3" fill="#fff"/><circle cx="29" cy="17" r="2" fill="#fff"/><circle cx="30" cy="28" r="3.500" fill="#fff"/><circle cx="19" cy="30" r="2.200" fill="#fff"/>'),
    '<svg viewBox="0 0 48 48"><circle cx="24" cy="25" r="20" fill="#7a4a06"/><circle cx="24" cy="23" r="20" fill="#ffc93c"/><circle cx="24" cy="23" r="16" fill="#1b1030"/><g transform="translate(24 24) rotate(38)"><path d="M-3 9Q0 19 3 9Z" fill="#ff9d1c"/><path d="M-5 2l-6 8 6-2zM5 2l6 8-6-2z" fill="#ff4d67"/><path d="M0-15C6-9 7-1 4 9h-8C-7-1-6-9 0-15z" fill="#fff"/><circle cx="0" cy="-3" r="2.800" fill="#4d8dff"/></g></svg>',
  ];
  const orbArt = (v) => `<svg viewBox="0 0 48 48"><defs><radialGradient id="tb-orb" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff6c4"/><stop offset=".45" stop-color="#ffc93c"/><stop offset="1" stop-color="#b56f00"/></radialGradient></defs><circle cx="24" cy="24" r="21" fill="url(#tb-orb)"/><circle cx="24" cy="24" r="21" fill="none" stroke="#fff3c0" stroke-width="2"/><text x="24" y="${v >= 100 ? 29 : 30.500}" font-size="${v >= 100 ? 14 : v >= 10 ? 17 : 20}" font-weight="800" text-anchor="middle" fill="#3a2300" font-family="Outfit,Arial,sans-serif">×${v}</text></svg>`;
  const symHTML = (x) => `<div class="tb-sym${x.s === SC ? ' scatter' : x.s === ORB ? ' orb' : x.s < 4 ? ' gem' : ''}">${x.s === ORB ? orbArt(x.v) : ART[x.s]}</div>`;

  /* ---------- the game ---------- */
  let amount, busy = false, alive = 0, pending = null, turbo = false, els = [], shown = null;
  const T = () => (turbo ? { drop: 230, show: 300, pop: 120, fall: 190, gap: 60 } : { drop: 430, show: 560, pop: 190, fall: 320, gap: 130 });

  const place = (el, row) => { el.style.transform = `translateY(${row * 100}%)`; };
  function cellEl(x, row) {
    const el = h(`<div class="tb-cell">${symHTML(x)}</div>`);
    place(el, row);
    return el;
  }

  /** Swap the whole grid: old symbols fall away, new ones drop in column by column. */
  async function dropIn(cols, my) {
    const t = T(), old = els;
    old.forEach((col) => col.forEach((el) => { el.classList.add('out'); place(el, ROWS + 1.5); }));
    setTimeout(() => old.forEach((col) => col.forEach((el) => el.remove())), t.drop);
    els = cols.map((col, c) => col.map((x, r) => {
      const el = cellEl(x, r - ROWS - 1);
      el.style.transitionDuration = t.drop + 'ms';
      el.style.transitionDelay = c * (t.drop / 12) + (ROWS - 1 - r) * 16 + 'ms';
      $('#tb-c' + c).appendChild(el);
      return el;
    }));
    void $('#tb-grid').offsetWidth;
    els.forEach((col) => col.forEach((el, r) => place(el, r)));
    BB.sfx('launch');
    await sleep(t.drop + (COLS * t.drop) / 12 + 40);
    if (my !== alive) return false;
    BB.sfx('tick', 0.9);
    return true;
  }

  /** Play out one tumble: light up the winners, pop them, let everything above fall and refill. */
  async function tumble(step, next, my, bet, n) {
    const t = T(), hit = {};
    step.wins.forEach((w) => { hit[w.s] = 1; });
    step.grid.forEach((col, c) => col.forEach((x, r) => { if (hit[x.s]) els[c][r].classList.add('win'); }));
    $('#tb-grid').classList.add('haswin');
    $('#vs-lines').innerHTML = step.wins.map((w) => `<span class="vs-chip">${w.n}× ${esc(NAMES[w.s])} <b>+${fmt(w.pay * bet)}</b></span>`).join('');
    BB.sfx('kenoHit', Math.min(9, n * 2));
    await sleep(t.show);
    if (my !== alive) return false;
    step.grid.forEach((col, c) => col.forEach((x, r) => { if (hit[x.s]) els[c][r].classList.add('pop'); }));
    await sleep(t.pop);
    if (my !== alive) return false;
    $('#tb-grid').classList.remove('haswin');
    els = step.grid.map((col, c) => {
      const keep = [];
      col.forEach((x, r) => { if (hit[x.s]) els[c][r].remove(); else keep.push(els[c][r]); });
      const k = ROWS - keep.length, add = [];
      for (let i = 0; i < k; i++) {
        const el = cellEl(next[c][i], i - k - 1);
        el.style.transitionDuration = t.fall + 'ms';
        $('#tb-c' + c).appendChild(el);
        add.push(el);
      }
      return add.concat(keep);
    });
    void $('#tb-grid').offsetWidth;
    els.forEach((col) => col.forEach((el, r) => { el.style.transitionDuration = t.fall + 'ms'; el.style.transitionDelay = '0ms'; place(el, r); }));
    await sleep(t.fall + t.gap);
    return my === alive;
  }

  function setWin(v) { const el = $('#vs-win'); if (el) { el.textContent = fmt(v); el.classList.toggle('pos', v > 0); } }
  function banner(big, small, cls) { const el = $('#vs-banner'); if (el) { el.className = 'vs-banner show ' + (cls || ''); el.innerHTML = `<b>${big}</b>${small ? `<span>${small}</span>` : ''}`; } }
  const hideBanner = () => { const el = $('#vs-banner'); if (el) el.className = 'vs-banner'; };
  function hud(html) { const el = $('#vs-hud'); if (el) el.innerHTML = html; }

  /** Show one spin from start to finish. Returns its win in coins, or null if the page was left. */
  async function showSpin(sp, my, bet) {
    $('#vs-lines').innerHTML = '';
    if (!(await dropIn(sp.steps.length ? sp.steps[0].grid : sp.final, my))) return null;
    let run = 0;
    for (let i = 0; i < sp.steps.length; i++) {
      const next = i + 1 < sp.steps.length ? sp.steps[i + 1].grid : sp.final;
      if (!(await tumble(sp.steps[i], next, my, bet, i + 1))) return null;
      run += sp.steps[i].wins.reduce((a, w) => a + w.pay, 0) * bet;
      $('#tb-spin').textContent = fmt(run);
    }
    shown = sp.final;
    if (sp.mult > 1) {
      sp.final.forEach((col, c) => col.forEach((x, r) => { if (x.s === ORB) els[c][r].classList.add('boom'); }));
      $('#vs-lines').innerHTML = `<span class="vs-chip sc">${sp.free ? 'Total multiplier' : 'Orbs'} <b>×${sp.mult}</b></span><span class="vs-chip">${fmt(run)} × ${sp.mult} = <b>${fmt(run * sp.mult)}</b></span>`;
      BB.sfx('cashout');
      await sleep(turbo ? 320 : 700);
      if (my !== alive) return null;
    }
    if (sp.sc >= (sp.free ? 3 : 4)) sp.final.forEach((col, c) => col.forEach((x, r) => { if (x.s === SC) els[c][r].classList.add('boom'); }));
    return sp.total * bet;
  }

  function ui() {
    amount.lock(busy);
    $('#tb-go').disabled = busy;
    $('#tb-buy').disabled = busy;
    $('#tb-cost').textContent = fmt(amount.get() * CFG.buy);
  }

  function settle(quiet) {
    if (!pending) return null;
    const p = pending;
    pending = null;
    BB.win(p.payout, quiet || p.payout <= p.wager);
    BB.logBet('starforge', p.wager, p.mult, p.payout, null, p.nonce);
    return p;
  }

  async function go(buy) {
    if (busy) return;
    const bet = amount.get(), wager = buy ? round2(bet * CFG.buy) : bet;
    if (buy && wager > BB.balance()) { BB.toast(`Buying the bonus costs ${fmt(wager)} — more than your balance.`, 'err'); return; }
    if (!BB.placeBet(wager)) return;
    const my = ++alive;
    const rng = BB.fair.roll();
    const round = play(rng, buy);
    const payout = round2(bet * round.total);
    pending = { wager, payout, mult: Math.round((payout / wager) * 100) / 100, nonce: rng.nonce };
    busy = true;
    hideBanner(); setWin(0); hud(''); $('#tb-spin').textContent = '0.00';
    ui();

    let run = 0, i = 0;
    if (!buy) {
      const w = await showSpin(round.spins[0], my, bet);
      if (w == null) return;
      run += w; setWin(run); i = 1;
    }
    if (round.free) {
      BB.sfx('bigwin');
      banner(`${CFG.freeSpins} FREE SPINS`, buy ? 'Bonus bought — multipliers add up all round' : 'Multipliers add up all round', 'free');
      await sleep(1900);
      if (my !== alive) return;
      hideBanner();
      let left = CFG.freeSpins, n = 0;
      for (; i < round.spins.length; i++) {
        const sp = round.spins[i];
        n++; left--;
        hud(`Free spin <b>${n}</b> · ${left} left · total multiplier <b>×${Math.max(1, round.spins[i - 1] && round.spins[i - 1].free ? round.spins[i - 1].gm : 0) || 1}</b>`);
        const w = await showSpin(sp, my, bet);
        if (w == null) return;
        if (w > 0) { run += w; setWin(run); BB.sfx('gem', Math.min(12, n)); }
        if (sp.more) { left += sp.more; BB.sfx('cashout'); }
        hud(`Free spin <b>${n}</b> · ${left} left · total multiplier <b>×${Math.max(1, sp.gm)}</b>${sp.more ? ` · <b>+${sp.more} spins</b>` : ''}`);
        await sleep(w > 0 ? (turbo ? 380 : 800) : turbo ? 140 : 300);
        if (my !== alive) return;
      }
      hud('Free spins finished');
    }
    const p = settle(false);
    setWin(p.payout);
    const x = round.total;
    if (x >= 20) { banner(x >= 100 ? 'MEGA WIN' : 'BIG WIN', `<i class="coin"></i>${fmt(p.payout)} · ${fmtMult(x)}`, 'big'); BB.sfx('bigwin'); BB.confetti($('.vs-frame'), x >= 100 ? 110 : 70); }
    else if (round.free) banner('FREE SPINS OVER', `<i class="coin"></i>${fmt(p.payout)} won`, 'free');
    else BB.sfx(p.payout > p.wager ? 'win' : p.payout > 0 ? 'push' : 'lose');
    busy = false;
    ui();
  }

  function paytable() {
    const rows = PAYS.map((p, s) => `<div class="vp-row"><div class="tb-sym">${ART[s]}</div><b>${NAMES[s]}</b><div class="vp-pays"><span><small>12+</small>${fmtMult(p[2])}</span><span><small>10–11</small>${fmtMult(p[1])}</span><span><small>8–9</small>${fmtMult(p[0])}</span></div></div>`).join('');
    BB.showModal(h(`<div class="modal-back"><div class="modal single vp" role="dialog" aria-modal="true" aria-label="Star Forge paytable">
      <button class="modal-x" aria-label="Close">&times;</button>
      <div class="modal-body">
        <h2 class="modal-title">Star Forge<span class="demo-tag">Neon Mango</span></h2>
        <div class="vp-feat">
          <div class="vp-f"><div class="tb-sym">${ART[0]}</div><div><b>Pay anywhere</b><p>Eight or more of one symbol anywhere on the grid win. Winners vanish and new symbols tumble in until nothing pays.</p></div></div>
          <div class="vp-f"><div class="tb-sym orb">${orbArt(10)}</div><div><b>Multiplier orbs</b><p>Worth ×2 to ×100. Orbs on the grid when a winning spin ends are added together and multiply that spin's win.</p></div></div>
          <div class="vp-f"><div class="tb-sym scatter">${ART[SC]}</div><div><b>Rocket scatter</b><p>4, 5 or 6 rockets pay 3× / 5× / 100× and start ${CFG.freeSpins} free spins. In free spins the orb values pile up into one multiplier for the whole round, and 3 rockets add ${CFG.retrigger} more spins.</p></div></div>
        </div>
        <div class="fair-sep"><span>Symbol pays — multiples of your bet</span></div>
        <div class="vp-rows">${rows}</div>
        <div class="rules-facts" style="margin-top:16px"><div><small>Return to player</small><b>${CFG.rtp}%</b></div><div><small>Volatility</small><b>Very high</b></div><div><small>Top payout</small><b>${CFG.maxWin.toLocaleString('en-US')}×</b></div></div>
        <p class="fair-note">Buying the bonus costs ${CFG.buy}× your bet and starts the free spins straight away (return ${CFG.buyRtp}%). The return figures come from simulating tens of millions of rounds with the game's own code, so they are accurate to about a tenth of a percent rather than exact. Star Forge and Neon Mango are made up for this demo.</p>
      </div></div></div>`));
  }

  const describe = (r) => {
    const out = [], b = r.spins[0];
    if (!r.buy) {
      out.push(['First drop — columns left to right, top to bottom', (b.steps.length ? b.steps[0].grid : b.final).map((col) => col.map((x) => (x.s === ORB ? '×' + x.v : NAMES[x.s].split(' ')[0])).join(' ')).join('  |  ')]);
      out.push(['Tumbles', b.steps.length ? b.steps.map((st) => st.wins.map((w) => `${w.n} ${NAMES[w.s]} = ${fmtMult(w.pay)}`).join(' + ')).join('  →  ') : 'none']);
      out.push(['Orbs / scatters', (b.orbs.length ? b.orbs.map((v) => '×' + v).join(' ') : 'no orbs') + ' · ' + b.sc + ' rockets']);
    }
    if (r.free) out.push(['Free spins', r.spins.filter((s) => s.free).map((s, i) => `#${i + 1}: ${fmtMult(s.total)}`).join('  ')]);
    out.push(['Total', fmtMult(r.total) + ' the bet']);
    return out;
  };

  BB.registerGame({
    id: 'starforge',
    name: 'Star Forge',
    cat: 'slots',
    provider: 'neon',
    vol: 'Very high',
    rtp: CFG.rtp,
    badge: 'NEW',
    colors: ['#6366f1', '#0f0f2e'],
    icon: '<svg viewBox="0 0 24 24"><path d="M12 2.500l2.800 6 6.700.8-5 4.500 1.400 6.700-5.900-3.400-5.900 3.400 1.400-6.700-5-4.500 6.700-.8z" fill="currentColor"/></svg>',
    art: `<svg viewBox="0 0 200 200">
      <g fill="#fff"><circle cx="30" cy="40" r="2.500" opacity=".7"/><circle cx="170" cy="30" r="2" opacity=".6"/><circle cx="160" cy="150" r="2.500" opacity=".5"/><circle cx="36" cy="150" r="2" opacity=".5"/></g>
      <g transform="translate(22 92) scale(1.350)">${ART[1].replace(/<\/?svg[^>]*>/g, '')}</g>
      <g transform="translate(114 92) scale(1.350)">${ART[2].replace(/<\/?svg[^>]*>/g, '')}</g>
      <g transform="translate(46 18) scale(2.250)">${ART[0].replace(/<\/?svg[^>]*>/g, '')}</g>
      <circle cx="152" cy="52" r="24" fill="#ffc93c" stroke="#fff3c0" stroke-width="3"/><text x="152" y="60" font-size="22" font-weight="800" text-anchor="middle" fill="#3a2300" font-family="Outfit,Arial,sans-serif">×25</text>
    </svg>`,
    verify(rng, fresh) {
      return [['If it was a normal spin', '']].concat(describe(play(rng, false)), [['If the bonus was bought', '']], describe(play(fresh(), true)));
    },

    mount(panel, stage) {
      busy = false; pending = null; els = [];
      amount = BB.ui.amount({ label: 'Bet' });
      panel.appendChild(amount.el);
      panel.appendChild(h(`<div>
        <button class="btn primary lg block" id="tb-go">Spin</button>
        <button class="btn ghost block tb-buy" id="tb-buy"><span>Buy free spins</span><b><i class="coin sm"></i><span id="tb-cost"></span></b></button>
        <div class="vs-opts">
          <button type="button" class="btn ghost sm" id="tb-pay">${BB.icon('info', 16)}Paytable</button>
          <label class="vs-turbo">Turbo<button type="button" class="switch${turbo ? ' on' : ''}" id="tb-turbo" role="switch" aria-checked="${turbo}" aria-label="Turbo spins"><i></i></button></label>
        </div>
        <p class="panel-note">Eight or more of a symbol anywhere pays, then the grid tumbles. Four rockets start ${CFG.freeSpins} free spins where multiplier orbs add up. Buying the bonus costs ${CFG.buy}× the bet.</p>
      </div>`));
      stage.classList.add('vs-stage');
      if (!shown) { const r = { float: BB.rand }; shown = []; for (let c = 0; c < COLS; c++) { const col = []; for (let y = 0; y < ROWS; y++) { let x = draw(r, false); if (x.s >= SC) x = { s: 4 + ((c + y) % 5) }; col.push(x); } shown.push(col); } }
      stage.appendChild(h(`<div class="vs-wrap tb-wrap" style="--vs1:#6366f1;--vs2:#0f0f2e">
        <div class="vs-top"><div class="vs-title"><b>Star Forge</b><small style="color:#e879f9">Neon Mango</small></div><div class="vs-hud" id="vs-hud"></div></div>
        <div class="vs-frame">
          <div class="tb-grid" id="tb-grid">${shown.map((col, c) => `<div class="tb-col" id="tb-c${c}"></div>`).join('')}</div>
          <div class="vs-banner" id="vs-banner"></div>
        </div>
        <div class="vs-bar"><div class="vs-winbox"><small>Win</small><b id="vs-win">0.00</b></div><div class="vs-winbox"><small>This spin</small><b id="tb-spin">0.00</b></div><div class="vs-lines" id="vs-lines"></div></div>
      </div>`));
      els = shown.map((col, c) => col.map((x, r) => { const el = cellEl(x, r); $('#tb-c' + c).appendChild(el); return el; }));
      $('#tb-go').addEventListener('click', () => go(false));
      $('#tb-buy').addEventListener('click', () => {
        if (busy) return;
        const cost = round2(amount.get() * CFG.buy);
        BB.confirm({ title: 'Buy free spins?', body: `This costs ${fmt(cost)} coins (${CFG.buy}× your bet) and starts ${CFG.freeSpins} free spins straight away.`, ok: 'Buy for ' + fmt(cost) }).then((ok) => { if (ok) go(true); });
      });
      $('#tb-pay').addEventListener('click', paytable);
      $('#tb-turbo').addEventListener('click', (e) => { turbo = !turbo; e.currentTarget.classList.toggle('on', turbo); e.currentTarget.setAttribute('aria-checked', turbo); BB.sfx('click'); });
      $('#vs-banner').addEventListener('click', hideBanner);
      amount.onChange(ui);
      ui();
    },

    unmount() {
      alive++;
      settle(true); // the round, free spins included, is already decided — pay it out rather than lose it
      busy = false;
    },
  });

  if (BB.rules) BB.rules.starforge = {
    how: ['Set a bet and spin. There are no lines: eight or more of the same symbol anywhere on the 6×5 grid win.', 'Winning symbols vanish, the ones above fall, and new symbols drop in. This repeats until nothing pays.',
      'Gold orbs carry a multiplier from ×2 to ×100. If a winning spin ends with orbs on the grid, they are added together and multiply that spin.', `Four or more rockets pay a prize and start ${CFG.freeSpins} free spins. There the orb values pile up into one multiplier that lasts the whole round.`, `You can also buy the free spins outright for ${CFG.buy}× your bet.`],
    max: CFG.maxWin.toLocaleString('en-US') + '×', risk: 'Very high volatility. Most spins pay nothing; nearly all of the return sits in tumbles that chain and in the free spins.',
  };
})();
