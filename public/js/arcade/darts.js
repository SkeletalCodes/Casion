/* Darts — throw one dart at the board. Where it lands (bull, treble, double, inner or outer single,
   or off the board) comes from your seed pair; the risk level decides what each ring pays.
   Every risk level returns 97% on average. */
(function () {
  'use strict';
  const { $, $$, h, fmt, fmtMult, sleep, round2 } = BB;

  // order matters: it is the order the first random number is cut into
  const ZONES = [
    { id: 'bull', label: 'Bullseye', p: 0.02, r0: 0, r1: 11 },
    { id: 'treble', label: 'Treble ring', p: 0.08, r0: 58, r1: 66 },
    { id: 'double', label: 'Double ring', p: 0.10, r0: 94, r1: 102 },
    { id: 'inner', label: 'Inner single', p: 0.25, r0: 13, r1: 56 },
    { id: 'outer', label: 'Outer single', p: 0.35, r0: 68, r1: 92 },
    { id: 'miss', label: 'Off the board', p: 0.20, r0: 108, r1: 122 },
  ];
  const RISK = {
    low: { label: 'Low', pay: { bull: 5, treble: 2.5, double: 1.7, inner: 1.3, outer: 0.5, miss: 0 } },
    medium: { label: 'Medium', pay: { bull: 15, treble: 4, double: 1.5, inner: 0.8, outer: 0, miss: 0 } },
    high: { label: 'High', pay: { bull: 30, treble: 4, double: 0.5, inner: 0, outer: 0, miss: 0 } },
  };
  const NUMS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

  let amount, risk = 'medium', busy = false, alive = 0, pending = null;
  const history = [];

  /** Where the dart lands: a zone, plus an angle and radius inside it (so the dart can be drawn). */
  function throwFrom(rng) {
    const f = rng.float();
    let acc = 0, zone = ZONES[ZONES.length - 1];
    for (const z of ZONES) { acc += z.p; if (f < acc) { zone = z; break; } }
    const ang = rng.float() * Math.PI * 2, rad = zone.r0 + rng.float() * (zone.r1 - zone.r0);
    return { zone, x: Math.cos(ang) * rad, y: Math.sin(ang) * rad };
  }

  function board() {
    const seg = (r0, r1, a0, a1, fill) => {
      const p = (r, a) => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
      return `<path d="M${p(r0, a0)}L${p(r1, a0)}A${r1} ${r1} 0 0 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z" fill="${fill}"/>`;
    };
    let s = '<circle r="128" fill="#140a24"/><circle r="104" fill="#0c0616"/>';
    for (let i = 0; i < 20; i++) {
      const a0 = ((i - 0.5) / 20) * Math.PI * 2 - Math.PI / 2, a1 = a0 + Math.PI / 10, dark = i % 2 === 0;
      s += seg(12, 58, a0, a1, dark ? '#1d1233' : '#efe3c8');
      s += seg(58, 66, a0, a1, dark ? '#9b4dff' : '#f5c542');
      s += seg(66, 94, a0, a1, dark ? '#1d1233' : '#efe3c8');
      s += seg(94, 102, a0, a1, dark ? '#9b4dff' : '#f5c542');
      const am = (a0 + a1) / 2;
      s += `<text x="${(Math.cos(am) * 115).toFixed(1)}" y="${(Math.sin(am) * 115 + 4).toFixed(1)}" text-anchor="middle" class="dt-num">${NUMS[i]}</text>`;
    }
    s += '<circle r="12" fill="#9b4dff"/><circle r="5.500" fill="#f5c542"/>';
    s += '<g fill="none" stroke="#c9c2d6" stroke-width=".8" opacity=".55"><circle r="12"/><circle r="58"/><circle r="66"/><circle r="94"/><circle r="102"/></g>';
    // ring highlights used when a dart lands
    s += ZONES.filter((z) => z.id !== 'miss').map((z) => `<circle class="dt-hl" data-z="${z.id}" r="${(z.r0 + z.r1) / 2}" fill="none" stroke-width="${z.r1 - z.r0 + 2}"/>`).join('');
    return s;
  }

  function paintPay() {
    const pay = RISK[risk].pay;
    $('#dt-pay').innerHTML = ZONES.map((z) => `<div class="dt-pr${pay[z.id] ? '' : ' zero'}" data-z="${z.id}"><i class="dt-sw ${z.id}"></i><span>${z.label}</span><small>${(z.p * 100).toFixed(0)}%</small><b>${fmtMult(pay[z.id])}</b></div>`).join('');
    $('#dt-max').textContent = fmt(amount.get() * pay.bull);
  }
  function paintHistory() {
    $('#dt-hist').innerHTML = history.slice(0, 12).map((r) => `<span class="hp ${r.m >= 1 ? 'good' : r.m > 0 ? '' : 'bad'}">${fmtMult(r.m)}</span>`).join('') || '<span class="hp">No throws yet</span>';
  }

  function settle(quiet) {
    if (!pending) return;
    const p = pending;
    pending = null;
    if (p.payout) BB.win(p.payout, quiet || p.mult < 1);
    BB.logBet('darts', p.bet, p.mult, p.payout, null, p.nonce);
  }

  async function play() {
    if (busy) return;
    const bet = amount.get();
    if (!BB.placeBet(bet)) return;
    const my = alive, rng = BB.fair.roll(), t = throwFrom(rng), mult = RISK[risk].pay[t.zone.id];
    pending = { bet, mult, payout: round2(bet * mult), nonce: rng.nonce };
    busy = true;
    $('#dt-go').disabled = true;
    $$('#dt-risk button').forEach((b) => { b.disabled = true; });
    const wrap = $('.dt-board'), dart = $('#dt-dart'), pop = $('#dt-res');
    pop.className = 'result-pop';
    $$('.dt-hl').forEach((c) => c.classList.remove('on'));
    $$('#dt-pay .dt-pr').forEach((r) => r.classList.remove('hit'));
    wrap.classList.remove('thud');
    // the board is 260 units across; place the dart in percent of the box
    dart.style.setProperty('--tx', ((t.x + 130) / 260) * 100 + '%');
    dart.style.setProperty('--ty', ((t.y + 130) / 260) * 100 + '%');
    dart.className = 'dt-dart';
    void dart.offsetWidth;
    dart.className = 'dt-dart fly';
    BB.sfx('launch');
    await sleep(BB.user() && BB.user().prefs.calm ? 80 : 460);
    if (my !== alive) return;
    dart.className = 'dt-dart stuck';
    wrap.classList.add('thud');
    BB.sfx('impact');
    const hl = $(`.dt-hl[data-z="${t.zone.id}"]`);
    if (hl) hl.classList.add('on');
    const row = $(`#dt-pay [data-z="${t.zone.id}"]`);
    if (row) row.classList.add('hit');
    settle(false);
    BB.sfx(mult >= 1 ? 'win' : 'lose');
    pop.className = 'result-pop show' + (mult >= 1 ? '' : ' bad');
    pop.innerHTML = `<b>${fmtMult(mult)}</b><span>${t.zone.label}</span>`;
    if (mult >= 10) BB.confetti($('.dt-wrap'), 70);
    history.unshift({ m: mult });
    paintHistory();
    await sleep(240);
    if (my !== alive) return;
    busy = false;
    $('#dt-go').disabled = false;
    $$('#dt-risk button').forEach((b) => { b.disabled = false; });
  }

  BB.registerGame({
    id: 'darts',
    name: 'Darts',
    cat: 'arcade',
    rtp: '97.0',
    badge: 'NEW',
    colors: ['#f5c542', '#3a2306'],
    icon: '<svg viewBox="0 0 24 24"><circle cx="11" cy="13" r="8.500" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="11" cy="13" r="4.500" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="11" cy="13" r="1.500" fill="currentColor"/><path d="M11 13l9-9M17 3.500l3 .500.500 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    art: `<svg viewBox="-130 -130 260 260">${board().replace(/<text[^>]*>\d+<\/text>/g, '')}
      <g transform="translate(-6 -2) rotate(-38)"><rect x="0" y="-3" width="70" height="6" rx="3" fill="#e9e3f5"/><path d="M68 -3l26 -14v34l-26 -14z" fill="#9b4dff"/><path d="M-12 0l12 -3v6z" fill="#c9c2d6"/></g></svg>`,
    verify(rng, fresh) {
      const t = throwFrom(fresh());
      return [['Lands in', t.zone.label]].concat(Object.keys(RISK).map((k) => [RISK[k].label + ' risk pays', fmtMult(RISK[k].pay[t.zone.id])]));
    },

    mount(panel, stage) {
      busy = false; pending = null;
      amount = BB.ui.amount();
      panel.appendChild(amount.el);
      panel.appendChild(h(`<div>
        <div class="field"><span class="field-l">Risk</span>${BB.ui.seg('dt-risk', Object.keys(RISK).map((k) => [k, RISK[k].label]), risk)}</div>
        <div class="field"><span class="field-l">Bullseye pays</span><div class="readout"><i class="coin"></i><span id="dt-max">0.00</span></div></div>
        <button class="btn primary lg block" id="dt-go">Throw dart</button>
        <div class="dt-pay" id="dt-pay"></div>
        <p class="panel-note">Each ring has a fixed chance of being hit (shown in grey). Low risk pays something on most throws; High pays only for the double, treble and bull — 30× for the bullseye.</p>
      </div>`));
      stage.appendChild(h(`<div class="dt-wrap">
        <div class="history" id="dt-hist"></div>
        <div class="dt-board"><svg viewBox="-130 -130 260 260" aria-hidden="true">${board()}</svg>
          <div class="dt-dart" id="dt-dart"><svg viewBox="-14 0 134 30"><path d="M-14 15l16-2.200v4.400z" fill="#d6d0e4"/><rect x="2" y="11" width="10" height="8" rx="2" fill="#8d86a0"/><rect x="12" y="9.500" width="34" height="11" rx="5.500" fill="#f5c542"/><g fill="#0c0616" opacity=".35"><rect x="18" y="9.500" width="2" height="11"/><rect x="24" y="9.500" width="2" height="11"/><rect x="30" y="9.500" width="2" height="11"/><rect x="36" y="9.500" width="2" height="11"/></g><rect x="46" y="13" width="38" height="4" rx="2" fill="#e9e3f5"/><path d="M80 15L96 1h22l-14 14z" fill="#9b4dff"/><path d="M80 15l16 14h22l-14-14z" fill="#6d28d9"/></svg></div>
        </div>
        <div class="result-pop" id="dt-res"></div>
      </div>`));
      BB.ui.bindSeg($('#dt-risk'), (v) => { if (busy) return; risk = v; paintPay(); });
      $('#dt-go').addEventListener('click', play);
      amount.onChange(paintPay);
      paintPay();
      paintHistory();
    },

    unmount() {
      alive++;
      settle(true);
      busy = false;
    },
  });
})();
