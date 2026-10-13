/* Plinko — each ball takes a random left/right at every peg; the bucket it lands in sets the multiplier. */
(function () {
  'use strict';
  const { $, $$, h, fmtMult, round2, clamp } = BB;

  const PAYS = {
    8: {
      low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
      medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
      high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    },
    12: {
      low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
      medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
      high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
    },
    16: {
      low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
      medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
      high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
    },
  };
  const MAX_BALLS = 30;

  let amount, cv, ctx, W = 0, H = 0, ro = null, raf = 0;
  let rows = 12, risk = 'medium';
  let balls = [];
  const pegHit = new Map(), bucketHit = new Map(), last = [];

  /** pre[i] = how many times the ball has gone right after i pegs; pre[rows] is the bucket. */
  function path(rng, n) {
    const pre = [0];
    for (let i = 0; i < n; i++) pre.push(pre[i] + (rng.float() < 0.5 ? 0 : 1));
    return pre;
  }

  function geo() {
    const R = rows, y0 = 40;
    const s = Math.min((W - 24) / (R + 2), (H - y0 - 44) / ((R - 1) * 0.9 + 0.66));
    const dy = s * 0.9, pr = Math.max(2.6, s * 0.105), br = Math.max(4.5, s * 0.2), bh = clamp(s * 0.72, 18, 34);
    return { R, s, dy, pr, br, bh, cx: W / 2, y0, by: y0 + (R - 1) * dy + dy * 0.66 };
  }

  function bucketColor(b, R) {
    const t = Math.abs(b - R / 2) / (R / 2);
    const a = [255, 201, 60], m = [255, 128, 32], e = [255, 56, 92];
    const mix = (p, q, k) => p.map((v, i) => Math.round(v + (q[i] - v) * k));
    const c = t < .5 ? mix(a, m, t * 2) : mix(m, e, (t - .5) * 2);
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  function rr(c, x, y, w, hgt, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hgt, r); c.arcTo(x + w, y + hgt, x, y + hgt, r);
    c.arcTo(x, y + hgt, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  function point(g, b, i) {
    if (i < 0) return { x: g.cx, y: g.y0 - g.dy * 1.15 };
    if (i >= g.R) return { x: g.cx + (b.pre[g.R] - g.R / 2) * g.s, y: g.by - g.br + 2 };
    return { x: g.cx + (b.pre[i] - i / 2) * g.s, y: g.y0 + i * g.dy - g.pr - g.br };
  }

  function land(b, now) {
    const payout = round2(b.bet * b.mult);
    BB.win(payout, b.mult < 1);
    BB.logBet('plinko', b.bet, b.mult, payout, null, b.nonce);
    BB.sfx(b.mult >= 5 ? 'win' : b.mult >= 1 ? 'cashout' : 'kenoMiss');
    bucketHit.set(b.bucket, now);
    last.unshift(b.mult);
    if (last.length > 6) last.pop();
    paintLast();
  }

  function frame(now) {
    raf = BB.frame(frame);
    if (!ctx || !W) return;
    const c = ctx, g = geo();
    c.clearRect(0, 0, W, H);

    // pegs
    for (let i = 0; i < g.R; i++) {
      for (let j = 0; j <= i + 2; j++) {
        const x = g.cx + (j - (i + 2) / 2) * g.s, y = g.y0 + i * g.dy;
        const hit = pegHit.get(i + ':' + j);
        const k = hit ? 1 - (now - hit) / 320 : 0;
        if (k > 0) {
          c.fillStyle = `rgba(255,201,60,${0.35 * k})`;
          c.beginPath(); c.arc(x, y, g.pr + 7 * k, 0, 7); c.fill();
        } else if (hit) pegHit.delete(i + ':' + j);
        c.fillStyle = k > 0 ? '#ffe9a8' : '#dfe4f0';
        c.beginPath(); c.arc(x, y, g.pr, 0, 7); c.fill();
      }
    }

    // buckets
    const pays = PAYS[g.R][risk], bw = g.s - Math.max(3, g.s * 0.1);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `800 ${clamp(g.s * 0.3, 9, 14)}px Outfit, Arial, sans-serif`;
    for (let b = 0; b <= g.R; b++) {
      const hit = bucketHit.get(b);
      const k = hit ? 1 - (now - hit) / 260 : 0;
      if (hit && k <= 0) bucketHit.delete(b);
      const off = k > 0 ? Math.sin(k * Math.PI) * 7 : 0;
      const x = g.cx + (b - g.R / 2) * g.s - bw / 2, y = g.by + off;
      c.fillStyle = bucketColor(b, g.R);
      c.shadowColor = c.fillStyle; c.shadowBlur = k > 0 ? 18 : 0;
      rr(c, x, y, bw, g.bh, Math.min(7, g.bh / 3)); c.fill();
      c.shadowBlur = 0;
      c.fillStyle = 'rgba(0,0,0,.2)';
      rr(c, x, y + g.bh - 4, bw, 4, 2); c.fill();
      c.fillStyle = '#1c1300';
      const v = pays[b];
      c.fillText(g.s < 44 ? String(v) : v + '×', x + bw / 2, y + g.bh / 2);
    }

    // balls
    const keep = [];
    for (const b of balls) {
      const el = now - b.t0, first = 190;
      let k = -1, t = el / first;
      if (el >= first) { k = Math.floor((el - first) / b.hop); t = (el - first - k * b.hop) / b.hop; }
      if (k >= g.R) { land(b, now); continue; }
      if (k !== b.seg) { b.seg = k; if (k >= 0) { pegHit.set(k + ':' + (b.pre[k] + 1), now); BB.sfx('tick', 0.45); } }
      const A = point(g, b, k), B = point(g, b, k + 1);
      const v = k < 0 ? 0 : g.dy * 0.62;
      const x = A.x + (B.x - A.x) * t;
      const y = A.y - v * t + (B.y - A.y + v) * t * t;
      const grad = c.createRadialGradient(x - g.br * .35, y - g.br * .4, 1, x, y, g.br);
      grad.addColorStop(0, '#fff6c4'); grad.addColorStop(.55, '#ffc93c'); grad.addColorStop(1, '#e08a00');
      c.shadowColor = 'rgba(255,190,50,.8)'; c.shadowBlur = 14;
      c.fillStyle = grad; c.beginPath(); c.arc(x, y, g.br, 0, 7); c.fill();
      c.shadowBlur = 0;
      keep.push(b);
    }
    if (keep.length !== balls.length) { balls = keep; lock(); }
  }

  function paintLast() {
    const box = $('#pl-last');
    if (box) box.innerHTML = last.map((m) => `<span class="pl-pill ${m >= 1 ? (m >= 5 ? 'big' : 'good') : 'bad'}">${fmtMult(m)}</span>`).join('');
  }

  function lock() {
    const busy = balls.length > 0;
    $$('#pl-risk button, #pl-rows button').forEach((b) => { b.disabled = busy; });
  }

  function drop() {
    if (balls.length >= MAX_BALLS) return;
    const bet = amount.get();
    if (!BB.placeBet(bet)) return;
    const rng = BB.fair.roll();
    const pre = path(rng, rows);
    balls.push({ pre, bucket: pre[rows], mult: PAYS[rows][risk][pre[rows]], bet, nonce: rng.nonce, t0: performance.now(), hop: 205 + BB.rand() * 50, seg: -2 });
    lock();
  }

  function size() {
    if (!cv) return;
    const box = cv.parentElement, dpr = Math.min(2, window.devicePixelRatio || 1);
    W = box.clientWidth; H = box.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function art() {
    let s = '';
    for (let i = 0; i < 5; i++) for (let j = 0; j <= i + 2; j++) s += `<circle cx="${100 + (j - (i + 2) / 2) * 26}" cy="${34 + i * 25}" r="5" fill="#fff"/>`;
    const cols = ['#ff385c', '#ff8020', '#ffc93c', '#ffc93c', '#ff8020', '#ff385c'];
    for (let b = 0; b < 6; b++) s += `<rect x="${100 + (b - 3) * 26 + 2}" y="150" width="22" height="24" rx="6" fill="${cols[b]}"/>`;
    return `<svg viewBox="0 0 200 200">${s}<circle cx="113" cy="71" r="11" fill="#ffc93c" stroke="#fff6c4" stroke-width="3"/></svg>`;
  }

  BB.registerGame({
    id: 'plinko',
    name: 'Plinko',
    rtp: '99.0',
    verify(rng) {
      const pre = path(rng, 16);
      let dirs = '';
      for (let i = 0; i < 16; i++) dirs += pre[i + 1] > pre[i] ? 'R' : 'L';
      return [['Path (top peg first)', dirs], ['Bucket, counted from the left', `8 rows: ${pre[8] + 1}  ·  12 rows: ${pre[12] + 1}  ·  16 rows: ${pre[16] + 1}`]];
    },
    colors: ['#ff5c9d', '#3a0c27'],
    icon: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="8" cy="11" r="2"/><circle cx="16" cy="11" r="2"/><circle cx="4" cy="17.500" r="2"/><circle cx="12" cy="17.500" r="2"/><circle cx="20" cy="17.500" r="2"/></svg>',
    art: art(),

    mount(panel, stage) {
      balls = []; pegHit.clear(); bucketHit.clear();
      amount = BB.ui.amount({ value: 100 });
      panel.appendChild(amount.el);
      panel.appendChild(h(`<div>
        <div class="field"><span class="field-l">Risk</span>
          <div class="seg" id="pl-risk">${['low', 'medium', 'high'].map((r) => `<button data-v="${r}" class="${r === risk ? 'on' : ''}">${r[0].toUpperCase() + r.slice(1)}</button>`).join('')}</div></div>
        <div class="field"><span class="field-l">Rows</span>
          <div class="seg" id="pl-rows">${[8, 12, 16].map((r) => `<button data-v="${r}" class="${r === rows ? 'on' : ''}">${r}</button>`).join('')}</div></div>
        <button class="btn primary lg block" id="pl-drop">Drop ball</button>
        <p class="panel-note">Each click drops another ball — stack as many as you like. Edges pay big, the middle pays small.</p>
      </div>`));
      stage.appendChild(h(`<div class="pl-box"><canvas id="pl-cv"></canvas><div class="pl-last" id="pl-last"></div></div>`));
      cv = $('#pl-cv');
      size();
      ro = new ResizeObserver(size);
      ro.observe(cv.parentElement);
      $('#pl-drop').addEventListener('click', drop);
      $('#pl-risk').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b || b.disabled) return;
        risk = b.dataset.v;
        $$('#pl-risk button').forEach((x) => x.classList.toggle('on', x === b));
      });
      $('#pl-rows').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b || b.disabled) return;
        rows = Number(b.dataset.v);
        $$('#pl-rows button').forEach((x) => x.classList.toggle('on', x === b));
      });
      paintLast();
      raf = BB.frame(frame);
    },

    unmount() {
      BB.unframe(raf);
      if (ro) ro.disconnect();
      // Balls still falling have already been decided — settle them so nothing is lost.
      for (const b of balls) { const p = round2(b.bet * b.mult); BB.win(p, true); BB.logBet('plinko', b.bet, b.mult, p, null, b.nonce); }
      balls = []; cv = null; ctx = null; ro = null;
    },
  });
})();
