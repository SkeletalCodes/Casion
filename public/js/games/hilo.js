/* Hi-Lo — a card is dealt; call whether the next one is higher or lower, as many times as you dare.
   Ace is the lowest card, King the highest. On most cards the calls are "higher or same" and "lower or same";
   on an Ace or a King they become a strict Higher / Lower plus a long-shot "Same".
   The payout is 0.99 divided by the combined chance of every call you got right, so the 1% edge is taken once. */
(function () {
  'use strict';
  const { $, $$, h, fmt, fmtMult, round2 } = BB;

  const EDGE = 0.99, FLIP_MS = 260;
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const UP = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 5l8 10H4z" fill="currentColor"/></svg>';
  const DOWN = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 19l8-10H4z" fill="currentColor"/></svg>';
  const SAME = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 9h14M5 15h14" stroke="currentColor" stroke-width="3.200" stroke-linecap="round"/></svg>';

  let amount, state = 'idle', rng = null, cur = null, odds = 1, steps = 0, bet = 0, trail = [], lock = 0, lost = false;

  /** The two calls on offer for a card (i = rank index, 0 = ace ... 12 = king). */
  function calls(i) {
    return {
      hi: i === 12 ? { label: 'Same', icon: SAME, p: 1 / 13, wins: (n) => n === i }
        : i === 0 ? { label: 'Higher', icon: UP, p: 12 / 13, wins: (n) => n > i }
        : { label: 'Higher or same', icon: UP, p: (13 - i) / 13, wins: (n) => n >= i },
      lo: i === 0 ? { label: 'Same', icon: SAME, p: 1 / 13, wins: (n) => n === i }
        : i === 12 ? { label: 'Lower', icon: DOWN, p: 12 / 13, wins: (n) => n < i }
        : { label: 'Lower or same', icon: DOWN, p: (i + 1) / 13, wins: (n) => n <= i },
    };
  }
  /** Payout multiplier once the calls made so far have combined odds of 1 in `o`. */
  const total = (o) => Math.floor(EDGE * o * 100) / 100;
  const shown = () => (lost ? 0 : steps ? total(odds) : 1);

  function setCard(c, how) {
    const box = $('#hl-card');
    box.className = 'hl-card' + (how ? ' ' + how : '');
    box.innerHTML = '';
    box.appendChild(c ? BB.cards.el(c) : BB.cards.el({ r: '', s: '', red: false }, true));
  }

  function paintTrail() {
    const box = $('#hl-trail');
    box.innerHTML = trail.length
      ? trail.map((t) => `<span class="hl-mini${t.c.red ? ' red' : ''}${t.ok === false ? ' miss' : ''}${t.how === 'skip' ? ' skip' : ''}" title="${t.note}"><b>${t.c.r}</b><i>${t.c.s}</i><em>${t.how === 'start' ? 'Start' : t.how === 'skip' ? 'Skip' : t.ok ? fmtMult(t.m) : 'Miss'}</em></span>`).join('')
      : '<span class="hl-none">Your cards line up here as you play.</span>';
    box.scrollLeft = box.scrollWidth;
  }

  function paintScale() {
    const i = cur ? cur.i : -1, live = state === 'playing';
    $('#hl-scale').innerHTML = RANKS.map((r, k) => `<i class="${k === i ? 'cur' : live && k > i ? 'up' : live && k < i ? 'down' : ''}">${r}</i>`).join('');
  }

  function msg(text, cls) {
    const el = $('#hl-msg');
    el.className = 'hl-msg' + (text ? ' show ' + (cls || '') : '');
    el.innerHTML = text || '';
  }

  function ui() {
    const playing = state === 'playing';
    amount.lock(playing);
    const btn = $('#hl-btn');
    if (playing) {
      btn.className = 'btn green lg block';
      btn.disabled = steps === 0;
      btn.innerHTML = steps ? `Cash out <i class="coin sm"></i>${fmt(bet * shown())}` : 'Make a call';
    } else { btn.className = 'btn primary lg block'; btn.disabled = false; btn.textContent = 'Bet'; }
    $('#hl-skip').disabled = !playing;
    $('#hl-skip2').disabled = !playing;
    $('#hl-mult').textContent = fmtMult(shown());
    $('#hl-profit').textContent = fmt(steps ? Math.max(0, bet * shown() - bet) : 0);
    $('#hl-big').textContent = fmtMult(shown());
    $('#hl-big').classList.toggle('pos', steps > 0 && !lost);
    $('#hl-big').classList.toggle('neg', lost);
    $('#hl-steps').textContent = playing ? (steps ? `${steps} correct call${steps === 1 ? '' : 's'}` : 'No calls yet') : lost ? 'Round lost — bet again' : steps ? `Cashed out after ${steps} call${steps === 1 ? '' : 's'}` : 'Place a bet to draw a card';
    const ready = playing && cur, c = ready ? calls(cur.i) : null;
    ['hi', 'lo'].forEach((d) => {
      const el = $('#hl-' + d), o = c ? c[d] : null;
      el.disabled = !ready;
      el.classList.toggle('same', !!o && o.label === 'Same');
      $('.hl-ic', el).innerHTML = o ? o.icon : d === 'hi' ? UP : DOWN;
      $('.hl-t', el).textContent = o ? o.label : d === 'hi' ? 'Higher' : 'Lower';
      $('.hl-pay', el).textContent = o ? fmtMult(total(odds / o.p)) : '—';
      $('.hl-p', el).textContent = o ? (o.p * 100).toFixed(1) + '% chance' : '';
    });
    paintScale();
  }

  function cashout() {
    if (state !== 'playing' || !steps) return;
    const m = shown(), payout = round2(bet * m);
    BB.win(payout);
    BB.logBet('hilo', bet, m, payout, null, rng.nonce);
    BB.sfx('cashout');
    state = 'idle';
    $('#hl-card').classList.add('win');
    msg(`Cashed out at <b>${fmtMult(m)}</b> · <i class="coin sm"></i>+${fmt(payout - bet)}`, 'good');
    if (m >= 10) BB.confetti($('.hl-wrap'), 60);
    ui();
  }

  function guess(dir) {
    if (state !== 'playing' || !cur || Date.now() < lock) return;
    const c = calls(cur.i)[dir], next = BB.cards.from(rng), ok = c.wins(next.i);
    lock = Date.now() + FLIP_MS;
    if (ok) { odds /= c.p; steps++; }
    trail.push({ c: next, how: dir, ok, m: total(odds), note: c.label });
    cur = next;
    setCard(cur, ok ? 'flip win' : 'flip lose');
    paintTrail();
    BB.sfx('card');
    if (!ok) {
      state = 'idle'; lost = true;
      BB.logBet('hilo', bet, 0, 0, null, rng.nonce);
      setTimeout(() => BB.sfx('lose'), 120);
      msg(`<b>${next.r}${next.s}</b> — wrong call. <i class="coin sm"></i>−${fmt(bet)}`, 'bad');
      ui();
      return;
    }
    BB.sfx('gem', steps * 2);
    msg(`<b>${next.r}${next.s}</b> — correct! Now at <b>${fmtMult(shown())}</b>`, 'good');
    ui();
  }

  function skip() {
    if (state !== 'playing' || Date.now() < lock) return;
    lock = Date.now() + FLIP_MS;
    cur = BB.cards.from(rng);
    trail.push({ c: cur, how: 'skip', note: 'Skipped' });
    setCard(cur, 'flip');
    paintTrail();
    BB.sfx('card');
    msg('Card swapped — no change to your multiplier.', '');
    ui();
  }

  function start() {
    if (state !== 'idle') return;
    bet = amount.get();
    if (!BB.placeBet(bet)) return;
    rng = BB.fair.roll();
    cur = BB.cards.from(rng);
    odds = 1; steps = 0; lost = false;
    trail = [{ c: cur, how: 'start', note: 'Starting card' }];
    state = 'playing';
    setCard(cur, 'flip');
    paintTrail();
    BB.sfx('card');
    msg('Higher or lower? Call it, or skip the card.', '');
    ui();
  }

  /* arrow keys: ↑ higher, ↓ lower, → skip */
  function onKey(e) {
    if (state !== 'playing' || e.metaKey || e.ctrlKey || e.altKey) return;
    const u = BB.user();
    if (u && !u.prefs.hotkeys) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '') || document.querySelector('#modal-root > *')) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); guess('hi'); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); guess('lo'); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); skip(); }
  }

  const callBtn = (d) => `<button type="button" class="hl-call ${d}" id="hl-${d}"><span class="hl-ic"></span><b class="hl-t"></b><span class="hl-pay">—</span><small class="hl-p"></small><kbd>${d === 'hi' ? '↑' : '↓'}</kbd></button>`;

  BB.registerGame({
    id: 'hilo',
    name: 'Hi-Lo',
    cat: 'table',
    rtp: '99.0',
    colors: ['#84cc16', '#1a2c05'],
    icon: '<svg viewBox="0 0 24 24"><path d="M12 3l5.500 6.500h-11zM12 21l-5.500-6.500h11z" fill="currentColor"/></svg>',
    art: `<svg viewBox="0 0 200 200">
      <g transform="rotate(-6 100 104)"><rect x="50" y="34" width="100" height="140" rx="14" fill="#fff"/><text x="64" y="70" font-size="30" font-weight="800" fill="#e3324c" font-family="Outfit,Arial,sans-serif">7</text><text x="100" y="138" font-size="70" text-anchor="middle" fill="#e3324c" font-family="Arial,sans-serif">♥︎</text></g>
      <path d="M28 84l22-30 22 30z" fill="#2fe08a" stroke="#0b3d22" stroke-width="5" stroke-linejoin="round"/>
      <path d="M128 124l22 30 22-30z" fill="#ff4d67" stroke="#4a0f17" stroke-width="5" stroke-linejoin="round"/>
    </svg>`,
    verify(stream) {
      const out = [];
      for (let i = 0; i < 12; i++) out.push(BB.cards.text(BB.cards.from(stream)));
      return [['Cards in order', out.join('  ')], ['How to read it', 'The first card is the starting card; every call or skip takes the next one. Ace is low, King is high.']];
    },

    mount(panel, stage) {
      state = 'idle'; cur = null; steps = 0; odds = 1; trail = []; lock = 0; lost = false;
      amount = BB.ui.amount();
      panel.appendChild(amount.el);
      panel.appendChild(h(`<div>
        <div class="row2">
          <div class="field"><span class="field-l">Multiplier</span><div class="readout" id="hl-mult">1.00×</div></div>
          <div class="field"><span class="field-l">Profit</span><div class="readout"><i class="coin"></i><span id="hl-profit">0.00</span></div></div>
        </div>
        <button class="btn primary lg block" id="hl-btn">Bet</button>
        <button class="btn ghost block" id="hl-skip" style="margin-top:10px" disabled>Skip card <kbd class="kb">→</kbd></button>
        <p class="panel-note">Ace is the lowest card and King the highest. Safe calls add a little, long shots add a lot — the number on each button is what you could cash out for if that call lands. Skipping swaps the card for free. One wrong call loses the bet.</p>
      </div>`));
      stage.appendChild(h(`<div class="hl-wrap">
        <div class="hl-head">
          <div class="hl-now"><small id="hl-steps">Place a bet to draw a card</small><b id="hl-big">1.00×</b></div>
          <div class="hl-msg" id="hl-msg"></div>
        </div>
        <div class="hl-table">
          ${callBtn('hi')}
          <div class="hl-deck"><i></i><i></i><div class="hl-card" id="hl-card"></div></div>
          ${callBtn('lo')}
        </div>
        <div class="hl-scalebox"><span>Low</span><div class="hl-scale" id="hl-scale"></div><span>High</span></div>
        <button type="button" class="btn ghost sm hl-skip2" id="hl-skip2" disabled>Skip card</button>
        <div class="hl-trail" id="hl-trail"></div>
      </div>`));
      setCard(null);
      $('#hl-btn').addEventListener('click', () => (state === 'playing' ? cashout() : start()));
      $('#hl-hi').addEventListener('click', () => guess('hi'));
      $('#hl-lo').addEventListener('click', () => guess('lo'));
      $('#hl-skip').addEventListener('click', skip);
      $('#hl-skip2').addEventListener('click', skip);
      $('#hl-card').addEventListener('click', () => { if (state !== 'playing') BB.nudge($('#hl-btn')); });
      document.addEventListener('keydown', onKey);
      paintTrail();
      ui();
    },

    unmount() {
      document.removeEventListener('keydown', onKey);
      if (state === 'playing') BB.win(bet, true); // left mid-round: return the stake
      state = 'idle';
    },
  });
})();
