/* Roulette — European single-zero wheel. The wheel stays put; the ball circles the track and drops
   into the winning pocket. Straight 35:1, dozens/columns 2:1, outside bets 1:1. */
(function () {
  'use strict';
  const { $, $$, h, fmt, sleep, round2 } = BB;

  const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const SEG = 360 / 37;
  const SPIN_MS = 6000, DROP_AT = 3900;
  const CHIPS = [[10, '#56688f'], [50, '#22a268'], [100, '#2d7be0'], [500, '#8f55e0'], [1000, '#e0832a'], [5000, '#dc3350']];
  const colorOf = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');

  let bets = {}, undo = [], chip = 100, spinning = false, alive = 0, ballRot = 0, pending = null, ticks = [];
  const history = [];

  const sum = () => Object.values(bets).reduce((a, b) => a + b, 0);
  const short = (n) => (n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k' : String(n));

  function wins(key, n) {
    if (key[0] === 'n') return Number(key.slice(2)) === n;
    if (n === 0) return false;
    switch (key) {
      case 'red': return REDS.has(n);
      case 'black': return !REDS.has(n);
      case 'even': return n % 2 === 0;
      case 'odd': return n % 2 === 1;
      case 'low': return n <= 18;
      case 'high': return n >= 19;
      case 'doz1': return n <= 12;
      case 'doz2': return n > 12 && n <= 24;
      case 'doz3': return n > 24;
      case 'col1': return n % 3 === 1;
      case 'col2': return n % 3 === 2;
      case 'col3': return n % 3 === 0;
    }
    return false;
  }
  const pays = (key) => (key[0] === 'n' ? 36 : /^(doz|col)/.test(key) ? 3 : 2);

  function drawWheel(cv) {
    const S = 340, dpr = Math.min(2, window.devicePixelRatio || 1), cx = S / 2, cy = S / 2, seg = (Math.PI * 2) / 37;
    cv.width = S * dpr; cv.height = S * dpr;
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    let g = c.createRadialGradient(cx, cy, 138, cx, cy, 170);
    g.addColorStop(0, '#5c3f17'); g.addColorStop(.55, '#e2bd66'); g.addColorStop(1, '#7a5520');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, 170, 0, 7); c.fill();
    c.fillStyle = '#120c05'; c.beginPath(); c.arc(cx, cy, 153, 0, 7); c.fill();
    g = c.createRadialGradient(cx, cy, 137, cx, cy, 152);
    g.addColorStop(0, '#3a2a14'); g.addColorStop(1, '#1f1609');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, 151, 0, 7); c.fill();
    for (let i = 0; i < 37; i++) {
      const a0 = -Math.PI / 2 + (i - .5) * seg;
      c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, 137, a0, a0 + seg); c.closePath();
      c.fillStyle = ORDER[i] === 0 ? '#1fae6a' : REDS.has(ORDER[i]) ? '#d02c47' : '#191c26';
      c.fill();
      c.strokeStyle = 'rgba(231,196,102,.6)'; c.lineWidth = 1; c.stroke();
    }
    c.fillStyle = '#fff'; c.font = '700 13px Outfit, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let i = 0; i < 37; i++) {
      c.save(); c.translate(cx, cy); c.rotate(i * seg); c.fillText(String(ORDER[i]), 0, -122); c.restore();
    }
    c.strokeStyle = 'rgba(231,196,102,.55)'; c.lineWidth = 1.5; c.beginPath(); c.arc(cx, cy, 108, 0, 7); c.stroke();
    c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.arc(cx, cy, 108, 0, 7); c.arc(cx, cy, 90, 0, 7, true); c.fill();
    g = c.createRadialGradient(cx - 24, cy - 24, 8, cx, cy, 92);
    g.addColorStop(0, '#6a4a1c'); g.addColorStop(1, '#1f1407');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, 90, 0, 7); c.fill();
    c.strokeStyle = '#d9b25a'; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, 90, 0, 7); c.stroke();
    c.strokeStyle = 'rgba(217,178,90,.5)'; c.lineWidth = 5; c.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * 54, cy + Math.sin(a) * 54); c.lineTo(cx + Math.cos(a) * 82, cy + Math.sin(a) * 82); c.stroke();
    }
  }

  function boardHTML() {
    let cells = `<div class="rl-cell green zero" data-k="n:0">0</div>`;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 12; c++) {
        const n = 3 * (c + 1) - r;
        cells += `<div class="rl-cell ${colorOf(n)}" data-k="n:${n}">${n}</div>`;
      }
      cells += `<div class="rl-cell out" data-k="col${3 - r}">2:1</div>`;
    }
    cells += `<div class="rl-cell out s4 c2" data-k="doz1">1 to 12</div><div class="rl-cell out s4" data-k="doz2">13 to 24</div><div class="rl-cell out s4" data-k="doz3">25 to 36</div>`;
    cells += `<div class="rl-cell out s2 c2" data-k="low">1-18</div><div class="rl-cell out s2" data-k="even">Even</div><div class="rl-cell red s2" data-k="red">Red</div><div class="rl-cell black s2" data-k="black">Black</div><div class="rl-cell out s2" data-k="odd">Odd</div><div class="rl-cell out s2" data-k="high">19-36</div>`;
    return cells;
  }

  function paintBets() {
    $$('.rl-cell').forEach((cell) => {
      const v = bets[cell.dataset.k];
      let b = $('.rl-chip', cell);
      if (!v) { if (b) b.remove(); return; }
      if (!b) { b = h('<span class="rl-chip"></span>'); cell.appendChild(b); }
      b.textContent = short(v);
    });
    $('#rl-total').textContent = fmt(sum());
  }

  function ui() {
    $('#rl-spin').disabled = spinning;
    $('#rl-undo').disabled = spinning || !undo.length;
    $('#rl-clear').disabled = spinning || !sum();
    $('.rl-board').classList.toggle('locked', spinning);
  }

  function paintHistory() {
    $('#rl-hist').innerHTML = history.slice(0, 12).map((n) => `<span class="rl-h ${colorOf(n)}">${n}</span>`).join('') || '<span class="rl-none">No spins yet</span>';
  }

  function place(key) {
    if (spinning) return;
    if (!BB.isAuthed()) { BB.openAuth('login'); return; }
    if (sum() + chip > BB.balance()) { BB.toast('Not enough balance for that chip.', 'err'); return; }
    bets[key] = (bets[key] || 0) + chip;
    undo.push([key, chip]);
    BB.sfx('click');
    paintBets(); ui();
  }

  function clearTicks() { ticks.forEach(clearTimeout); ticks = []; }

  /* Clicks as the ball passes pockets: fast at first, slowing as it loses speed. */
  function scheduleTicks() {
    clearTicks();
    let t = 60, gap = 46;
    while (t < SPIN_MS - 250) {
      const vol = Math.max(0.35, 1 - t / SPIN_MS);
      ticks.push(setTimeout(() => BB.sfx('tick', vol), t));
      gap *= 1.07;
      t += gap;
    }
  }

  async function spin() {
    if (spinning) return;
    const total = sum();
    if (total <= 0) { BB.toast('Place a chip on the table first.', 'err'); BB.nudge($('.rl-board')); return; }
    if (!BB.placeBet(total)) return;
    const my = ++alive;
    const rng = BB.fair.roll();
    spinning = true;
    $$('.rl-cell.hit').forEach((c) => c.classList.remove('hit'));
    $('#rl-hub').className = 'rl-hub';
    $('#rl-msg').className = 'rl-msg';
    $('#rl-win').className = 'rl-win';
    ui();

    const n = rng.int(37);
    const idx = ORDER.indexOf(n);
    let payout = 0;
    for (const k in bets) if (wins(k, n)) payout += bets[k] * pays(k);
    payout = round2(payout);
    pending = { total, payout, nonce: rng.nonce };
    const delta = (((idx * SEG - ballRot) % 360) + 360) % 360;
    ballRot += 360 * 6 + delta;
    const ball = $('#rl-ball');
    ball.classList.add('rolling');
    $('#rl-orbit').style.transform = `rotate(${ballRot}deg)`;
    scheduleTicks();
    await sleep(DROP_AT); if (my !== alive) return;
    ball.classList.remove('rolling');
    await sleep(SPIN_MS - DROP_AT + 250); if (my !== alive) return;

    pending = null;
    BB.win(payout);
    BB.logBet('roulette', total, round2(payout / total), payout, null, rng.nonce);
    BB.sfx(payout > total ? 'win' : payout > 0 ? 'push' : 'lose');
    history.unshift(n);
    paintHistory();
    const hub = $('#rl-hub');
    hub.textContent = n;
    hub.className = 'rl-hub show ' + colorOf(n);
    const w = $('#rl-win');
    w.style.setProperty('--a', idx * SEG + 'deg');
    w.className = 'rl-win show';
    const cell = $(`.rl-cell[data-k="n:${n}"]`);
    if (cell) cell.classList.add('hit');
    const msg = $('#rl-msg');
    msg.className = 'rl-msg show ' + (payout > 0 ? 'good' : 'bad');
    msg.innerHTML = payout > 0
      ? `<b>${n} ${colorOf(n)}</b> — you won <i class="coin sm"></i>${fmt(payout)}`
      : `<b>${n} ${colorOf(n)}</b> — no win this spin`;
    spinning = false;
    ui();
  }

  function wheelArt() {
    let s = '';
    const R = 86, r = 54, cx = 100, cy = 100;
    const p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(1)} ${(cy + rad * Math.sin(a)).toFixed(1)}`;
    for (let i = 0; i < 37; i++) {
      const a0 = (i / 37) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1) / 37) * 2 * Math.PI - Math.PI / 2;
      const col = i === 0 ? '#1fae6a' : i % 2 ? '#d02c47' : '#191c26';
      s += `<path d="M${p(R, a0)}A${R} ${R} 0 0 1 ${p(R, a1)}L${p(r, a1)}A${r} ${r} 0 0 0 ${p(r, a0)}Z" fill="${col}" stroke="#e2bd66" stroke-width=".6"/>`;
    }
    return `<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="97" fill="#e2bd66"/><circle cx="100" cy="100" r="91" fill="#2a1e0e"/>${s}
      <circle cx="100" cy="100" r="54" fill="#e2bd66"/><circle cx="100" cy="100" r="50" fill="#3a280f"/>
      <path d="M100 62v76M62 100h76" stroke="#e2bd66" stroke-width="5" stroke-linecap="round"/><circle cx="100" cy="100" r="13" fill="#f3d98c"/>
      <circle cx="147" cy="50" r="8" fill="#fff"/></svg>`;
  }

  BB.registerGame({
    id: 'roulette',
    name: 'Roulette',
    rtp: '97.3',
    colors: ['#d8344f', '#3a0d18'],
    icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.400"/><circle cx="12" cy="12" r="2.600" fill="currentColor"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    art: wheelArt(),
    verify(rng) { const n = rng.int(37); return [['Winning number', `${n} (${colorOf(n)})`]]; },

    mount(panel, stage) {
      spinning = false;
      panel.appendChild(h(`<div>
        <div class="field">
          <span class="field-l">Chip value</span>
          <div class="rl-chips">${CHIPS.map(([v, c]) => `<button class="chipbtn${v === chip ? ' on' : ''}" data-v="${v}" style="--cc:${c}">${short(v)}</button>`).join('')}</div>
        </div>
        <div class="field">
          <span class="field-l">Total bet</span>
          <div class="readout"><i class="coin"></i><span id="rl-total">0.00</span></div>
        </div>
        <button class="btn primary lg block" id="rl-spin">Spin</button>
        <div class="row2" style="margin-top:10px">
          <button class="btn ghost" id="rl-undo">Undo</button>
          <button class="btn ghost" id="rl-clear">Clear</button>
        </div>
        <p class="panel-note">Pick a chip, then click the table to stack bets. Right-click a spot to take its chips back. Bets stay down after each spin.</p>
      </div>`));

      stage.classList.add('rl-stage');
      stage.appendChild(h(`<div class="rl-wrap">
        <div class="rl-top">
          <div class="rl-wheelbox">
            <canvas id="rl-wheel" class="rl-wheel"></canvas>
            <div class="rl-win" id="rl-win"></div>
            <div class="rl-orbit" id="rl-orbit" style="transform:rotate(${ballRot}deg)"><i class="rl-ball" id="rl-ball"></i></div>
            <div class="rl-hub" id="rl-hub"></div>
          </div>
          <div class="rl-side">
            <span class="field-l">Previous spins</span>
            <div class="rl-hist" id="rl-hist"></div>
            <div class="rl-msg" id="rl-msg"></div>
          </div>
        </div>
        <div class="rl-scroll"><div class="rl-board">${boardHTML()}</div></div>
      </div>`));

      const cv = $('#rl-wheel');
      drawWheel(cv);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (cv.isConnected) drawWheel(cv); });

      $('.rl-chips').addEventListener('click', (e) => {
        const b = e.target.closest('.chipbtn');
        if (!b) return;
        chip = Number(b.dataset.v);
        BB.sfx('click');
        $$('.chipbtn').forEach((x) => x.classList.toggle('on', x === b));
      });
      const board = $('.rl-board');
      board.addEventListener('click', (e) => {
        const cell = e.target.closest('.rl-cell');
        if (cell) place(cell.dataset.k);
      });
      board.addEventListener('contextmenu', (e) => {
        const cell = e.target.closest('.rl-cell');
        if (!cell) return;
        e.preventDefault();
        if (spinning || !bets[cell.dataset.k]) return;
        delete bets[cell.dataset.k];
        undo = undo.filter((u) => u[0] !== cell.dataset.k);
        paintBets(); ui();
      });
      $('#rl-spin').addEventListener('click', spin);
      $('#rl-undo').addEventListener('click', () => {
        const last = undo.pop();
        if (!last) return;
        bets[last[0]] -= last[1];
        if (bets[last[0]] <= 0) delete bets[last[0]];
        paintBets(); ui();
      });
      $('#rl-clear').addEventListener('click', () => { bets = {}; undo = []; paintBets(); ui(); });
      paintBets(); paintHistory(); ui();
    },

    unmount() {
      alive++;
      clearTicks();
      if (spinning && pending) { // left mid-spin: the result is already decided, so settle it
        BB.win(pending.payout, true);
        BB.logBet('roulette', pending.total, round2(pending.payout / pending.total), pending.payout, null, pending.nonce);
      }
      spinning = false; pending = null;
      ballRot %= 360;
    },
  });
})();
