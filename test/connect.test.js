/* The Connect bot: the 7×6 solver against brute force, and the bot against random players.
   No database needed: node --test test/connect.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const AI = require('../connect-bot/connect-ai.js');
AI.setBook(require('../connect-bot/connect-book.js'));

let seed = 20261014;
const rand = (m) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };

/** A tiny independent referee: W×H board, K in a row. */
function referee(W, H, K) {
  const cells = new Int8Array(W * H), hgt = new Int8Array(W);
  let n = 0;
  return {
    cells, hgt,
    get n() { return n; },
    legal: (c) => c >= 0 && c < W && hgt[c] < H,
    /** Would player p (1 or 2) make K in a row by playing column c? */
    wouldWin(c, p) {
      const r = hgt[c];
      for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        let k = 1;
        for (const s of [1, -1]) {
          let x = c + dc * s, y = r + dr * s;
          while (x >= 0 && x < W && y >= 0 && y < H && cells[x * H + y] === p) { k++; x += dc * s; y += dr * s; }
        }
        if (k >= K) return true;
      }
      return false;
    },
    /** Play c for the player to move; returns true if it made K in a row. */
    play(c) {
      const p = (n & 1) + 1, won = this.wouldWin(c, p);
      cells[c * H + hgt[c]++] = p; n++;
      return won;
    },
    undo(c) { n--; cells[c * H + --hgt[c]] = 0; },
    full: () => n === W * H,
  };
}

/** Exact Pons-style score of a 7×6 position by plain minimax (slow; late positions only). */
function bruteScore(g) {
  let best = -Infinity;
  for (let c = 0; c < 7; c++) {
    if (!g.legal(c)) continue;
    const won = g.play(c);
    const v = won ? (44 - g.n) >> 1 : g.full() ? 0 : -bruteScore(g);   // g.n counts the winning move
    g.undo(c);
    if (v > best) best = v;
  }
  return best;
}

test('7×6 solver agrees with brute-force minimax', () => {
  let checked = 0;
  while (checked < 25) {
    const g = referee(7, 6, 4), moves = [];
    let over = false;
    while (moves.length < 30 && !over) {
      const c = rand(7);
      if (!g.legal(c)) continue;
      moves.push(c);
      over = g.play(c);
    }
    if (over) continue;
    const want = bruteScore(g) + 0;   // + 0 turns -0 into 0
    assert.strictEqual(AI.C4.solve(AI.C4.fromMoves(moves)), want, 'score of ' + moves.join(''));
    const r = AI.C4.best(moves);
    const sign = Math.sign(want) + 0;
    assert.strictEqual(r.result, sign, 'result of ' + moves.join(''));
    // the chosen move keeps that result
    assert.strictEqual(Math.sign(AI.C4.scoreMove(AI.C4.fromMoves(moves), r.move)) + 0, sign, 'move for ' + moves.join(''));
    checked++;
  }
});

test('the book opens in the centre and mirrors correctly', () => {
  assert.deepStrictEqual(AI.think('c4', []), { move: 3, kind: 'book' });
  const a = AI.C4.bookKey([0, 3, 1]), b = AI.C4.bookKey([6, 3, 5]);
  assert.strictEqual(a.key, b.key);
  assert.notStrictEqual(a.mirror, b.mirror);
});

/** Bot vs a random player; returns 'bot', 'human' or 'draw'. */
function match(variant, botFirst, opts) {
  const { w, h, k } = AI.VARIANTS[variant];
  const g = referee(w, h, k), moves = [];
  for (;;) {
    const botTurn = (moves.length % 2 === 0) === botFirst;
    let c;
    if (botTurn) c = AI.think(variant, moves, opts).move;
    else {
      // a random player who still takes a win and blocks one
      const legal = [...Array(w).keys()].filter(g.legal), me = (g.n & 1) + 1;
      c = legal.find((x) => g.wouldWin(x, me));
      if (c === undefined) c = legal.find((x) => g.wouldWin(x, 3 - me));
      if (c === undefined) c = legal[rand(legal.length)];
    }
    assert.ok(g.legal(c), 'legal move');
    moves.push(c);
    if (g.play(c)) return botTurn ? 'bot' : 'human';
    if (g.full()) return 'draw';
  }
}

test('Connect 4: the bot never loses, moving first or second', () => {
  for (let i = 0; i < 16; i++) {
    const botFirst = i % 2 === 0;
    const r = match('c4', botFirst, {});
    assert.notStrictEqual(r, 'human');
    if (botFirst) assert.strictEqual(r, 'bot', 'a perfect first player always wins');
  }
});

for (const v of ['c5', 'c6']) {
  test(`${v}: takes a win and blocks one`, () => {
    const { w, k } = AI.VARIANTS[v];
    // first player has k-1 stacked in column 0, second player in column 1 → first player wins in column 0
    const moves = [];
    for (let i = 0; i < k - 1; i++) moves.push(0, 1);
    assert.strictEqual(AI.think(v, moves, { ms: 300 }).move, 0);
    // second player to move must block column 0... after first player's extra move elsewhere it is their win
    const block = [];
    for (let i = 0; i < k - 1; i++) block.push(0, w - 1 - (i % 2) * 2);
    block.pop();
    assert.strictEqual(AI.think(v, block, { ms: 300 }).move, 0);
  });

  test(`${v}: the bot beats a random player`, () => {
    for (let i = 0; i < 2; i++) assert.strictEqual(match(v, i === 0, { ms: 120 }), 'bot');
  });
}
