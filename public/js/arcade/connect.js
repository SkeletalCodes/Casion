/* Connect — four, five or six in a row against the house bot. Free play: there is no bet.
   Connect 4 (7×6), Connect 5 (9×7) or Connect 6 (11×8); you choose who drops the first disc.
   The bot thinks in a Web Worker (connect-ai.js) so the page never freezes:
   on 7×6 it is a perfect solver, on the bigger boards a deep search. */
(function () {
  'use strict';
  const { $, $$, h, sleep } = BB;

  const MODES = {
    c4: { w: 7, h: 6, k: 4, label: 'Connect 4', size: '7×6', ms: 0, max: 560 },
    c5: { w: 9, h: 7, k: 5, label: 'Connect 5', size: '9×7', ms: 1800, max: 640 },
    c6: { w: 11, h: 8, k: 6, label: 'Connect 6', size: '11×8', ms: 2200, max: 760 },
  };
  const VER = (document.querySelector('script[src*="arcade/connect.js"]') || { src: '' }).src.split('?')[1] || '';
  const STORE = 'bb-connect';

  let mode = 'c4', botFirst = false;
  let M = MODES.c4, moves = [], hgt = [], cells = [], over = null, thinking = false, game = 0, alive = 0;
  let worker = null, reqId = 0;
  const waiting = {};
  let record = load();

  function load() {
    try { const r = JSON.parse(localStorage.getItem(STORE)); if (r && typeof r === 'object') return r; } catch (e) { /* private mode */ }
    return {};
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(record)); } catch (e) { /* ignore */ } }
  const rec = () => record[mode] || (record[mode] = { w: 0, d: 0, l: 0 });

  /* ---------- the bot ---------- */
  function ask(variant, list, opts) {
    if (!worker) {
      try {
        worker = new Worker('js/arcade/connect-ai.js' + (VER ? '?' + VER : ''));
        worker.onmessage = (e) => { const d = e.data || {}, f = waiting[d.id]; if (f) { delete waiting[d.id]; f(d.result); } };
        worker.onerror = () => { Object.keys(waiting).forEach((k) => { waiting[k](null); delete waiting[k]; }); };
      } catch (e) { return Promise.resolve(null); }
    }
    const id = ++reqId;
    return new Promise((res) => { waiting[id] = res; worker.postMessage({ id, variant, moves: list, opts }); });
  }

  /** Drop a search nobody is waiting for any more (a new game, or the page was left). */
  function cancel() {
    if (!thinking || !worker) return;
    worker.terminate();
    worker = null;
    Object.keys(waiting).forEach((k) => { waiting[k](null); delete waiting[k]; });
  }

  /* ---------- rules ---------- */
  const me = () => (botFirst ? 1 : 0);          // the human's player index (0 moves first)
  const turn = () => moves.length & 1;
  const at = (c, r) => cells[c * M.h + r];
  /** The winning cells through (c, r) for player p, or null. */
  function line(c, r, p) {
    for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const run = [[c, r]];
      for (const s of [1, -1]) {
        let x = c + dc * s, y = r + dr * s;
        while (x >= 0 && x < M.w && y >= 0 && y < M.h && at(x, y) === p + 1) { run.push([x, y]); x += dc * s; y += dr * s; }
      }
      if (run.length >= M.k) return run;
    }
    return null;
  }

  /* ---------- drawing ---------- */
  function board() {
    let s = '';
    for (let r = M.h - 1; r >= 0; r--) for (let c = 0; c < M.w; c++) s += `<i class="cn-cell" data-c="${c}" data-r="${r}"><b></b></i>`;
    return s;
  }
  function paintBoard() {
    const el = $('.cn-board');
    el.style.setProperty('--w', M.w);
    el.style.setProperty('--h', M.h);
    el.className = 'cn-board ' + mode;
    el.innerHTML = board();
    $('.cn-stage').style.setProperty('--max', M.max + 'px');
    $('#cn-cols').style.setProperty('--w', M.w);
    $('#cn-cols').innerHTML = Array.from({ length: M.w }, (_, c) => `<button type="button" data-c="${c}" aria-label="Drop a disc in column ${c + 1}"></button>`).join('');
  }
  function disc(c, r, p, drop) {
    const el = $(`.cn-cell[data-c="${c}"][data-r="${r}"]`);
    if (!el) return;
    el.classList.add(p === me() ? 'you' : 'bot');
    if (drop) {
      el.style.setProperty('--fall', M.h - r);
      el.classList.remove('drop'); void el.offsetWidth; el.classList.add('drop');
    }
    $$('.cn-cell.last').forEach((x) => x.classList.remove('last'));
    el.classList.add('last');
  }
  function status() {
    const say = $('#cn-say'), playing = !over;
    $$('.cn-cell.ghost').forEach((x) => x.classList.remove('ghost'));
    let txt;
    if (over) txt = over.winner === null ? 'Draw — the board is full' : over.winner === me() ? 'You win!' : 'The bot wins';
    else if (thinking) txt = 'Bot is thinking…';
    else if (turn() === me()) txt = moves.length ? 'Your move' : 'Your move — drop a disc';
    else txt = 'Bot to move';
    say.textContent = txt;
    say.className = 'cn-say' + (over ? (over.winner === null ? ' draw' : over.winner === me() ? ' win' : ' lose') : thinking ? ' wait' : '');
    $('.cn-stage').classList.toggle('mine', playing && !thinking && turn() === me());
    $$('#cn-cols button').forEach((b) => { b.disabled = !playing || thinking || turn() !== me() || hgt[+b.dataset.c] >= M.h; });
    const r = rec();
    $('#cn-w').textContent = r.w; $('#cn-d').textContent = r.d; $('#cn-l').textContent = r.l;
    $('#cn-moves').textContent = moves.length;
  }

  /* ---------- play ---------- */
  function drop(c) {
    const r = hgt[c], p = turn();
    hgt[c]++;
    cells[c * M.h + r] = p + 1;
    moves.push(c);
    disc(c, r, p, true);
    BB.sfx('coinLand');
    const run = line(c, r, p);
    if (run) return finish(p, run);
    if (moves.length === M.w * M.h) return finish(null);
    return false;
  }

  function finish(winner, run) {
    over = { winner };
    const r = rec();
    if (winner === null) r.d++; else if (winner === me()) r.w++; else r.l++;
    save();
    if (run) run.forEach(([c, rr]) => { const el = $(`.cn-cell[data-c="${c}"][data-r="${rr}"]`); if (el) el.classList.add('won'); });
    const pop = $('#cn-res');
    if (winner === null) { pop.className = 'result-pop show push'; pop.innerHTML = '<b>Draw</b><span>Nobody got ' + M.k + ' in a row</span>'; BB.sfx('push'); }
    else if (winner === me()) { pop.className = 'result-pop show'; pop.innerHTML = '<b>You win!</b><span>You beat the bot</span>'; BB.sfx('bigwin'); BB.confetti($('.cn-wrap'), 90); }
    else { pop.className = 'result-pop show bad'; pop.innerHTML = '<b>Bot wins</b><span>' + M.k + ' in a row</span>'; BB.sfx('lose'); }
    $('.cn-board').classList.add('done');
    // let the winning line show through after a moment
    const g = game;
    setTimeout(() => { if (g === game && pop.isConnected) pop.classList.remove('show'); }, 2400);
    status();
    return true;
  }

  async function botMove() {
    if (over || turn() === me()) return;
    const my = alive, g = game;
    thinking = true;
    status();
    const t0 = Date.now();
    const res = await ask(mode, moves.slice(), { ms: M.ms });
    if (my !== alive || g !== game) return;
    // a short pause so an instant answer still reads as a move
    const wait = 420 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    if (my !== alive || g !== game) return;
    thinking = false;
    let c = res && res.move;
    if (!(c >= 0 && c < M.w) || hgt[c] >= M.h) {
      // the worker couldn't run: fall back to the first open column near the centre
      const order = Array.from({ length: M.w }, (_, i) => i).sort((a, b) => Math.abs(a - (M.w - 1) / 2) - Math.abs(b - (M.w - 1) / 2));
      c = order.find((x) => hgt[x] < M.h);
      if (!res) BB.toast('The bot could not start in this browser.', 'bad');
    }
    drop(c);
    status();
  }

  function humanMove(c) {
    if (over || thinking || turn() !== me() || !(c >= 0 && c < M.w) || hgt[c] >= M.h) return;
    if (drop(c)) return;
    botMove();
  }

  function newGame() {
    cancel();
    game++;
    M = MODES[mode];
    moves = []; over = null; thinking = false;
    hgt = new Array(M.w).fill(0);
    cells = new Array(M.w * M.h).fill(0);
    $('#cn-res').className = 'result-pop';
    $('#cn-k').textContent = M.k;
    paintBoard();
    status();
    if (botFirst) botMove();
  }

  /* ---------- artwork ---------- */
  const ART = (() => {
    let s = '<svg viewBox="0 0 200 200"><rect x="22" y="40" width="156" height="134" rx="16" fill="#2b1563"/><rect x="22" y="40" width="156" height="134" rx="16" fill="none" stroke="#5b34b5" stroke-width="3"/>';
    const grid = ['.....', '...g.', '..rg.', '.grrg', 'grrgr'];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      const x = 46 + c * 27, y = 62 + r * 24, k = grid[r][c];
      s += `<circle cx="${x}" cy="${y}" r="10.500" fill="${k === 'g' ? '#ffc93c' : k === 'r' ? '#ff4d67' : '#150a33'}"/>`;
    }
    s += '<circle cx="127" cy="22" r="11" fill="#ffc93c"/><path d="M127 36v8" stroke="#ffc93c" stroke-width="3" stroke-linecap="round"/><path d="M38 176h124" stroke="#5b34b5" stroke-width="6" stroke-linecap="round"/></svg>';
    return s;
  })();

  BB.registerGame({
    id: 'connect',
    name: 'Connect',
    cat: 'arcade',
    free: true,
    rtp: '100.0',
    badge: 'NEW',
    colors: ['#ffc93c', '#2b1563'],
    icon: '<svg viewBox="0 0 24 24"><rect x="2.500" y="4" width="19" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="9.500" r="1.900" fill="currentColor"/><circle cx="12" cy="14.500" r="1.900" fill="currentColor"/><circle cx="16" cy="14.500" r="1.900" fill="currentColor"/><circle cx="8" cy="14.500" r="1.900" fill="currentColor"/></svg>',
    art: ART,

    mount(panel, stage) {
      alive++;
      panel.appendChild(h(`<div>
        <div class="field"><span class="field-l">Game</span>${BB.ui.seg('cn-mode', Object.keys(MODES).map((k) => [k, `${MODES[k].label}<small>${MODES[k].size}</small>`]), mode)}</div>
        <div class="field"><span class="field-l">First move</span>${BB.ui.seg('cn-first', [['you', 'You start'], ['bot', 'Bot starts']], botFirst ? 'bot' : 'you')}</div>
        <div class="cn-record">
          <div><small>You won</small><b id="cn-w">0</b></div>
          <div><small>Draws</small><b id="cn-d">0</b></div>
          <div><small>Bot won</small><b id="cn-l">0</b></div>
        </div>
        <button class="btn primary lg block" id="cn-new">New game</button>
        <p class="panel-note" id="cn-note"></p>
      </div>`));
      stage.appendChild(h(`<div class="cn-wrap">
        <div class="cn-top"><span class="cn-say" id="cn-say"></span><span class="cn-meta"><b id="cn-k">4</b> in a row · move <b id="cn-moves">0</b></span></div>
        <div class="cn-stage">
          <div class="cn-board"></div>
          <div class="cn-cols" id="cn-cols"></div>
        </div>
        <div class="cn-legend"><span><i class="you"></i>You</span><span><i class="bot"></i>Bot</span></div>
        <div class="result-pop" id="cn-res"></div>
      </div>`));
      const note = () => {
        $('#cn-note').textContent = mode === 'c4'
          ? 'On 7×6 the bot plays perfectly: it never makes a move that loses ground. Connect 4 is a win for whoever starts, so when the bot starts it always wins, and when you start you can only beat it with a perfect game.'
          : `Get ${MODES[mode].k} in a row — across, up or diagonally — before the bot does. On this board the bot reads many moves ahead and never misses a win or a block in its search.`;
      };
      BB.ui.bindSeg($('#cn-mode'), (v) => { if (!MODES[v]) return; mode = v; note(); newGame(); });
      BB.ui.bindSeg($('#cn-first'), (v) => { botFirst = v === 'bot'; newGame(); });
      $('#cn-new').addEventListener('click', () => { BB.sfx('click'); newGame(); });
      $('#cn-cols').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) humanMove(+b.dataset.c); });
      // hover shows where the disc would land
      $('#cn-cols').addEventListener('mouseover', (e) => {
        const b = e.target.closest('button');
        $$('.cn-cell.ghost').forEach((x) => x.classList.remove('ghost'));
        if (!b || b.disabled) return;
        const c = +b.dataset.c, el = $(`.cn-cell[data-c="${c}"][data-r="${hgt[c]}"]`);
        if (el) el.classList.add('ghost');
      });
      $('#cn-cols').addEventListener('mouseleave', () => $$('.cn-cell.ghost').forEach((x) => x.classList.remove('ghost')));
      const keys = (e) => {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || $('#modal-root').children.length) return;
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= 9 && n <= M.w) humanMove(n - 1);
      };
      document.addEventListener('keydown', keys);
      BB.onLeave(() => document.removeEventListener('keydown', keys));
      note();
      newGame();
    },

    unmount() {
      cancel();
      alive++;
      thinking = false;
    },
  });
})();
