/* Limbo — set a target multiplier; a result is generated and you win if it lands at or above your target.
   P(result >= x) = 0.99 / x, so a higher target pays more and hits less often. */
(function () {
  'use strict';
  const { $, h, fmt, sleep, round2, clamp } = BB;

  const RISK = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['extreme', 'Extreme']];
  const TARGETS = { low: 1.5, medium: 2, high: 10, extreme: 100 };
  const MAX_TARGET = 1000000;

  let amount, target = 2, busy = false, alive = 0, pending = null, counter = 0;
  const history = [];

  const resultFrom = (rng) => Math.min(MAX_TARGET, Math.max(1, Math.floor(99 / (1 - rng.float())) / 100));
  const chance = () => 99 / target;
  const riskOf = (t) => { for (const k in TARGETS) if (TARGETS[k] === t) return k; return ''; };
  const show = (v) => (v >= 10000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2)) + '×';

  function paint() {
    $('#lb-chance').textContent = (chance() >= 0.01 ? chance().toFixed(chance() < 1 ? 4 : 2) : chance().toFixed(6)) + '%';
    $('#lb-profit').textContent = fmt(Math.max(0, amount.get() * target - amount.get()));
    $('#lb-goal').textContent = 'Target ' + show(target);
    BB.ui.setSeg($('#lb-risk'), riskOf(target));
  }

  function readTarget() {
    const v = parseFloat($('#lb-target').value);
    if (!isFinite(v) || v < 1.01 || v > MAX_TARGET) return false;
    target = round2(v);
    return true;
  }

  function paintHistory() {
    $('#lb-hist').innerHTML = history.slice(0, 12).map((r) => `<span class="hp ${r.won ? 'good' : 'bad'}">${show(r.v)}</span>`).join('') || '<span class="hp">No rounds yet</span>';
  }

  function settle(quiet) {
    if (!pending) return;
    const p = pending;
    pending = null;
    BB.win(p.payout, quiet);
    BB.logBet('limbo', p.bet, p.mult, p.payout, null, p.nonce);
  }

  async function play() {
    if (busy) return;
    if (!readTarget()) { BB.toast('Target must be between 1.01× and 1,000,000×.', 'err'); $('#lb-target').focus(); return; }
    const bet = amount.get();
    if (!BB.placeBet(bet)) return;
    const my = alive;
    const rng = BB.fair.roll();
    busy = true;
    $('#lb-bet').disabled = true;
    const result = resultFrom(rng), won = result >= target, m = won ? target : 0;
    pending = { bet, mult: m, payout: round2(bet * m), nonce: rng.nonce };

    // quick count-up to the result
    const num = $('#lb-num');
    num.className = 'lb-num rolling';
    const steps = 14;
    clearInterval(counter);
    let i = 0;
    await new Promise((done) => {
      counter = setInterval(() => {
        i++;
        const v = Math.pow(result, Math.pow(i / steps, 1.6));
        if (num.isConnected) num.textContent = show(v);
        if (i % 3 === 0) BB.sfx('tick', 0.5);
        if (i >= steps) { clearInterval(counter); done(); }
      }, 30);
    });
    if (my !== alive) return;
    settle(false);
    num.textContent = show(result);
    num.className = 'lb-num ' + (won ? 'won' : 'lost');
    BB.sfx(won ? 'win' : 'lose');
    history.unshift({ v: result, won });
    paintHistory();
    await sleep(120);
    busy = false;
    if ($('#lb-bet')) $('#lb-bet').disabled = false;
  }

  BB.registerGame({
    id: 'limbo',
    name: 'Limbo',
    rtp: '99.0',
    colors: ['#14b8a6', '#052a27'],
    icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.200"/><circle cx="12" cy="12" r="4.500" fill="none" stroke="currentColor" stroke-width="2.200"/><circle cx="12" cy="12" r="1.400" fill="currentColor"/></svg>',
    art: `<svg viewBox="0 0 200 200">
      <circle cx="100" cy="104" r="78" fill="#fff" opacity=".14"/><circle cx="100" cy="104" r="78" fill="none" stroke="#fff" stroke-width="7"/>
      <circle cx="100" cy="104" r="52" fill="none" stroke="#fff" stroke-width="7" opacity=".75"/><circle cx="100" cy="104" r="26" fill="#ffc93c"/>
      <path d="M158 40L112 92" stroke="#12141c" stroke-width="9" stroke-linecap="round"/><path d="M158 40L112 92" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
      <path d="M150 26l22 2-2 22-20 6 6-20z" fill="#ff4d67"/><path d="M100 104l12-12" stroke="#12141c" stroke-width="5" stroke-linecap="round"/>
    </svg>`,
    verify(rng) { return [['Result', show(resultFrom(rng))], ['You win if', 'the result is at or above your target']]; },

    mount(panel, stage) {
      busy = false; pending = null;
      amount = BB.ui.amount();
      panel.appendChild(amount.el);
      panel.appendChild(h(`<div>
        <div class="field"><span class="field-l">Risk</span>${BB.ui.seg('lb-risk', RISK, riskOf(target))}</div>
        <div class="row2">
          <label class="field"><span class="field-l">Target</span><input type="text" inputmode="decimal" id="lb-target" value="${target.toFixed(2)}" maxlength="10"></label>
          <div class="field"><span class="field-l">Win chance</span><div class="readout" id="lb-chance"></div></div>
        </div>
        <div class="field"><span class="field-l">Profit on win</span><div class="readout"><i class="coin"></i><span id="lb-profit">0.00</span></div></div>
        <button class="btn primary lg block" id="lb-bet">Bet</button>
        <p class="panel-note">Pick a risk level or type your own target. Low targets hit often; a 100× target lands about 1 time in 100.</p>
      </div>`));
      stage.appendChild(h(`<div class="lb-wrap">
        <div class="history" id="lb-hist"></div>
        <div class="lb-num" id="lb-num">1.00×</div>
        <div class="lb-goal" id="lb-goal"></div>
      </div>`));
      BB.ui.bindSeg($('#lb-risk'), (v) => { if (busy) return; target = TARGETS[v]; $('#lb-target').value = target.toFixed(2); paint(); });
      $('#lb-target').addEventListener('input', (e) => {
        const clean = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
        if (clean !== e.target.value) e.target.value = clean;
        e.target.classList.toggle('bad', !readTarget());
        if (readTarget()) paint();
      });
      $('#lb-target').addEventListener('blur', (e) => { target = clamp(target, 1.01, MAX_TARGET); e.target.value = target.toFixed(2); e.target.classList.remove('bad'); paint(); });
      $('#lb-bet').addEventListener('click', play);
      amount.onChange(paint);
      paint(); paintHistory();
    },

    unmount() {
      alive++;
      clearInterval(counter);
      settle(true); // a round in progress is already decided — pay it out rather than lose it
      busy = false;
    },
  });
})();
