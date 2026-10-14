/* Connect AI — the brain behind the Connect arcade game. Runs in a Web Worker (and in Node for
   the tests and the opening-book builder).

   Connect 4 on 7×6 is solved: the engine is an exact solver (Pascal Pons' bitboard negamax with
   a transposition table, null-window score narrowing and "never play a move that loses at once"
   pruning), so it always plays a move that keeps the best possible result. The first few plies
   take too long to solve live, so they come from an opening book built offline with the same
   solver (tools/connect-book.js → connect-book.js).

   Connect 5 on 9×7 and Connect 6 on 11×8 are not solved by anyone, so those boards use a deep
   alpha-beta search (iterative deepening, transposition table, forced-move extensions, threat and
   zugzwang-aware evaluation). It never misses a win or a block inside its horizon, which is far
   deeper than a person reads. */
(function () {
  'use strict';

  /* =====================================================================================
     Connect 4, 7×6: exact solver.
     Bitboard: column c uses bits c*7 .. c*7+6 (bit 6 of each column is an always-empty
     sentinel). JS bit operations are 32-bit, so the 49-bit board is split on a column
     boundary: `l` holds columns 0-3 (28 bits), `h` holds columns 4-6 (21 bits).
     ===================================================================================== */
  const C4 = (function () {
    const W = 7, H = 6, H1 = 7, SIZE = W * H;
    const LB = 28, LM = 0x0fffffff, HM = 0x1fffff;
    const MIN_SCORE = -(SIZE / 2) + 3, MAX_SCORE = (SIZE + 1) / 2 - 3 | 0;
    const ORDER = [3, 2, 4, 1, 5, 0, 6];

    // per-column masks, split into the two halves
    const COL_L = new Int32Array(W), COL_H = new Int32Array(W), TOP_L = new Int32Array(W), TOP_H = new Int32Array(W);
    let BOT_L = 0, BOT_H = 0;
    for (let c = 0; c < W; c++) {
      const lo = c < 4, sh = (lo ? c : c - 4) * H1;
      const col = ((1 << H) - 1) << sh, bot = 1 << sh, top = 1 << (sh + H - 1);
      if (lo) { COL_L[c] = col; TOP_L[c] = top; BOT_L |= bot; } else { COL_H[c] = col; TOP_H[c] = top; BOT_H |= bot; }
    }
    const BM_L = BOT_L * ((1 << H) - 1), BM_H = BOT_H * ((1 << H) - 1);

    // shifted copies of a pair, written to these scratch slots
    let rl = 0, rh = 0;
    function shl(l, h, s) { rl = (l << s) & LM; rh = ((h << s) | (l >>> (LB - s))) & HM; }
    function shr(l, h, s) { rl = ((l >>> s) | (h << (LB - s))) & LM; rh = h >>> s; }

    /** Empty cells that would complete a four for the stones in (pl, ph). Result in rl/rh. */
    function winning(pl, ph, ml, mh) {
      // vertical
      let a, b, c, d;
      shl(pl, ph, 1); let ol = rl, oh = rh;
      shl(pl, ph, 2); ol &= rl; oh &= rh;
      shl(pl, ph, 3); ol &= rl; oh &= rh;
      for (let k = 0; k < 3; k++) {
        const s = k === 0 ? H1 : k === 1 ? H : H + 2;
        shl(pl, ph, s); const l1 = rl, h1 = rh;
        shl(pl, ph, 2 * s); const l2 = rl, h2 = rh;
        shl(pl, ph, 3 * s); const l3 = rl, h3 = rh;
        shr(pl, ph, s); const r1l = rl, r1h = rh;
        shr(pl, ph, 2 * s); const r2l = rl, r2h = rh;
        shr(pl, ph, 3 * s); const r3l = rl, r3h = rh;
        a = l1 & l2; b = h1 & h2;
        ol |= (a & l3) | (a & r1l); oh |= (b & h3) | (b & r1h);
        c = r1l & r2l; d = r1h & r2h;
        ol |= (c & l1) | (c & r3l); oh |= (d & h1) | (d & r3h);
      }
      rl = ol & (BM_L ^ ml); rh = oh & (BM_H ^ mh);
    }
    const pop = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };

    /** Does the (pl, ph) stone set contain four in a row? */
    function aligned(pl, ph) {
      for (let k = 0; k < 4; k++) {
        const s = k === 0 ? 1 : k === 1 ? H1 : k === 2 ? H : H + 2;
        shr(pl, ph, s); const ml = pl & rl, mh = ph & rh;
        shr(ml, mh, 2 * s); if ((ml & rl) | (mh & rh)) return true;
      }
      return false;
    }

    /* ---- transposition table: 49-bit key = position + mask, stored as key mod 2^32 ---- */
    const TT_SIZE = 4194301; // prime
    const ttKey = new Uint32Array(TT_SIZE), ttVal = new Uint8Array(TT_SIZE);
    const ttIndex = (kl, kh) => (kh * 268435456 + kl) % TT_SIZE;
    function ttGet(kl, kh) { const i = ttIndex(kl, kh); return ttKey[i] === ((kl | (kh << LB)) >>> 0) ? ttVal[i] : 0; }
    function ttPut(kl, kh, v) { const i = ttIndex(kl, kh); ttKey[i] = (kl | (kh << LB)) >>> 0; ttVal[i] = v; }
    function ttClear() { ttKey.fill(0); ttVal.fill(0); }

    // move sorter scratch, one row per ply
    const SL = new Int32Array(SIZE * 8), SH = new Int32Array(SIZE * 8), SS = new Int32Array(SIZE * 8);

    let nodes = 0, limit = Infinity;
    const ABORT = { abort: true };

    /* negamax on (current player's stones, mask). Precondition: the player to move cannot win now. */
    function negamax(cl, ch, ml, mh, n, alpha, beta) {
      if (++nodes > limit) throw ABORT;
      // possible non-losing moves
      let pl = (ml + BOT_L) & BM_L, ph = (mh + BOT_H) & BM_H;
      winning(cl ^ ml, ch ^ mh, ml, mh);
      const ol = rl, oh = rh;
      let fl = pl & ol, fh = ph & oh;
      if (fl | fh) {
        if ((fl && fh) || (fl & (fl - 1)) || (fh & (fh - 1))) return -((SIZE - n) >> 1);
        pl = fl; ph = fh;
      }
      pl &= ~(ol >>> 1) & LM; ph &= ~(oh >>> 1);
      if (!(pl | ph)) return -((SIZE - n) >> 1);
      if (n >= SIZE - 2) return 0;

      let min = -((SIZE - 2 - n) >> 1);
      if (alpha < min) { alpha = min; if (alpha >= beta) return alpha; }
      let max = (SIZE - 1 - n) >> 1;
      if (beta > max) { beta = max; if (alpha >= beta) return beta; }
      const kl = cl + ml, kh = ch + mh;
      const v = ttGet(kl, kh);
      if (v) {
        if (v > MAX_SCORE - MIN_SCORE + 1) {
          min = v + 2 * MIN_SCORE - MAX_SCORE - 2;
          if (alpha < min) { alpha = min; if (alpha >= beta) return alpha; }
        } else {
          max = v + MIN_SCORE - 1;
          if (beta > max) { beta = max; if (alpha >= beta) return beta; }
        }
      }

      // sort moves by how many new threats they make (centre first on ties)
      const base = n * 8;
      let cnt = 0;
      for (let i = W - 1; i >= 0; i--) {
        const c = ORDER[i];
        const vl = pl & COL_L[c], vh = ph & COL_H[c];
        if (!(vl | vh)) continue;
        winning(cl | vl, ch | vh, ml, mh);
        const sc = pop(rl) + pop(rh);
        let p = cnt++;
        for (; p && SS[base + p - 1] > sc; p--) { SL[base + p] = SL[base + p - 1]; SH[base + p] = SH[base + p - 1]; SS[base + p] = SS[base + p - 1]; }
        SL[base + p] = vl; SH[base + p] = vh; SS[base + p] = sc;
      }
      while (cnt) {
        cnt--;
        const vl = SL[base + cnt], vh = SH[base + cnt];
        const score = -negamax(cl ^ ml, ch ^ mh, ml | vl, mh | vh, n + 1, -beta, -alpha);
        if (score >= beta) { ttPut(kl, kh, score + MAX_SCORE - 2 * MIN_SCORE + 2); return score; }
        if (score > alpha) alpha = score;
      }
      ttPut(kl, kh, alpha - MIN_SCORE + 1);
      return alpha;
    }

    /* ---- positions ---- */
    function fromMoves(moves) {
      let cl = 0, ch = 0, ml = 0, mh = 0;
      const hgt = new Int8Array(W);
      for (let i = 0; i < moves.length; i++) {
        const c = moves[i];
        if (!(c >= 0 && c < W) || hgt[c] >= H) return null;
        const vl = ((ml + BOT_L) & COL_L[c]), vh = ((mh + BOT_H) & COL_H[c]);
        // a game that is already over has no moves left
        if (aligned(cl | vl, ch | vh)) return null;
        cl ^= ml; ch ^= mh; ml |= vl; mh |= vh;
        hgt[c]++;
      }
      return { cl, ch, ml, mh, n: moves.length };
    }
    function playable(P, c) { return !((P.ml & TOP_L[c]) | (P.mh & TOP_H[c])); }
    function winsNow(P, c) {
      if (!playable(P, c)) return false;
      winning(P.cl, P.ch, P.ml, P.mh);
      const pl = (P.ml + BOT_L) & BM_L, ph = (P.mh + BOT_H) & BM_H;
      return !!((rl & pl & COL_L[c]) | (rh & ph & COL_H[c]));
    }
    function play(P, c) {
      const vl = ((P.ml + BOT_L) & COL_L[c]), vh = ((P.mh + BOT_H) & COL_H[c]);
      return { cl: P.cl ^ P.ml, ch: P.ch ^ P.mh, ml: P.ml | vl, mh: P.mh | vh, n: P.n + 1 };
    }

    /** Exact score of a position: >0 the player to move wins (bigger = sooner), 0 draw, <0 loses. */
    function solve(P) {
      for (let c = 0; c < W; c++) if (winsNow(P, c)) return (SIZE + 1 - P.n) >> 1;
      let min = -((SIZE - P.n) >> 1), max = (SIZE + 1 - P.n) >> 1;
      while (min < max) {
        let med = min + ((max - min) >> 1);
        if (med <= 0 && Math.trunc(min / 2) < med) med = Math.trunc(min / 2);
        else if (med >= 0 && Math.trunc(max / 2) > med) med = Math.trunc(max / 2);
        const r = negamax(P.cl, P.ch, P.ml, P.mh, P.n, med, med + 1);
        if (r <= med) max = r; else min = r;
      }
      return min;
    }

    /** Score of playing column c (from the mover's side), exact. */
    function scoreMove(P, c) {
      if (!playable(P, c)) return null;
      if (winsNow(P, c)) return (SIZE + 1 - P.n) >> 1;
      return -solve(play(P, c));
    }

    /** Does the player to move in Q (who just got the move) have a four to play right now? */
    function threatNow(Q) {
      winning(Q.cl, Q.ch, Q.ml, Q.mh);
      return !!((rl & ((Q.ml + BOT_L) & BM_L)) | (rh & ((Q.mh + BOT_H) & BM_H)));
    }
    /** Is playing c from P worth at least `target` (in the mover's score)? Uses a null window. */
    function keeps(P, c, target) {
      const Q = play(P, c);
      if (threatNow(Q)) return -((SIZE + 1 - Q.n) >> 1) >= target;   // they win at once
      if (Q.n >= SIZE) return 0 >= target;
      return -negamax(Q.cl, Q.ch, Q.ml, Q.mh, Q.n, -target, -target + 1) >= target;
    }

    /**
     * The best column for the player to move. `result` is 1 (the mover wins with best play),
     * 0 (draw) or -1 (loss). A won or drawn position only needs a move that keeps that result,
     * which is far cheaper to find than the exact score: any move that keeps a win still wins in
     * the end, because the board fills up. A lost position is solved exactly, and the move that
     * holds out longest is played. Ties go to the column nearest the centre. `maxNodes` caps the
     * work; past it null is returned so the caller can fall back to a heuristic search.
     */
    function best(moves, maxNodes) {
      const P = fromMoves(moves);
      if (!P || P.n >= SIZE) return null;
      nodes = 0; limit = maxNodes || Infinity;
      try {
        for (const c of ORDER) if (winsNow(P, c)) return { move: c, result: 1, nodes };
        let result;
        if (negamax(P.cl, P.ch, P.ml, P.mh, P.n, 0, 1) > 0) result = 1;
        else result = negamax(P.cl, P.ch, P.ml, P.mh, P.n, -1, 0) < 0 ? -1 : 0;
        const target = result >= 0 ? result : solve(P);
        for (const c of ORDER) if (playable(P, c) && keeps(P, c, target)) return { move: c, result, score: target, nodes };
        for (const c of ORDER) if (playable(P, c)) return { move: c, result, score: target, nodes };
        return null;
      } catch (e) {
        if (e === ABORT) return null;
        throw e;
      } finally { limit = Infinity; }
    }

    /** Book key: the position (not the move order), the same for its mirror image. */
    function bookKey(moves) {
      const P = fromMoves(moves), M = fromMoves(moves.map((c) => W - 1 - c));
      if (!P) return null;
      const a = (P.ch + P.mh) * 268435456 + P.cl + P.ml, b = (M.ch + M.mh) * 268435456 + M.cl + M.ml;
      return a <= b ? { key: a.toString(36), mirror: false } : { key: b.toString(36), mirror: true };
    }

    return { W, H, best, solve, scoreMove, fromMoves, play, winsNow, playable, bookKey, ttClear, nodesUsed: () => nodes, SIZE };
  })();

  /* =====================================================================================
     Any W×H board, K in a row: alpha-beta search with an evaluation.
     Cells are numbered col*H + row, row 0 at the bottom.
     ===================================================================================== */
  function makeEngine(W, H, K) {
    const N = W * H, WIN = 1000000, MATE = WIN - 1000;
    const ORDER = Array.from({ length: W }, (_, i) => i).sort((a, b) => Math.abs(a - (W - 1) / 2) - Math.abs(b - (W - 1) / 2) || a - b);

    // every K-long line on the board
    const lines = [];
    for (let c = 0; c < W; c++) for (let r = 0; r < H; r++) {
      for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const ec = c + dc * (K - 1), er = r + dr * (K - 1);
        if (ec < 0 || ec >= W || er < 0 || er >= H) continue;
        const cells = [];
        for (let i = 0; i < K; i++) cells.push((c + dc * i) * H + (r + dr * i));
        lines.push(cells);
      }
    }
    const NL = lines.length;
    const lineCells = new Int32Array(NL * K);
    lines.forEach((cs, i) => cs.forEach((x, j) => { lineCells[i * K + j] = x; }));
    const cellLines = Array.from({ length: N }, () => []);
    lines.forEach((cs, i) => cs.forEach((x) => cellLines[x].push(i)));
    const CL = cellLines.map((a) => Int32Array.from(a));

    // line value by how many stones of one colour it holds (and none of the other)
    const LV = new Int32Array(K + 1);
    for (let i = 1; i < K; i++) LV[i] = Math.round(Math.pow(5, i - 1) * (i === K - 1 ? 2 : 1));
    // the centre is worth a little on its own: more lines run through it
    const CELLV = new Int32Array(N);
    for (let x = 0; x < N; x++) CELLV[x] = cellLines[x].length;

    const board = new Int8Array(N);         // 0 empty, 1 first player, 2 second
    const height = new Int8Array(W);
    const cnt = [new Int8Array(NL), new Int8Array(NL)];
    let n = 0, evalScore = 0;               // evalScore: from the first player's side
    // Zobrist keys, two 32-bit halves
    let seed = 0x9e3779b9;
    const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
    const ZL = [new Uint32Array(N), new Uint32Array(N)], ZH = [new Uint32Array(N), new Uint32Array(N)];
    for (let p = 0; p < 2; p++) for (let x = 0; x < N; x++) { ZL[p][x] = rnd(); ZH[p][x] = rnd(); }
    let hl = 0, hh = 0;

    function make(c) {
      const p = n & 1, o = p ^ 1, x = c * H + height[c];
      const cp = cnt[p], co = cnt[o], ls = CL[x];
      let d = CELLV[x];
      for (let i = 0; i < ls.length; i++) {
        const l = ls[i], a = cp[l], b = co[l];
        if (!b) d += LV[a + 1 < K ? a + 1 : 0] - LV[a];
        else if (!a) d += LV[b];                    // their line is dead now
        cp[l] = a + 1;
      }
      evalScore += p ? -d : d;
      board[x] = p + 1; height[c]++; n++;
      hl ^= ZL[p][x]; hh ^= ZH[p][x];
    }
    function unmake(c) {
      n--; height[c]--;
      const p = n & 1, o = p ^ 1, x = c * H + height[c];
      const cp = cnt[p], co = cnt[o], ls = CL[x];
      let d = CELLV[x];
      for (let i = 0; i < ls.length; i++) {
        const l = ls[i], a = cp[l] - 1, b = co[l];
        if (!b) d += LV[a + 1 < K ? a + 1 : 0] - LV[a];
        else if (!a) d += LV[b];
        cp[l] = a;
      }
      evalScore -= p ? -d : d;
      board[x] = 0;
      hl ^= ZL[p][x]; hh ^= ZH[p][x];
    }
    /** Would player p complete a line by playing in column c now? */
    function wins(c, p) {
      if (height[c] >= H) return false;
      const x = c * H + height[c], ls = CL[x], cp = cnt[p], co = cnt[p ^ 1];
      for (let i = 0; i < ls.length; i++) if (cp[ls[i]] === K - 1 && !co[ls[i]]) return true;
      return false;
    }
    /** Would cell x complete a line for p (x empty)? */
    function threatAt(x, p) {
      const ls = CL[x], cp = cnt[p], co = cnt[p ^ 1];
      for (let i = 0; i < ls.length; i++) if (cp[ls[i]] === K - 1 && !co[ls[i]]) return true;
      return false;
    }

    /* Leaf evaluation for the player to move: the line values kept up to date by make(), plus the
       threats on the board (empty cells that would finish a line). With an even number of rows the
       board ends in zugzwang: if both players just answer in the same column, the first player gets
       the odd rows (1st, 3rd… from the bottom) and the second player the even rows. So the lowest
       threat in a column is worth a lot when it sits on its owner's parity (the other side will be
       forced to play under it once the board fills up), and little otherwise. */
    const stamp = new Int32Array(N), low0 = new Int8Array(W), low1 = new Int8Array(W);
    let stampN = 0;
    function evaluate() {
      let s = evalScore;
      stampN++;
      low0.fill(H); low1.fill(H);
      for (let l = 0; l < NL; l++) {
        const a = cnt[0][l], b = cnt[1][l];
        let p;
        if (a === K - 1 && !b) p = 0; else if (b === K - 1 && !a) p = 1; else continue;
        let x = -1;
        for (let j = 0; j < K; j++) { const y = lineCells[l * K + j]; if (!board[y]) { x = y; break; } }
        if (x < 0 || stamp[x] === stampN) continue;
        stamp[x] = stampN;
        const row = x % H, col = (x - row) / H;
        let v = 80 - (row - height[col]) * 4;   // nearer the top of its stack = sooner in play
        if (threatAt(x, p ^ 1)) v >>= 1;         // both need this cell
        s += p === 0 ? v : -v;
        if (p === 0) { if (row < low0[col]) low0[col] = row; } else if (row < low1[col]) low1[col] = row;
      }
      if ((H & 1) === 0) {
        let z0 = 0, z1 = 0;
        for (let c = 0; c < W; c++) {
          const r0 = low0[c], r1 = low1[c];
          if (r0 === H && r1 === H) continue;
          if (r0 < r1) { if ((r0 & 1) === 0) { z0++; s += 900; } else s += 150; }
          else if (r1 < r0) { if ((r1 & 1) === 1) { z1++; s -= 900; } else s -= 150; }
          // both threaten the same cell: whoever gets there first wins, the search sees that
        }
        if (z0 && !z1) s += 2500; else if (z1 && !z0) s -= 2500;
      }
      return (n & 1) ? -s : s;
    }

    /* ---------- search ---------- */
    const TT_BITS = 20, TT_N = 1 << TT_BITS, TT_MASK = TT_N - 1;
    const tKey = new Uint32Array(TT_N), tKey2 = new Uint32Array(TT_N), tVal = new Int32Array(TT_N), tInfo = new Int16Array(TT_N);
    // tInfo: depth*64 + flag*16 + move+1 (flag 1 exact, 2 lower, 3 upper)
    const hist = new Int32Array(N);
    const killer = new Int8Array(N + 2).fill(-1);
    const moveBuf = new Int8Array((N + 2) * W), scoreBuf = new Int32Array((N + 2) * W);
    let nodes = 0, deadline = 0, stopped = false;
    const STOP = { stop: true };
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    function search(depth, alpha, beta, ply) {
      if ((++nodes & 2047) === 0 && now() > deadline) { stopped = true; throw STOP; }
      if (n >= N) return 0;
      const me = n & 1, op = me ^ 1;
      for (let i = 0; i < W; i++) if (wins(ORDER[i], me)) return WIN - ply;
      let forced = -1, threats = 0;
      for (let c = 0; c < W; c++) if (wins(c, op)) { threats++; forced = c; }
      if (threats >= 2) return -(WIN - ply - 1);
      if (n + 1 >= N) return 0;
      // a mate can't come sooner than next turn: clamp the window
      const best0 = WIN - ply - 2;
      if (beta > best0) { beta = best0; if (alpha >= beta) return beta; }

      if (threats === 1) depth++;           // forced block: look further
      if (depth <= 0) return evaluate();

      const slot = (hl & TT_MASK);
      let ttMove = -1;
      if (tKey[slot] === hl && tKey2[slot] === hh) {
        const info = tInfo[slot], d = info >> 6, flag = (info >> 4) & 3;
        ttMove = (info & 15) - 1;
        if (d >= depth) {
          let v = tVal[slot];
          if (v > MATE) v -= ply; else if (v < -MATE) v += ply;
          if (flag === 1) return v;
          if (flag === 2 && v >= beta) return v;
          if (flag === 3 && v <= alpha) return v;
        }
      }

      // move list
      const base = ply * W;
      let m = 0;
      if (forced >= 0) { moveBuf[base] = forced; m = 1; }
      else {
        for (let i = 0; i < W; i++) {
          const c = ORDER[i];
          if (height[c] >= H) continue;
          let sc = hist[c * H + height[c]] + (W - i);
          if (c === ttMove) sc += 1 << 28;
          else if (c === killer[ply]) sc += 1 << 26;
          // giving the opponent the cell above for a win: try last
          if (height[c] + 1 < H && threatAt(c * H + height[c] + 1, op)) sc -= 1 << 27;
          let p = m++;
          for (; p && scoreBuf[base + p - 1] < sc; p--) { moveBuf[base + p] = moveBuf[base + p - 1]; scoreBuf[base + p] = scoreBuf[base + p - 1]; }
          moveBuf[base + p] = c; scoreBuf[base + p] = sc;
        }
      }

      const a0 = alpha;
      let best = -Infinity, bestMove = moveBuf[base];
      for (let i = 0; i < m; i++) {
        const c = moveBuf[base + i];
        make(c);
        let v;
        if (i === 0) v = -search(depth - 1, -beta, -alpha, ply + 1);
        else {
          v = -search(depth - 1, -alpha - 1, -alpha, ply + 1);
          if (v > alpha && v < beta) v = -search(depth - 1, -beta, -alpha, ply + 1);
        }
        unmake(c);
        if (v > best) { best = v; bestMove = c; }
        if (v > alpha) alpha = v;
        if (alpha >= beta) {
          killer[ply] = c;
          hist[c * H + height[c]] += depth * depth;
          break;
        }
      }
      // store
      let sv = best;
      if (sv > MATE) sv += ply; else if (sv < -MATE) sv -= ply;
      const flag = best <= a0 ? 3 : best >= beta ? 2 : 1;
      tKey[slot] = hl; tKey2[slot] = hh; tVal[slot] = sv;
      tInfo[slot] = (Math.min(depth, 500) << 6) | (flag << 4) | (bestMove + 1);
      return best;
    }

    let lastMoves = [];

    /** Best column for the player to move after `moves`, searching for about `ms` milliseconds. */
    function best(moves, ms, maxDepth) {
      for (let i = lastMoves.length - 1; i >= 0; i--) unmake(lastMoves[i]);
      lastMoves = [];
      for (const c of moves) {
        if (!(c >= 0 && c < W) || height[c] >= H) { for (let i = lastMoves.length - 1; i >= 0; i--) unmake(lastMoves[i]); lastMoves = []; return null; }
        make(c); lastMoves.push(c);
      }
      if (n >= N) return null;
      const me = n & 1, op = me ^ 1;
      // instant decisions
      for (const c of ORDER) if (wins(c, me)) return { move: c, score: WIN, depth: 1, nodes: 0 };
      const blocks = ORDER.filter((c) => wins(c, op));
      if (blocks.length === 1) return { move: blocks[0], score: 0, depth: 0, nodes: 0 };   // the only move that doesn't lose at once
      const legal = ORDER.filter((c) => height[c] < H);
      if (legal.length === 1) return { move: legal[0], score: 0, depth: 0, nodes: 0 };

      nodes = 0; stopped = false; deadline = now() + ms;
      hist.fill(0);
      let bestMove = blocks.length ? blocks[0] : legal[0], bestScore = 0, done = 0;
      const limit = Math.min(maxDepth || 64, N - n);
      for (let d = 1; d <= limit; d++) {
        let alpha = -Infinity, beta = Infinity, cur = -1, curScore = -Infinity;
        try {
          // root: try last iteration's best first
          const list = [bestMove].concat(legal.filter((c) => c !== bestMove));
          for (const c of list) {
            make(c);
            let v;
            if (cur < 0) v = -search(d - 1, -beta, -alpha, 1);
            else {
              v = -search(d - 1, -alpha - 1, -alpha, 1);
              if (v > alpha) v = -search(d - 1, -beta, -alpha, 1);
            }
            unmake(c);
            if (v > curScore) { curScore = v; cur = c; }
            if (v > alpha) alpha = v;
          }
        } catch (e) {
          if (e !== STOP) throw e;
          rebuild(moves);   // the aborted search left stones on the board
          // the last best move is searched first, so anything that beat it in this unfinished pass is better
          if (cur >= 0 && cur !== bestMove) { bestMove = cur; bestScore = curScore; }
          break;
        }
        bestMove = cur; bestScore = curScore; done = d;
        if (Math.abs(bestScore) > MATE) break;   // a forced result: no need to look deeper
        if (now() > deadline - ms * 0.45) break;  // the next iteration won't finish
      }
      return { move: bestMove, score: bestScore, depth: done, nodes };
    }
    // rebuild the board from scratch (after an aborted search)
    function rebuild(moves) {
      board.fill(0); height.fill(0); cnt[0].fill(0); cnt[1].fill(0);
      n = 0; evalScore = 0; hl = 0; hh = 0;
      lastMoves = [];
      for (const c of moves) { make(c); lastMoves.push(c); }
    }

    function clear() { tKey.fill(0); tKey2.fill(0); tInfo.fill(0); hist.fill(0); killer.fill(-1); }

    return { W, H, K, best, clear, WIN, MATE };
  }

  /* =====================================================================================
     Front door
     ===================================================================================== */
  const VARIANTS = {
    c4: { w: 7, h: 6, k: 4 },
    c5: { w: 9, h: 7, k: 5 },
    c6: { w: 11, h: 8, k: 6 },
  };
  const engines = {};
  const engine = (v) => engines[v] || (engines[v] = makeEngine(VARIANTS[v].w, VARIANTS[v].h, VARIANTS[v].k));
  let BOOK = null;
  function setBook(b) { BOOK = b; }

  /**
   * Pick a move. variant: 'c4' | 'c5' | 'c6'; moves: columns played so far (0-based);
   * opts.ms: thinking time for the searched boards.
   */
  function think(variant, moves, opts) {
    opts = opts || {};
    if (!VARIANTS[variant]) return null;
    if (variant === 'c4') {
      if (BOOK) {
        const bk = C4.bookKey(moves), hit = bk && BOOK[bk.key];
        if (hit !== undefined && hit !== null) {
          const col = bk.mirror ? C4.W - 1 - hit : hit;
          return { move: col, kind: 'book' };
        }
      }
      const r = C4.best(moves, opts.maxNodes || 30000000);   // ~10 s: past that, search instead
      if (r) return { move: r.move, result: r.result, kind: 'solved', nodes: r.nodes };
    }
    const r = engine(variant).best(moves, opts.ms || 1500);
    return r && { move: r.move, score: r.score, depth: r.depth, kind: 'search', nodes: r.nodes };
  }

  const api = { think, VARIANTS, C4, makeEngine, setBook };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (typeof importScripts === 'function') {
    const v = (self.location && self.location.search) || '';
    try { importScripts('connect-book.js' + v); if (self.CONNECT_BOOK) setBook(self.CONNECT_BOOK); } catch (e) { /* no book: it just thinks longer */ }
    self.onmessage = (e) => {
      const d = e.data || {};
      let out = null;
      try { out = think(d.variant, d.moves || [], d.opts); } catch (err) { out = null; }
      self.postMessage({ id: d.id, result: out });
    };
  }
})();
