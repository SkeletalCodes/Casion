/* Dice — roll 0.00–100.00, bet on landing under or over your target. Multiplier = 99 / win chance. */
(function () {
  'use strict';
  const { $, h, fmt, sleep, round2, clamp } = BB;

  let amount, mode = 'under', target = 50, busy = false, alive = 0, pending = null, tumble = 0;
  const history = [];

  const RISK = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['extreme', 'Extreme']];
  const CHANCE = { low: 75, medium: 50, high: 10, extreme: 2 }; // win chance (%) for each preset
  const chance = () => (mode === 'under' ? target : 100 - target);
  const riskOf = () => { for (const k in CHANCE) if (CHANCE[k] === chance()) return k; return ''; };
  const mult = () => Math.floor((99 / chance()) * 10000) / 10000;
  const rollFrom = (rng) => Math.floor(rng.float() * 10001) / 100;

  function paint() {
    $('#dc-bar').style.setProperty('--t', target);
    $('#dc-bar').dataset.mode = mode;
    $('#dc-range').value = target;
    $('#dc-mult').textContent = mult().toFixed(4) + '×';
    $('#dc-mode-l').textContent = mode === 'under' ? 'Roll under' : 'Roll over';
    $('#dc-target').textContent = target.toFixed(2);
    $('#dc-chance').textContent = chance().toFixed(2) + '%';
    $('#dc-profit').textContent = fmt(Math.max(0, amount.get() * mult() - amount.get()));
    BB.ui.setSeg($('#dc-risk'), riskOf());
  }

  function paintHistory() {
    $('#dc-hist').innerHTML = history.slice(0, 12).map((r) => `<span class="hp ${r.won ? 'good' : 'bad'}">${r.v.toFixed(2)}</span>`).join('') || '<span class="hp">No rolls yet</span>';
  }

  function settle(quiet) {
    if (!pending) return;
    const p = pending;
    pending = null;
    BB.win(p.payout, quiet);
    BB.logBet('dice', p.bet, p.mult, p.payout, null, p.nonce);
  }

  async function roll() {
    if (busy) return;
    const bet = amount.get();
    if (!BB.placeBet(bet)) return;
    const my = alive;
    const rng = BB.fair.roll();
    busy = true;
    $('#dc-roll').disabled = true;
    const r = rollFrom(rng);
    const won = mode === 'under' ? r < target : r > target;
    const m = won ? mult() : 0;
    pending = { bet, mult: m, payout: round2(bet * m), nonce: rng.nonce };
    const marker = $('#dc-marker');
    marker.className = 'dc-marker show';
    marker.style.left = r + '%';
    $('#dc-mval').textContent = r.toFixed(2);
    BB.sfx('tick');
    const tum = $('#dc-result');
    tum.className = 'dc-result rolling';
    clearInterval(tumble);
    tumble = setInterval(() => { if (tum.isConnected) tum.textContent = (BB.rand() * 100).toFixed(2); }, 42);
    await sleep(420);
    clearInterval(tumble);
    if (my !== alive) return; // unmount already settled it
    settle(false);
    BB.sfx(won ? 'win' : 'lose');
    marker.className = 'dc-marker show ' + (won ? 'won' : 'lost');
    const big = $('#dc-result');
    big.textContent = r.toFixed(2);
    big.className = 'dc-result ' + (won ? 'won' : 'lost');
    history.unshift({ v: r, won });
    paintHistory();
    busy = false;
    $('#dc-roll').disabled = false;
  }

  BB.registerGame({
    id: 'dice',
    name: 'Dice',
    rtp: '99.0',
    colors: ['#22b8d6', '#072a36'],
    icon: '<svg viewBox="0 0 24 24"><rect x="3.500" y="3.500" width="17" height="17" rx="4.500" fill="currentColor"/><circle cx="8.500" cy="8.500" r="1.700" fill="#101218"/><circle cx="12" cy="12" r="1.700" fill="#101218"/><circle cx="15.500" cy="15.500" r="1.700" fill="#101218"/></svg>',
    art: `<svg viewBox="0 0 200 200">
      <g transform="rotate(-12 78 116)"><rect x="26" y="64" width="104" height="104" rx="22" fill="#fff"/><rect x="26" y="150" width="104" height="18" rx="9" fill="#d9dce6"/>
        <g fill="#151821"><circle cx="52" cy="90" r="9.500"/><circle cx="104" cy="90" r="9.500"/><circle cx="78" cy="114" r="9.500"/><circle cx="52" cy="138" r="9.500"/><circle cx="104" cy="138" r="9.500"/></g></g>
      <g transform="rotate(15 142 70)"><rect x="100" y="28" width="84" height="84" rx="18" fill="#ffc93c"/><rect x="100" y="98" width="84" height="14" rx="7" fill="#e89a10"/>
        <g fill="#1c1300"><circle cx="121" cy="49" r="8"/><circle cx="142" cy="68" r="8"/><circle cx="163" cy="87" r="8"/></g></g>
    </svg>`,
    verify(rng) { return [['Roll', rollFrom(rng).toFixed(2)]]; },

    mount(panel, stage) {
      busy = false; pending = null;
      amount = BB.ui.amount();
      panel.appendChild(amount.el);
      panel.appendChild(h(`<div>
        <div class="field"><span class="field-l">Risk</span>${BB.ui.seg('dc-risk', RISK, riskOf())}</div>
        <div class="field"><span class="field-l">Profit on win</span><div class="readout"><i class="coin"></i><span id="dc-profit">0.00</span></div></div>
        <button class="btn primary lg block" id="dc-roll">Roll dice</button>
        <p class="panel-note">Pick a risk level or drag the slider to set your own target. Low wins three rolls in four; Extreme wins one in fifty and pays 49.5×. Tap the target box to flip between rolling under and over.</p>
      </div>`));
      stage.appendChild(h(`<div class="dc-wrap">
        <div class="history" id="dc-hist"></div>
        <div class="dc-result" id="dc-result">50.00</div>
        <div class="dc-track">
          <div class="dc-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
          <div class="dc-rail">
            <div class="dc-bar" id="dc-bar"><div class="dc-marker" id="dc-marker"><i id="dc-mval"></i></div></div>
            <input type="range" id="dc-range" min="0" max="100" step="1" value="50" aria-label="Target">
          </div>
        </div>
        <div class="dc-stats">
          <div class="field"><span class="field-l">Multiplier</span><div class="readout" id="dc-mult"></div></div>
          <div class="field"><span class="field-l" id="dc-mode-l">Roll under</span><button class="readout dc-swap" id="dc-swap"><span id="dc-target"></span><svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 7h11l-3-3M17 17H6l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
          <div class="field"><span class="field-l">Win chance</span><div class="readout" id="dc-chance"></div></div>
        </div>
      </div>`));
      $('#dc-range').addEventListener('input', (e) => { if (busy) { e.target.value = target; return; } target = clamp(Number(e.target.value), 2, 98); paint(); });
      $('#dc-swap').addEventListener('click', () => { if (busy) return; mode = mode === 'under' ? 'over' : 'under'; target = 100 - target; BB.sfx('click'); paint(); });
      $('#dc-roll').addEventListener('click', roll);
      BB.ui.bindSeg($('#dc-risk'), (v) => { if (busy) { paint(); return; } target = mode === 'under' ? CHANCE[v] : 100 - CHANCE[v]; paint(); });
      amount.onChange(paint);
      paint(); paintHistory();
    },

    unmount() {
      alive++;
      clearInterval(tumble);
      settle(true); // a roll in progress is already decided — pay it out rather than lose it
      busy = false;
    },
  });
})();
