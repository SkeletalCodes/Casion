/* Pump — inflate the balloon. Every pump raises the multiplier; if it pops, the bet is gone.
   Think of 25 pumps in a row with M of them rigged to pop: you pump through them in order.
   The multiplier after k safe pumps is 0.98 / P(surviving k pumps). */
(function () {
  'use strict';
  const { $, $$, h, fmt, fmtMult, round2 } = BB;

  const N = 25;
  const LEVELS = { easy: { m: 1, label: 'Easy' }, medium: { m: 3, label: 'Medium' }, hard: { m: 5, label: 'Hard' }, expert: { m: 10, label: 'Expert' } };

  let amount, diff = 'medium', state = 'idle', pumps = 0, safe = 0, bet = 0, nonce = 0;

  const m = () => LEVELS[diff].m;
  function multFor(k, mm) {
    let x = 1;
    for (let i = 0; i < k; i++) x *= (N - i) / (N - mm - i);
    return Math.floor(x * 0.98 * 100) / 100;
  }
  /** How many pumps are safe: the first rigged slot among M drawn from 25. */
  function safePumps(rng, mm) {
    const pool = [];
    for (let i = 0; i < N; i++) pool.push(i);
    let first = N;
    for (let i = 0; i < mm; i++) first = Math.min(first, rng.pick(pool));
    return first;
  }
  const survive = (k) => { let x = 1; for (let i = 0; i < k; i++) x *= (N - m() - i) / (N - i); return x; };

  function paintBalloon(popAnim) {
    const b = $('#pm-balloon');
    if (!b) return;
    const s = 0.5 + 0.8 * (1 - Math.pow(0.87, pumps));
    b.style.setProperty('--s', s.toFixed(3));
    b.style.setProperty('--hue', Math.round(150 * Math.pow(survive(pumps), 0.8)));
    if (popAnim) { b.classList.remove('wob'); void b.offsetWidth; b.classList.add('wob'); }
    $('#pm-mult').textContent = fmtMult(pumps ? multFor(pumps, m()) : 1);
  }

  function paintLadder() {
    const max = N - m();
    let out = '';
    for (let k = Math.max(1, pumps - 1); k <= Math.min(max, Math.max(1, pumps - 1) + 6); k++) {
      out += `<div class="pm-step${k === pumps ? ' on' : k < pumps ? ' past' : ''}"><small>Pump ${k}</small><b>${fmtMult(multFor(k, m()))}</b></div>`;
    }
    $('#pm-ladder').innerHTML = out;
  }

  function ui() {
    const playing = state === 'playing';
    amount.lock(playing);
    $$('#pm-diff button').forEach((b) => { b.disabled = playing; });
    const btn = $('#pm-btn'), cash = $('#pm-cash');
    btn.textContent = playing ? 'Pump' : 'Bet';
    cash.hidden = !playing;
    cash.disabled = !pumps;
    cash.innerHTML = pumps ? `Cash out <i class="coin sm"></i>${fmt(bet * multFor(pumps, m()))}` : 'Cash out';
    $('#pm-cur').textContent = fmtMult(pumps ? multFor(pumps, m()) : 1);
    $('#pm-next').textContent = pumps < N - m() ? fmtMult(multFor(pumps + 1, m())) : '—';
    $('#pm-chance').textContent = pumps < N - m() ? (((N - m() - pumps) / (N - pumps)) * 100).toFixed(1) + '%' : '—';
    paintLadder();
  }

  function cashout() {
    if (state !== 'playing' || !pumps) return;
    const mult = multFor(pumps, m()), payout = round2(bet * mult);
    BB.win(payout);
    BB.logBet('pump', bet, mult, payout, null, nonce);
    BB.sfx('cashout');
    state = 'idle';
    const pop = $('#pm-res');
    pop.className = 'result-pop show';
    pop.innerHTML = `<b>${fmtMult(mult)}</b><span><i class="coin sm"></i>+${fmt(payout - bet)}</span>`;
    if (mult >= 10) BB.confetti($('.pm-wrap'), 60);
    $('#pm-balloon').classList.add('fly');
    ui();
  }

  function pump() {
    if (state !== 'playing') return;
    if (pumps >= safe) {
      state = 'idle';
      BB.logBet('pump', bet, 0, 0, null, nonce);
      BB.sfx('bomb');
      const b = $('#pm-balloon');
      b.classList.add('popped');
      const burst = $('#pm-burst');
      burst.classList.remove('go'); void burst.offsetWidth; burst.classList.add('go');
      const pop = $('#pm-res');
      pop.className = 'result-pop show bad';
      pop.innerHTML = `<b>Pop!</b><span><i class="coin sm"></i>-${fmt(bet)}</span>`;
      $('#pm-mult').textContent = 'Popped';
      ui();
      return;
    }
    pumps++;
    BB.sfx('gem', pumps);
    paintBalloon(true);
    if (pumps === N - m()) cashout(); else ui();
  }

  function start() {
    if (state !== 'idle') return;
    bet = amount.get();
    if (!BB.placeBet(bet)) return;
    const rng = BB.fair.roll();
    nonce = rng.nonce;
    safe = safePumps(rng, m());
    pumps = 0;
    state = 'playing';
    const b = $('#pm-balloon');
    b.className = 'pm-balloon';
    $('#pm-burst').classList.remove('go');
    $('#pm-res').className = 'result-pop';
    paintBalloon(false);
    ui();
  }

  BB.registerGame({
    id: 'pump',
    name: 'Pump',
    cat: 'cashout',
    rtp: '98.0',
    badge: 'NEW',
    colors: ['#f59e0b', '#3d2204'],
    icon: '<svg viewBox="0 0 24 24"><path d="M12 2.500c4 0 6.500 3 6.500 6.800 0 4-3 7.200-6.500 7.200S5.500 13.300 5.500 9.300C5.500 5.500 8 2.500 12 2.500z" fill="currentColor"/><path d="M12 16.500l-1.500 2h3zM12 18.500c-2 1.200 1.500 1.800 0 3.200" fill="none" stroke="currentColor" stroke-width="1.600" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    art: `<svg viewBox="0 0 200 200">
      <path d="M100 150c-10 14 12 18 0 36" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".7"/>
      <path d="M100 16c38 0 62 28 62 64 0 38-28 68-62 68s-62-30-62-68c0-36 24-64 62-64z" fill="#ff4d67"/>
      <path d="M100 16c38 0 62 28 62 64 0 38-28 68-62 68 30-14 44-38 44-68 0-30-16-54-44-64z" fill="#c81f3f" opacity=".7"/>
      <ellipse cx="74" cy="56" rx="14" ry="22" fill="#fff" opacity=".4" transform="rotate(24 74 56)"/>
      <path d="M100 146l-11 14h22z" fill="#c81f3f"/>
      <text x="100" y="100" font-size="34" font-weight="800" text-anchor="middle" fill="#fff" font-family="Outfit,Arial,sans-serif">×</text>
    </svg>`,
    verify(rng, fresh) {
      return Object.keys(LEVELS).map((k) => {
        const s = safePumps(fresh(), LEVELS[k].m), max = N - LEVELS[k].m;
        return [LEVELS[k].label + ' (' + LEVELS[k].m + ' in 25)', s >= max ? `Never pops — all ${max} pumps are safe` : `Pops on pump ${s + 1} (${s} safe)`];
      });
    },

    mount(panel, stage) {
      state = 'idle'; pumps = 0;
      amount = BB.ui.amount();
      panel.appendChild(amount.el);
      panel.appendChild(h(`<div>
        <div class="field"><span class="field-l">Difficulty</span>${BB.ui.seg('pm-diff', Object.keys(LEVELS).map((k) => [k, LEVELS[k].label]), diff)}</div>
        <div class="row2">
          <div class="field"><span class="field-l">Multiplier</span><div class="readout" id="pm-cur">1.00×</div></div>
          <div class="field"><span class="field-l">Next pump</span><div class="readout" id="pm-next">—</div></div>
        </div>
        <div class="field"><span class="field-l">Chance the next pump is safe</span><div class="readout" id="pm-chance">—</div></div>
        <button class="btn primary lg block" id="pm-btn">Bet</button>
        <button class="btn green lg block" id="pm-cash" style="margin-top:10px" hidden>Cash out</button>
        <p class="panel-note">Easy rigs 1 pump in 25, Medium 3, Hard 5 and Expert 10. The balloon turns from green to red as the odds of having survived this long shrink.</p>
      </div>`));
      stage.appendChild(h(`<div class="pm-wrap">
        <div class="pm-arena">
          <div class="pm-burst" id="pm-burst">${'<i></i>'.repeat(12)}</div>
          <div class="pm-balloon" id="pm-balloon">
            <svg viewBox="0 0 200 250"><path d="M100 196c-12 16 14 22 0 44" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="3" stroke-linecap="round"/>
              <path class="pm-body" d="M100 8c50 0 82 38 82 86 0 52-38 92-82 92S18 146 18 94C18 46 50 8 100 8z"/>
              <path d="M100 8c50 0 82 38 82 86 0 52-38 92-82 92 40-18 58-52 58-92 0-40-20-72-58-86z" fill="#000" opacity=".16"/>
              <ellipse cx="64" cy="62" rx="18" ry="30" fill="#fff" opacity=".35" transform="rotate(24 64 62)"/>
              <path class="pm-body" d="M100 184l-13 16h26z"/></svg>
            <b id="pm-mult">1.00×</b>
          </div>
        </div>
        <div class="pm-ladder" id="pm-ladder"></div>
        <div class="result-pop" id="pm-res"></div>
      </div>`));
      BB.ui.bindSeg($('#pm-diff'), (v) => { if (state === 'playing') return; diff = v; ui(); });
      $('#pm-btn').addEventListener('click', () => (state === 'playing' ? pump() : start()));
      $('#pm-cash').addEventListener('click', cashout);
      $('#pm-balloon').addEventListener('click', () => { if (state === 'playing') pump(); else BB.nudge($('#pm-btn')); });
      paintBalloon(false);
      ui();
    },

    unmount() {
      if (state === 'playing') BB.win(bet, true); // left mid-round: return the stake
      state = 'idle';
    },
  });
})();
