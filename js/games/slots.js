/* Slots — three reels, one payline across the middle.
   Each reel stops on a symbol drawn from the same weighted list. Three of a kind pays the big prizes;
   on Low and Medium risk, matching the first two reels pays a smaller one. */
(function () {
  'use strict';
  const { $, $$, h, fmt, fmtMult, sleep, round2, randInt } = BB;

  const GEM = '<svg viewBox="0 0 48 48"><path d="M24 5L43 19L24 44L5 19Z" fill="#4d8dff"/><path d="M24 5L33 19H15Z" fill="#c3d8ff"/><path d="M5 19H15L24 44Z" fill="#2456c2"/><path d="M43 19H33L24 44Z" fill="#1c459e"/><path d="M5 19L24 5L15 19Z" fill="#8fb6ff"/><path d="M43 19L24 5L33 19Z" fill="#3b76e6"/></svg>';
  const SYM = [
    { name: 'Cherry', w: 30, svg: '<svg viewBox="0 0 48 48"><path d="M30 8c-8 3-13 10-15 19M30 8c1 9 3 14 6 20" fill="none" stroke="#3a8f3a" stroke-width="3" stroke-linecap="round"/><path d="M30 8c5-3 10-2 13 1-4 4-9 4-13-1z" fill="#4dbb4d"/><circle cx="14" cy="33" r="9.500" fill="#e0284a"/><circle cx="36" cy="34" r="9.500" fill="#c81f3f"/><circle cx="11" cy="30" r="2.600" fill="#fff" opacity=".55"/><circle cx="33" cy="31" r="2.600" fill="#fff" opacity=".5"/></svg>' },
    { name: 'Lemon', w: 24, svg: '<svg viewBox="0 0 48 48"><g transform="rotate(-28 24 24)"><ellipse cx="24" cy="24" rx="17" ry="12.500" fill="#ffd93b"/><path d="M4.500 24c2-3.500 3.500-3.500 5 0-1.500 3.500-3 3.500-5 0zM38.500 24c1.500-3.500 3-3.500 5 0-2 3.500-3.500 3.500-5 0z" fill="#f2b90f"/><ellipse cx="19" cy="19" rx="7" ry="3.500" fill="#fff" opacity=".4"/></g></svg>' },
    { name: 'Banana', w: 20, svg: '<svg viewBox="0 0 48 48"><g transform="translate(2 4) scale(1.380)"><path d="M5 7A15.5 15.5 0 0 0 27 24A26 26 0 0 1 9 5Z" fill="#ffd23b" stroke="#c98a0a" stroke-width="1"/><path d="M4 6.500L7.800 2.700 10.300 5.200 6.500 9Z" fill="#8a5a1a"/></g></svg>' },
    { name: 'Bell', w: 13, svg: '<svg viewBox="0 0 48 48"><path d="M24 6c-8 0-12 6-12 14v8l-5 7h34l-5-7v-8c0-8-4-14-12-14z" fill="#ffc93c" stroke="#b9820f" stroke-width="1.500"/><path d="M7 35h34v3H7z" fill="#e8a81c"/><circle cx="24" cy="41" r="3.500" fill="#b9820f"/><path d="M17 14c1-3 3-4 6-4" fill="none" stroke="#fff6c4" stroke-width="2.500" stroke-linecap="round"/></svg>' },
    { name: 'Diamond', w: 8, svg: GEM },
    { name: 'Seven', w: 5, svg: '<svg viewBox="0 0 48 48"><path d="M10 8h28v7L25 41H14l12-23H10z" fill="#ff3b5c" stroke="#8a0f26" stroke-width="2" stroke-linejoin="round"/><path d="M13 11.500h22" stroke="#ffc2cb" stroke-width="2" stroke-linecap="round"/></svg>' },
  ];
  /* Multipliers by symbol index. Returns ~96.5-97.3% against the weights above (checked by enumeration). */
  const TRI = { low: [6, 8, 12, 35, 80, 300], medium: [7, 10, 18, 50, 150, 750], high: [6, 12, 22, 70, 250, 1500] };
  const PAIR = { low: [2.5, 2.5, 3, 3, 4, 5], medium: [1, 1, 1.5, 2, 3, 5], high: [0, 0, 0, 0, 0, 0] };
  const BASE_MS = 1000, STEP_MS = 480;

  let amount, risk = 'medium', busy = false, alive = 0, pending = null, shown = [[0, 1, 2], [3, 0, 1], [2, 4, 0]];

  function symFrom(f) { let x = f * 100; for (let i = 0; i < SYM.length; i++) { x -= SYM[i].w; if (x < 0) return i; } return SYM.length - 1; }
  const spinFrom = (rng) => [symFrom(rng.float()), symFrom(rng.float()), symFrom(rng.float())];
  function payFor(r, lv) {
    if (r[0] === r[1] && r[1] === r[2]) return { mult: TRI[lv][r[0]], kind: 'tri' };
    if (r[0] === r[1] && PAIR[lv][r[0]]) return { mult: PAIR[lv][r[0]], kind: 'pair' };
    return { mult: 0, kind: '' };
  }

  const cell = (i) => `<div class="sl-cell">${SYM[i].svg}</div>`;

  function paintPay(hit) {
    const three = (i) => SYM[i].svg.repeat(3);
    $('#sl-pay').innerHTML = '<div class="sl-prow th"><span>Line</span><b>3 of a kind</b><b>First 2</b></div>' + SYM.map((s, i) => i).reverse().map((i) => {
      const t = TRI[risk][i], p = PAIR[risk][i];
      return `<div class="sl-prow${hit && hit.sym === i ? ' on ' + hit.kind : ''}"><span class="sl-icons">${three(i)}</span><b class="t">${fmtMult(t)}</b><b class="p${p ? '' : ' zero'}">${p ? fmtMult(p) : '—'}</b></div>`;
    }).join('');
  }

  function ui() {
    amount.lock(busy);
    $('#sl-spin').disabled = busy;
    $$('#sl-risk button').forEach((b) => { b.disabled = busy; });
  }

  function settle(quiet) {
    if (!pending) return null;
    const p = pending;
    pending = null;
    BB.win(p.payout, quiet || p.mult <= 1);
    BB.logBet('slots', p.bet, p.mult, p.payout, null, p.nonce);
    return p;
  }

  /** Build reel `i` so it scrolls from what is showing now down to [above, result, below]. */
  function loadReel(i, result, ms) {
    const strip = $('#sl-s' + i);
    const next = [randInt(SYM.length), result, randInt(SYM.length)];
    const fill = [];
    for (let k = 0; k < 12 + i * 7; k++) fill.push(randInt(SYM.length));
    const list = next.concat(fill, shown[i]);
    strip.style.transition = 'none';
    strip.innerHTML = list.map(cell).join('');
    strip.style.transform = `translateY(${(-(list.length - 3) / list.length) * 100}%)`;
    void strip.offsetWidth;
    strip.style.transition = `transform ${ms}ms cubic-bezier(.22, .1, .18, 1)`;
    strip.style.transform = 'translateY(0)';
    strip.parentElement.classList.remove('land');
    strip.parentElement.classList.add('spinning');
    shown[i] = next;
    return ms;
  }

  async function spin() {
    if (busy) return;
    const bet = amount.get();
    if (!BB.placeBet(bet)) return;
    const my = ++alive;
    const rng = BB.fair.roll();
    const r = spinFrom(rng), res = payFor(r, risk);
    pending = { bet, mult: res.mult, payout: round2(bet * res.mult), nonce: rng.nonce };
    busy = true;
    $('#sl-res').className = 'result-pop';
    $('.sl-machine').classList.remove('win', 'tease');
    $$('.sl-cell.hit').forEach((c) => c.classList.remove('hit'));
    paintPay();
    ui();

    const tease = r[0] === r[1]; // first two match — hold the last reel a little longer
    const times = [BASE_MS, BASE_MS + STEP_MS, BASE_MS + STEP_MS * 2 + (tease ? 900 : 0)];
    BB.sfx('launch');
    for (let i = 0; i < 3; i++) loadReel(i, r[i], times[i]);
    for (let i = 0; i < 3; i++) {
      await sleep(i ? times[i] - times[i - 1] : times[0]);
      if (my !== alive) return;
      $('#sl-s' + i).parentElement.classList.remove('spinning');
      $('#sl-s' + i).parentElement.classList.add('land');
      BB.sfx(i === 2 ? 'lock' : 'tick');
      if (i === 1 && tease) { $('.sl-machine').classList.add('tease'); BB.sfx('scan', 0.6); }
    }
    await sleep(160);
    if (my !== alive) return;

    const p = settle(false);
    $('.sl-machine').classList.remove('tease');
    if (res.mult > 0) {
      const n = res.kind === 'tri' ? 3 : 2;
      for (let i = 0; i < n; i++) $('#sl-s' + i).children[1].classList.add('hit');
      $('.sl-machine').classList.add('win');
      paintPay({ sym: r[0], kind: res.kind });
      const net = round2(p.payout - bet), pop = $('#sl-res');
      pop.className = 'result-pop show' + (net > 0 ? '' : ' push');
      pop.innerHTML = `<b>${fmtMult(res.mult)}</b><span><i class="coin sm"></i>${net > 0 ? '+' : ''}${fmt(net)}</span>`;
      if (res.mult >= 20) { BB.sfx('bigwin'); BB.confetti($('.sl-wrap'), 80); } else BB.sfx(net > 0 ? 'win' : 'push');
    } else BB.sfx('lose');
    busy = false;
    ui();
  }

  BB.registerGame({
    id: 'slots',
    name: 'Triple Banana',
    cat: 'slots',
    provider: 'peel',
    vol: 'Medium',
    rtp: '96.5',
    colors: ['#ec4899', '#4a0b2b'],
    icon: '<svg viewBox="0 0 24 24"><rect x="2.500" y="5" width="19" height="14" rx="3" fill="currentColor"/><path d="M9 5v14M15 5v14" stroke="#101218" stroke-width="1.600"/><path d="M4.500 10h3l-1.800 4.500M10.500 10h3l-1.800 4.500M16.500 10h3l-1.800 4.500" fill="none" stroke="#101218" stroke-width="1.500" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    art: `<svg viewBox="0 0 200 200">
      <rect x="14" y="44" width="172" height="118" rx="20" fill="#2a0618" stroke="#ffc93c" stroke-width="5"/>
      <rect x="26" y="58" width="46" height="90" rx="8" fill="#fff"/><rect x="77" y="58" width="46" height="90" rx="8" fill="#fff"/><rect x="128" y="58" width="46" height="90" rx="8" fill="#fff"/>
      <g transform="translate(29 80) scale(.83)">${SYM[5].svg.replace(/<\/?svg[^>]*>/g, '')}</g>
      <g transform="translate(80 80) scale(.83)">${SYM[5].svg.replace(/<\/?svg[^>]*>/g, '')}</g>
      <g transform="translate(131 80) scale(.83)">${SYM[5].svg.replace(/<\/?svg[^>]*>/g, '')}</g>
      <path d="M14 103h172" stroke="#ffc93c" stroke-width="2" stroke-dasharray="5 5" opacity=".7"/>
      <circle cx="100" cy="30" r="9" fill="#ffc93c"/><circle cx="66" cy="34" r="6" fill="#ff4d67"/><circle cx="134" cy="34" r="6" fill="#2fe08a"/>
    </svg>`,
    verify(rng) {
      const r = spinFrom(rng);
      return [['Reels, left to right', r.map((i) => SYM[i].name).join('  ·  ')]].concat(['low', 'medium', 'high'].map((lv) => [lv[0].toUpperCase() + lv.slice(1) + ' risk pays', fmtMult(payFor(r, lv).mult)]));
    },

    mount(panel, stage) {
      busy = false; pending = null;
      amount = BB.ui.amount();
      panel.appendChild(amount.el);
      panel.appendChild(h(`<div>
        <div class="field"><span class="field-l">Risk</span>${BB.ui.seg('sl-risk', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], risk)}</div>
        <button class="btn primary lg block" id="sl-spin">Spin</button>
        <p class="panel-note">Only the middle line counts. Low risk pays small prizes for two of a kind; High drops them and doubles the jackpot for three sevens.</p>
      </div>`));
      stage.appendChild(h(`<div class="sl-wrap">
        <div class="sl-machine">
          <div class="sl-reels">${[0, 1, 2].map((i) => `<div class="sl-reel"><div class="sl-strip" id="sl-s${i}">${shown[i].map(cell).join('')}</div></div>`).join('')}</div>
          <div class="sl-line"></div>
        </div>
        <div class="sl-pay" id="sl-pay"></div>
        <div class="result-pop" id="sl-res"></div>
      </div>`));
      BB.ui.bindSeg($('#sl-risk'), (v) => { risk = v; paintPay(); });
      $('#sl-spin').addEventListener('click', spin);
      paintPay(); ui();
    },

    unmount() {
      alive++;
      settle(true); // a spin in progress is already decided — pay it out rather than lose it
      busy = false;
    },
  });
})();
