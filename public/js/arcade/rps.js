/* Rock Paper Scissors — pick a hand, the house throws one from your seed pair.
   A win pays 1.96×, a draw returns the stake, a loss loses it: RTP = (1.96 + 1) / 3 = 98.67%. */
(function () {
  'use strict';
  const { $, $$, h, fmt, sleep } = BB;

  const HANDS = ['rock', 'paper', 'scissors'];
  const LABEL = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' };
  const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  const WIN = 1.96;

  const ART = {
    rock: `<svg viewBox="0 0 120 120"><g fill="currentColor"><rect x="26" y="40" width="70" height="56" rx="24"/><rect x="30" y="30" width="18" height="30" rx="9"/><rect x="47" y="26" width="18" height="32" rx="9"/><rect x="64" y="28" width="18" height="31" rx="9"/><rect x="80" y="36" width="15" height="26" rx="7.500"/><path d="M26 66c-8-2-12 8-4 13l14 8 6-14z"/></g><g fill="none" stroke="rgba(0,0,0,.22)" stroke-width="3" stroke-linecap="round"><path d="M47 44v12M64 42v13M80 46v10M40 82c12 6 30 6 44-2"/></g></svg>`,
    paper: `<svg viewBox="0 0 120 120"><g fill="currentColor"><rect x="30" y="52" width="62" height="48" rx="22"/><rect x="32" y="20" width="14" height="50" rx="7"/><rect x="47" y="12" width="14" height="56" rx="7"/><rect x="62" y="14" width="14" height="54" rx="7"/><rect x="77" y="22" width="13" height="46" rx="6.500"/><path d="M30 70c-10-12-22-6-16 4l18 22 8-12z"/></g><g fill="none" stroke="rgba(0,0,0,.2)" stroke-width="3" stroke-linecap="round"><path d="M42 88c12 6 28 6 40-2"/></g></svg>`,
    scissors: `<svg viewBox="0 0 120 120"><g fill="currentColor"><rect x="28" y="54" width="64" height="46" rx="22"/><rect x="38" y="10" width="15" height="58" rx="7.500" transform="rotate(-12 45 40)"/><rect x="60" y="12" width="15" height="58" rx="7.500" transform="rotate(12 67 40)"/><rect x="76" y="52" width="15" height="24" rx="7.500"/><path d="M28 72c-10-4-16 8-6 14l14 8 6-14z"/></g><g fill="none" stroke="rgba(0,0,0,.2)" stroke-width="3" stroke-linecap="round"><path d="M76 62v10M40 88c12 6 28 6 40-2"/></g></svg>`,
  };

  let amount, pick = 'rock', busy = false, alive = 0, pending = null, streak = 0;
  const history = [];
  const throwFrom = (rng) => HANDS[rng.int(3)];

  function settle(quiet) {
    if (!pending) return;
    const p = pending;
    pending = null;
    if (p.payout) BB.win(p.payout, quiet || p.mult === 1);
    BB.logBet('rps', p.bet, p.mult, p.payout, null, p.nonce);
  }

  function paintPick() {
    $$('#rp-picks button').forEach((b) => b.classList.toggle('on', b.dataset.h === pick));
    $$('.rp-choice').forEach((b) => b.classList.toggle('on', b.dataset.h === pick));
    $('#rp-you .rp-hand').innerHTML = ART[pick];
    $('#rp-profit').textContent = fmt(amount.get() * (WIN - 1));
  }
  function paintHistory() {
    $('#rp-hist').innerHTML = history.slice(0, 12).map((r) => `<span class="hp ${r.out === 'win' ? 'good' : r.out === 'lose' ? 'bad' : ''}">${LABEL[r.you][0]}–${LABEL[r.house][0]}</span>`).join('') || '<span class="hp">No throws yet</span>';
    $('#rp-streak').textContent = streak ? `${streak} win${streak === 1 ? '' : 's'} in a row` : 'Win streak: 0';
  }

  async function play() {
    if (busy) return;
    const bet = amount.get();
    if (!BB.placeBet(bet)) return;
    const my = alive, rng = BB.fair.roll(), you = pick, house = throwFrom(rng);
    const out = house === you ? 'draw' : BEATS[you] === house ? 'win' : 'lose';
    const mult = out === 'win' ? WIN : out === 'draw' ? 1 : 0;
    pending = { bet, mult, payout: Math.round(bet * mult * 100) / 100, nonce: rng.nonce };
    busy = true;
    $('#rp-go').disabled = true;
    amount.lock(true);
    const stage = $('.rp-arena'), pop = $('#rp-res'), call = $('#rp-call');
    pop.className = 'result-pop';
    stage.classList.remove('win', 'lose', 'draw');
    $('#rp-house .rp-hand').innerHTML = ART.rock;
    $('#rp-you .rp-hand').innerHTML = ART.rock;
    stage.classList.add('shake');
    for (const word of ['Rock', 'Paper', 'Scissors']) { call.textContent = word + '…'; BB.sfx('tick'); await sleep(BB.user() && BB.user().prefs.calm ? 60 : 260); if (my !== alive) return; }
    stage.classList.remove('shake');
    call.textContent = 'Shoot!';
    $('#rp-you .rp-hand').innerHTML = ART[you];
    $('#rp-house .rp-hand').innerHTML = ART[house];
    stage.classList.add(out);
    settle(false);
    streak = out === 'win' ? streak + 1 : out === 'lose' ? 0 : streak;
    BB.sfx(out === 'win' ? 'win' : out === 'lose' ? 'lose' : 'click');
    pop.className = 'result-pop show' + (out === 'lose' ? ' bad' : out === 'draw' ? ' push' : '');
    const why = out === 'win' ? `${LABEL[you]} beats ${LABEL[house].toLowerCase()}` : out === 'lose' ? `${LABEL[house]} beats ${LABEL[you].toLowerCase()}` : 'Same hand';
    pop.innerHTML = out === 'win' ? `<b>You win</b><span><i class="coin sm"></i>+${fmt(bet * (WIN - 1))}</span><small>${why}</small>` : out === 'draw' ? `<b>Draw</b><span>Stake returned</span><small>${why}</small>` : `<b>House wins</b><span><i class="coin sm"></i>-${fmt(bet)}</span><small>${why}</small>`;
    call.textContent = why;
    if (out === 'win' && streak >= 3) BB.confetti($('.rp-arena'), 50);
    history.unshift({ you, house, out });
    paintHistory();
    await sleep(350);
    if (my !== alive) return;
    busy = false;
    amount.lock(false);
    $('#rp-go').disabled = false;
  }

  BB.registerGame({
    id: 'rps',
    name: 'Rock Paper Scissors',
    cat: 'arcade',
    rtp: '98.7',
    badge: 'NEW',
    colors: ['#a855f7', '#2a0f45'],
    icon: '<svg viewBox="0 0 24 24"><path d="M6 10.500a2 2 0 0 1 2-2h.500V6a1.500 1.500 0 0 1 3 0v1a1.500 1.500 0 0 1 3 0v.500a1.500 1.500 0 0 1 3 .500v5a6 6 0 0 1-6 6h-.500A5 5 0 0 1 6 14z" fill="currentColor"/></svg>',
    art: `<svg viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="78" fill="#3b1466"/><circle cx="100" cy="100" r="78" fill="none" stroke="#f5c542" stroke-width="5" stroke-dasharray="10 9"/>
      <g transform="translate(28 50) scale(.62) rotate(-14 60 60)" color="#ffd5b5">${ART.rock}</g>
      <g transform="translate(96 40) scale(.66) rotate(12 60 60)" color="#ffe2c9">${ART.paper}</g>
      <g transform="translate(62 96) scale(.6)" color="#f6c6a0">${ART.scissors}</g>
      <text x="100" y="186" font-size="20" font-weight="800" text-anchor="middle" fill="#f5c542" font-family="Outfit,Arial,sans-serif">1.96×</text>
    </svg>`,
    verify(rng) { return [['House throws', LABEL[throwFrom(rng)]]]; },

    mount(panel, stage) {
      busy = false; pending = null;
      amount = BB.ui.amount();
      panel.appendChild(amount.el);
      panel.appendChild(h(`<div>
        <div class="field"><span class="field-l">Your hand</span>
          <div class="rp-picks" id="rp-picks">${HANDS.map((k) => `<button type="button" data-h="${k}" aria-label="${LABEL[k]}"><i>${ART[k]}</i><span>${LABEL[k]}</span></button>`).join('')}</div></div>
        <div class="row2">
          <div class="field"><span class="field-l">Win pays</span><div class="readout">${WIN.toFixed(2)}×</div></div>
          <div class="field"><span class="field-l">Profit on win</span><div class="readout"><i class="coin"></i><span id="rp-profit">0.00</span></div></div>
        </div>
        <button class="btn primary lg block" id="rp-go">Throw</button>
        <p class="panel-note">Rock beats scissors, scissors beat paper, paper beats rock. Win and you get 1.96× your bet; a draw hands your stake back. Keys 1, 2 and 3 pick a hand.</p>
      </div>`));
      stage.appendChild(h(`<div class="rp-wrap">
        <div class="history" id="rp-hist"></div>
        <div class="rp-arena">
          <div class="rp-side" id="rp-you"><small>You</small><div class="rp-hand">${ART.rock}</div></div>
          <div class="rp-mid"><b id="rp-call">Pick a hand</b><span id="rp-streak"></span></div>
          <div class="rp-side house" id="rp-house"><small>House</small><div class="rp-hand">${ART.rock}</div></div>
        </div>
        <div class="rp-choices">${HANDS.map((k) => `<button type="button" class="rp-choice" data-h="${k}">${ART[k]}<span>${LABEL[k]}</span></button>`).join('')}</div>
        <div class="result-pop" id="rp-res"></div>
      </div>`));
      const choose = (k) => { if (busy || !LABEL[k]) return; pick = k; BB.sfx('click'); paintPick(); };
      $('#rp-picks').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) choose(b.dataset.h); });
      $('.rp-choices').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) choose(b.dataset.h); });
      $('#rp-go').addEventListener('click', play);
      amount.onChange(paintPick);
      const keys = (e) => {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || $('#modal-root').children.length) return;
        const k = { 1: 'rock', 2: 'paper', 3: 'scissors' }[e.key];
        if (k) choose(k);
      };
      document.addEventListener('keydown', keys);
      BB.onLeave(() => document.removeEventListener('keydown', keys));
      paintPick();
      paintHistory();
    },

    unmount() {
      alive++;
      settle(true); // the throw is already decided when you press the button
      busy = false;
    },
  });
})();
