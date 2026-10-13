/* Provably-fair layer.
   Before you bet you are shown SHA-256(server seed). Every result is derived from
   HMAC-SHA256(server seed, "clientSeed:nonce:cursor"), 4 bytes per random number.
   Rotating the pair reveals the old server seed so past bets can be re-checked.

   Honest caveat: this is a front-end demo, so the "server" seed is generated and kept
   in this browser. The maths is real and verifiable; the secrecy of a real server is not. */
(function () {
  'use strict';
  const { $, $$, h, esc } = BB;
  const H = window.BBHash;

  const randomHex = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return H.hex(a); };
  const sha256hex = (str) => H.hex(H.sha256(H.utf8(str)));

  /** Deterministic number stream for one bet. */
  function rngFor(server, client, nonce) {
    const key = H.utf8(server);
    let block = 0, buf = null, pos = 32;
    return {
      nonce, client,
      float() {
        if (pos >= 32) { buf = H.hmac(key, H.utf8(`${client}:${nonce}:${block++}`)); pos = 0; }
        const f = buf[pos] / 256 + buf[pos + 1] / 65536 + buf[pos + 2] / 16777216 + buf[pos + 3] / 4294967296;
        pos += 4;
        return f;
      },
      int(n) { return Math.floor(this.float() * n); },
      /** Remove and return a random element (draws without replacement). */
      pick(pool) { return pool.splice(Math.floor(this.float() * pool.length), 1)[0]; },
    };
  }

  function state() {
    const u = BB.user();
    if (!u) return null;
    if (!u.fair) {
      u.fair = { server: randomHex(32), next: randomHex(32), client: randomHex(8), nonce: 0, prev: null, gen: 0 };
      BB.saveUsers();
    }
    if (u.fair.gen == null) u.fair.gen = 0; // counts rotations, so a saved bet knows which pair it used
    return u.fair;
  }

  /** Start a bet: bumps the nonce and returns that bet's number stream. */
  function roll() {
    const f = state();
    if (!f) return rngFor(randomHex(32), 'guest', 0);
    f.nonce++;
    BB.saveUsers();
    return rngFor(f.server, f.client, f.nonce);
  }

  function rotate(newClient) {
    const f = state();
    if (!f) return;
    f.prev = { server: f.server, client: f.client, nonce: f.nonce, gen: f.gen };
    f.gen++;
    f.server = f.next;
    f.next = randomHex(32);
    f.client = (newClient || '').trim().slice(0, 64) || randomHex(8);
    f.nonce = 0;
    BB.saveUsers();
  }

  const copyField = (label, value, id) => `
    <div class="field"><span class="field-l">${label}</span>
      <div class="copy"><input type="text" readonly value="${esc(value)}"${id ? ` id="${id}"` : ''}><button type="button" data-copy>Copy</button></div></div>`;

  function open(prefill) {
    BB.hideModal($('#fair'));
    const f = state();
    const gameOpts = BB.order.filter((id) => BB.games[id].verify).map((id) => `<option value="${id}">${BB.games[id].name}</option>`).join('');
    const seeds = f ? `
        ${copyField('Active client seed', f.client)}
        ${copyField('Active server seed (hashed)', sha256hex(f.server))}
        <div class="field"><span class="field-l">Bets made with this pair</span><div class="readout">${f.nonce}</div></div>
        <div class="fair-sep"><span>Rotate seed pair</span></div>
        <div class="field"><span class="field-l">New client seed</span>
          <div class="copy"><input type="text" id="fair-new" value="${randomHex(8)}" maxlength="64" spellcheck="false"><button type="button" class="go" id="fair-rotate">Rotate</button></div></div>
        ${copyField('Next server seed (hashed)', sha256hex(f.next))}
        ${f.prev ? `
        <div class="fair-sep"><span>Previous pair — revealed</span></div>
        ${copyField('Server seed (unhashed)', f.prev.server)}
        ${copyField('Client seed', f.prev.client)}
        <div class="fair-prev"><span>${f.prev.nonce} bet${f.prev.nonce === 1 ? '' : 's'} were made with it.</span><button type="button" class="btn ghost sm" id="fair-check">Verify one</button></div>` : `
        <p class="hint left">Rotate the pair to reveal the current server seed, then check any bet you made with it in the Verify tab.</p>`}`
      : `<div class="empty">Log in to get your own seed pair.<br>The Verify tab works without an account.</div>`;

    const m = h(`
      <div class="modal-back" id="fair">
        <div class="modal single" role="dialog" aria-modal="true" aria-label="Provably fair">
          <button class="modal-x" aria-label="Close">&times;</button>
          <div class="modal-body">
            <h2 class="modal-title"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2.500l8 3v6c0 5-3.400 8.700-8 10-4.600-1.300-8-5-8-10v-6z" fill="currentColor"/><path d="M8.500 12l2.500 2.500 4.500-5" fill="none" stroke="#161922" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Provably fair</h2>
            <div class="tabs">
              <button type="button" data-tab="seeds">Seeds</button>
              <button type="button" data-tab="verify">Verify</button>
            </div>
            <div data-pane="seeds">${seeds}</div>
            <div data-pane="verify" hidden>
              <div class="row2">
                <div class="field"><span class="field-l">Game</span><select id="fv-game">${gameOpts}</select></div>
                <div class="field"><span class="field-l">Nonce</span><input type="text" inputmode="numeric" id="fv-nonce" value="1"></div>
              </div>
              <div class="field"><span class="field-l">Client seed</span><input type="text" id="fv-client" spellcheck="false"></div>
              <div class="field"><span class="field-l">Server seed (unhashed)</span><input type="text" id="fv-server" spellcheck="false" placeholder="Revealed after you rotate the pair"></div>
              <div class="fair-out" id="fv-out"></div>
            </div>
            <p class="fair-note">Results come from <code>HMAC-SHA256(serverSeed, clientSeed:nonce:cursor)</code>. The hash shown before you bet is <code>SHA-256(serverSeed)</code>, so the seed can't be swapped afterwards. Note: seeds are generated in your browser and saved with your account.</p>
          </div>
        </div>
      </div>`);

    const setTab = (t) => {
      $$('.tabs button', m).forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
      $$('[data-pane]', m).forEach((p) => { p.hidden = p.dataset.pane !== t; });
    };
    $$('.tabs button', m).forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

    m.addEventListener('click', (e) => {
      const c = e.target.closest('[data-copy]');
      if (!c) return;
      const input = c.parentElement.querySelector('input');
      input.select();
      const done = () => { c.textContent = 'Copied'; setTimeout(() => { c.textContent = 'Copy'; }, 1200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(input.value).then(done, done);
      else { try { document.execCommand('copy'); } catch (err) { /* ignore */ } done(); }
    });

    const runVerify = () => {
      const out = $('#fv-out', m);
      const server = $('#fv-server', m).value.trim(), client = $('#fv-client', m).value.trim();
      const nonce = parseInt($('#fv-nonce', m).value, 10);
      const g = BB.games[$('#fv-game', m).value];
      if (!server || !client || !(nonce >= 0) || !g) { out.innerHTML = '<div class="empty">Enter a server seed, client seed and nonce.</div>'; return; }
      const rows = [['Server seed hash', sha256hex(server)]].concat(g.verify(rngFor(server, client, nonce), () => rngFor(server, client, nonce)));
      out.innerHTML = rows.map((r) => `<div class="fo-row"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('');
    };
    $$('#fv-game, #fv-nonce, #fv-client, #fv-server', m).forEach((el) => el.addEventListener('input', runVerify));

    const fillVerify = (v) => {
      $('#fv-server', m).value = v.server || '';
      $('#fv-client', m).value = v.client || '';
      $('#fv-nonce', m).value = v.nonce != null ? v.nonce : 1;
      if (v.game && BB.games[v.game]) $('#fv-game', m).value = v.game;
      setTab('verify');
      runVerify();
    };

    const rot = $('#fair-rotate', m);
    if (rot) rot.addEventListener('click', () => {
      rotate($('#fair-new', m).value);
      BB.toast('Seed pair rotated. The old server seed is now revealed.', 'ok');
      open();
    });
    const chk = $('#fair-check', m);
    if (chk) chk.addEventListener('click', () => fillVerify({ server: f.prev.server, client: f.prev.client, nonce: Math.max(1, f.prev.nonce) }));

    BB.showModal(m);
    if (f) $('#fv-client', m).value = f.client;
    if (prefill) fillVerify(prefill); else { setTab('seeds'); runVerify(); }
  }

  /** Open the verifier for one of your saved bets (b = a row from BB.history()). */
  function verifyBet(b) {
    const f = state();
    if (!f) return;
    if (f.prev && f.prev.gen === b.gen) { open({ server: f.prev.server, client: f.prev.client, nonce: b.nonce, game: b.id }); return; }
    if (f.gen === b.gen) {
      open({ client: f.client, nonce: b.nonce, game: b.id });
      BB.toast('That bet used your active seed pair. Rotate the pair (Seeds tab) to reveal its server seed.', '');
      return;
    }
    open({ nonce: b.nonce, game: b.id });
    BB.toast('The seed pair for that bet has been replaced — this demo only keeps the latest revealed pair.', '');
  }

  BB.fair = { roll, rotate, state, open, verifyBet, rngFor, sha256hex, randomHex };
})();
