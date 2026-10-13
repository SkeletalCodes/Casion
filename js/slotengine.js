/* Video slots — one engine, several themed games from the site's own (fictional) studios.
   5 reels × 3 rows, 10 fixed lines paying left to right. Every cell is an independent draw from a weighted
   symbol list. Wilds stand in for anything but the scatter; three or more scatters pay and start free spins
   where every win is multiplied. The whole round — base spin and all free spins — comes off one seeded
   number stream, so it is decided the moment you press Spin and can be re-run in the fairness verifier. */
(function () {
  'use strict';
  const { $, $$, h, fmt, fmtMult, sleep, round2, randInt, esc } = BB;

  const W = 0, S = 1, REELS = 5, ROWS = 3;
  const LINES = [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [1, 0, 1, 2, 1]];

  /* Symbol order: 0 wild, 1 scatter, 2-4 premium, 5-8 A K Q J. `weights` are per-cell chances (%).
     `pays` are for 3 / 4 / 5 of a kind in line-bet units (a line bet is a tenth of the total bet).
     RTP for each profile is computed exactly by enumeration — see BB.slotMath.rtp(). */
  const MATH = {
    low: { rtp: '96.5', vol: 'Low', weights: [3.2, 5, 7, 9, 11, 14.8, 16, 16.6, 17.4], scatter: { pays: [2, 10, 50], spins: [6, 8, 10], mult: 2 },
      pays: { 2: [35, 100, 425], 3: [20, 70, 250], 4: [20, 40, 150], 5: [10, 30, 75], 6: [10, 20, 65], 7: [7, 20, 50], 8: [7, 15, 40] } },
    medium: { rtp: '96.9', vol: 'Medium', weights: [2.8, 4.6, 6, 8.4, 10.8, 15.2, 16.6, 17.6, 18], scatter: { pays: [2, 15, 100], spins: [8, 10, 12], mult: 2 },
      pays: { 2: [55, 200, 1000], 3: [30, 100, 425], 4: [20, 55, 200], 5: [10, 30, 90], 6: [7, 20, 65], 7: [7, 20, 50], 8: [4, 15, 35] } },
    high: { rtp: '96.1', vol: 'High', weights: [2.3, 4.2, 5, 8, 10.8, 15.7, 17.2, 18.2, 18.6], scatter: { pays: [3, 20, 200], spins: [8, 12, 15], mult: 3 },
      pays: { 2: [85, 425, 3500], 3: [35, 150, 700], 4: [15, 70, 275], 5: [7, 30, 85], 6: [7, 20, 65], 7: [4, 15, 40], 8: [3, 10, 35] } },
  };

  function symFrom(m, f) { let x = f * 100; for (let i = 0; i < m.weights.length; i++) { x -= m.weights[i]; if (x < 0) return i; } return m.weights.length - 1; }

  /** Best pay for one line of five symbols: { pay (line-bet units), n (symbols used), sym }. */
  function linePay(m, line) {
    let best = { pay: 0, n: 0, sym: -1 }, k = 0;
    while (k < REELS && line[k] === W) k++;
    if (k >= 3) best = { pay: m.pays[2][k - 3], n: k, sym: W };
    const first = line.find((x) => x !== W);
    if (first !== undefined && first !== S) {
      let n = 0;
      while (n < REELS && (line[n] === first || line[n] === W)) n++;
      if (n >= 3 && m.pays[first][n - 3] >= best.pay) best = { pay: m.pays[first][n - 3], n, sym: first };
    }
    return best;
  }

  /** One spin: grid[reel][row], its winning lines, scatter count and total win in bet multiples. */
  function spinFrom(m, rng, mult) {
    const grid = [];
    for (let r = 0; r < REELS; r++) { const col = []; for (let y = 0; y < ROWS; y++) col.push(symFrom(m, rng.float())); grid.push(col); }
    const wins = [];
    LINES.forEach((ln, i) => {
      const res = linePay(m, ln.map((row, r) => grid[r][row]));
      if (res.pay) wins.push({ line: i, n: res.n, sym: res.sym, pay: (res.pay / 10) * mult });
    });
    let sc = 0;
    grid.forEach((col) => col.forEach((s) => { if (s === S) sc++; }));
    const scPay = sc >= 3 ? m.scatter.pays[Math.min(sc, 5) - 3] * mult : 0;
    return { grid, wins, sc, scPay, total: wins.reduce((a, w) => a + w.pay, 0) + scPay };
  }

  /** A whole round: the base spin plus any free spins it triggers (free spins can't re-trigger). */
  function playFrom(m, rng) {
    const base = spinFrom(m, rng, 1), spins = [base];
    let free = 0;
    if (base.sc >= 3) {
      free = m.scatter.spins[Math.min(base.sc, 5) - 3];
      for (let i = 0; i < free; i++) spins.push(spinFrom(m, rng, m.scatter.mult));
    }
    return { spins, free, total: Math.round(spins.reduce((a, s) => a + s.total, 0) * 100) / 100 };
  }

  /** Exact return-to-player for a math profile (enumerates every 5-symbol line and the scatter odds). */
  function rtp(m) {
    const w = m.weights.map((x) => x / 100), n = w.length, line = [0, 0, 0, 0, 0];
    let lineE = 0;
    // ten lines at a tenth of the bet each, so the lines' return per unit bet is simply E[line pay in line bets]
    (function rec(i, p) { if (i === REELS) { lineE += p * linePay(m, line).pay; return; } for (let s = 0; s < n; s++) { line[i] = s; rec(i + 1, p * w[s]); } })(0, 1);
    const C = (a, b) => { let r = 1; for (let i = 0; i < b; i++) r = (r * (a - i)) / (i + 1); return r; };
    const P = (k) => C(15, k) * Math.pow(w[S], k) * Math.pow(1 - w[S], 15 - k);
    let p5 = 0;
    for (let k = 5; k <= 15; k++) p5 += P(k);
    const pk = [P(3), P(4), p5];
    const base = lineE + pk[0] * m.scatter.pays[0] + pk[1] * m.scatter.pays[1] + pk[2] * m.scatter.pays[2];
    const spins = pk[0] * m.scatter.spins[0] + pk[1] * m.scatter.spins[1] + pk[2] * m.scatter.spins[2];
    return base * (1 + spins * m.scatter.mult);
  }

  /* ---------- studios ---------- */
  const PROVIDERS = {
    originals: { name: 'BananaBet Originals', short: 'Originals', color: '#ffc93c', mark: 'B', blurb: 'Provably fair house games' },
    peel: { name: 'Peel Studios', short: 'Peel', color: '#a3e635', mark: 'P', blurb: 'Bright, friendly, easy-going reels' },
    bonecoin: { name: 'Bonecoin Gaming', short: 'Bonecoin', color: '#f97316', mark: 'B', blurb: 'High-volatility treasure hunts' },
    neon: { name: 'Neon Mango', short: 'Neon Mango', color: '#e879f9', mark: 'N', blurb: 'Arcade colour, steady wins' },
  };
  BB.providers = PROVIDERS;

  const RANKS = ['A', 'K', 'Q', 'J'];
  const RANK_COL = ['#ff6b81', '#ffc93c', '#7cc4ff', '#7ef0b0'];

  function make(cfg) {
    const m = MATH[cfg.math], prov = PROVIDERS[cfg.provider];
    const NAMES = ['Wild', 'Scatter'].concat(cfg.names, RANKS);
    let amount, busy = false, alive = 0, pending = null, turbo = false;
    let shown = [[5, 6, 7], [6, 2, 8], [7, 0, 5], [8, 3, 6], [5, 4, 7]];

    function symHTML(i) {
      const cls = i === W ? 'wild' : i === S ? 'scatter' : i <= 4 ? 'high' : 'low';
      const glyph = i >= 5 ? `<b style="color:${RANK_COL[i - 5]}">${RANKS[i - 5]}</b>` : cfg.glyphs[i].length <= 2 && /^[A-Z0-9]+$/.test(cfg.glyphs[i]) ? `<b class="txt">${cfg.glyphs[i]}</b>` : `<span>${cfg.glyphs[i]}</span>`;
      return `<div class="vs-sym ${cls}">${glyph}${i === W ? '<em>WILD</em>' : i === S ? '<em>SCATTER</em>' : ''}</div>`;
    }
    const cell = (i) => `<div class="vs-cell">${symHTML(i)}</div>`;
    const text = (i) => (i >= 5 ? RANKS[i - 5] : cfg.glyphs[i]);

    function ui() {
      amount.lock(busy);
      $('#vs-spin').disabled = busy;
      $('#vs-line').textContent = fmt(amount.get() / 10);
    }

    function settle(quiet) {
      if (!pending) return null;
      const p = pending;
      pending = null;
      BB.win(p.payout, quiet || p.mult <= 1);
      BB.logBet(cfg.id, p.bet, p.mult, p.payout, null, p.nonce);
      return p;
    }

    function loadReel(r, next, ms) {
      const strip = $('#vs-s' + r), fill = [];
      for (let k = 0; k < 9 + r * 4; k++) fill.push(2 + randInt(7));
      const list = next.concat(fill, shown[r]);
      strip.style.transition = 'none';
      strip.innerHTML = list.map(cell).join('');
      strip.style.transform = `translateY(${(-(list.length - ROWS) / list.length) * 100}%)`;
      void strip.offsetWidth;
      strip.style.transition = `transform ${ms}ms cubic-bezier(.22, .1, .18, 1)`;
      strip.style.transform = 'translateY(0)';
      strip.parentElement.classList.remove('land');
      strip.parentElement.classList.add('spinning');
      shown[r] = next.slice();
    }

    function clearMarks() {
      $$('.vs-cell.hit').forEach((c) => c.classList.remove('hit'));
      $('.vs-frame').classList.remove('haswin');
      $('#vs-lines').innerHTML = '';
    }

    /** Spin the reels to one result and light up what it won. Resolves false if the page was left. */
    async function showSpin(sp, my, bet) {
      clearMarks();
      const base = turbo ? 420 : 820, step = turbo ? 110 : 250, times = [];
      let extra = 0, scSoFar = 0;
      for (let r = 0; r < REELS; r++) {
        if (r >= 2 && scSoFar >= 2) extra += turbo ? 250 : 600; // two scatters landed — hold the remaining reels
        times.push(base + r * step + extra);
        scSoFar += sp.grid[r].filter((s) => s === S).length;
      }
      for (let r = 0; r < REELS; r++) loadReel(r, sp.grid[r], times[r]);
      BB.sfx('launch');
      let seen = 0;
      for (let r = 0; r < REELS; r++) {
        await sleep(r ? times[r] - times[r - 1] : times[0]);
        if (my !== alive) return false;
        $('#vs-s' + r).parentElement.classList.remove('spinning');
        $('#vs-s' + r).parentElement.classList.add('land');
        const sc = sp.grid[r].filter((s) => s === S).length;
        seen += sc;
        if (sc) BB.sfx('kenoHit', seen * 2); else BB.sfx('tick', 0.9);
        $('.vs-frame').classList.toggle('tease', seen >= 2 && r < REELS - 1);
      }
      $('.vs-frame').classList.remove('tease');
      await sleep(turbo ? 60 : 140);
      if (my !== alive) return false;
      if (sp.total > 0) {
        sp.wins.forEach((w) => { for (let r = 0; r < w.n; r++) $('#vs-s' + r).children[LINES[w.line][r]].classList.add('hit'); });
        if (sp.scPay) for (let r = 0; r < REELS; r++) sp.grid[r].forEach((s, y) => { if (s === S) $('#vs-s' + r).children[y].classList.add('hit'); });
        $('.vs-frame').classList.add('haswin');
        $('#vs-lines').innerHTML = sp.wins.slice(0, 4).map((w) => `<span class="vs-chip">Line ${w.line + 1} · ${w.n}× ${esc(text(w.sym))} <b>+${fmt(w.pay * bet)}</b></span>`).join('') +
          (sp.wins.length > 4 ? `<span class="vs-chip">+${sp.wins.length - 4} more</span>` : '') + (sp.scPay ? `<span class="vs-chip sc">${sp.sc} scatters <b>+${fmt(sp.scPay * bet)}</b></span>` : '');
      }
      return true;
    }

    function banner(big, small, cls) {
      const el = $('#vs-banner');
      if (!el) return;
      el.className = 'vs-banner show ' + (cls || '');
      el.innerHTML = `<b>${big}</b>${small ? `<span>${small}</span>` : ''}`;
    }
    const hideBanner = () => { const el = $('#vs-banner'); if (el) el.className = 'vs-banner'; };

    function setWin(v) { const el = $('#vs-win'); if (el) { el.textContent = fmt(v); el.classList.toggle('pos', v > 0); } }

    async function spin() {
      if (busy) return;
      const bet = amount.get();
      if (!BB.placeBet(bet)) return;
      const my = ++alive;
      const rng = BB.fair.roll();
      const round = playFrom(m, rng);
      pending = { bet, mult: round.total, payout: round2(bet * round.total), nonce: rng.nonce };
      busy = true;
      hideBanner();
      setWin(0);
      $('#vs-hud').textContent = '';
      ui();

      let run = 0;
      if (!(await showSpin(round.spins[0], my, bet))) return;
      run += round.spins[0].total * bet;
      setWin(run);
      if (round.free) {
        BB.sfx('bigwin');
        banner(`${round.free} FREE SPINS`, `Every win pays ×${m.scatter.mult}`, 'free');
        await sleep(1900);
        if (my !== alive) return;
        hideBanner();
        for (let i = 1; i <= round.free; i++) {
          $('#vs-hud').innerHTML = `Free spin <b>${i}</b> of ${round.free} · wins ×${m.scatter.mult}`;
          if (!(await showSpin(round.spins[i], my, bet))) return;
          if (round.spins[i].total > 0) { run += round.spins[i].total * bet; setWin(run); BB.sfx('gem', Math.min(12, i)); }
          await sleep(round.spins[i].total > 0 ? (turbo ? 450 : 850) : turbo ? 150 : 300);
          if (my !== alive) return;
        }
        $('#vs-hud').textContent = 'Free spins finished';
      }
      const p = settle(false);
      setWin(p.payout);
      if (round.total >= 15) {
        banner(round.total >= 50 ? 'MEGA WIN' : 'BIG WIN', `<i class="coin"></i>${fmt(p.payout)} · ${fmtMult(round.total)}`, 'big');
        BB.sfx('bigwin');
        BB.confetti($('.vs-frame'), round.total >= 50 ? 110 : 70);
      } else if (round.free) banner('FREE SPINS OVER', `<i class="coin"></i>${fmt(p.payout)} won`, 'free');
      else BB.sfx(p.payout > bet ? 'win' : p.payout > 0 ? 'push' : 'lose');
      busy = false;
      ui();
    }

    function paytable() {
      const pay = (i) => m.pays[i].map((v, k) => `<span><small>${k + 3}×</small>${fmtMult(v / 10)}</span>`).reverse().join('');
      const rows = [2, 3, 4, 5, 6, 7, 8].map((i) => `<div class="vp-row">${symHTML(i)}<b>${esc(NAMES[i])}</b><div class="vp-pays">${pay(i)}</div></div>`).join('');
      const lines = LINES.map((ln, i) => `<div class="vp-line"><small>${i + 1}</small><div>${[0, 1, 2].map((row) => ln.map((x) => `<i class="${x === row ? 'on' : ''}"></i>`).join('')).join('')}</div></div>`).join('');
      BB.showModal(h(`<div class="modal-back"><div class="modal single vp" role="dialog" aria-modal="true" aria-label="${esc(cfg.name)} paytable" style="--vs1:${cfg.colors[0]};--vs2:${cfg.colors[1]}">
        <button class="modal-x" aria-label="Close">&times;</button>
        <div class="modal-body">
          <h2 class="modal-title">${esc(cfg.name)}<span class="demo-tag" style="color:${prov.color};border-color:${prov.color}55;background:${prov.color}1c">${prov.name}</span></h2>
          <div class="vp-feat">
            <div class="vp-f">${symHTML(W)}<div><b>Wild</b><p>Stands in for every symbol except the scatter. A line of wilds pays like ${esc(NAMES[2])}.</p></div></div>
            <div class="vp-f">${symHTML(S)}<div><b>Scatter</b><p>3, 4 or 5 anywhere pay ${m.scatter.pays.map((v) => v + '×').join(' / ')} your bet and award ${m.scatter.spins.join(' / ')} free spins with every win ×${m.scatter.mult}.</p></div></div>
          </div>
          <div class="fair-sep"><span>Line pays — multiples of your total bet</span></div>
          <div class="vp-rows">${rows}</div>
          <div class="fair-sep"><span>The 10 lines</span></div>
          <div class="vp-lines">${lines}</div>
          <div class="rules-facts" style="margin-top:16px"><div><small>Return to player</small><b>${m.rtp}%</b></div><div><small>Volatility</small><b>${m.vol}</b></div><div><small>Studio</small><b>${prov.name}</b></div></div>
          <p class="fair-note">Lines pay left to right starting from the first reel, and only the best win on each line counts. Free spins can't re-trigger. ${prov.name} is a made-up studio — these games are part of this demo, not a third-party integration.</p>
        </div></div></div>`));
    }

    const glyphAt = (i, x, y, size) => `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${cfg.glyphs[i]}</text>`;
    BB.registerGame({
      id: cfg.id,
      name: cfg.name,
      cat: 'slots',
      provider: cfg.provider,
      vol: m.vol,
      rtp: m.rtp,
      badge: cfg.badge,
      colors: cfg.colors,
      icon: `<svg viewBox="0 0 24 24"><text x="12" y="18.500" font-size="17" text-anchor="middle" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${cfg.glyphs[W]}</text></svg>`,
      art: `<svg viewBox="0 0 200 200">
        <rect x="10" y="40" width="180" height="112" rx="18" fill="rgba(0,0,0,.34)" stroke="rgba(255,255,255,.28)" stroke-width="3"/>
        <rect x="20" y="52" width="48" height="88" rx="10" fill="rgba(255,255,255,.1)"/><rect x="76" y="52" width="48" height="88" rx="10" fill="rgba(255,255,255,.16)"/><rect x="132" y="52" width="48" height="88" rx="10" fill="rgba(255,255,255,.1)"/>
        ${glyphAt(2, 44, 110, 38)}${glyphAt(3, 156, 110, 38)}
        <circle cx="100" cy="94" r="46" fill="rgba(0,0,0,.35)"/><circle cx="100" cy="94" r="46" fill="none" stroke="#ffc93c" stroke-width="4"/>
        ${glyphAt(W, 100, 116, 62)}
      </svg>`,
      verify(rng) {
        const round = playFrom(m, rng), b = round.spins[0];
        const rowsOut = [0, 1, 2].map((y) => b.grid.map((col) => text(col[y])).join(' ')).join('   /   ');
        const out = [['Base spin — rows, top to bottom', rowsOut],
          ['Winning lines', b.wins.length ? b.wins.map((w) => `line ${w.line + 1}: ${w.n}× ${text(w.sym)} = ${fmtMult(w.pay)}`).join(', ') : 'none'],
          ['Scatters', b.sc + (b.sc >= 3 ? ` — pays ${b.scPay}× and ${round.free} free spins` : '')]];
        if (round.free) out.push(['Free spins', round.spins.slice(1).map((s, i) => `#${i + 1}: ${fmtMult(s.total)}`).join('  ')]);
        out.push(['Total payout', fmtMult(round.total) + ' the bet']);
        return out;
      },

      mount(panel, stage) {
        busy = false; pending = null;
        amount = BB.ui.amount({ label: 'Total bet' });
        panel.appendChild(amount.el);
        panel.appendChild(h(`<div>
          <div class="row2">
            <div class="field"><span class="field-l">Line bet <em style="font-style:normal;color:var(--dim)">10 lines</em></span><div class="readout"><i class="coin"></i><span id="vs-line"></span></div></div>
            <div class="field"><span class="field-l">Volatility</span><div class="readout">${m.vol}</div></div>
          </div>
          <button class="btn primary lg block" id="vs-spin">Spin</button>
          <div class="vs-opts">
            <button type="button" class="btn ghost sm" id="vs-pay">${BB.icon('info', 16)}Paytable</button>
            <label class="vs-turbo">Turbo<button type="button" class="switch${turbo ? ' on' : ''}" id="vs-turbo" role="switch" aria-checked="${turbo}" aria-label="Turbo spins"><i></i></button></label>
          </div>
          <p class="panel-note">${cfg.blurb} Three or more ${esc(cfg.glyphs[S])} scatters start free spins where every win pays ×${m.scatter.mult}.</p>
        </div>`));
        stage.classList.add('vs-stage');
        stage.appendChild(h(`<div class="vs-wrap" style="--vs1:${cfg.colors[0]};--vs2:${cfg.colors[1]}">
          <div class="vs-top"><div class="vs-title"><b>${esc(cfg.name)}</b><small style="color:${prov.color}">${prov.name}</small></div><div class="vs-hud" id="vs-hud"></div></div>
          <div class="vs-frame">
            <div class="vs-reels">${shown.map((col, r) => `<div class="vs-reel"><div class="vs-strip" id="vs-s${r}">${col.map(cell).join('')}</div></div>`).join('')}</div>
            <div class="vs-banner" id="vs-banner"></div>
          </div>
          <div class="vs-bar"><div class="vs-winbox"><small>Win</small><b id="vs-win">0.00</b></div><div class="vs-lines" id="vs-lines"></div></div>
        </div>`));
        $('#vs-spin').addEventListener('click', spin);
        $('#vs-pay').addEventListener('click', paytable);
        $('#vs-turbo').addEventListener('click', (e) => { turbo = !turbo; e.currentTarget.classList.toggle('on', turbo); e.currentTarget.setAttribute('aria-checked', turbo); BB.sfx('click'); });
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

    if (BB.rules) BB.rules[cfg.id] = {
      how: ['Set your total bet and spin. The bet is split evenly over 10 fixed lines.', 'Three or more matching symbols on a line, starting from the left-hand reel, win.',
        `${cfg.glyphs[W]} is wild and replaces any symbol except the scatter.`, `Three or more ${cfg.glyphs[S]} scatters anywhere pay a prize and start free spins where every win is multiplied by ${m.scatter.mult}.`, 'Open the paytable under the Spin button for every prize and all 10 lines.'],
      max: fmtMult(m.pays[2][2] / 10) + ' per line', risk: `${m.vol} volatility. ${m.vol === 'Low' ? 'Smaller prizes that land more evenly.' : m.vol === 'Medium' ? 'A balance of regular wins and the odd big one.' : 'Long quiet spells, with most of the return packed into rare big hits and free spins.'}`,
    };
  }

  BB.slotMath = { MATH, LINES, linePay, spinFrom, playFrom, rtp };

  [
    { id: 'skullreef', name: 'Skull Reef', provider: 'bonecoin', math: 'high', badge: 'HOT', colors: ['#0e9aa7', '#06232b'], glyphs: ['💀', '🧭', '💰', '⚓', '🦜'], names: ['Treasure', 'Anchor', 'Parrot'], blurb: 'A pirate treasure hunt with a brutal top prize.' },
    { id: 'junglepeel', name: 'Jungle Peel', provider: 'peel', math: 'medium', badge: 'NEW', colors: ['#65a30d', '#16260a'], glyphs: ['🐵', '🥥', '🍌', '🐯', '🌺'], names: ['Banana', 'Tiger', 'Flower'], blurb: 'Monkeys, bananas and a steady stream of mid-size wins.' },
    { id: 'neonsevens', name: 'Neon Sevens', provider: 'neon', math: 'low', colors: ['#c026d3', '#1a0b2e'], glyphs: ['⭐', '🎰', '7', '🔔', '🍒'], names: ['Seven', 'Bell', 'Cherry'], blurb: 'A classic fruit machine stretched across five reels.' },
    { id: 'tombofgold', name: 'Tomb of Gold', provider: 'bonecoin', math: 'high', colors: ['#ca8a04', '#2b1d05'], glyphs: ['🐍', '🏺', '👑', '🔱', '🐪'], names: ['Crown', 'Trident', 'Camel'], blurb: 'Dig through a desert tomb for the crown.' },
    { id: 'frostgems', name: 'Frost Gems', provider: 'neon', math: 'medium', badge: 'NEW', colors: ['#0ea5e9', '#082032'], glyphs: ['❄️', '🔮', '💎', '🐧', '🧊'], names: ['Diamond', 'Penguin', 'Ice'], blurb: 'Frozen gems and frequent free spins.' },
    { id: 'dragonhoard', name: 'Dragon Hoard', provider: 'peel', math: 'high', colors: ['#dc2626', '#2b0707'], glyphs: ['🐉', '🏮', '🪙', '🔥', '⚔️'], names: ['Gold coin', 'Flame', 'Swords'], blurb: 'Steal from the dragon — if the reels let you.' },
  ].forEach(make);
})();
