/* Blackjack — infinite deck (each card is an independent seeded draw), dealer stands on 17,
   blackjack pays 3:2, double on any first two cards. */
(function () {
  'use strict';
  const { $, h, fmt, sleep, round2 } = BB;

  const SUITS = ['♠︎', '♥︎', '♦︎', '♣︎'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  let amount, alive = 0, phase = 'idle', rng = null, player, dealer, bet = 0, doubled = false, holeDown = false;

  function cardFrom(stream) {
    const i = stream.int(52), si = Math.floor(i / 13);
    return { r: RANKS[i % 13], s: SUITS[si], red: si === 1 || si === 2 };
  }

  function total(cards) {
    let t = 0, aces = 0;
    for (const c of cards) {
      if (c.r === 'A') { aces++; t += 11; } else if (c.r === 'K' || c.r === 'Q' || c.r === 'J' || c.r === '10') t += 10; else t += Number(c.r);
    }
    while (t > 21 && aces) { t -= 10; aces--; }
    return t;
  }

  function cardEl(c, down) {
    return h(`<div class="pcard${c.red ? ' red' : ''}${down ? ' down' : ''}"><div class="pcard-in">
      <div class="pcard-f"><span class="pc-r">${c.r}</span><span class="pc-s">${c.s}</span><span class="pc-big">${c.s}</span></div>
      <div class="pcard-b"></div></div></div>`);
  }

  function scores() {
    const ps = $('#bj-p .bj-score'), ds = $('#bj-d .bj-score');
    if (!ps) return;
    ps.hidden = !player.length;
    ds.hidden = !dealer.length;
    ps.textContent = total(player);
    ds.textContent = holeDown ? total(dealer.slice(0, 1)) : total(dealer);
  }

  async function give(hand, who, down) {
    const c = cardFrom(rng);
    hand.push(c);
    BB.sfx('card');
    if (down) holeDown = true;
    $(`#bj-${who} .bj-cards`).appendChild(cardEl(c, down));
    scores();
    await sleep(340);
  }

  async function reveal() {
    const el = $('#bj-d .pcard.down');
    if (el) el.classList.remove('down');
    holeDown = false;
    await sleep(380);
    scores();
  }

  function ui() {
    const idle = phase === 'idle', turn = phase === 'player';
    amount.lock(!idle);
    $('#bj-deal').disabled = !idle;
    $('#bj-hit').disabled = !turn;
    $('#bj-stand').disabled = !turn;
    $('#bj-double').disabled = !(turn && player.length === 2);
  }

  function settle(kind, note) {
    const wager = bet * (doubled ? 2 : 1);
    let mult = 0, title = note || 'Dealer wins', cls = 'bad';
    if (kind === 'blackjack') { mult = 2.5; title = 'Blackjack!'; cls = ''; }
    else if (kind === 'win') { mult = 2; title = note || 'You win'; cls = ''; }
    else if (kind === 'push') { mult = 1; title = 'Push'; cls = 'push'; }
    else if (kind === 'bust') { title = 'Bust'; }
    const payout = round2(wager * mult);
    BB.win(payout, kind === 'push');
    BB.logBet('blackjack', wager, mult, payout, null, rng.nonce);
    BB.sfx(kind === 'blackjack' ? 'bigwin' : mult > 1 ? 'win' : mult === 1 ? 'push' : 'lose');
    const pop = $('#bj-res');
    pop.className = 'result-pop show ' + cls;
    pop.innerHTML = `<b>${title}</b><span><i class="coin sm"></i>${mult > 1 ? '+' + fmt(payout - wager) : mult === 1 ? 'Bet returned' : '-' + fmt(wager)}</span>`;
    $('#bj-p .bj-score').classList.add(mult > 1 ? 'win' : mult === 1 ? 'push' : 'lose');
    phase = 'idle';
    ui();
  }

  async function deal() {
    if (phase !== 'idle') return;
    bet = amount.get();
    if (!BB.placeBet(bet)) return;
    const my = ++alive;
    phase = 'busy'; doubled = false; holeDown = false;
    rng = BB.fair.roll(); player = []; dealer = [];
    $('#bj-p .bj-cards').innerHTML = '';
    $('#bj-d .bj-cards').innerHTML = '';
    $('#bj-p .bj-score').className = 'bj-score';
    $('#bj-res').className = 'result-pop';
    scores(); ui();

    await give(player, 'p'); if (my !== alive) return;
    await give(dealer, 'd'); if (my !== alive) return;
    await give(player, 'p'); if (my !== alive) return;
    await give(dealer, 'd', true); if (my !== alive) return;

    const dealerBJ = total(dealer) === 21;
    if (total(player) === 21) { await reveal(); if (my !== alive) return; return settle(dealerBJ ? 'push' : 'blackjack'); }
    if (dealerBJ) { await reveal(); if (my !== alive) return; return settle('lose', 'Dealer blackjack'); }
    phase = 'player'; ui();
  }

  async function dealerPlay(my) {
    phase = 'busy'; ui();
    await reveal(); if (my !== alive) return;
    while (total(dealer) < 17) { await give(dealer, 'd'); if (my !== alive) return; }
    const p = total(player), d = total(dealer);
    if (d > 21) settle('win', 'Dealer busts');
    else if (p > d) settle('win');
    else if (p === d) settle('push');
    else settle('lose');
  }

  async function hit() {
    if (phase !== 'player') return;
    const my = alive;
    phase = 'busy'; ui();
    await give(player, 'p'); if (my !== alive) return;
    const t = total(player);
    if (t > 21) { await reveal(); if (my !== alive) return; return settle('bust'); }
    if (t === 21) return dealerPlay(my);
    phase = 'player'; ui();
  }

  function stand() {
    if (phase !== 'player') return;
    dealerPlay(alive);
  }

  async function dbl() {
    if (phase !== 'player' || player.length !== 2) return;
    if (!BB.placeBet(bet)) return;
    doubled = true;
    const my = alive;
    phase = 'busy'; ui();
    await give(player, 'p'); if (my !== alive) return;
    if (total(player) > 21) { await reveal(); if (my !== alive) return; return settle('bust'); }
    return dealerPlay(my);
  }

  BB.registerGame({
    id: 'blackjack',
    name: 'Blackjack',
    rtp: '99.5',
    badge: 'HOT',
    colors: ['#23a877', '#0a3324'],
    verify(stream) {
      const cards = [];
      for (let i = 0; i < 10; i++) { const c = cardFrom(stream); cards.push(c.r + c.s); }
      return [['Cards in draw order', cards.join('  ')], ['Deal order', 'you, dealer, you, dealer (face down), then each hit']];
    },
    icon: '<svg viewBox="0 0 24 24"><rect x="3" y="5.500" width="10.500" height="14.500" rx="2" fill="currentColor" opacity=".45" transform="rotate(-10 8 12)"/><rect x="10.500" y="4" width="10.500" height="14.500" rx="2" fill="currentColor" transform="rotate(9 16 11)"/></svg>',
    art: `<svg viewBox="0 0 200 200">
      <g transform="rotate(-14 80 110)"><rect x="30" y="44" width="94" height="132" rx="13" fill="#fff"/><text x="42" y="76" font-size="28" font-weight="800" fill="#e3324c" font-family="Outfit,Arial,sans-serif">K</text><text x="77" y="140" font-size="62" text-anchor="middle" fill="#e3324c" font-family="Arial,sans-serif">♥︎</text></g>
      <g transform="rotate(11 126 104)"><rect x="80" y="32" width="94" height="132" rx="13" fill="#fff"/><rect x="80" y="32" width="94" height="132" rx="13" fill="none" stroke="#d9dce6" stroke-width="2"/><text x="92" y="64" font-size="28" font-weight="800" fill="#151821" font-family="Outfit,Arial,sans-serif">A</text><text x="127" y="130" font-size="66" text-anchor="middle" fill="#151821" font-family="Arial,sans-serif">♠︎</text></g>
    </svg>`,

    mount(panel, stage) {
      phase = 'idle'; player = []; dealer = []; holeDown = false;
      amount = BB.ui.amount();
      panel.appendChild(amount.el);
      panel.appendChild(h(`<div>
        <div class="bj-actions">
          <button class="btn ghost" id="bj-hit">Hit</button>
          <button class="btn ghost" id="bj-stand">Stand</button>
          <button class="btn ghost" id="bj-double">Double</button>
        </div>
        <button class="btn primary lg block" id="bj-deal">Deal</button>
        <p class="panel-note">Blackjack pays 3:2. Dealer stands on 17. Double on any first two cards.</p>
      </div>`));
      stage.appendChild(h(`<div class="bj-table">
        <div class="bj-hand" id="bj-d"><div class="bj-cards"></div><div class="bj-score" hidden></div></div>
        <div class="bj-mid"><span>BLACKJACK PAYS 3 TO 2</span><small>Dealer must stand on 17 and draw to 16</small></div>
        <div class="bj-hand" id="bj-p"><div class="bj-score" hidden></div><div class="bj-cards"></div></div>
        <div class="bj-shoe"><i></i><i></i><i></i></div>
        <div class="result-pop" id="bj-res"></div>
      </div>`));
      $('#bj-deal').addEventListener('click', deal);
      $('#bj-hit').addEventListener('click', hit);
      $('#bj-stand').addEventListener('click', stand);
      $('#bj-double').addEventListener('click', dbl);
      ui();
    },

    unmount() {
      alive++;
      if (phase !== 'idle') BB.win(bet * (doubled ? 2 : 1), true); // hand abandoned mid-round: return the stake
      phase = 'idle';
    },
  });
})();
