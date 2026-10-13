/* Diamonds — five gems are drawn from seven colours. Matching colours pay like a poker hand:
   pairs, three of a kind, full house and so on. Risk reshapes the paytable. */
(function () {
  'use strict';
  const { $, $$, h, fmt, fmtMult, sleep, round2 } = BB;

  const GEMS = [
    { a: '#ff4d67', l: '#ffc2cb', d: '#b01f3a' }, { a: '#2fe08a', l: '#b8f7d6', d: '#149454' }, { a: '#4d8dff', l: '#c3d8ff', d: '#2456c2' },
    { a: '#ffb52e', l: '#ffe6ad', d: '#c27a05' }, { a: '#9b6bff', l: '#ddd0ff', d: '#5f35c9' }, { a: '#22d3ee', l: '#baf2fa', d: '#0b8ea3' },
    { a: '#ff5cc8', l: '#ffc9ee', d: '#b8248a' },
  ];
  const gemSVG = (g) => `<svg viewBox="0 0 48 48"><path d="M24 5L43 19L24 44L5 19Z" fill="${g.a}"/><path d="M24 5L33 19H15Z" fill="${g.l}"/><path d="M5 19H15L24 44Z" fill="${g.d}"/><path d="M43 19H33L24 44Z" fill="${g.d}" opacity=".75"/><path d="M5 19L24 5L15 19Z" fill="${g.l}" opacity=".6"/><path d="M43 19L24 5L33 19Z" fill="${g.a}" opacity=".85"/></svg>`;

  const HANDS = [
    ['five', 'Five of a kind', [5]], ['four', 'Four of a kind', [4, 1]], ['full', 'Full house', [3, 2]], ['three', 'Three of a kind', [3, 1, 1]],
    ['twopair', 'Two pairs', [2, 2, 1]], ['pair', 'One pair', [2, 1, 1, 1]], ['none', 'No match', [1, 1, 1, 1, 1]],
  ];
  const BY_SHAPE = { 5: 'five', 41: 'four', 32: 'full', 311: 'three', 221: 'twopair', 2111: 'pair', 11111: 'none' };
  /* Each table returns ~98.3-98.5% against the exact odds of 5 draws from 7 colours. */
  const PAY = {
    low: { five: 25, four: 4, full: 3.5, three: 2.1, twopair: 1.6, pair: 0.55, none: 0 },
    medium: { five: 50, four: 5, full: 4, three: 3, twopair: 2, pair: 0.1, none: 0 },
    high: { five: 120, four: 10, full: 5, three: 3, twopair: 1.65, pair: 0, none: 0 },
  };

  let amount, risk = 'medium', busy = false, alive = 0, pending = null;

  function drawFrom(rng) { const out = []; for (let i = 0; i < 5; i++) out.push(rng.int(7)); return out; }
  function classify(gems) {
    const n = {};
    gems.forEach((g) => { n[g] = (n[g] || 0) + 1; });
    return BY_SHAPE[Object.values(n).sort((x, y) => y - x).join('')];
  }

  function paintPay(hit) {
    $('#dm-pay').innerHTML = HANDS.map(([k, label, shape]) => {
      let dots = '', c = 0;
      shape.forEach((n) => { for (let i = 0; i < n; i++) dots += `<i style="background:${n > 1 ? GEMS[c].a : '#3a4156'}"></i>`; c++; });
      return `<div class="dm-row${hit === k ? ' on' : ''}${PAY[risk][k] ? '' : ' zero'}"><span class="dm-dots">${dots}</span><span class="dm-label">${label}</span><b>${fmtMult(PAY[risk][k])}</b></div>`;
    }).join('');
  }

  function ui() {
    amount.lock(busy);
    $('#dm-bet').disabled = busy;
    $$('#dm-risk button').forEach((b) => { b.disabled = busy; });
  }

  function settle(quiet) {
    if (!pending) return null;
    const p = pending;
    pending = null;
    BB.win(p.payout, quiet || p.mult <= 1);
    BB.logBet('diamonds', p.bet, p.mult, p.payout, null, p.nonce);
    return p;
  }

  async function play() {
    if (busy) return;
    const bet = amount.get();
    if (!BB.placeBet(bet)) return;
    const my = ++alive;
    const rng = BB.fair.roll();
    const gems = drawFrom(rng), hand = classify(gems), mult = PAY[risk][hand];
    pending = { bet, mult, payout: round2(bet * mult), nonce: rng.nonce };
    busy = true;
    const slots = $$('.dm-slot');
    slots.forEach((s) => { s.className = 'dm-slot'; s.innerHTML = ''; });
    $('#dm-res').className = 'result-pop';
    paintPay(); ui();

    for (let i = 0; i < 5; i++) {
      await sleep(i ? 190 : 120);
      if (my !== alive) return;
      slots[i].innerHTML = gemSVG(GEMS[gems[i]]);
      slots[i].classList.add('in');
      BB.sfx('gem', i * 2);
    }
    await sleep(260);
    if (my !== alive) return;
    const n = {};
    gems.forEach((g) => { n[g] = (n[g] || 0) + 1; });
    slots.forEach((s, i) => {
      s.classList.add(n[gems[i]] > 1 ? 'match' : 'dim');
      if (n[gems[i]] > 1) s.style.setProperty('--c', GEMS[gems[i]].a);
    });
    const p = settle(false);
    paintPay(hand);
    if (mult > 0) {
      const pop = $('#dm-res'), net = round2(p.payout - bet);
      pop.className = 'result-pop show' + (net > 0 ? '' : ' push');
      pop.innerHTML = `<b>${fmtMult(mult)}</b><span><i class="coin sm"></i>${net > 0 ? '+' : ''}${fmt(net)}</span>`;
      if (mult >= 10) { BB.sfx('bigwin'); BB.confetti($('.dm-wrap'), 70); } else BB.sfx(net > 0 ? 'win' : 'push');
    } else BB.sfx('lose');
    busy = false;
    ui();
  }

  BB.registerGame({
    id: 'diamonds',
    name: 'Diamonds',
    rtp: '98.3',
    colors: ['#38bdf8', '#06283f'],
    icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4h10l4 5.500L12 21 3 9.500z"/><path d="M3 9.500h18M9.500 9.500L12 21l2.500-11.500M7 4l2.500 5.500L12 4l2.500 5.500L17 4" fill="none" stroke="#101218" stroke-width="1.200" stroke-linejoin="round"/></svg>',
    art: `<svg viewBox="0 0 200 200">
      <g transform="translate(10 62) scale(1.700)">${gemSVG(GEMS[4]).replace(/<\/?svg[^>]*>/g, '')}</g>
      <g transform="translate(108 62) scale(1.700)">${gemSVG(GEMS[3]).replace(/<\/?svg[^>]*>/g, '')}</g>
      <g transform="translate(46 30) scale(2.250)">${gemSVG(GEMS[5]).replace(/<\/?svg[^>]*>/g, '')}</g>
    </svg>`,
    verify(rng) {
      const g = drawFrom(rng), names = ['Red', 'Green', 'Blue', 'Amber', 'Purple', 'Cyan', 'Pink'];
      return [['Gems drawn, left to right', g.map((i) => names[i]).join(', ')], ['Hand', HANDS.find((x) => x[0] === classify(g))[1]]];
    },

    mount(panel, stage) {
      busy = false; pending = null;
      amount = BB.ui.amount();
      panel.appendChild(amount.el);
      panel.appendChild(h(`<div>
        <div class="field"><span class="field-l">Risk</span>${BB.ui.seg('dm-risk', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], risk)}</div>
        <button class="btn primary lg block" id="dm-bet">Bet</button>
        <p class="panel-note">Low risk pays back on a single pair. High risk pays nothing for a pair but far more for the rare hands.</p>
      </div>`));
      stage.appendChild(h(`<div class="dm-wrap">
        <div class="dm-row5">${'<div class="dm-slot"></div>'.repeat(5)}</div>
        <div class="dm-pay" id="dm-pay"></div>
        <div class="result-pop" id="dm-res"></div>
      </div>`));
      BB.ui.bindSeg($('#dm-risk'), (v) => { risk = v; paintPay(); });
      $('#dm-bet').addEventListener('click', play);
      paintPay(); ui();
    },

    unmount() {
      alive++;
      settle(true); // a draw in progress is already decided — pay it out rather than lose it
      busy = false;
    },
  });
})();
