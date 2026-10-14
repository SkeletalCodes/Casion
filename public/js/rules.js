/* How-to-play text for the info button under each game. `max` is the best single-bet payout. */
BB.rules = {
  blackjack: {
    how: ['Get closer to 21 than the dealer without going over.', 'Hit to take a card, Stand to stop, Double to double your bet for exactly one more card.', 'Face cards count 10, an ace counts 1 or 11. The dealer stands on 17.', 'A two-card 21 (blackjack) pays 3 to 2. A tie returns your bet.'],
    max: '2.50×', risk: 'Low. The edge is small and you control every decision.',
  },
  baccarat: {
    how: ['Bet on Player, Banker or Tie before the cards are dealt.', 'Two cards each; tens and faces count zero and only the last digit of the total matters. Closest to 9 wins.', 'A third card is drawn by fixed rules — you make no decisions after betting.', 'Player pays 1 to 1, Banker pays 0.95 to 1, Tie pays 8 to 1. A tie returns Player and Banker bets.'],
    max: '9.00×', risk: 'Player and Banker are steady, near even-money bets. Tie is the long shot.',
  },
  roulette: {
    how: ['Pick a chip value, then click the table to place chips. Right-click a spot to take chips back.', 'Press Spin: the ball circles the wheel and drops into one of 37 pockets (0 to 36).', 'A single number pays 35 to 1, dozens and columns pay 2 to 1, red/black, odd/even and high/low pay 1 to 1.', 'Zero is green and loses every outside bet.'],
    max: '36.00×', risk: 'You choose it: outside bets win often and pay little, single numbers win rarely and pay 35 to 1.',
  },
  hilo: {
    how: ['Bet to draw a starting card. Ace is the lowest card, King the highest.', 'Call whether the next card is higher-or-the-same or lower-or-the-same. On an Ace or a King the calls become a strict Higher or Lower, plus a long-shot Same.', 'The number on each button is what your payout multiplier becomes if that call lands. Unlikely calls add more.', 'Skip swaps the card for free. Cash out whenever you like — one wrong call loses the bet.', 'Arrow keys work too: ↑ higher, ↓ lower, → skip.'],
    max: 'No cap', risk: 'In your hands. Safe calls grow the payout slowly; a correct Same call multiplies it by 13.',
  },
  keno: {
    how: ['Pick between 1 and 10 numbers on the 40-number board.', 'Ten numbers are drawn. The more of yours are hit, the bigger the multiplier.', 'The pay table under the board shows what each number of hits pays for your picks and risk level.', 'From five hits on, the draw slows down while more hits are still possible.'],
    max: '1,000×', risk: 'Low pays something on most draws. High pays nothing for a few hits and far more for many.',
  },
  dice: {
    how: ['A number between 0.00 and 100.00 is rolled.', 'Drag the slider to set your target, and tap the target box to switch between rolling under and rolling over.', 'The smaller your winning zone, the bigger the multiplier: it is always 99 divided by your win chance.'],
    max: '49.50×', risk: 'Use the presets: Low wins three rolls in four at 1.32×, Extreme wins one in fifty at 49.50×.',
  },
  limbo: {
    how: ['Set a target multiplier.', 'A result is generated. If it lands at or above your target you win your bet times the target.', 'The chance of winning is 99 divided by the target — a 2× target wins 49.5% of the time.'],
    max: '1,000,000×', risk: 'Entirely set by your target. Low targets hit often, a 100× target lands about once in a hundred.',
  },
  plinko: {
    how: ['Choose how many rows of pegs and a risk level, then drop a ball.', 'The ball bounces left or right at every peg and lands in a bucket at the bottom.', 'The bucket sets your multiplier. Edge buckets pay the most and are the hardest to reach.', 'You can drop several balls at once.'],
    max: '1,000×', risk: 'Low keeps most buckets near 1×. High empties the middle and loads the edges.',
  },
  wheel: {
    how: ['Choose a risk level and how many segments the wheel has.', 'Spin: the pointer lands on one segment and pays its multiplier.', 'The chips under the wheel show each prize and how likely it is.'],
    max: '49.50×', risk: 'Low wins a little on most spins. High puts the whole prize on a single segment.',
  },
  slots: {
    how: ['Three reels spin and stop one after another.', 'Three matching symbols on the middle line pay the big prizes.', 'On Low and Medium risk, matching the first two reels pays a smaller prize.', 'The pay table next to the reels updates when you change the risk level.'],
    max: '1,500×', risk: 'Low pays small prizes often. High drops the two-of-a-kind prizes and doubles the top jackpot.',
  },
  diamonds: {
    how: ['Five gems are drawn, each one of seven colours.', 'Matching colours make a hand, like poker: a pair, two pairs, three of a kind, a full house, four or five of a kind.', 'The pay table shows what each hand pays at your risk level.'],
    max: '120×', risk: 'Low pays back on a single pair. High pays nothing for a pair but much more for rare hands.',
  },
  double: {
    how: ['Pick a colour: red, black or green.', 'The strip spins and stops on one of 15 tiles — seven red, seven black and one green.', 'Red and black pay 2×. Green pays 14×.'],
    max: '14.00×', risk: 'Red and black win 7 times in 15. Green wins once in 15. The edge is higher here than in the other games.',
  },
  coinflip: {
    how: ['Call skull (heads) or crossbones (tails).', 'One flip pays 1.98× if you called it right.', 'Raise the streak to need two, three or five correct flips in a row for a bigger payout. The first miss ends it.'],
    max: '31.68×', risk: 'One flip is a coin toss. Five in a row lands about 3 times in 100 and pays 31.68×.',
  },
  crash: {
    how: ['Place a bet to launch the rocket. The multiplier starts at 1.00× and climbs.', 'Cash out before it crashes to win your bet times the multiplier at that moment.', 'If it crashes first, the bet is lost. Set an auto cash-out to bank a target automatically.'],
    max: 'No cap', risk: 'The longer you wait the more you win and the more often you lose. About half of all rounds crash before 2×.',
  },
  mines: {
    how: ['Choose how many mines are hidden in the 5×5 grid and place a bet.', 'Reveal tiles one at a time, or hold and drag to reveal several quickly.', 'Every gem raises the multiplier. Cash out any time after your first gem.', 'Hit a mine and the bet is lost.'],
    max: '5,148,297×', risk: 'More mines means bigger steps and a shorter life. Presets run from 3 mines (Low) to 20 (Extreme).',
  },
  towers: {
    how: ['Pick a difficulty and place a bet.', 'Climb the tower one floor at a time by choosing a tile. Each floor hides at least one trap.', 'Every safe step multiplies your payout. Cash out any time, or reach the top floor.'],
    max: '6,429.78×', risk: 'Difficulty sets how many safe tiles each floor has: Easy is 3 in 4, Hard is 1 in 2, Extreme is 1 in 3.',
  },
  pump: {
    how: ['Pick a difficulty and place a bet to get a balloon.', 'Every pump inflates it and raises the multiplier.', 'Cash out before it pops. If it pops, the bet is lost.'],
    max: '3,203,384×', risk: 'Difficulty sets how soon a pop is likely: Easy pops on 1 pump in 25, Expert on 10 in 25.',
  },
  rps: {
    how: ['Pick rock, paper or scissors (or press 1, 2 or 3), then press Throw.', 'The house throws its hand from your seed pair.', 'Rock beats scissors, scissors beat paper, paper beats rock.', 'A win pays 1.96×. A draw gives your stake back. A loss loses it.'],
    max: '1.96×', risk: 'Low. You win, draw or lose a third of the time each.',
  },
  cups: {
    how: ['Choose three or five cups and place a bet.', 'The ball goes under a cup and the cups shuffle.', 'Click the cup you think hides the ball. Find it and you win 0.98× the number of cups.', 'Where the ball ends up is set by your seed pair when you bet — the shuffle is just the show.'],
    max: '4.90×', risk: 'Three cups wins one round in three; five cups wins one in five and pays 4.90×.',
  },
  darts: {
    how: ['Pick a risk level and throw a dart.', 'It lands in the bullseye (2%), treble ring (8%), double ring (10%), inner single (25%), outer single (35%) or misses the board (20%).', 'The table under the button shows what each part of the board pays at your risk level.'],
    max: '30.00×', risk: 'Low pays something on most throws. High only pays for the double, treble and the 30× bullseye.',
  },
  moles: {
    how: ['Pick between 1 and 5 of the nine holes, or press Auto pick.', 'Press Whack: three moles pop up from three different holes.', 'Each mole that pops from one of your holes is a hit. The pay table under the board shows what every number of hits pays.'],
    max: '72.75×', risk: 'Fewer holes means fewer hits but bigger prizes — a single hole pays 2.91×, three hits on three holes pays 72.75×.',
  },
  connect: {
    how: ['Pick a game: Connect 4 on a 7×6 board, Connect 5 on 9×7 or Connect 6 on 11×8, and choose whether you or the bot moves first.', 'Click a column (or press its number) to drop a disc. It falls to the lowest empty space.', 'Line up 4, 5 or 6 of your discs across, up and down, or diagonally to win. A full board with no line is a draw.', 'This is free play: there is no bet and nothing to win or lose but bragging rights.'],
    facts: [['Bet', 'None — free play'], ['Connect 4 bot', 'Perfect play'], ['Bigger boards', 'Deep search']],
  },
  snake: {
    how: ['Pick a difficulty and place a bet.', 'Press Move and the snake heads for the next apple. A golden apple grows the snake and the multiplier.', 'A rotten apple ends the round and the bet is lost.', 'Cash out at any time to take the current multiplier. After 25 apples it cashes out for you.'],
    max: 'No practical cap', risk: 'Easy apples are golden 90% of the time, Medium 75%, Hard 55% and Expert just 35%.',
  },
};
