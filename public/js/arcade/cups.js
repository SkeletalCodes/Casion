/* Cups — the shell game. A ball goes under one cup, the cups shuffle, you pick one.
   Where the ball ends up is fixed by your seed pair the moment you bet; the shuffle is just the show.
   Pays 0.98 × the number of cups: 2.94× with three, 4.90× with five. */
(function () {
  'use strict';
  const { $, $$, h, fmt, sleep, round2 } = BB;

  const MODES = { 3: { label: '3 cups', mult: 2.94 }, 5: { label: '5 cups', mult: 4.9 } };
  let amount, n = 3, state = 'idle', bet = 0, ball = 0, nonce = 0, alive = 0, pending = null;
  const history = [];
  const ballFrom = (rng, cups) => rng.int(cups);

  const CUP = `<svg viewBox="0 0 100 110"><defs><linearGradient id="cupg" x1="0" x2="1"><stop offset="0" stop-color="#7a1fd1"/><stop offset=".45" stop-color="#b35cff"/><stop offset="1" stop-color="#5a1499"/></linearGradient></defs>
    <path d="M22 12h56l14 86H8z" fill="url(#cupg)"/><rect x="4" y="94" width="92" height="12" rx="6" fill="#4a0f80"/><rect x="18" y="6" width="64" height="10" rx="5" fill="#c98cff"/>
    <path d="M14 70h72" stroke="#f5c542" stroke-width="5"/><path d="M17 52h66" stroke="#f5c542" stroke-width="2.500" opacity=".7"/><ellipse cx="36" cy="40" rx="6" ry="20" fill="#fff" opacity=".18"/></svg>`;

  function slots() {
    return $$('.cu-cup').sort((a, b) => Number(a.dataset.pos) - Number(b.dataset.pos));
  }
  function place() {
    $$('.cu-cup').forEach((c) => { c.style.setProperty('--s', Number(c.dataset.pos) - (n - 1) / 2); });
  }

  function build() {
    const row = $('#cu-row');
    row.innerHTML = Array.from({ length: n }, (_, i) => `<button type="button" class="cu-cup" data-i="${i}" data-pos="${i}" aria-label="Cup ${i + 1}"><span class="cu-shell">${CUP}</span></button>`).join('') + '<i class="cu-ball" id="cu-ball"></i>';
    row.classList.toggle('five', n === 5);
    place();
  }

  function ui() {
    const picking = state === 'pick' || state === 'shuffle';
    amount.lock(picking);
    $$('#cu-mode button').forEach((b) => { b.disabled = picking; });
    $('#cu-go').disabled = picking;
    $('#cu-go').textContent = picking ? (state === 'shuffle' ? 'Shuffling…' : 'Pick a cup') : 'Bet';
    $('#cu-mult').textContent = MODES[n].mult.toFixed(2) + '×';
    $('#cu-chance').textContent = (100 / n).toFixed(2) + '%';
    $('#cu-profit').textContent = fmt(amount.get() * (MODES[n].mult - 1));
    $('#cu-row').classList.toggle('picking', state === 'pick');
  }
  function paintHistory() {
    $('#cu-hist').innerHTML = history.slice(0, 12).map((r) => `<span class="hp ${r.won ? 'good' : 'bad'}">${r.won ? MODES[r.n].mult.toFixed(2) + '×' : '0.00×'}</span>`).join('') || '<span class="hp">No rounds yet</span>';
  }

  /** Drop the ball under the middle cup, lower the cups, swap them around for a while. */
  async function start() {
    if (state !== 'idle') return;
    bet = amount.get();
    if (!BB.placeBet(bet)) return;
    const my = ++alive, rng = BB.fair.roll();
    nonce = rng.nonce;
    ball = ballFrom(rng, n);
    state = 'shuffle';
    build();
    ui();
    $('#cu-res').className = 'result-pop';
    $('#cu-say').textContent = 'Watch the ball…';
    const row = $('#cu-row'), b = $('#cu-ball'), cups = slots(), mid = Math.floor(n / 2);
    b.style.setProperty('--s', 0);
    row.classList.add('show-ball');
    cups[mid].classList.add('up');
    await sleep(500);
    if (my !== alive) return;
    cups[mid].classList.remove('up');
    BB.sfx('card');
    await sleep(350);
    if (my !== alive) return;
    row.classList.remove('show-ball');
    // swap pairs of cups (cosmetic)
    const calm = BB.user() && BB.user().prefs.calm;
    const swaps = calm ? 3 : n === 3 ? 7 : 9;
    row.classList.add('shuffling');
    for (let s = 0; s < swaps; s++) {
      const list = slots(), a = BB.randInt(n);
      let c = BB.randInt(n - 1); if (c >= a) c++;
      const pa = list[a].dataset.pos;
      list[a].dataset.pos = list[c].dataset.pos;
      list[c].dataset.pos = pa;
      list[a].classList.toggle('lift', s % 2 === 0); list[c].classList.toggle('lift', s % 2 === 1);
      place();
      BB.sfx('tick');
      await sleep(calm ? 120 : Math.max(170, 330 - s * 18));
      if (my !== alive) return;
    }
    $$('.cu-cup').forEach((x) => x.classList.remove('lift'));
    row.classList.remove('shuffling');
    state = 'pick';
    $('#cu-say').textContent = 'Which cup is it under?';
    ui();
  }

  function settle(quiet) {
    if (!pending) return;
    const p = pending;
    pending = null;
    if (p.payout) BB.win(p.payout, quiet);
    BB.logBet('cups', p.bet, p.mult, p.payout, null, p.nonce);
  }

  async function choose(cupEl) {
    if (state !== 'pick') return;
    state = 'reveal';
    const my = alive;
    const chosen = Number(cupEl.dataset.pos), won = chosen === ball;
    const mult = won ? MODES[n].mult : 0, payout = round2(bet * mult);
    pending = { bet, mult, payout, nonce };
    // the ball sits at the winning position; show it under that slot
    const b = $('#cu-ball');
    b.style.setProperty('--s', ball - (n - 1) / 2);
    $('#cu-row').classList.add('show-ball');
    cupEl.classList.add('up', won ? 'won' : 'lost');
    BB.sfx('card');
    await sleep(420);
    if (my !== alive) return;
    if (!won) { const right = slots()[ball]; right.classList.add('up', 'reveal'); }
    settle(false);
    BB.sfx(won ? 'win' : 'lose');
    const pop = $('#cu-res');
    pop.className = 'result-pop show' + (won ? '' : ' bad');
    pop.innerHTML = won ? `<b>${MODES[n].mult.toFixed(2)}×</b><span><i class="coin sm"></i>+${fmt(payout - bet)}</span>` : `<b>Empty</b><span><i class="coin sm"></i>-${fmt(bet)}</span>`;
    $('#cu-say').textContent = won ? 'Found it!' : `It was under cup ${ball + 1}.`;
    history.unshift({ won, n });
    paintHistory();
    state = 'idle';
    ui();
  }

  BB.registerGame({
    id: 'cups',
    name: 'Cups',
    cat: 'arcade',
    rtp: '98.0',
    badge: 'NEW',
    colors: ['#c084fc', '#2e0b52'],
    icon: '<svg viewBox="0 0 24 24"><path d="M6 4.500h12l2.500 15h-17z" fill="currentColor"/><rect x="2.500" y="18.500" width="19" height="3" rx="1.500" fill="currentColor"/></svg>',
    art: `<svg viewBox="0 0 200 200">
      <ellipse cx="100" cy="168" rx="86" ry="14" fill="#000" opacity=".3"/>
      <g transform="translate(10 66) scale(.62)">${CUP}</g>
      <g transform="translate(130 66) scale(.62)">${CUP}</g>
      <g transform="translate(64 28) scale(.72) rotate(-14 50 55)">${CUP}</g>
      <circle cx="104" cy="150" r="15" fill="#f5c542"/><circle cx="99" cy="145" r="5" fill="#fff6c4"/>
    </svg>`,
    verify(rng, fresh) {
      return Object.keys(MODES).map((k) => [MODES[k].label, 'Ball under cup ' + (ballFrom(fresh(), Number(k)) + 1)]);
    },

    mount(panel, stage) {
      state = 'idle';
      amount = BB.ui.amount();
      panel.appendChild(amount.el);
      panel.appendChild(h(`<div>
        <div class="field"><span class="field-l">Cups</span>${BB.ui.seg('cu-mode', Object.keys(MODES).map((k) => [k, MODES[k].label]), n)}</div>
        <div class="row2">
          <div class="field"><span class="field-l">Payout</span><div class="readout" id="cu-mult"></div></div>
          <div class="field"><span class="field-l">Win chance</span><div class="readout" id="cu-chance"></div></div>
        </div>
        <div class="field"><span class="field-l">Profit on win</span><div class="readout"><i class="coin"></i><span id="cu-profit">0.00</span></div></div>
        <button class="btn primary lg block" id="cu-go">Bet</button>
        <p class="panel-note">Bet, watch the ball go under a cup and the cups shuffle, then click the one you think hides it. The ball's final cup is set by your seed pair when you bet.</p>
      </div>`));
      stage.appendChild(h(`<div class="cu-wrap">
        <div class="history" id="cu-hist"></div>
        <p class="cu-say" id="cu-say">Place a bet to start</p>
        <div class="cu-table"><div class="cu-row" id="cu-row"></div></div>
        <div class="result-pop" id="cu-res"></div>
      </div>`));
      BB.ui.bindSeg($('#cu-mode'), (v) => { if (state !== 'idle') return; n = Number(v); build(); ui(); });
      $('#cu-go').addEventListener('click', start);
      $('#cu-row').addEventListener('click', (e) => { const c = e.target.closest('.cu-cup'); if (c) { if (state === 'pick') choose(c); else if (state === 'idle') BB.nudge($('#cu-go')); } });
      amount.onChange(ui);
      build();
      ui();
      paintHistory();
    },

    unmount() {
      alive++;
      if (state === 'shuffle' || state === 'pick') BB.win(bet, true); // left before picking: return the stake
      settle(true); // a cup was already picked: pay it out
      state = 'idle';
    },
  });
})();
