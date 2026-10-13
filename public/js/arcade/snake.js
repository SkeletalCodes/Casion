/* Snake — a climb-and-cash-out game. Each press sends the snake to the next apple.
   Golden apples grow the snake and the multiplier; a rotten one ends the round and the bet.
   How many apples are golden is fixed by your seed pair when you bet: each one is golden with
   chance p (set by the difficulty), and after k golden apples the multiplier is 0.98 / p^k. */
(function () {
  'use strict';
  const { $, $$, h, fmt, fmtMult, sleep, round2 } = BB;

  const N = 9, MAX = 25;
  const LEVELS = { easy: { p: 0.9, label: 'Easy' }, medium: { p: 0.75, label: 'Medium' }, hard: { p: 0.55, label: 'Hard' }, expert: { p: 0.35, label: 'Expert' } };

  let amount, diff = 'medium', state = 'idle', bet = 0, steps = 0, safe = 0, nonce = 0, alive = 0;
  let body = [], apple = -1, moving = false, doomed = false;
  const history = [];

  const p = () => LEVELS[diff].p;
  const multFor = (k, pp) => (k ? Math.floor((0.98 / Math.pow(pp, k)) * 100) / 100 : 1);
  function safeFrom(rng, pp) {
    for (let i = 0; i < MAX; i++) if (rng.float() >= pp) return i;
    return MAX;
  }

  /* ---------- board ---------- */
  const xy = (i) => [i % N, Math.floor(i / N)];
  const at = (x, y) => y * N + x;
  function freshSnake() { const c = Math.floor(N / 2); body = [at(c, c), at(c - 1, c), at(c - 2, c)]; }
  /** Shortest path from the head to `to`, not through the body (the tail end may be crossed, it moves on). */
  function path(to) {
    const head = body[0], blocked = new Set(body.slice(0, body.length - 1));
    const prev = new Map([[head, -1]]), q = [head];
    while (q.length) {
      const cur = q.shift();
      if (cur === to) break;
      const [x, y] = xy(cur);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, nxt = at(nx, ny);
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || prev.has(nxt) || blocked.has(nxt)) continue;
        prev.set(nxt, cur);
        q.push(nxt);
      }
    }
    if (!prev.has(to)) return null;
    const out = [];
    for (let c = to; c !== head; c = prev.get(c)) out.unshift(c);
    return out;
  }
  function placeApple() {
    for (let tries = 0; tries < 60; tries++) {
      const c = BB.randInt(N * N);
      if (body.indexOf(c) >= 0) continue;
      const route = path(c);
      if (route && route.length >= 2) { apple = c; return route; }
    }
    freshSnake(); // boxed in: start the snake over in the middle
    return placeApple();
  }

  function paint(dead) {
    const cells = $$('.sn-cell');
    if (!cells.length) return;
    cells.forEach((c) => { c.className = 'sn-cell'; c.style.removeProperty('--k'); });
    body.forEach((b, i) => {
      const c = cells[b];
      c.classList.add('body');
      c.style.setProperty('--k', (i / Math.max(1, body.length - 1)).toFixed(2));
      if (i === 0) c.classList.add('head', dirOf());
      if (dead) c.classList.add('dead');
    });
    if (apple >= 0 && body.indexOf(apple) < 0) cells[apple].classList.add('apple');
  }
  function dirOf() {
    if (body.length < 2) return 'r';
    const [x0, y0] = xy(body[0]), [x1, y1] = xy(body[1]);
    return x0 > x1 ? 'r' : x0 < x1 ? 'l' : y0 > y1 ? 'd' : 'u';
  }

  /* ---------- panel ---------- */
  function ui() {
    const playing = state === 'playing';
    amount.lock(playing);
    $$('#sn-diff button').forEach((b) => { b.disabled = playing; });
    const btn = $('#sn-btn'), cash = $('#sn-cash');
    btn.textContent = playing ? 'Move to the apple' : 'Bet';
    btn.disabled = moving;
    cash.hidden = !playing;
    cash.disabled = !steps || moving;
    cash.innerHTML = steps ? `Cash out <i class="coin sm"></i>${fmt(bet * multFor(steps, p()))}` : 'Cash out';
    $('#sn-cur').textContent = fmtMult(multFor(steps, p()));
    $('#sn-next').textContent = steps < MAX ? fmtMult(multFor(steps + 1, p())) : '—';
    $('#sn-chance').textContent = (p() * 100).toFixed(0) + '%';
    $('#sn-mult').textContent = fmtMult(multFor(steps, p()));
    $('#sn-len').textContent = `${steps} apple${steps === 1 ? '' : 's'}`;
    let lad = '';
    for (let k = Math.max(1, steps - 1); k <= Math.min(MAX, Math.max(1, steps - 1) + 5); k++) lad += `<div class="pm-step${k === steps ? ' on' : k < steps ? ' past' : ''}"><small>Apple ${k}</small><b>${fmtMult(multFor(k, p()))}</b></div>`;
    $('#sn-ladder').innerHTML = lad;
  }
  function paintHistory() {
    $('#sn-hist').innerHTML = history.slice(0, 12).map((r) => `<span class="hp ${r.m ? 'good' : 'bad'}">${fmtMult(r.m)}</span>`).join('') || '<span class="hp">No rounds yet</span>';
  }

  function start() {
    if (state !== 'idle') return;
    bet = amount.get();
    if (!BB.placeBet(bet)) return;
    const rng = BB.fair.roll();
    nonce = rng.nonce;
    safe = safeFrom(rng, p());
    steps = 0;
    state = 'playing';
    $('#sn-res').className = 'result-pop';
    $('.sn-board').classList.remove('over', 'won');
    freshSnake();
    placeApple();
    paint();
    ui();
  }

  async function move() {
    if (state !== 'playing' || moving) return;
    const my = alive, route = path(apple) || placeApple();
    moving = true;
    ui();
    const rotten = steps >= safe;
    doomed = rotten;
    const calm = BB.user() && BB.user().prefs.calm;
    const grow = !rotten;
    for (let i = 0; i < route.length; i++) {
      const cell = route[i];
      body.unshift(cell);
      const last = i === route.length - 1;
      if (!(last && grow && body.length <= 14)) body.pop();
      paint();
      if (i % 2 === 0) BB.sfx('tick');
      await sleep(calm ? 10 : Math.max(34, 70 - route.length * 2));
      if (my !== alive) return;
    }
    moving = false;
    doomed = false;
    if (rotten) return crash();
    steps++;
    BB.sfx('gem', steps);
    $('.sn-board').classList.remove('pop'); void $('.sn-board').offsetWidth; $('.sn-board').classList.add('pop');
    if (steps >= MAX) { cashout(); return; }
    placeApple();
    paint();
    ui();
  }

  function crash() {
    state = 'idle';
    BB.logBet('snake', bet, 0, 0, null, nonce);
    BB.sfx('bomb');
    $$('.sn-cell')[apple].classList.add('rotten');
    paint(true);
    $$('.sn-cell')[apple].classList.add('rotten');
    $('.sn-board').classList.add('over');
    const pop = $('#sn-res');
    pop.className = 'result-pop show bad';
    pop.innerHTML = `<b>Rotten apple!</b><span><i class="coin sm"></i>-${fmt(bet)}</span>`;
    history.unshift({ m: 0 });
    paintHistory();
    ui();
  }

  function cashout() {
    if (state !== 'playing' || !steps || moving) return;
    const mult = multFor(steps, p()), payout = round2(bet * mult);
    state = 'idle';
    BB.win(payout);
    BB.logBet('snake', bet, mult, payout, null, nonce);
    BB.sfx('cashout');
    $('.sn-board').classList.add('won');
    const pop = $('#sn-res');
    pop.className = 'result-pop show';
    pop.innerHTML = `<b>${fmtMult(mult)}</b><span><i class="coin sm"></i>+${fmt(payout - bet)}</span>`;
    if (mult >= 10) BB.confetti($('.sn-wrap'), 70);
    history.unshift({ m: mult });
    paintHistory();
    ui();
  }

  BB.registerGame({
    id: 'snake',
    name: 'Snake',
    cat: 'arcade',
    rtp: '98.0',
    badge: 'NEW',
    colors: ['#4ade80', '#062b14'],
    icon: '<svg viewBox="0 0 24 24"><path d="M4 18h9a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" fill="none" stroke="currentColor" stroke-width="3.200" stroke-linecap="round" stroke-linejoin="round"/><circle cx="19" cy="6" r="2.400" fill="currentColor"/></svg>',
    art: `<svg viewBox="0 0 200 200">
      <rect x="16" y="16" width="168" height="168" rx="22" fill="#0d2a18"/>
      <g fill="#123b22">${Array.from({ length: 36 }, (_, i) => ((i + Math.floor(i / 6)) % 2 ? `<rect x="${22 + (i % 6) * 26.5}" y="${22 + Math.floor(i / 6) * 26.5}" width="26.5" height="26.5"/>` : '')).join('')}</g>
      <path d="M40 150h70a24 24 0 0 0 0-48H86a24 24 0 0 1 0-48h40" fill="none" stroke="#4ade80" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M40 150h70a24 24 0 0 0 0-48H86a24 24 0 0 1 0-48h40" fill="none" stroke="#86efac" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 14" opacity=".6"/>
      <circle cx="132" cy="48" r="5" fill="#062b14"/>
      <circle cx="164" cy="54" r="14" fill="#f5c542"/><path d="M164 40c2-6 8-8 12-6" stroke="#4ade80" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="159" cy="50" r="4" fill="#fff6c4"/>
    </svg>`,
    verify(rng, fresh) {
      return Object.keys(LEVELS).map((k) => {
        const s = safeFrom(fresh(), LEVELS[k].p);
        return [LEVELS[k].label + ` (${LEVELS[k].p * 100}% golden)`, s >= MAX ? `All ${MAX} apples golden` : `Apple ${s + 1} is rotten (${s} golden first)`];
      });
    },

    mount(panel, stage) {
      state = 'idle'; steps = 0; moving = false;
      amount = BB.ui.amount();
      panel.appendChild(amount.el);
      panel.appendChild(h(`<div>
        <div class="field"><span class="field-l">Difficulty</span>${BB.ui.seg('sn-diff', Object.keys(LEVELS).map((k) => [k, LEVELS[k].label]), diff)}</div>
        <div class="row2">
          <div class="field"><span class="field-l">Multiplier</span><div class="readout" id="sn-cur">1.00×</div></div>
          <div class="field"><span class="field-l">Next apple</span><div class="readout" id="sn-next">—</div></div>
        </div>
        <div class="field"><span class="field-l">Chance the next apple is golden</span><div class="readout" id="sn-chance">—</div></div>
        <button class="btn primary lg block" id="sn-btn">Bet</button>
        <button class="btn green lg block" id="sn-cash" style="margin-top:10px" hidden>Cash out</button>
        <p class="panel-note">Bet, then press to send the snake after each apple. Golden apples raise the multiplier; one rotten apple ends the round. Cash out whenever you like — after ${MAX} apples it cashes out for you.</p>
      </div>`));
      stage.appendChild(h(`<div class="sn-wrap">
        <div class="history" id="sn-hist"></div>
        <div class="sn-top"><span id="sn-len">0 apples</span><b id="sn-mult">1.00×</b></div>
        <div class="sn-board">${'<i class="sn-cell"></i>'.repeat(N * N)}</div>
        <div class="pm-ladder" id="sn-ladder"></div>
        <div class="result-pop" id="sn-res"></div>
      </div>`));
      BB.ui.bindSeg($('#sn-diff'), (v) => { if (state === 'playing') return; diff = v; ui(); });
      $('#sn-btn').addEventListener('click', () => (state === 'playing' ? move() : start()));
      $('#sn-cash').addEventListener('click', cashout);
      $('.sn-board').addEventListener('click', () => { if (state === 'playing') move(); else BB.nudge($('#sn-btn')); });
      freshSnake();
      apple = -1;
      paint();
      ui();
      paintHistory();
    },

    unmount() {
      alive++;
      if (state === 'playing' && doomed) BB.logBet('snake', bet, 0, 0, null, nonce); // already heading for a rotten apple
      else if (state === 'playing') BB.win(bet, true); // left mid-round: return the stake
      state = 'idle';
      moving = false;
      doomed = false;
    },
  });
})();
