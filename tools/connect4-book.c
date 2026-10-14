/* Opening-book builder for the 7×6 Connect 4 bot.

   This is the same solver as connect-bot/connect-ai.js (same move order, same table size,
   same "keep the result" move choice), in C so the book builds in minutes instead of hours.
   It walks every position the bot can face, for both "bot moves first" and "bot moves second",
   and writes the bot's move for each position the browser would be slow to solve itself.
   A position the browser solves quickly is left out, and so is everything after it.

   Build and run (see connect-bot/README.md):
     cc -O2 -o /tmp/c4book tools/connect4-book.c
     /tmp/c4book [maxNodes] [jobs] [item] > /tmp/book.txt
   (with `item`, only that work item is built, its branches in parallel)
     node tools/connect4-book.js /tmp/book.txt   # writes connect-bot/connect-book.js

   Output lines: "<key in base 36> <column 0-6>", key = position + mask in Pons' bitboard
   layout, the smaller of the position and its mirror image (the column is for that one). */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/wait.h>

#define W 7
#define H 6
#define H1 7
#define SIZE 42
#define MIN_SCORE (-(SIZE / 2) + 3)
#define MAX_SCORE ((SIZE + 1) / 2 - 3)
#define TT_SIZE 4194301u

typedef uint64_t u64;
static const int ORDER[W] = {3, 2, 4, 1, 5, 0, 6};

static u64 BOTTOM, BOARD;
static u64 col_mask(int c) { return ((1ULL << H) - 1) << (c * H1); }
static u64 bottom_mask(int c) { return 1ULL << (c * H1); }

static u64 winning(u64 p, u64 mask) {
  u64 r = (p << 1) & (p << 2) & (p << 3), q;
  const int S[3] = {H1, H, H + 2};
  for (int k = 0; k < 3; k++) {
    int s = S[k];
    q = (p << s) & (p << 2 * s);
    r |= q & (p << 3 * s);
    r |= q & (p >> s);
    q = (p >> s) & (p >> 2 * s);
    r |= q & (p << s);
    r |= q & (p >> 3 * s);
  }
  return r & (BOARD ^ mask);
}
static int popc(u64 x) { return __builtin_popcountll(x); }

static uint32_t *ttKey;
static uint8_t *ttVal;
static void tt_put(u64 key, uint8_t v) { u64 i = key % TT_SIZE; ttKey[i] = (uint32_t)key; ttVal[i] = v; }
static uint8_t tt_get(u64 key) { u64 i = key % TT_SIZE; return ttKey[i] == (uint32_t)key ? ttVal[i] : 0; }
static void tt_clear(void) { memset(ttKey, 0, TT_SIZE * 4); memset(ttVal, 0, TT_SIZE); }

static long long nodes;

static int negamax(u64 cur, u64 mask, int n, int alpha, int beta) {
  nodes++;
  u64 possible = (mask + BOTTOM) & BOARD;
  u64 opp = winning(cur ^ mask, mask);
  u64 forced = possible & opp;
  if (forced) {
    if (forced & (forced - 1)) return -(SIZE - n) / 2;
    possible = forced;
  }
  possible &= ~(opp >> 1);
  if (!possible) return -(SIZE - n) / 2;
  if (n >= SIZE - 2) return 0;
  int min = -(SIZE - 2 - n) / 2;
  if (alpha < min) { alpha = min; if (alpha >= beta) return alpha; }
  int max = (SIZE - 1 - n) / 2;
  if (beta > max) { beta = max; if (alpha >= beta) return beta; }
  u64 key = cur + mask;
  int v = tt_get(key);
  if (v) {
    if (v > MAX_SCORE - MIN_SCORE + 1) {
      min = v + 2 * MIN_SCORE - MAX_SCORE - 2;
      if (alpha < min) { alpha = min; if (alpha >= beta) return alpha; }
    } else {
      max = v + MIN_SCORE - 1;
      if (beta > max) { beta = max; if (alpha >= beta) return beta; }
    }
  }
  u64 mv[W]; int sc[W], cnt = 0;
  for (int i = W - 1; i >= 0; i--) {
    u64 m = possible & col_mask(ORDER[i]);
    if (!m) continue;
    int s = popc(winning(cur | m, mask));
    int p = cnt++;
    for (; p && sc[p - 1] > s; p--) { mv[p] = mv[p - 1]; sc[p] = sc[p - 1]; }
    mv[p] = m; sc[p] = s;
  }
  while (cnt) {
    u64 m = mv[--cnt];
    int score = -negamax(cur ^ mask, mask | m, n + 1, -beta, -alpha);
    if (score >= beta) { tt_put(key, (uint8_t)(score + MAX_SCORE - 2 * MIN_SCORE + 2)); return score; }
    if (score > alpha) alpha = score;
  }
  tt_put(key, (uint8_t)(alpha - MIN_SCORE + 1));
  return alpha;
}

typedef struct { u64 cur, mask; int n; int hgt[W]; } Pos;

static int playable(const Pos *P, int c) { return P->hgt[c] < H; }
static int wins_now(const Pos *P, int c) {
  if (!playable(P, c)) return 0;
  return (winning(P->cur, P->mask) & ((P->mask + BOTTOM) & BOARD) & col_mask(c)) != 0;
}
static Pos play(const Pos *P, int c) {
  Pos Q = *P;
  u64 m = (P->mask + bottom_mask(c)) & col_mask(c);
  Q.cur = P->cur ^ P->mask; Q.mask = P->mask | m; Q.n++; Q.hgt[c]++;
  return Q;
}
static int threat_now(const Pos *Q) { return (winning(Q->cur, Q->mask) & ((Q->mask + BOTTOM) & BOARD)) != 0; }

static int solve(const Pos *P) {
  for (int c = 0; c < W; c++) if (wins_now(P, c)) return (SIZE + 1 - P->n) / 2;
  int min = -(SIZE - P->n) / 2, max = (SIZE + 1 - P->n) / 2;
  while (min < max) {
    int med = min + (max - min) / 2;
    if (med <= 0 && min / 2 < med) med = min / 2;
    else if (med >= 0 && max / 2 > med) med = max / 2;
    int r = negamax(P->cur, P->mask, P->n, med, med + 1);
    if (r <= med) max = r; else min = r;
  }
  return min;
}
static int keeps(const Pos *P, int c, int target) {
  Pos Q = play(P, c);
  if (threat_now(&Q)) return -((SIZE + 1 - Q.n) / 2) >= target;
  if (Q.n >= SIZE) return 0 >= target;
  return -negamax(Q.cur, Q.mask, Q.n, -target, -target + 1) >= target;
}
/* Same choice as C4.best() in connect-ai.js. */
static int best(const Pos *P) {
  for (int i = 0; i < W; i++) if (wins_now(P, ORDER[i])) return ORDER[i];
  int result;
  if (negamax(P->cur, P->mask, P->n, 0, 1) > 0) result = 1;
  else result = negamax(P->cur, P->mask, P->n, -1, 0) < 0 ? -1 : 0;
  int target = result >= 0 ? result : solve(P);
  for (int i = 0; i < W; i++) if (playable(P, ORDER[i]) && keeps(P, ORDER[i], target)) return ORDER[i];
  for (int i = 0; i < W; i++) if (playable(P, ORDER[i])) return ORDER[i];
  return -1;
}

static u64 mirror_key(const Pos *P) {
  u64 cur = 0, mask = 0;
  for (int c = 0; c < W; c++) {
    cur |= ((P->cur >> (c * H1)) & 0x7f) << ((W - 1 - c) * H1);
    mask |= ((P->mask >> (c * H1)) & 0x7f) << ((W - 1 - c) * H1);
  }
  return cur + mask;
}

/* visited set (open addressing) so transpositions are solved once */
#define SEEN_BITS 24
static u64 *seen;
static int seen_add(u64 k) {
  u64 i = (k * 0x9E3779B97F4A7C15ULL) >> (64 - SEEN_BITS);
  while (seen[i]) { if (seen[i] == k) return 0; i = (i + 1) & ((1ULL << SEEN_BITS) - 1); }
  seen[i] = k;
  return 1;
}

static long long maxNodes;
static long long stored, visited;

static void to36(u64 v, char *out) {
  char buf[16]; int i = 0;
  do { int d = v % 36; buf[i++] = d < 10 ? '0' + d : 'a' + d - 10; v /= 36; } while (v);
  int j = 0; while (i) out[j++] = buf[--i]; out[j] = 0;
}

/* The bot is to move in P. */
static void visit(const Pos *P) {
  if (P->n >= SIZE) return;
  u64 k1 = P->cur + P->mask, k2 = mirror_key(P), key = k1 <= k2 ? k1 : k2;
  if (!seen_add(key)) return;
  visited++;
  tt_clear();
  nodes = 0;
  int c = best(P);
  if (c < 0) return;
  if (nodes <= maxNodes) return;   // quick to solve live, and so is what follows
  int col = k1 <= k2 ? c : W - 1 - c;
  char s[16]; to36(key, s);
  printf("%s %d\n", s, col);
  fflush(stdout);
  stored++;
  if (wins_now(P, c)) return;
  Pos Q = play(P, c);
  if (Q.n >= SIZE) return;
  for (int h = 0; h < W; h++) {
    if (!playable(&Q, h)) continue;
    if (wins_now(&Q, h)) continue;   // the human wins: game over
    Pos R = play(&Q, h);
    visit(&R);
  }
}

int main(int argc, char **argv) {
  for (int c = 0; c < W; c++) BOTTOM |= bottom_mask(c);
  BOARD = BOTTOM * ((1ULL << H) - 1);
  if (argc > 1 && !strcmp(argv[1], "check")) {
    /* "check": read move strings (columns 1-7) and print the move chosen and the work done,
       to compare with the JavaScript solver */
    ttKey = malloc(TT_SIZE * 4); ttVal = malloc(TT_SIZE);
    char line[64];
    while (fgets(line, sizeof line, stdin)) {
      Pos P; memset(&P, 0, sizeof P);
      for (char *q = line; *q >= '1' && *q <= '7'; q++) P = play(&P, *q - '1');
      tt_clear(); nodes = 0;
      int c = best(&P);
      line[strcspn(line, "\n")] = 0;
      printf("%s %d %lld\n", line, c, nodes);
    }
    return 0;
  }
  maxNodes = argc > 1 ? atoll(argv[1]) : 1000000;
  int jobs = argc > 2 ? atoi(argv[2]) : 4;

  /* Work items: the bot to move after each human opening (bot second), and after each human
     reply to the bot's opening (bot first). Mirror images are skipped. The bot opens in the
     centre: it is the only first move that wins (Allis, Allen 1988), so it is not re-solved. */
  ttKey = malloc(TT_SIZE * 4); ttVal = malloc(TT_SIZE);
  seen = calloc(1ULL << SEEN_BITS, sizeof(u64));
  Pos root; memset(&root, 0, sizeof root);
  Pos items[8]; int ni = 0;
  char s[16]; to36(root.cur + root.mask, s);
  printf("%s %d\n", s, 3);
  fflush(stdout);
  Pos open = play(&root, 3);
  for (int h = 0; h < 4; h++) { items[ni++] = play(&root, h); items[ni++] = play(&open, h); }
  if (argc > 3) {
    /* one work item only, with the replies to the bot's move split across processes */
    int it = atoi(argv[3]);
    Pos *P = &items[it];
    tt_clear(); nodes = 0;
    int c = best(P);
    u64 k1 = P->cur + P->mask, k2 = mirror_key(P);
    to36(k1 <= k2 ? k1 : k2, s);
    printf("%s %d\n", s, k1 <= k2 ? c : W - 1 - c);
    fflush(stdout);
    Pos Q = play(P, c);
    for (int h = 0; h < W; h++) {
      if (wins_now(&Q, h)) continue;
      if (fork() == 0) {
        Pos R = play(&Q, h);
        visit(&R);
        fprintf(stderr, "item %d reply %d done (%lld visited, %lld stored)\n", it, h, visited, stored);
        _exit(0);
      }
    }
    while (wait(NULL) > 0) {}
    return 0;
  }
  for (int j = 0; j < jobs; j++) {
    if (fork() == 0) {
      for (int i = j; i < ni; i += jobs) {
        visit(&items[i]);
        fprintf(stderr, "job %d: item %d done (%lld visited, %lld stored)\n", j, i, visited, stored);
      }
      _exit(0);
    }
  }
  while (wait(NULL) > 0) {}
  return 0;
}
