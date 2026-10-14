/* Lobby — hero + promo carousel, latest-wins strip, recently played, then one "All games" grid.
   Slots sit behind a single tile that opens their own lobby (#/slots), filtered by studio.
   The wins strip and the live bets table come from the server: real rounds by real players. */
(function () {
  'use strict';
  const { $, $$, h, fmt, esc } = BB;
  const ic = BB.icon;

  const FILTERS = [['all', 'All games'], ['arcade', 'Arcade'], ['table', 'Table'], ['instant', 'Instant'], ['cashout', 'Cash out']];
  const TITLES = { originals: 'BananaBet Originals', arcade: 'Arcade', table: 'Table games', instant: 'Instant win', cashout: 'Climb & cash out', fav: 'Favourites' };
  const GRID_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.500"/><rect x="13" y="4" width="7" height="7" rx="1.500"/><rect x="4" y="13" width="7" height="7" rx="1.500"/><rect x="13" y="13" width="7" height="7" rx="1.500"/></svg>';
  const SLOTS_ART = `<svg viewBox="0 0 200 200">
    <rect x="30" y="22" width="140" height="150" rx="22" fill="#3a0d2c" stroke="#ffc93c" stroke-width="5"/>
    <rect x="44" y="12" width="112" height="30" rx="12" fill="#ffc93c"/><text x="100" y="34" font-size="20" font-weight="800" text-anchor="middle" fill="#3a0d2c" font-family="Outfit,Arial,sans-serif">JACKPOT</text>
    <rect x="42" y="58" width="36" height="62" rx="8" fill="#fff"/><rect x="82" y="58" width="36" height="62" rx="8" fill="#fff"/><rect x="122" y="58" width="36" height="62" rx="8" fill="#fff"/>
    <g fill="#ff3b5c" stroke="#8a0f26" stroke-width="2" stroke-linejoin="round"><path d="M49 74h22v6L62 106h-9l9-20H49z"/><path d="M89 74h22v6l-9 26h-9l9-20H89z"/><path d="M129 74h22v6l-9 26h-9l9-20h-13z"/></g>
    <rect x="46" y="132" width="108" height="14" rx="7" fill="#1c0616"/><circle cx="62" cy="139" r="5" fill="#2fe08a"/><circle cx="100" cy="139" r="5" fill="#ffc93c"/><circle cx="138" cy="139" r="5" fill="#ff4d67"/>
    <path d="M172 100v-44" stroke="#c9cfde" stroke-width="7" stroke-linecap="round"/><circle cx="172" cy="50" r="12" fill="#ff4d67" stroke="#8a0f26" stroke-width="3"/>
  </svg>`;
  let timer = 0, slideTimer = 0, tab = 'all', cat = 'all', query = '', slide = 0;
  let studio = 'all', slotQuery = '', slotSort = 'featured';
  const slotIds = () => BB.order.filter((id) => BB.games[id].cat === 'slots');
  const studioIds = () => Object.keys(provs()).filter((k) => slotIds().some((id) => BB.games[id].provider === k));

  const feedOn = () => { const u = BB.user(); return !u || u.prefs.feed !== false; };
  const provs = () => BB.providers || {};
  const matches = (g) => {
    if (cat === 'fav') return BB.isFav(g.id);
    if (cat === 'all' || cat === 'originals') return g.cat !== 'slots';
    return g.cat === cat;
  };

  /* live feed from /api/feed */
  let feed = { recent: [], big: [] }, lastTop = 0;
  const feedTimer = { soon: 0 };
  const row = (b) => ({ game: BB.games[b.game] ? BB.games[b.game].name : b.game, id: b.game, user: b.name || 'Hidden', mine: b.mine, wager: b.wager, mult: b.mult, payout: b.payout, t: b.t });
  async function loadFeed() {
    try { feed = await BB.api('GET', 'feed'); } catch (e) { return; }
    const top = feed.recent[0] ? feed.recent[0].id : 0;
    paintFeed(top !== lastTop && lastTop !== 0);
    lastTop = top;
    paintWinners();
  }

  function paintFeed(flash) {
    const box = $('#feed');
    if (!box) return;
    let list = (tab === 'big' ? feed.big : feed.recent).map(row);
    if (!feedOn()) list = list.filter((b) => b.mine);
    if (tab === 'mine') list = BB.history();
    list = list.slice(0, 10);
    box.innerHTML = list.length
      ? `<div class="tr th"><span class="td g">Game</span><span class="td u">Player</span><span class="td n">Bet</span><span class="td m">Multiplier</span><span class="td n">Profit</span></div>` + list.map((b) => BB.betRow(b, true)).join('')
      : `<div class="empty">${tab === 'mine' ? 'Your bets will show up here once you play a round.' : BB.serverDown() ? 'The live feed is offline right now.' : 'No bets yet — be the first to play.'}</div>`;
    if (flash && list.length && box.children[1]) box.children[1].classList.add('new');
  }
  const onBet = () => { clearTimeout(feedTimer.soon); feedTimer.soon = setTimeout(loadFeed, 700); };

  /** The marquee: real recent big wins, or a strip of games to try while there are none. */
  function winnersHTML() {
    const wins = feed.big.filter((b) => BB.games[b.game]).slice(0, 14);
    let cards;
    if (wins.length >= 3) {
      cards = wins.map((b) => {
        const g = BB.games[b.game];
        return `<a class="wcard" href="#/g/${g.id}">
          <span class="wthumb" style="--c1:${g.colors[0]};--c2:${g.colors[1]}"><i>${g.icon}</i></span>
          <span class="wmeta"><b>${esc(g.name)}</b><small>${esc(b.name || 'Hidden')} · ${BB.fmtMult(b.mult)}</small></span>
          <span class="wamt">+${fmt(b.payout - b.wager)}</span>
        </a>`;
      });
    } else {
      cards = BB.order.filter((id) => BB.games[id].cat !== 'slots').slice(0, 14).map((id) => {
        const g = BB.games[id], r = BB.rules && BB.rules[id];
        return `<a class="wcard" href="#/g/${g.id}">
          <span class="wthumb" style="--c1:${g.colors[0]};--c2:${g.colors[1]}"><i>${g.icon}</i></span>
          <span class="wmeta"><b>${esc(g.name)}</b><small>${BB.rtpText(g)}</small></span>
          <span class="wamt">${r && r.max ? 'up to ' + r.max : 'Play'}</span>
        </a>`;
      });
    }
    const strip = cards.join('');
    return `<div class="winners-track">${strip}${strip}</div>`; // doubled so the marquee loops seamlessly
  }
  function paintWinners() {
    const v = $('#winners-view');
    if (!v) return;
    const html = winnersHTML();
    if (v.dataset.sig !== html.length + ':' + feed.big.length) { v.innerHTML = html; v.dataset.sig = html.length + ':' + feed.big.length; }
  }

  function chips(x, y, n, color) {
    let s = '';
    for (let i = 0; i < n; i++) {
      const cy = y - i * 13;
      s += `<ellipse cx="${x}" cy="${cy + 9}" rx="44" ry="15" fill="rgba(0,0,0,.35)"/><ellipse cx="${x}" cy="${cy}" rx="44" ry="15" fill="${color}"/><ellipse cx="${x}" cy="${cy}" rx="44" ry="15" fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="14 14" opacity=".8"/>`;
    }
    return s + `<ellipse cx="${x}" cy="${y - (n - 1) * 13}" rx="26" ry="8.5" fill="rgba(255,255,255,.2)"/>`;
  }

  const HERO_ART = `<svg viewBox="0 0 360 300">
    <defs><radialGradient id="hg" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="#fff6c4"/><stop offset=".5" stop-color="#ffc93c"/><stop offset="1" stop-color="#d98200"/></radialGradient></defs>
    <g transform="rotate(-18 150 170)"><rect x="92" y="70" width="112" height="158" rx="15" fill="#fff"/><text x="106" y="108" font-size="32" font-weight="800" fill="#e3324c" font-family="Outfit,Arial,sans-serif">Q</text><text x="148" y="182" font-size="76" text-anchor="middle" fill="#e3324c" font-family="Arial,sans-serif">♦︎</text></g>
    <g transform="rotate(5 206 150)"><rect x="150" y="52" width="112" height="158" rx="15" fill="#fff" stroke="#d9dce6" stroke-width="2"/><text x="164" y="90" font-size="32" font-weight="800" fill="#151821" font-family="Outfit,Arial,sans-serif">A</text><text x="206" y="164" font-size="80" text-anchor="middle" fill="#151821" font-family="Arial,sans-serif">♠︎</text></g>
    ${chips(72, 250, 4, '#dc3350')}${chips(150, 268, 2, '#2d7be0')}
    <circle cx="300" cy="70" r="42" fill="#a86400"/><circle cx="298" cy="66" r="42" fill="url(#hg)"/><circle cx="298" cy="66" r="32" fill="none" stroke="#b56f00" stroke-width="3" opacity=".5"/>
    <g transform="translate(274 42) scale(1.5)" fill="#9a5c00"><path d="M5 7A15.5 15.5 0 0 0 27 24A26 26 0 0 1 9 5ZM4 6.5L7.8 2.7 10.3 5.2 6.5 9Z"/></g>
    <g transform="rotate(16 300 222)"><rect x="262" y="184" width="76" height="76" rx="17" fill="#fff"/><rect x="262" y="246" width="76" height="14" rx="7" fill="#d9dce6"/><g fill="#151821"><circle cx="282" cy="204" r="7"/><circle cx="318" cy="204" r="7"/><circle cx="300" cy="221" r="7"/><circle cx="282" cy="238" r="7"/><circle cx="318" cy="238" r="7"/></g></g>
  </svg>`;

  function tile(id, i, cls) {
    const g = BB.games[id], fav = BB.isFav(id), p = BB.provOf(g);
    return `<div class="tile${cls ? ' ' + cls : ''}" data-id="${id}" style="--c1:${g.colors[0]};--c2:${g.colors[1]};--i:${Math.min(i, 12)}">
      <a class="tile-a" href="#/g/${id}" aria-label="Play ${esc(g.name)}">
        ${g.badge ? `<span class="tile-badge${g.badge === 'HOT' ? ' hot' : ''}">${g.badge}</span>` : ''}
        <div class="tile-art">${g.art}</div>
        <span class="tile-play">Play</span>
        <div class="tile-name">${esc(g.name)}</div>
        <span class="tile-meta">${g.provider === 'originals' ? BB.rtpText(g) : esc(p.name) + (g.vol ? ' · ' + g.vol : '')}</span>
      </a>
      <button type="button" class="tile-fav${fav ? ' on' : ''}" data-fav="${id}" aria-label="Favourite ${esc(g.name)}" aria-pressed="${fav}">${ic('star', 17)}</button>
    </div>`;
  }

  const head = (icon, title, pill, extra) => `<div class="sec-head"><span class="sec-ic">${icon}</span><h2>${title}</h2>${pill ? `<span class="pill">${pill}</span>` : ''}${extra || ''}</div>`;

  /** One tile in the main grid that stands for the whole slots lobby. */
  function slotsTile(i) {
    const n = slotIds().length, st = studioIds().length;
    return `<div class="tile slots-tile" data-id="slots-lobby" style="--c1:#ec4899;--c2:#3a0d2c;--i:${i}">
      <a class="tile-a" href="#/slots" aria-label="Open the slots lobby">
        <span class="tile-badge hot">${n} GAMES</span>
        <div class="tile-art">${SLOTS_ART}</div>
        <span class="tile-play">Browse</span>
        <div class="tile-name">Slots</div>
        <span class="tile-meta">${st} studios</span>
      </a>
    </div>`;
  }

  /** The "All games" grid: every original plus the slots tile, or whatever the chips and search narrow it to. */
  function paintGames() {
    const box = $('#lobby-games');
    if (!box) return;
    const all = BB.order.map((id) => BB.games[id]);
    $$('#cat-chips .chip').forEach((c) => c.classList.toggle('on', c.dataset.c === cat || (c.dataset.c === 'all' && cat === 'originals')));
    // a search looks through everything, slots included
    const list = query ? all.filter((g) => g.name.toLowerCase().includes(query) || BB.provOf(g).name.toLowerCase().includes(query)) : all.filter(matches);
    const withSlots = !query && cat === 'all';
    const title = query ? 'Search results' : cat === 'all' ? 'All games' : TITLES[cat] || 'Games';
    const count = list.length + (withSlots ? slotIds().length : 0);
    const empty = cat === 'fav' && !query
      ? (BB.isAuthed() ? 'No favourites yet — tap the star on any game to pin it here.' : 'Log in to keep a list of favourite games.')
      : 'No games match that.';
    let tiles = list.map((g, i) => tile(g.id, i + (withSlots ? 1 : 0)));
    if (withSlots) tiles.splice(Math.min(4, tiles.length), 0, slotsTile(4));
    box.innerHTML = head(cat === 'fav' ? ic('star', 18) : GRID_IC, esc(title), count + ' game' + (count === 1 ? '' : 's')) +
      (tiles.length ? `<div class="tiles">${tiles.join('')}</div>` : `<div class="empty">${empty}</div>`);
  }

  function setSlide(n) {
    const slides = $$('.pc-slide'), dots = $$('.pc-dots button');
    if (!slides.length) return;
    slide = (n + slides.length) % slides.length;
    slides.forEach((x, i) => x.classList.toggle('on', i === slide));
    dots.forEach((d, i) => d.classList.toggle('on', i === slide));
  }

  const VALID = /^(all|originals|arcade|table|instant|cashout|fav)$/;
  /** Old links to the slots filter or a studio now live on the slots lobby. */
  const moved = (sub) => (sub === 'slots' || sub === 'providers' ? '#/slots' : sub && sub.indexOf('prov-') === 0 ? '#/slots/' + sub.slice(5) : '');

  BB.setLobby({
    mount(view, sub) {
      const u = BB.user(), authed = !!u, count = BB.order.length;
      if (moved(sub)) { location.replace(moved(sub)); return; }
      cat = sub && VALID.test(sub) ? sub : 'all';
      const recent = authed ? u.recent.filter((id) => BB.games[id]).slice(0, 8) : [];
      const playId = recent[0] || 'keno';
      const v = authed ? BB.vipInfo(u) : null;
      const nSlots = BB.order.filter((id) => BB.games[id].cat === 'slots').length;

      view.appendChild(h(`<div class="page">
        <section class="hero">
          <div class="hero-main" id="hero-main">
            <span class="kicker">Play-money casino</span>
            <h1>${count} games.<br><em>Zero risk.</em></h1>
            <p>Slots, blackjack, roulette, crash, plus arcade games like Snake, Darts and Whack-a-Mole — all on a free ${fmt(BB.START_BALANCE).replace(/\.00$/, '')} play-coin balance. Every result is provably fair, and no real money is involved anywhere.</p>
            ${authed
              ? `<div class="hero-cta"><a class="btn primary lg" href="#/g/${playId}">${recent.length ? 'Continue ' + esc(BB.games[playId].name) : 'Play now'}</a><button class="btn ghost lg" data-open="wallet">${ic('wallet', 18)}Wallet</button></div>
                 <div class="hero-stats"><div><b data-count="${u.stats.wagered}" data-dec="2">0.00</b><small>Wagered</small></div><div><b data-count="${u.stats.bets}" data-dec="0">0</b><small>Bets</small></div><div><b style="color:${v.cur.color}">${v.cur.name}</b><small>VIP level</small></div></div>`
              : `<div class="hero-cta"><button class="btn primary lg" data-auth="register">Create free account</button><button class="btn ghost lg" data-auth="login">Log in</button></div>`}
            <div class="hero-art" id="hero-art">${HERO_ART}</div>
          </div>
          <div class="hero-side">
            <div class="pc" id="pc">
              <a class="pc-slide s1 on" href="#" data-open="wallet"><small>Crypto cashier · demo</small><b>No fiat? No problem.</b><span>Try a test deposit in BTC, ETH, LTC, USDT, SOL and more. Nothing real moves.</span><em>Open wallet</em><i class="big">₿</i></a>
              <a class="pc-slide s2" href="#/slots"><small>Slots lobby</small><b>${nSlots} slot games</b><span>Free spins, wilds and scatters from Peel Studios, Bonecoin Gaming and Neon Mango.</span><em>Browse slots</em><i class="big">7</i></a>
              <a class="pc-slide s3" href="#" data-open="fair"><small>Provably fair</small><b>Seeded results</b><span>Every bet can be re-run against its seed hash, slots included.</span><em>How it works</em><i class="big">#</i></a>
              <div class="pc-dots"><button type="button" class="on" aria-label="Slide 1"></button><button type="button" aria-label="Slide 2"></button><button type="button" aria-label="Slide 3"></button></div>
            </div>
            <a class="promo p3" href="#/vip"><small>VIP &amp; rewards</small><b>Daily bonus + rakeback</b><span id="trio-daily">Six levels. A little of every bet comes back.</span><i class="big">★</i></a>
          </div>
        </section>

        <div class="winners" aria-label="Latest big wins">
          <div class="winners-tag"><span class="live-dot"></span>Big wins</div>
          <div class="winners-view" id="winners-view">${winnersHTML()}</div>
        </div>

        ${recent.length ? `<div class="sec-head sm"><h2>Continue playing</h2></div>
        <div class="recent">${recent.map((id) => { const g = BB.games[id]; return `<a class="rcard" href="#/g/${id}"><span class="wthumb" style="--c1:${g.colors[0]};--c2:${g.colors[1]}"><i>${g.icon}</i></span><span><b>${esc(g.name)}</b><small>${esc(BB.provOf(g).short)} · ${g.free ? 'Free' : g.rtp + '%'}</small></span></a>`; }).join('')}</div>` : ''}

        <div class="filters" id="games-top">
          <div class="chips" id="cat-chips">
            ${FILTERS.map(([id, label]) => `<a class="chip" data-c="${id}" href="${id === 'all' ? '#/' : '#/lobby/' + id}">${label}</a>`).join('')}
            <a class="chip" data-c="fav" href="#/lobby/fav">${ic('star', 15)}Favourites</a>
            <a class="chip link-chip" href="#/slots">Slots<small>${nSlots}</small></a>
          </div>
          <label class="search"><svg viewBox="0 0 24 24" width="16" height="16"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <input type="search" id="game-search" placeholder="Search games" autocomplete="off" aria-label="Search games" value="${esc(query)}"></label>
        </div>
        <div id="lobby-games"></div>

        <div class="duo">
          <a class="duo-card d1" href="#/slots"><div><b>Game studios</b><span>${nSlots} slots from Peel Studios, Bonecoin Gaming and Neon Mango — free spins, wilds and scatters.</span><em class="btn primary sm">Open slots lobby</em></div><i>7</i></a>
          <a class="duo-card d2" href="#/vip"><div><b>Climb the ladder</b><span>Six VIP levels with rakeback on every bet, a daily bonus and level-up rewards.</span><em class="btn ghost sm">${ic('crown', 15)}Rewards</em></div><i>★</i></a>
        </div>

        <div class="sec-head">
          <span class="live-dot"></span><h2>Live bets</h2>
          <div class="seg mini" id="feed-tabs">
            <button data-t="all" class="${tab === 'all' ? 'on' : ''}">All bets</button>
            <button data-t="mine" class="${tab === 'mine' ? 'on' : ''}">My bets</button>
            <button data-t="big" class="${tab === 'big' ? 'on' : ''}">Big wins</button>
          </div>
        </div>
        <section class="card-sec" style="margin-top:0"><div class="table" id="feed"></div></section>
      </div>`));

      $('#game-search').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); paintGames(); });
      $('#lobby-games').addEventListener('click', (e) => {
        const b = e.target.closest('[data-fav]');
        if (!b) return;
        e.preventDefault();
        if (!BB.isAuthed()) { BB.openAuth('login'); return; }
        const on = BB.toggleFav(b.dataset.fav);
        $$(`[data-fav="${b.dataset.fav}"]`).forEach((x) => { x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
        if (cat === 'fav') paintGames();
      });
      $('#feed-tabs').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        tab = b.dataset.t;
        $$('#feed-tabs button').forEach((x) => x.classList.toggle('on', x === b));
        paintFeed(false);
      });
      // daily-bonus card: say whether it is ready, and count down if not
      const daily = () => {
        const el = $('#trio-daily'), me = BB.user();
        if (!el || !me) return;
        const left = me.vip.daily + 86400000 - Date.now(), lv = BB.vipInfo(me).cur;
        const p2 = (n) => String(Math.floor(n)).padStart(2, '0');
        el.innerHTML = left <= 0 ? `<em class="ok">Daily bonus ready</em> · ${fmt(lv.daily)} coins` : `Next daily bonus in ${p2(left / 3600000)}:${p2((left % 3600000) / 60000)}:${p2((left % 60000) / 1000)}`;
      };
      daily();
      // promo carousel: dots to jump, auto-advance every six seconds unless the pointer is on it
      $('#pc').addEventListener('click', (e) => { const d = e.target.closest('.pc-dots button'); if (d) { e.preventDefault(); setSlide($$('.pc-dots button').indexOf(d)); } });
      setSlide(slide);
      let ticks = 0;
      slideTimer = setInterval(() => {
        daily();
        if (++ticks % 6 === 0) { const pc = $('#pc'); if (pc && !pc.matches(':hover')) setSlide(slide + 1); }
      }, 1000);
      // hero: numbers count up, and the artwork drifts a little with the pointer
      $$('#hero-main [data-count]').forEach((el) => {
        const to = Number(el.dataset.count), dec = Number(el.dataset.dec), t0 = performance.now();
        const fmtN = (n) => n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
        const step = (now) => { const k = Math.min(1, (now - t0) / 900), e = 1 - Math.pow(1 - k, 3); el.textContent = fmtN(to * e); if (k < 1 && el.isConnected) requestAnimationFrame(step); };
        el.textContent = fmtN(to); // final value first, in case animation frames are paused
        requestAnimationFrame(step);
      });
      const heroMain = $('#hero-main'), art = $('#hero-art');
      heroMain.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        const r = heroMain.getBoundingClientRect();
        art.style.setProperty('--px', (((e.clientX - r.left) / r.width - 0.5) * -18).toFixed(1) + 'px');
        art.style.setProperty('--py', (((e.clientY - r.top) / r.height - 0.5) * -12).toFixed(1) + 'px');
      });
      heroMain.addEventListener('pointerleave', () => { art.style.removeProperty('--px'); art.style.removeProperty('--py'); });
      // tiles lean a little toward the pointer
      const grid = $('#lobby-games');
      grid.addEventListener('pointermove', (e) => {
        const t = e.target.closest('.tile');
        if (!t || e.pointerType === 'touch') return;
        const r = t.getBoundingClientRect();
        t.style.setProperty('--rx', (((e.clientY - r.top) / r.height - 0.5) * -7).toFixed(2) + 'deg');
        t.style.setProperty('--ry', (((e.clientX - r.left) / r.width - 0.5) * 9).toFixed(2) + 'deg');
      });
      grid.addEventListener('pointerout', (e) => { const t = e.target.closest('.tile'); if (t && !t.contains(e.relatedTarget)) { t.style.removeProperty('--rx'); t.style.removeProperty('--ry'); } });

      paintGames();
      paintFeed(false);
      if (!BB.serverDown()) { loadFeed(); timer = setInterval(() => { if (document.visibilityState === 'visible') loadFeed(); }, 5000); }
      document.addEventListener('bb:bet', onBet);
      if (sub) setTimeout(() => { const t = $('#games-top'); if (t) window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY - 84); }, 30);
    },

    /** Switching filter chips changes the hash; the page stays put and only the games area is redrawn. */
    update(sub) {
      if (moved(sub)) { location.replace(moved(sub)); return; }
      cat = sub && VALID.test(sub) ? sub : 'all';
      query = '';
      const q = $('#game-search');
      if (q) q.value = '';
      paintGames();
      const t = $('#games-top');
      if (t && (cat !== 'all' || window.scrollY > t.offsetTop)) window.scrollTo({ top: cat === 'all' ? 0 : t.getBoundingClientRect().top + window.scrollY - 84, behavior: 'smooth' });
    },

    unmount() {
      clearInterval(timer);
      clearTimeout(feedTimer.soon);
      clearInterval(slideTimer);
      document.removeEventListener('bb:bet', onBet);
    },
  });

  /* ---------- slots lobby (#/slots, #/slots/<studio>) ---------- */
  const VOL_RANK = { Low: 0, Medium: 1, High: 2 };
  function paintSlots() {
    const box = $('#sl-grid');
    if (!box) return;
    let list = slotIds().map((id) => BB.games[id]).filter((g) => (studio === 'all' || g.provider === studio) && (!slotQuery || g.name.toLowerCase().includes(slotQuery) || BB.provOf(g).name.toLowerCase().includes(slotQuery)));
    if (slotSort === 'az') list.sort((a, b) => a.name.localeCompare(b.name));
    if (slotSort === 'rtp') list.sort((a, b) => parseFloat(b.rtp) - parseFloat(a.rtp));
    if (slotSort === 'vol') list.sort((a, b) => (VOL_RANK[b.vol] || 0) - (VOL_RANK[a.vol] || 0));
    $$('#st-chips .chip').forEach((c) => c.classList.toggle('on', c.dataset.s === studio));
    const p = studio !== 'all' ? provs()[studio] : null;
    $('#sl-title').innerHTML = `<span class="sec-ic"${p ? ` style="color:${p.color};background:${p.color}22"` : ''}>${p ? p.mark : GRID_IC}</span><h2>${p ? esc(p.name) : 'All slots'}</h2><span class="pill">${list.length} game${list.length === 1 ? '' : 's'}</span>${p ? `<span class="sec-sub">${esc(p.blurb)}</span>` : ''}`;
    box.innerHTML = list.length ? list.map((g, i) => tile(g.id, i)).join('') : '<div class="empty" style="grid-column:1/-1">No slots match that.</div>';
  }

  BB.registerPage('slots', {
    mount(view, sub) {
      studio = sub && provs()[sub] && studioIds().indexOf(sub) >= 0 ? sub : 'all';
      const all = slotIds(), st = studioIds();
      view.appendChild(h(`<div class="page slots-page">
        <section class="slots-hero">
          <div class="slots-hero-t">
            <span class="kicker">Slots lobby</span>
            <h1>Slots</h1>
            <p>${all.length} slot games from ${st.length} in-house studios. Pick one and it opens right here — every spin comes straight off your play balance, and every result can be checked against your seed pair.</p>
            <div class="hero-stats"><div><b>${all.length}</b><small>Games</small></div><div><b>${st.length}</b><small>Studios</small></div><div><b>96–97%</b><small>Return to player</small></div></div>
          </div>
          <div class="slots-hero-art">${SLOTS_ART}</div>
        </section>
        <div class="filters">
          <div class="chips" id="st-chips">
            <a class="chip" data-s="all" href="#/slots">All studios<small>${all.length}</small></a>
            ${st.map((k) => `<a class="chip" data-s="${k}" href="#/slots/${k}"><i class="dot" style="background:${provs()[k].color}"></i>${esc(provs()[k].name)}<small>${all.filter((id) => BB.games[id].provider === k).length}</small></a>`).join('')}
          </div>
          <select id="sl-sort" class="input sm" aria-label="Sort slots"><option value="featured">Featured</option><option value="az">A – Z</option><option value="rtp">Highest return</option><option value="vol">Highest volatility</option></select>
          <label class="search"><svg viewBox="0 0 24 24" width="16" height="16"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <input type="search" id="sl-search" placeholder="Search slots" autocomplete="off" aria-label="Search slots" value="${esc(slotQuery)}"></label>
        </div>
        <div class="sec-head" id="sl-title" style="margin-top:8px"></div>
        <div class="tiles" id="sl-grid"></div>

        <div class="sl-info">
          <section class="card-sec">
            <h3>How it works</h3>
            <p class="sec-p">Pick a slot and it opens on the page with its own controls. Set a bet and press Spin, or tap Space. Wins land back in your balance as the reels stop.</p>
            <p class="sec-p">Most are five-reel games with wilds, scatters and free spins. Star Forge is different: it pays for eight or more matching symbols anywhere on a 6×5 grid, tumbles after every win, and lets you buy the free spins outright. The Paytable button under Spin lists every prize for that title.</p>
            <p class="sec-p" style="margin-bottom:0">Use <b>All slots</b> at the top of a game to come back here. A round that is still playing when you leave settles on its own, free spins included — you never lose a win by closing the page.</p>
          </section>
          <aside class="card-sec">
            <h3>How to check a result</h3>
            <p class="sec-p">These slots are drawn from the same seed pair as the originals, so they are provably fair: open a bet in your history and press Verify to re-run the whole round.</p>
            <div class="sl-links"><a class="link" href="#" data-open="fair">Provably fair</a><a class="link" href="#/account/bets">Bet history</a><a class="link" href="#/vip">Rewards</a><a class="link" href="#/">All games</a></div>
          </aside>
        </div>
        <section class="card-sec">
          <h3>Frequently asked questions</h3>
          <details class="faq" open><summary>Are the slots provably fair?</summary><p>Yes. Each spin — and any free spins it triggers — comes from one seeded number stream that is fixed before you bet. Rotate your seed pair and you can re-run any past round in the verifier.</p></details>
          <details class="faq"><summary>Who makes them?</summary><p>Peel Studios, Bonecoin Gaming and Neon Mango are made-up studios that belong to this demo. Real casinos license games from outside studios; none of those are embedded here.</p></details>
          <details class="faq"><summary>Which balance do the slots use?</summary><p>Your play-coin balance, the same one as every other game. Nothing here is real money.</p></details>
          <details class="faq"><summary>What if I close a slot mid-spin?</summary><p>The round is already decided when you press Spin, so it settles to your balance straight away, free spins included.</p></details>
        </section>
      </div>`));
      $('#sl-sort').value = slotSort;
      $('#sl-sort').addEventListener('change', (e) => { slotSort = e.target.value; paintSlots(); });
      $('#sl-search').addEventListener('input', (e) => { slotQuery = e.target.value.trim().toLowerCase(); paintSlots(); });
      $('#sl-grid').addEventListener('click', (e) => {
        const b = e.target.closest('[data-fav]');
        if (!b) return;
        e.preventDefault();
        if (!BB.isAuthed()) { BB.openAuth('login'); return; }
        const on = BB.toggleFav(b.dataset.fav);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on);
      });
      paintSlots();
    },
    update(sub) {
      studio = sub && provs()[sub] && studioIds().indexOf(sub) >= 0 ? sub : 'all';
      paintSlots();
    },
  });
})();
