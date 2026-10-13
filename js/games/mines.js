/* Mines — 5x5 grid. Each gem multiplies the payout; one mine ends the round.
   Click a tile, or hold and drag across tiles to reveal them quickly. */
(function () {
  'use strict';
  const { $, $$, h, fmt, fmtMult, randInt, round2 } = BB;

  const N = 25;
  const GEM = '<svg viewBox="0 0 48 48"><path d="M24 5L43 19L24 44L5 19Z" fill="#2fe08a"/><path d="M24 5L33 19H15Z" fill="#a5f7cf"/><path d="M5 19H15L24 44Z" fill="#1fb96d"/><path d="M43 19H33L24 44Z" fill="#149454"/><path d="M15 19H33L24 44Z" fill="#3df29a"/><path d="M5 19L24 5L15 19Z" fill="#5cf0ac"/><path d="M43 19L24 5L33 19Z" fill="#22c479"/></svg>';
  const BOMB = '<svg viewBox="0 0 48 48"><path d="M31 15l5-6" stroke="#b9c0d1" stroke-width="4" stroke-linecap="round"/><path d="M38 7l2.500-4M39 8l5-1.500M36.500 6l-1-4.500" stroke="#ffc93c" stroke-width="2.600" stroke-linecap="round"/><circle cx="22" cy="28" r="15.500" fill="#161922"/><circle cx="22" cy="28" r="13" fill="#2a2f3d"/><ellipse cx="16.500" cy="22" rx="4.500" ry="3" fill="#fff" opacity=".28" transform="rotate(-35 16.500 22)"/></svg>';

  const RISK = [[3, 'Low'], [5, 'Medium'], [10, 'High'], [20, 'Extreme']]; // mine-count presets

  let amount, state = 'idle', mines = new Set(), revealed = new Set(), bet = 0, count = 3, nonce = 0, dragging = false;

  function multFor(k, m) {
    let x = 1;
    for (let i = 0; i < k; i++) x *= (N - i) / (N - m - i);
    return Math.floor(x * 0.99 * 100) / 100;
  }

  /** Mine positions come off the bet's number stream: the first `m` picks from the 25 tiles. */
  function layout(rng, m) {
    const pool = [];
    for (let i = 0; i < N; i++) pool.push(i);
    const out = [];
    for (let i = 0; i < m; i++) out.push(rng.pick(pool));
    return out;
  }

  function ui() {
    const playing = state === 'playing', k = revealed.size;
    amount.lock(playing);
    $('#mn-count').disabled = playing;
    $$('#mn-risk button').forEach((b) => { b.disabled = playing; });
    BB.ui.setSeg($('#mn-risk'), count);
    $('#mn-first').innerHTML = `First tile is safe <b>${(((N - count) / N) * 100).toFixed(0)}%</b> of the time and pays <b>${fmtMult(multFor(1, count))}</b>`;
    const btn = $('#mn-btn');
    if (playing) {
      btn.className = 'btn green lg block';
      btn.disabled = k === 0;
      btn.innerHTML = k ? `Cash out <i class="coin sm"></i>${fmt(bet * multFor(k, count))}` : 'Pick a tile';
    } else {
      btn.className = 'btn primary lg block'; btn.disabled = false; btn.textContent = 'Bet';
    }
    $('#mn-rand').hidden = !playing;
    $('#mn-mult').textContent = fmtMult(k ? multFor(k, count) : 1);
    $('#mn-next').textContent = playing && k < N - count ? fmtMult(multFor(k + 1, count)) : '—';
    $('.mn-grid').classList.toggle('live', playing);
  }

  function finish(won, mult, payout) {
    state = 'idle'; dragging = false;
    $$('.mn-tile').forEach((t, i) => {
      if (t.classList.contains('open')) return;
      t.classList.add('open', 'dim', mines.has(i) ? 'bomb' : 'gem');
      t.innerHTML = mines.has(i) ? BOMB : GEM;
    });
    if (won) {
      const pop = $('#mn-res');
      pop.className = 'result-pop show';
      pop.innerHTML = `<b>${fmtMult(mult)}</b><span><i class="coin sm"></i>+${fmt(payout - bet)}</span>`;
    }
    ui();
  }

  function cashout() {
    if (state !== 'playing' || !revealed.size) return;
    const mult = multFor(revealed.size, count), payout = round2(bet * mult);
    BB.win(payout);
    BB.logBet('mines', bet, mult, payout, null, nonce);
    BB.sfx('cashout');
    finish(true, mult, payout);
  }

  function pick(i) {
    if (state !== 'playing' || revealed.has(i)) return;
    const t = $$('.mn-tile')[i];
    if (mines.has(i)) {
      t.classList.add('open', 'bomb', 'boom');
      t.innerHTML = BOMB;
      BB.logBet('mines', bet, 0, 0, null, nonce);
      BB.sfx('bomb');
      $('.mn-grid').classList.add('shake');
      setTimeout(() => { const g = $('.mn-grid'); if (g) g.classList.remove('shake'); }, 450);
      finish(false);
      return;
    }
    revealed.add(i);
    t.classList.add('open', 'gem');
    t.innerHTML = GEM;
    BB.sfx('gem', revealed.size);
    if (revealed.size === N - count) cashout(); else ui();
  }

  function start() {
    if (state !== 'idle') return;
    bet = amount.get();
    if (!BB.placeBet(bet)) return;
    count = Number($('#mn-count').value);
    const rng = BB.fair.roll();
    nonce = rng.nonce;
    mines = new Set(layout(rng, count));
    revealed = new Set();
    $$('.mn-tile').forEach((t) => { t.className = 'mn-tile'; t.innerHTML = ''; });
    $('#mn-res').className = 'result-pop';
    state = 'playing';
    ui();
  }

  /* Drag-select: pointerdown reveals a tile, and any tile the pointer crosses while held is revealed too. */
  const tileAt = (e) => { const el = document.elementFromPoint(e.clientX, e.clientY); return el && el.closest ? el.closest('.mn-tile') : null; };
  const onMove = (e) => { if (!dragging) return; const t = tileAt(e); if (t) pick(Number(t.dataset.i)); };
  const onUp = () => { dragging = false; };

  BB.registerGame({
    id: 'mines',
    name: 'Mines',
    rtp: '99.0',
    colors: ['#2f86ee', '#0b1f45'],
    icon: '<svg viewBox="0 0 24 24"><path d="M12 3l8.500 6.500L12 21 3.500 9.500z" fill="currentColor"/></svg>',
    art: `<svg viewBox="0 0 200 200">
      <g transform="translate(22 30) scale(2.500)">${GEM.replace(/<\/?svg[^>]*>/g, '')}</g>
      <g transform="translate(96 92) scale(2)">${BOMB.replace(/<\/?svg[^>]*>/g, '')}</g>
    </svg>`,
    verify(rng) {
      return [['Mine order (tiles 1-25)', layout(rng, 24).map((i) => i + 1).join(', ')], ['How to read it', 'An N-mine game uses the first N tiles in this list']];
    },

    mount(panel, stage) {
      state = 'idle'; revealed = new Set(); mines = new Set(); dragging = false;
      amount = BB.ui.amount();
      panel.appendChild(amount.el);
      let opts = '';
      for (let i = 1; i <= 24; i++) opts += `<option value="${i}"${i === count ? ' selected' : ''}>${i}</option>`;
      panel.appendChild(h(`<div>
        <div class="field"><span class="field-l">Risk</span>${BB.ui.seg('mn-risk', RISK, count)}</div>
        <label class="field"><span class="field-l">Mines</span><select id="mn-count">${opts}</select></label>
        <p class="risk-note" id="mn-first"></p>
        <div class="row2">
          <div class="field"><span class="field-l">Multiplier</span><div class="readout" id="mn-mult">1.00×</div></div>
          <div class="field"><span class="field-l">Next gem</span><div class="readout" id="mn-next">—</div></div>
        </div>
        <button class="btn primary lg block" id="mn-btn">Bet</button>
        <button class="btn ghost block" id="mn-rand" style="margin-top:10px" hidden>Pick random tile</button>
        <p class="panel-note">Tap tiles one at a time, or <b>hold and drag</b> across the grid to reveal a run of them fast. Cash out any time after your first gem.</p>
      </div>`));
      let tiles = '';
      for (let i = 0; i < N; i++) tiles += `<button class="mn-tile" data-i="${i}" aria-label="Tile ${i + 1}"></button>`;
      stage.appendChild(h(`<div class="mn-wrap"><div class="mn-grid">${tiles}</div><div class="result-pop" id="mn-res"></div></div>`));

      const grid = $('.mn-grid');
      grid.addEventListener('pointerdown', (e) => {
        const t = e.target.closest('.mn-tile');
        if (!t) return;
        if (state !== 'playing') { BB.nudge($('#mn-btn')); return; }
        e.preventDefault();
        dragging = true;
        pick(Number(t.dataset.i));
      });
      // Keyboard activation (Enter/Space) arrives as a click with no pointer behind it.
      grid.addEventListener('click', (e) => {
        if (e.detail !== 0) return;
        const t = e.target.closest('.mn-tile');
        if (t) pick(Number(t.dataset.i));
      });
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);

      $('#mn-btn').addEventListener('click', () => (state === 'playing' ? cashout() : start()));
      $('#mn-rand').addEventListener('click', () => {
        const free = [];
        for (let i = 0; i < N; i++) if (!revealed.has(i)) free.push(i);
        if (free.length) pick(free[randInt(free.length)]);
      });
      $('#mn-count').addEventListener('change', (e) => { count = Number(e.target.value); ui(); });
      BB.ui.bindSeg($('#mn-risk'), (v) => { if (state === 'playing') return; count = Number(v); $('#mn-count').value = count; ui(); });
      ui();
    },

    unmount() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (state === 'playing') BB.win(bet, true); // left mid-round: return the stake
      state = 'idle'; dragging = false;
    },
  });
})();
