/*
 * AniRoll UI — wired to the vid backend.
 *
 * The markup, styling, interactions and TV remote navigation are the AniRoll
 * "UI Demo" as-is. Only the data layer changed: instead of the hard-coded demo
 * catalogue, everything comes from GET /api/aniroll (server route in
 * src/routes/api/aniroll.ts), which is built on vid's own Supabase movies table,
 * the official Hindi-dub YouTube feeds, and the existing stream resolvers
 * (/api/extract, /api/toonstream, /api/hlsproxy).
 */
(function () {
  'use strict';

  var GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  var FALLBACK = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"><rect width="600" height="900" fill="#15171b"/>' +
    '<path d="M106 450C206 272 394 272 494 450C394 628 206 628 106 450Z" fill="#f47521"/>' +
    '<circle cx="300" cy="450" r="92" fill="#202227"/><path d="M276 380L366 450L276 520Z" fill="#fff"/></svg>'
  );
  window.__arFallback = FALLBACK;

  /* ── tiny DOM helpers (same contract as the original demo) ── */
  function byId(id) { return document.getElementById(id); }
  function all(selector, root) { return (root || document).querySelectorAll(selector); }
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
  function keysOf(object) { var r = []; for (var k in object) if (Object.prototype.hasOwnProperty.call(object, k)) r.push(k); return r; }
  function hasClass(el, name) { return (' ' + el.className + ' ').indexOf(' ' + name + ' ') > -1; }
  function addClass(el, name) { if (el && !hasClass(el, name)) el.className += (el.className ? ' ' : '') + name; }
  function removeClass(el, name) { if (el) el.className = (' ' + el.className + ' ').replace(' ' + name + ' ', ' ').replace(/^\s+|\s+$/g, ''); }
  function setClass(el, name, on) { if (on) addClass(el, name); else removeClass(el, name); }
  function attr(el, name) { return el ? el.getAttribute(name) : null; }
  function closest(el, selector) {
    while (el && el.nodeType === 1) {
      var m = el.matches || el.webkitMatchesSelector || el.msMatchesSelector;
      if (m && m.call(el, selector)) return el;
      el = el.parentNode;
    }
    return null;
  }
  function setHidden(el, hidden) { if (!el) return; el.hidden = hidden; el.style.display = hidden ? 'none' : ''; }
  function scrollToElement(el) { if (el && el.scrollIntoView) el.scrollIntoView(true); }
  function scrollTrack(el, amount) { if (el) el.scrollLeft = el.scrollLeft + amount; }
  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function stringContains(text, value) { return String(text).indexOf(value) !== -1; }
  function arrayContains(list, value) { return list.indexOf(value) !== -1; }
  function safeUrl(u) { return String(u || '').replace(/["'()\s]/g, function (c) { return encodeURIComponent(c); }); }

  function posterImage(src, alt, lazy) {
    var real = src || FALLBACK;
    var onerr = ' onerror="this.onerror=null;this.src=window.__arFallback"';
    if (lazy && src) {
      return '<img src="' + GIF + '" data-src="' + escapeHtml(real) + '" loading="lazy" decoding="async" width="600" height="900" alt="' + escapeHtml(alt) + '"' + onerr + '>';
    }
    return '<img src="' + escapeHtml(real) + '" loading="eager" decoding="async" width="600" height="900" alt="' + escapeHtml(alt) + '"' + onerr + '>';
  }
  function wideImage(src, alt, lazy) {
    var real = src || FALLBACK;
    var onerr = ' onerror="this.onerror=null;this.src=window.__arFallback"';
    if (lazy && src) {
      return '<img src="' + GIF + '" data-src="' + escapeHtml(real) + '" loading="lazy" decoding="async" width="320" height="180" alt="' + escapeHtml(alt) + '"' + onerr + '>';
    }
    return '<img src="' + escapeHtml(real) + '" loading="eager" decoding="async" width="320" height="180" alt="' + escapeHtml(alt) + '"' + onerr + '>';
  }
  function loadLazyImages() {
    var images = all('img[data-src]');
    var viewHeight = window.innerHeight || document.documentElement.clientHeight || 720;
    each(images, function (image) {
      if (!image.offsetWidth && !image.offsetHeight) return;
      var rect = image.getBoundingClientRect();
      if (rect.top < viewHeight + 500 && rect.bottom > -300) {
        image.src = attr(image, 'data-src');
        image.removeAttribute('data-src');
      }
    });
  }
  var lazyTimer = null;
  function queueLazy() {
    if (lazyTimer) return;
    lazyTimer = setTimeout(function () { lazyTimer = null; loadLazyImages(); }, 100);
  }
  window.addEventListener('scroll', queueLazy, false);
  window.addEventListener('resize', queueLazy, false);

  /* ── local (per-browser) state ── */
  var store = {
    get: function (key, fallback) {
      try { var v = window.localStorage.getItem('aniroll.' + key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { window.localStorage.setItem('aniroll.' + key, JSON.stringify(value)); } catch (e) { /* private mode */ }
    }
  };
  var saved = store.get('saved', {});
  var favorites = store.get('favs', {});
  var recent = store.get('recent', []);

  /* ── catalogue state (filled from /api/aniroll) ── */
  var shows = {};
  var showList = [];
  var movieIds = [];
  var rowsCfg = [];
  var newestIds = [];
  var heroId = null;
  var activeKey = null;
  var current = null;      // { show, ep }
  var playToken = 0;
  var hlsInstance = null;
  var progressTick = 0;

  /* ── formatting ── */
  function genreName(g) {
    if (g === 'science-fiction') return 'Sci-Fi';
    if (g === 'anime') return 'Anime';
    return g.charAt(0).toUpperCase() + g.slice(1);
  }
  function genreText(show) {
    var names = [];
    each(show.genres, function (g) { names.push(genreName(g)); });
    return names.join(' · ');
  }
  function catalogMeta(a) {
    return { type: a.type.toLowerCase(), status: a.type === 'Movie' || a.year < 2023 ? 'completed' : 'airing' };
  }
  function formatTime(seconds) {
    if (!isFinite(seconds)) return '0:00';
    seconds = Math.max(0, Math.floor(seconds));
    var h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = String(seconds % 60);
    if (s.length < 2) s = '0' + s;
    if (h) { var mm = String(m); if (mm.length < 2) mm = '0' + mm; return h + ':' + mm + ':' + s; }
    return m + ':' + s;
  }
  function epLabel(show, ep) {
    if (show.type === 'Movie') return 'Movie';
    return 'S' + (ep.season || 1) + ' · EP ' + ep.n;
  }
  function showToast(message) {
    var toast = document.querySelector('.toast');
    clearTimeout(showToast.timer);
    toast.innerHTML = escapeHtml(message);
    addClass(toast, 'show');
    showToast.timer = setTimeout(function () { removeClass(toast, 'show'); }, 2600);
  }

  /* ── card markup ── */
  function railCard(key) {
    var a = shows[key];
    return '<article class="rail-card" data-open="' + escapeHtml(key) + '" tabindex="0" role="button"><div class="rail-poster">' +
      posterImage(a.img, a.title + ' anime poster', true) +
      '<div class="quick-info"><h3>' + escapeHtml(a.title) + '</h3><div class="quick-meta"><span class="rating">★ ' + a.rating + '</span> · ' + a.year + '<br>' + escapeHtml(genreText(a)) + '</div>' +
      '<div class="quick-actions"><button data-quick-play="' + escapeHtml(key) + '">▶ Play</button><button class="quick-save" data-save-key="' + escapeHtml(key) + '">＋ My List</button></div></div></div>' +
      '<div class="rail-copy"><h3>' + escapeHtml(a.title) + '</h3><p>★ ' + a.rating + ' · ' + escapeHtml(genreText(a)) + '</p></div></article>';
  }
  function renderHomeRows() {
    var html = '';
    each(rowsCfg, function (row, i) {
      var cards = '';
      each(row.keys, function (key, n) {
        if (!shows[key]) return;
        var card = railCard(key);
        cards += row.ranked ? '<div class="rank-card"><span class="rank-number">' + (n + 1) + '</span>' + card + '</div>' : card;
      });
      if (!cards) return;
      html += '<section class="anime-rail" aria-labelledby="rail-title-' + i + '"><div class="rail-head"><h2 id="rail-title-' + i + '"><span class="orange-line"></span>' + escapeHtml(row.title) +
        '</h2><div class="rail-controls"><button class="rail-arrow" data-rail-prev aria-label="Scroll ' + escapeHtml(row.title) + ' left">‹</button><button class="rail-arrow" data-rail-next aria-label="Scroll ' + escapeHtml(row.title) + ' right">›</button></div></div><div class="rail-track' + (row.ranked ? ' ranked-track' : '') + '">' + cards + '</div></section>';
    });
    byId('homeRows').innerHTML = html;
    queueLazy();
  }
  function cardHtml(key, isMovie) {
    var a = shows[key], m = catalogMeta(a);
    return '<article class="show-card' + (isMovie ? ' movie-card' : '') + '" data-genre="' + escapeHtml(a.genres.join(' ')) + '" data-title="' + escapeHtml(a.title) + '" data-year="' + a.year + '" data-rating="' + a.stars + '" data-status="' + m.status + '" data-type="' + m.type + '" data-open="' + escapeHtml(key) + '" tabindex="0" role="button"><div class="poster">' +
      posterImage(a.img, a.title + (isMovie ? ' anime movie poster' : ' anime poster'), true) +
      (isMovie ? '<span class="movie-badge">MOVIE</span>' : '') +
      '<button class="bookmark" aria-label="Add ' + escapeHtml(a.title) + ' to watchlist" data-save-key="' + escapeHtml(key) + '">＋</button></div><div class="card-copy"><h3>' + escapeHtml(a.title) + '</h3><p>★ ' + a.rating + ' · ' + escapeHtml(genreText(a)) +
      (isMovie ? ' <span class="movie-runtime">· ' + escapeHtml(a.runtime || '—') + '</span>' : '') + '</p></div></article>';
  }
  function renderCatalog() {
    var html = '';
    each(showList, function (s) { html += cardHtml(s.id, s.type === 'Movie'); });
    byId('catalogGrid').innerHTML = html;
    byId('catalogEnd').hidden = true;
    queueLazy();
  }
  function renderMovies(filter) {
    var html = '';
    each(movieIds, function (key) {
      var show = shows[key];
      if (!filter || filter === 'all' || arrayContains(show.genres, filter)) html += cardHtml(key, true);
    });
    byId('movieGrid').innerHTML = html || '<p class="empty">No movies for this genre yet.</p>';
    queueLazy();
  }

  /* ── hero ── */
  function renderHero() {
    var h = shows[heroId];
    if (!h) return;
    byId('hero-title').innerHTML = escapeHtml(h.title);
    byId('heroKicker').textContent = h.type === 'Movie' ? 'Featured movie' : 'Featured series';
    var meta = '';
    if (h.rating) meta += '<span class="age">' + escapeHtml(h.rating) + '</span>';
    each(h.genres.slice(0, 3), function (g) { meta += '<span>' + escapeHtml(genreName(g)) + '</span>'; });
    byId('heroMeta').innerHTML = meta;
    byId('heroDesc').textContent = h.desc;
    var img = byId('heroImg');
    img.src = h.backdrop || h.img || FALLBACK;
    img.onerror = function () { this.onerror = null; this.src = FALLBACK; };
    img.alt = h.title + ' artwork';
    byId('heroPlay').setAttribute('data-play-show', h.id);
    byId('heroSave').setAttribute('data-save-key', h.id);
    byId('heroSave').innerHTML = '';
    byId('heroSave').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>Add to watchlist';
    syncSaved(h.id);
  }

  /* ── continue watching (local history) ── */
  function resumeFor(showId) {
    for (var i = 0; i < recent.length; i++) if (recent[i].show === showId) return recent[i];
    return null;
  }
  function renderContinue() {
    var items = [];
    each(recent, function (r) {
      var show = shows[r.show];
      if (!show) return;
      var ep = findEp(show, r.ep);
      if (!ep) return;
      var pct = r.d ? Math.min(100, Math.round((r.t / r.d) * 100)) : 0;
      if (r.d && pct >= 95) return;
      items.push({ r: r, show: show, ep: ep, pct: pct });
    });
    var html = '';
    each(items.slice(0, 12), function (it) {
      var left = it.r.d ? Math.max(0, Math.round((it.r.d - it.r.t) / 60)) + 'm left' : 'Resume';
      var status = it.r.d ? it.pct + '% watched · ' + left : 'Last watched';
      html += '<article class="continue-card" data-continue-card><button class="continue-main" data-play-ep="' + escapeHtml(it.show.id + '|' + it.ep.id) + '" data-start="' + Math.floor(it.r.t || 0) + '">' +
        wideImage(it.ep.img || it.show.img, it.show.title + ' artwork', false) +
        '<span class="continue-copy"><strong>' + escapeHtml(it.show.title) + '</strong><small>' + escapeHtml(epLabel(it.show, it.ep) + ' · ' + it.ep.title) + '</small>' +
        '<span class="progress"><i style="width:' + it.pct + '%"></i></span><em>' + escapeHtml(status) + '</em></span></button>' +
        '<button class="dismiss" aria-label="Remove ' + escapeHtml(it.show.title) + ' from Continue Watching" data-dismiss-continue="' + escapeHtml(it.r.key) + '">×</button></article>';
    });
    byId('continueGrid').innerHTML = html;
    setHidden(byId('continueWatching'), !html);
  }
  function noteRecent(show, ep, t, d) {
    var key = show.id + '|' + ep.id;
    var list = [{ key: key, show: show.id, ep: ep.id, t: t || 0, d: d || 0, at: Date.now() }];
    each(recent, function (r) { if (r.key !== key) list.push(r); });
    recent = list.slice(0, 40);
    store.set('recent', recent);
  }

  /* ── my list / profile / stats ── */
  var listSets = {};
  function computeLists() {
    var seen = {}, historyKeys = [], continueKeys = [];
    each(recent, function (r) {
      if (!shows[r.show]) return;
      if (!seen[r.show]) { seen[r.show] = true; historyKeys.push(r.show); }
    });
    continueKeys = historyKeys.filter(function (k) { var r = resumeFor(k); return r && (!r.d || r.t / r.d < 0.95); });
    listSets = {
      continue: continueKeys,
      favorites: keysOf(favorites).filter(function (k) { return favorites[k] && shows[k]; }),
      watchlater: keysOf(saved).filter(function (k) { return saved[k] && shows[k]; }),
      history: historyKeys
    };
    each(all('[data-list-tab]'), function (btn) {
      var tab = attr(btn, 'data-list-tab');
      var b = btn.querySelector('b');
      if (b) b.textContent = String((listSets[tab] || []).length);
    });
  }
  function renderMiniList(tab) {
    var source = listSets[tab] || [], html = '';
    each(source, function (key) {
      var show = shows[key];
      html += '<button class="mini-item" data-open="' + escapeHtml(key) + '">' + posterImage(show.img, show.title + ' poster', true) +
        '<span><strong>' + escapeHtml(show.title) + '</strong><small>' + (tab === 'continue' ? 'Continue watching' : '★ ' + show.rating + ' · ' + escapeHtml(genreText(show))) + '</small></span></button>';
    });
    byId('miniList').innerHTML = html || '<p class="empty">Nothing here yet — start watching or save a title.</p>';
    queueLazy();
  }
  function renderProfile() {
    var guest = store.get('guest', null);
    if (!guest) { guest = Math.random().toString(16).slice(2, 6).toUpperCase(); store.set('guest', guest); }
    byId('profileName').textContent = 'Guest #' + guest;
    byId('profileAvatar').textContent = 'G' + guest.charAt(0);
    var watchSec = 0, done = 0, genreCount = {}, seriesSeen = {};
    each(recent, function (r) {
      watchSec += r.t || 0;
      if (r.d && r.t / r.d >= 0.9) done++;
      var show = shows[r.show];
      if (show && !seriesSeen[show.id]) { seriesSeen[show.id] = 1; each(show.genres, function (g) { genreCount[g] = (genreCount[g] || 0) + 1; }); }
    });
    var top = keysOf(genreCount).sort(function (a, b) { return genreCount[b] - genreCount[a]; });
    byId('profileTaste').textContent = top.length ? 'Loves ' + top.slice(0, 2).map(genreName).join(' · ') : 'Start watching to build your taste profile';
    var h = Math.floor(watchSec / 3600), m = Math.floor((watchSec % 3600) / 60);
    var seriesCount = keysOf(seriesSeen).length;
    var savedCount = keysOf(saved).filter(function (k) { return saved[k]; }).length;
    byId('statGrid').innerHTML =
      '<article><strong>' + h + 'h ' + m + 'm</strong><span>Watch time</span></article>' +
      '<article><strong>' + done + '</strong><span>Episodes done</span></article>' +
      '<article><strong>' + seriesCount + '</strong><span>Titles started</span></article>' +
      '<article><strong>' + (top.length ? genreName(top[0]) : '—') + '</strong><span>Top genre</span></article>' +
      '<article><strong>' + savedCount + '</strong><span>Saved</span></article>';
  }

  /* ── watchlist + favourites ── */
  function syncSaved(key) {
    each(all('[data-save-key="' + key + '"]'), function (el) {
      setClass(el, 'saved', !!saved[key]);
      el.setAttribute('aria-pressed', saved[key] ? 'true' : 'false');
      if (hasClass(el, 'secondary')) el.innerHTML = saved[key]
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"></path></svg>Remove from watchlist'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>Add to watchlist';
    });
    if (activeKey === key) setClass(byId('detailSave'), 'active', !!saved[key]);
  }
  function toggleSave(key) {
    saved[key] = !saved[key];
    store.set('saved', saved);
    syncSaved(key);
    computeLists();
    renderMiniList(currentTab());
    showToast(saved[key] ? 'Added to watchlist' : 'Removed from watchlist');
  }
  function currentTab() {
    var active = document.querySelector('[data-list-tab].active');
    return active ? attr(active, 'data-list-tab') : 'continue';
  }

  /* ── detail dialog ── */
  var dialog = byId('detailDialog');
  var playerShell = byId('playerShell');
  var video = byId('referenceVideo');
  var videoStage = byId('videoStage');
  var bigPlay = byId('bigPlay');
  var playPause = byId('playPause');
  var timeline = byId('timeline');
  var playedBar = byId('playedBar');
  var bufferedBar = byId('bufferedBar');
  var settingsMenu = byId('settingsMenu');
  var settingsButton = byId('settingsButton');
  var notificationButton = byId('notificationButton');
  var notificationPanel = byId('notificationPanel');

  function dialogClose() {
    dialog.removeAttribute('open');
    setHidden(dialog, true);
    document.body.style.overflow = '';
  }
  function dialogOpen() {
    setHidden(dialog, false);
    dialog.setAttribute('open', 'open');
    document.body.style.overflow = 'hidden';
  }
  function findEp(show, epId) {
    for (var i = 0; i < show.episodes.length; i++) if (String(show.episodes[i].id) === String(epId)) return show.episodes[i];
    return null;
  }
  function sortedEpisodes(show) {
    return show.episodes.slice().sort(function (a, b) { return (a.season - b.season) || (a.n - b.n); });
  }
  function renderSeasonOptions(show) {
    var select = byId('seasonSelect');
    var html = '';
    each(show.seasons, function (s) { html += '<option value="' + s + '">Season ' + s + '</option>'; });
    select.innerHTML = html;
    select.value = String(show.seasons[0] || 1);
  }
  function renderEpisodes(query) {
    var show = shows[activeKey];
    if (!show) return;
    var season = Number(byId('seasonSelect').value) || show.seasons[0] || 1;
    var q = (query || '').toLowerCase(), html = '', count = 0;
    each(sortedEpisodes(show), function (ep) {
      if (ep.season !== season) return;
      if (!q || stringContains(String(ep.n), q) || stringContains(ep.title.toLowerCase(), q)) {
        count++;
        html += '<button class="episode-card" data-episode-play data-ep="' + escapeHtml(ep.id) + '">' +
          wideImage(ep.img || show.img, show.title + ' episode ' + ep.n + ' thumbnail', true) +
          '<span class="episode-card-content"><span class="episode-card-meta"><span class="episode-no">EP ' + ep.n + '</span><span class="episode-runtime">' + escapeHtml(ep.runtime || '') + '</span></span>' +
          '<span class="episode-copy"><strong>' + escapeHtml(ep.title) + '</strong><span class="episode-desc">' + escapeHtml(show.title) + ' · Season ' + ep.season + '</span></span></span></button>';
      }
    });
    byId('episodeCount').innerHTML = '· ' + count;
    byId('episodeList').innerHTML = count ? html : '<p class="empty">No matching episode.</p>';
    queueLazy();
  }
  function renderRecommendations() {
    var current = shows[activeKey];
    var pool = current.type === 'Movie' ? movieIds : showList.map(function (s) { return s.id; });
    var html = '', count = 0;
    each(pool, function (key) {
      var show = shows[key], shares = false;
      if (!show || show.type !== current.type || key === activeKey || count >= 12) return;
      each(show.genres, function (g) { if (arrayContains(current.genres, g)) shares = true; });
      if (shares) {
        count++;
        html += '<button class="recommend-card" data-open="' + escapeHtml(key) + '"><span class="recommend-badge type">' + show.type.toUpperCase() + '</span><span class="recommend-badge score">★ ' + show.rating + '</span>' +
          wideImage(show.img, show.title + ' poster', true) + '<span class="recommend-card-copy"><strong>' + escapeHtml(show.title) + '</strong><span>' + escapeHtml(genreText(show)) + (show.type === 'Movie' && show.runtime ? ' · ' + escapeHtml(show.runtime) : '') + '</span></span></button>';
      }
    });
    byId('recommendTrack').innerHTML = html;
    queueLazy();
  }
  function openDetail(key) {
    var item = shows[key];
    if (!item) return;
    activeKey = key;
    var meta = catalogMeta(item), isMovie = item.type === 'Movie', status = meta.status === 'airing' ? 'Airing' : 'Completed';
    byId('detailTitle').innerHTML = escapeHtml(item.title);
    byId('detailMeta').innerHTML = '<span class="detail-badge rating">★ ' + item.rating + '</span><span class="detail-badge">' + item.year + '</span><span class="detail-badge status">' + status + '</span>' +
      (item.audio ? '<span class="detail-badge">' + escapeHtml(item.audio) + '</span>' : '');
    byId('detailDescription').innerHTML = escapeHtml(item.desc || 'No synopsis available yet.');
    var image = byId('detailImg');
    image.src = item.img || FALLBACK;
    image.alt = item.title + ' anime poster';
    image.onerror = function () { this.onerror = null; this.src = FALLBACK; };
    byId('detailHero').style.backgroundImage = item.backdrop ? 'url("' + safeUrl(item.backdrop) + '")' : '';
    var genreHtml = '';
    each(item.genres, function (genre, i) {
      genreHtml += (i ? ' · ' : '') + '<button data-detail-genre="' + escapeHtml(genre) + '">' + escapeHtml(genreName(genre)) + '</button>';
    });
    byId('detailGenres').innerHTML = genreHtml;
    var stats = byId('detailStats');
    setClass(stats, 'movie-stats', isMovie);
    stats.innerHTML = isMovie
      ? '<article><strong>Movie</strong><span>Type</span></article><article><strong>' + escapeHtml(item.runtime || '—') + '</strong><span>Runtime</span></article><article><strong>' + status + '</strong><span>Status</span></article>'
      : '<article><strong>Series</strong><span>Type</span></article><article><strong>' + item.episodes.length + '</strong><span>Episodes</span></article><article><strong>' + status + '</strong><span>Status</span></article><article><strong>' + item.seasons.length + '</strong><span>Seasons</span></article>';
    var resume = resumeFor(key);
    var playBtn = byId('demoPlay');
    playBtn.setAttribute('data-play-show', key);
    var firstEp = sortedEpisodes(item)[0];
    playBtn.innerHTML = isMovie ? '▶ Watch Now' : (resume ? '▶ Continue' : '▶ Watch EP ' + (firstEp ? firstEp.n : 1));
    setHidden(document.querySelector('.episode-guide'), isMovie);
    setClass(byId('detailSave'), 'active', !!saved[key]);
    setClass(byId('detailFavorite'), 'active', !!favorites[key]);
    byId('detailFavorite').setAttribute('aria-pressed', favorites[key] ? 'true' : 'false');
    setHidden(byId('detailMore'), true);
    removeClass(byId('detailDescription'), 'expanded');
    byId('readMore').innerHTML = 'Read more⌄';
    if (!isMovie) {
      renderSeasonOptions(item);
      byId('episodeSearch').value = '';
      renderEpisodes('');
    }
    renderRecommendations();
    dialogOpen();
    document.querySelector('.detail-page').scrollTop = 0;
    setTimeout(function () { document.querySelector('.detail-back').focus(); loadLazyImages(); }, 30);
  }

  /* ── stream resolution (vid's own routes) ── */
  function getJson(url) {
    return fetch(url, { headers: { accept: 'application/json' } })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .catch(function () { return null; });
  }
  function withParams(url, extra) { return url + (url.indexOf('?') === -1 ? '?' : '&') + extra; }
  function extractStream(embedUrl) {
    return getJson('/api/extract?url=' + encodeURIComponent(embedUrl) + '&format=json').then(function (d) {
      return d && d.ok && d.streamUrl ? String(d.streamUrl) : null;
    });
  }
  function resolveSource(ep) {
    if (ep.videoUrl) {
      var v = ep.videoUrl;
      if (v.indexOf('/api/toonstream') === 0) {
        return getJson(withParams(v, 'format=json&sources=1')).then(function (d) {
          var list = d && Array.isArray(d.sources) ? d.sources : [];
          var chain = Promise.resolve(null);
          each(list, function (candidate) {
            chain = chain.then(function (found) { return found || extractStream(candidate); });
          });
          return chain.then(function (u) { return u ? { kind: 'video', url: u } : null; });
        });
      }
      if (v.indexOf('/api/extract') === 0 || v.indexOf('/api/stream') === 0) {
        return getJson(withParams(v, 'format=json')).then(function (d) {
          return d && d.ok && d.streamUrl ? { kind: 'video', url: String(d.streamUrl) } : null;
        });
      }
      return Promise.resolve({ kind: 'video', url: v });
    }
    if (ep.embedUrl) {
      return extractStream(ep.embedUrl).then(function (u) {
        if (u) return { kind: 'video', url: u };
        return { kind: 'iframe', url: ep.embedUrl };
      });
    }
    return Promise.resolve(null);
  }

  /* ── player ── */
  function setStageMode(mode) { setClass(videoStage, 'embed-mode', mode === 'embed'); }
  function clearEmbed() { byId('embedSlot').innerHTML = ''; }
  function stopPlayback() {
    try { video.pause(); } catch (e) { /* noop */ }
    if (hlsInstance) { try { hlsInstance.destroy(); } catch (e) { /* noop */ } hlsInstance = null; }
    video.onerror = null;
    video.removeAttribute('src');
    try { video.load(); } catch (e) { /* noop */ }
    clearEmbed();
    setStageMode('video');
  }
  function mountEmbed(url) {
    stopPlayback();
    setStageMode('embed');
    var frame = document.createElement('iframe');
    frame.src = url;
    frame.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('referrerpolicy', 'origin');
    frame.setAttribute('title', 'Video player');
    byId('embedSlot').appendChild(frame);
  }
  function mountVideo(url, startAt) {
    stopPlayback();
    var isHls = /\.m3u8(\?|$)/i.test(url);
    var src = isHls ? '/api/hlsproxy?audio=hi&u=' + encodeURIComponent(url) : url;
    video.onloadedmetadata = function () {
      if (startAt > 0 && video.duration && startAt < video.duration - 5) {
        try { video.currentTime = startAt; } catch (e) { /* noop */ }
      }
      updateProgress();
    };
    video.onerror = function () {
      if (!video.getAttribute('src') && !hlsInstance) return;
      showToast('This stream could not be played — try another episode');
    };
    if (isHls && window.Hls && window.Hls.isSupported()) {
      hlsInstance = new window.Hls({ maxBufferLength: 30 });
      hlsInstance.on(window.Hls.Events.ERROR, function (e, data) {
        if (data && data.fatal) showToast('Stream failed — try another episode');
      });
      hlsInstance.loadSource(src);
      hlsInstance.attachMedia(video);
    } else {
      video.src = src;
    }
    try { var p = video.play(); if (p && p.catch) p.catch(syncPlayState); } catch (e) { syncPlayState(); }
  }

  function setHeading(show, ep) {
    byId('playerTitle').textContent = show.title;
    byId('playerSub').textContent = show.type === 'Movie' ? 'Movie · ' + (ep.title || show.title) : epLabel(show, ep) + ' · ' + ep.title;
  }
  function nextEpisodeOf(show, ep) {
    if (show.type === 'Movie') return null;
    var list = sortedEpisodes(show), idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === ep.id) idx = i;
    return idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
  }
  function renderUpNext(show, ep) {
    var next = nextEpisodeOf(show, ep);
    var btn = byId('upNext');
    var note = byId('upNextNote');
    if (next) {
      byId('upNextImg').src = next.img || show.img || FALLBACK;
      byId('upNextTitle').textContent = show.title;
      byId('upNextSub').textContent = epLabel(show, next) + ' · ' + next.title;
      btn.setAttribute('data-play-ep', show.id + '|' + next.id);
      btn.removeAttribute('data-scroll');
      note.textContent = 'The next episode starts automatically when this one ends.';
    } else {
      var poster = show.img || FALLBACK;
      byId('upNextImg').src = poster;
      byId('upNextTitle').textContent = show.type === 'Movie' ? 'Browse more movies' : 'You are all caught up';
      byId('upNextSub').textContent = show.type === 'Movie' ? 'Movies' : show.title;
      btn.removeAttribute('data-play-ep');
      btn.setAttribute('data-scroll', 'movies');
      note.textContent = '';
    }
  }
  function playEpisode(showKey, epId, startAt) {
    var show = shows[showKey];
    if (!show) return;
    var ep = (epId != null && findEp(show, epId)) || sortedEpisodes(show)[0];
    if (!ep) return;
    var tok = ++playToken;
    activeKey = showKey;
    var from = startAt != null ? Number(startAt) : (resumeFor(show.id) && resumeFor(show.id).ep === ep.id ? resumeFor(show.id).t : 0);
    current = { show: show, ep: ep };
    dialogClose();
    setHidden(playerShell, false);
    document.body.style.overflow = 'hidden';
    setHeading(show, ep);
    renderUpNext(show, ep);
    noteRecent(show, ep, from, 0);
    renderContinue();
    stopPlayback();
    byId('closePlayer').focus();
    if (ep.youtubeId) {
      mountEmbed('https://www.youtube-nocookie.com/embed/' + encodeURIComponent(ep.youtubeId) + '?autoplay=1&rel=0&modestbranding=1&playsinline=1');
      return;
    }
    resolveSource(ep).then(function (res) {
      if (tok !== playToken) return;
      if (!res) { showToast('This title has no playable source yet'); return; }
      if (res.kind === 'iframe') mountEmbed(res.url);
      else mountVideo(res.url, from);
    });
  }
  function playShow(showKey) {
    var show = shows[showKey];
    if (!show) return;
    var resume = resumeFor(show.id);
    if (show.type === 'TV' && resume && findEp(show, resume.ep)) {
      playEpisode(show.id, resume.ep, resume.t);
      return;
    }
    playEpisode(show.id, sortedEpisodes(show)[0].id, 0);
  }
  function closePlayer() {
    if (current && current.ep && !current.ep.youtubeId) {
      noteRecent(current.show, current.ep, video.currentTime || 0, video.duration || 0);
    }
    playToken++;
    stopPlayback();
    setHidden(playerShell, true);
    document.body.style.overflow = '';
    setHidden(settingsMenu, true);
    settingsButton.setAttribute('aria-expanded', 'false');
    removeClass(videoStage, 'theater');
    current = null;
    renderContinue();
    computeLists();
    renderProfile();
    renderMiniList(currentTab());
  }
  function togglePlayback() {
    if (video.paused) {
      var promise = video.play();
      if (promise && promise.catch) promise.catch(function () { showToast('Press play once more to start the video'); });
    } else {
      video.pause();
    }
  }
  function syncPlayState() {
    var paused = video.paused;
    setClass(bigPlay, 'hidden', !paused);
    playPause.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    playPause.innerHTML = paused ? '<span class="play-glyph">▶</span>' : '<span class="play-glyph">Ⅱ</span>';
  }
  function updateProgress() {
    var ratio = video.duration ? video.currentTime / video.duration : 0;
    timeline.value = String(Math.round(ratio * 1000));
    playedBar.style.width = (ratio * 100) + '%';
    byId('currentTime').innerHTML = formatTime(video.currentTime);
    byId('duration').innerHTML = formatTime(video.duration);
    if (video.buffered && video.buffered.length && video.duration) {
      bufferedBar.style.width = ((video.buffered.end(video.buffered.length - 1) / video.duration) * 100) + '%';
    }
  }
  function nextAfterCurrent() {
    if (!current) return null;
    return nextEpisodeOf(current.show, current.ep);
  }

  video.addEventListener('click', togglePlayback, false);
  video.addEventListener('play', syncPlayState, false);
  video.addEventListener('pause', syncPlayState, false);
  video.addEventListener('timeupdate', function () {
    updateProgress();
    if (current && !current.ep.youtubeId) {
      progressTick++;
      if (progressTick % 5 === 0) noteRecent(current.show, current.ep, video.currentTime, video.duration);
    }
  }, false);
  video.addEventListener('ended', function () {
    if (!current) return;
    noteRecent(current.show, current.ep, video.duration || 0, video.duration || 0);
    var next = nextAfterCurrent();
    if (next) playEpisode(current.show.id, next.id, 0);
    else renderContinue();
  }, false);
  bigPlay.addEventListener('click', togglePlayback, false);
  playPause.addEventListener('click', togglePlayback, false);
  timeline.addEventListener('input', function () {
    if (video.duration) video.currentTime = (Number(this.value) / 1000) * video.duration;
  }, false);
  byId('rewind').addEventListener('click', function () { video.currentTime = Math.max(0, video.currentTime - 10); }, false);
  byId('forward').addEventListener('click', function () { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10); }, false);
  var volume = byId('volume');
  volume.addEventListener('input', function () { video.volume = Number(this.value); video.muted = video.volume === 0; }, false);
  byId('mute').addEventListener('click', function () {
    video.muted = !video.muted;
    volume.value = video.muted ? '0' : String(video.volume || 1);
    showToast(video.muted ? 'Muted' : 'Sound on');
  }, false);
  settingsButton.addEventListener('click', function () {
    var willShow = settingsMenu.hidden;
    setHidden(settingsMenu, !willShow);
    settingsButton.setAttribute('aria-expanded', willShow ? 'true' : 'false');
  }, false);
  each(all('[data-speed]'), function (button) {
    button.addEventListener('click', function () {
      video.playbackRate = Number(attr(button, 'data-speed'));
      each(all('[data-speed]'), function (item) { setClass(item, 'active', item === button); });
      setHidden(settingsMenu, true);
      settingsButton.setAttribute('aria-expanded', 'false');
    }, false);
  });
  byId('theater').addEventListener('click', function () { setClass(videoStage, 'theater', !hasClass(videoStage, 'theater')); }, false);
  byId('fullscreen').addEventListener('click', function () {
    var request = playerShell.requestFullscreen || playerShell.webkitRequestFullscreen || playerShell.msRequestFullscreen;
    if (request) request.call(playerShell);
  }, false);
  byId('closePlayer').addEventListener('click', closePlayer, false);

  /* ── search ── */
  var searchPanel = document.querySelector('.search-panel');
  var searchInput = byId('searchInput');
  var results = byId('searchResults');
  function renderResults(query) {
    var q = String(query || '').toLowerCase().replace(/^\s+|\s+$/g, ''), html = '', count = 0;
    each(showList, function (s) {
      var hay = (s.title + ' ' + genreText(s) + ' ' + s.audio + ' ' + s.type).toLowerCase();
      if (!q || stringContains(hay, q)) {
        count++;
        html += '<button class="result" data-search-open="' + escapeHtml(s.id) + '">' + posterImage(s.img, '', true) +
          '<span class="result-copy"><strong>' + escapeHtml(s.title) + '</strong><small>' + s.year + ' · ★ ' + s.rating + ' · ' + escapeHtml(genreText(s)) + '</small></span><span>Details →</span></button>';
      }
    });
    results.innerHTML = count ? html : '<p class="empty">No matching anime found.</p>';
    queueLazy();
  }
  function openSearch() {
    addClass(searchPanel, 'open');
    searchPanel.setAttribute('aria-hidden', 'false');
    renderResults(searchInput.value);
    setTimeout(function () { searchInput.focus(); }, 80);
  }
  function closeSearch() {
    removeClass(searchPanel, 'open');
    searchPanel.setAttribute('aria-hidden', 'true');
  }
  each(all('.search-trigger'), function (button) { button.addEventListener('click', openSearch, false); });
  document.querySelector('.close-search').addEventListener('click', closeSearch, false);
  searchInput.addEventListener('input', function () { renderResults(this.value); }, false);
  results.addEventListener('click', function (event) {
    var button = closest(event.target || event.srcElement, '[data-search-open]');
    if (button) { closeSearch(); openDetail(attr(button, 'data-search-open')); }
  }, false);

  /* ── browse filters ── */
  function applyBrowseFilters() {
    var genre = byId('genreFilter').value, status = byId('statusFilter').value, type = byId('typeFilter').value, sort = byId('sortFilter').value;
    var grid = byId('catalogGrid'), cards = [], nodes = all('.show-card', grid), visible = false;
    each(nodes, function (node) { cards.push(node); });
    cards.sort(function (a, b) {
      if (sort === 'newest') return Number(attr(b, 'data-year')) - Number(attr(a, 'data-year'));
      if (sort === 'rated') return Number(attr(b, 'data-rating')) - Number(attr(a, 'data-rating'));
      if (sort === 'az') return attr(a, 'data-title').localeCompare(attr(b, 'data-title'));
      return 0;
    });
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var show = (genre === 'all' || stringContains(attr(card, 'data-genre'), genre)) &&
        (status === 'all' || attr(card, 'data-status') === status) &&
        (type === 'all' || attr(card, 'data-type') === type);
      setHidden(card, !show);
      if (show) visible = true;
      grid.appendChild(card);
    }
    var empty = byId('watchlistEmpty');
    empty.textContent = 'No anime matches these filters.';
    setHidden(empty, visible || cards.length === 0);
  }
  each(['genreFilter', 'statusFilter', 'typeFilter', 'sortFilter'], function (id) {
    byId(id).addEventListener('change', applyBrowseFilters, false);
  });
  byId('movieFilters').addEventListener('click', function (event) {
    var chip = closest(event.target || event.srcElement, '[data-movie-filter]');
    if (!chip) return;
    each(all('.chip', this), function (item) { setClass(item, 'active', item === chip); });
    renderMovies(attr(chip, 'data-movie-filter'));
  }, false);

  /* ── my list tabs ── */
  each(all('[data-list-tab]'), function (button) {
    button.addEventListener('click', function () {
      each(all('[data-list-tab]'), function (item) { setClass(item, 'active', item === button); });
      renderMiniList(attr(button, 'data-list-tab'));
    }, false);
  });

  /* ── notifications ── */
  function renderNotifications() {
    var html = '';
    each(newestIds.slice(0, 5), function (id) {
      var s = shows[id];
      if (!s) return;
      html += '<button data-open="' + escapeHtml(id) + '"><span class="notice-dot"></span><strong>' + escapeHtml(s.title) + '</strong><small>' +
        (s.type === 'Movie' ? 'New movie available' : s.episodes.length + ' episode' + (s.episodes.length === 1 ? '' : 's') + ' available') + '</small></button>';
    });
    byId('noticeList').innerHTML = html || '<p class="notice-empty">No new episodes right now.</p>';
  }
  notificationButton.addEventListener('click', function () {
    var show = notificationPanel.hidden;
    setHidden(notificationPanel, !show);
    notificationButton.setAttribute('aria-expanded', show ? 'true' : 'false');
  }, false);
  byId('closeNotifications').addEventListener('click', function () {
    setHidden(notificationPanel, true);
    notificationButton.setAttribute('aria-expanded', 'false');
  }, false);
  byId('detailNotifications').addEventListener('click', function () {
    dialogClose();
    setHidden(notificationPanel, false);
    notificationButton.setAttribute('aria-expanded', 'true');
  }, false);

  /* ── dialog secondary buttons ── */
  byId('detailSearch').addEventListener('click', function () { dialogClose(); openSearch(); }, false);
  document.querySelector('.dialog-close').addEventListener('click', dialogClose, false);
  byId('detailSave').addEventListener('click', function () { toggleSave(activeKey); }, false);
  byId('detailFavorite').addEventListener('click', function () {
    favorites[activeKey] = !favorites[activeKey];
    store.set('favs', favorites);
    setClass(this, 'active', !!favorites[activeKey]);
    this.setAttribute('aria-pressed', favorites[activeKey] ? 'true' : 'false');
    computeLists();
    showToast(favorites[activeKey] ? 'Added to favorites' : 'Removed from favorites');
  }, false);
  byId('readMore').addEventListener('click', function () {
    var more = byId('detailMore'), show = more.hidden;
    setHidden(more, !show);
    setClass(byId('detailDescription'), 'expanded', show);
    this.innerHTML = show ? 'Show less⌃' : 'Read more⌄';
  }, false);
  byId('seasonSelect').addEventListener('change', function () { renderEpisodes(byId('episodeSearch').value); }, false);
  byId('episodeSearch').addEventListener('input', function () { renderEpisodes(this.value); }, false);
  byId('recommendPrev').addEventListener('click', function () { scrollTrack(byId('recommendTrack'), -570); }, false);
  byId('recommendNext').addEventListener('click', function () { scrollTrack(byId('recommendTrack'), 570); }, false);

  /* ── request + discussion (session-only, like the demo) ── */
  byId('requestForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var title = this.elements.title.value.replace(/^\s+|\s+$/g, '');
    var language = this.elements.language.value;
    if (!title) return;
    byId('requestQueue').insertAdjacentHTML('afterbegin', '<article class="request-ticket"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(language) + '</span><small>Queued for review · this browser only</small></article>');
    this.reset();
    showToast('Request added');
  }, false);
  byId('commentForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var input = byId('commentInput'), text = input.value.replace(/^\s+|\s+$/g, '');
    if (!text) return;
    var list = byId('commentList');
    list.insertAdjacentHTML('afterbegin', '<article><span class="comment-avatar">G</span><div><strong>Guest · just now</strong><p>' + escapeHtml(text) + '</p></div></article>');
    byId('commentCount').textContent = list.children.length + (list.children.length === 1 ? ' comment' : ' comments');
    input.value = '';
  }, false);

  /* ── delegated clicks ── */
  function delegatedClick(event) {
    var target = event.target || event.srcElement, node, track, key;
    node = closest(target, '[data-play-show]');
    if (node) { event.preventDefault(); playShow(attr(node, 'data-play-show')); return; }
    node = closest(target, '[data-play-ep]');
    if (node) {
      var parts = String(attr(node, 'data-play-ep')).split('|');
      var start = attr(node, 'data-start');
      playEpisode(parts[0], parts[1], start != null ? Number(start) : null);
      return;
    }
    node = closest(target, '[data-episode-play]');
    if (node) { playEpisode(activeKey, attr(node, 'data-ep'), 0); return; }
    node = closest(target, '[data-quick-play]');
    if (node) { event.stopPropagation && event.stopPropagation(); playShow(attr(node, 'data-quick-play')); return; }
    node = closest(target, '[data-rail-prev],[data-rail-next]');
    if (node) {
      track = closest(node, '.anime-rail').querySelector('.rail-track');
      scrollTrack(track, (attr(node, 'data-rail-next') !== null ? 1 : -1) * Math.max(300, track.clientWidth * 0.82));
      return;
    }
    node = closest(target, '[data-dismiss-continue]');
    if (node) {
      event.stopPropagation && event.stopPropagation();
      var dkey = attr(node, 'data-dismiss-continue');
      recent = recent.filter(function (r) { return r.key !== dkey; });
      store.set('recent', recent);
      renderContinue();
      computeLists();
      showToast('Removed from Continue Watching');
      return;
    }
    node = closest(target, '[data-detail-genre]');
    if (node) {
      dialogClose();
      byId('genreFilter').value = attr(node, 'data-detail-genre');
      applyBrowseFilters();
      scrollToElement(byId('browse'));
      return;
    }
    node = closest(target, '[data-hero-save],[data-save-key]');
    if (node) {
      event.stopPropagation && event.stopPropagation();
      if (closest(target, 'button') === node || node.tagName === 'BUTTON') { toggleSave(attr(node, 'data-save-key')); return; }
    }
    node = closest(target, '[data-open]');
    if (node) { openDetail(attr(node, 'data-open')); return; }
    node = closest(target, '[data-scroll]');
    if (node) {
      key = attr(node, 'data-scroll');
      scrollToElement(byId(key));
      each(all('.bottom-nav button'), function (button) { setClass(button, 'active', button === node); });
      return;
    }
    node = closest(target, '[data-search-chip]');
    if (node) { searchInput.value = attr(node, 'data-search-chip'); openSearch(); return; }
  }
  document.addEventListener('click', delegatedClick, false);

  /* ── TV remote / keyboard (unchanged from the demo) ── */
  function focusables() {
    var result = [], nodes = all('a[href],button,input,select,textarea,[tabindex="0"]');
    each(nodes, function (node) {
      if (!node.disabled && node.getAttribute('aria-hidden') !== 'true' && node.offsetWidth > 0 && node.offsetHeight > 0) result.push(node);
    });
    return result;
  }
  function moveFocus(direction) {
    var current = document.activeElement, list = focusables();
    if (!list.length) return;
    if (!current || list.indexOf(current) < 0) { list[0].focus(); return; }
    var from = current.getBoundingClientRect(), fx = from.left + from.width / 2, fy = from.top + from.height / 2, best = null, bestScore = Infinity;
    each(list, function (item) {
      if (item === current) return;
      var rect = item.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2, dx = x - fx, dy = y - fy;
      var valid = (direction === 'left' && dx < -4) || (direction === 'right' && dx > 4) || (direction === 'up' && dy < -4) || (direction === 'down' && dy > 4);
      if (!valid) return;
      var primary = (direction === 'left' || direction === 'right') ? Math.abs(dx) : Math.abs(dy);
      var cross = (direction === 'left' || direction === 'right') ? Math.abs(dy) : Math.abs(dx);
      var score = primary + cross * 2.5;
      if (score < bestScore) { bestScore = score; best = item; }
    });
    if (best) { best.focus(); if (best.scrollIntoView) best.scrollIntoView(false); }
  }
  document.addEventListener('keydown', function (event) {
    var key = event.key || event.keyCode, target = event.target || event.srcElement, card;
    if (key === 27 || key === 'Escape' || key === 'Back') {
      if (!playerShell.hidden) { closePlayer(); event.preventDefault(); return; }
      if (attr(searchPanel, 'aria-hidden') === 'false') { closeSearch(); event.preventDefault(); return; }
      if (!dialog.hidden) { dialogClose(); event.preventDefault(); return; }
      if (!notificationPanel.hidden) { setHidden(notificationPanel, true); notificationButton.setAttribute('aria-expanded', 'false'); event.preventDefault(); return; }
    }
    if ((key === 461 || key === 10009 || key === 8) && target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
      if (!playerShell.hidden) closePlayer();
      else if (attr(searchPanel, 'aria-hidden') === 'false') closeSearch();
      else if (!dialog.hidden) dialogClose();
      event.preventDefault();
      return;
    }
    if (key === 37 || key === 'ArrowLeft') { moveFocus('left'); event.preventDefault(); return; }
    if (key === 38 || key === 'ArrowUp') { moveFocus('up'); event.preventDefault(); return; }
    if (key === 39 || key === 'ArrowRight') { moveFocus('right'); event.preventDefault(); return; }
    if (key === 40 || key === 'ArrowDown') { moveFocus('down'); event.preventDefault(); return; }
    if (key === 13 || key === 'Enter' || key === 32 || key === ' ') {
      card = closest(target, '.show-card,.rail-card');
      if (card && !closest(target, 'button')) { event.preventDefault(); openDetail(attr(card, 'data-open')); }
    }
  }, false);

  /* ── load the catalogue from vid ── */
  function applyCatalog(data) {
    shows = {};
    showList = [];
    each(data.shows || [], function (s) {
      s.genres = s.genres || [];
      s.stars = Number(s.stars) || 0;
      s.rating = s.stars ? s.stars.toFixed(1) : '—';
      s.desc = s.desc || '';
      s.runtime = s.runtime || '';
      s.audio = s.audio || '';
      s.episodes = s.episodes || [];
      s.seasons = s.seasons && s.seasons.length ? s.seasons : [1];
      shows[s.id] = s;
      showList.push(s);
    });
    movieIds = (data.movieIds || []).filter(function (id) { return shows[id]; });
    rowsCfg = data.rows || [];
    newestIds = (data.newest || []).filter(function (id) { return shows[id]; });
    heroId = data.hero && shows[data.hero] ? data.hero : (showList[0] ? showList[0].id : null);

    var browse = document.querySelector('#browse .section-head p');
    if (browse) browse.textContent = showList.length + ' titles · ' + (data.source && data.source.anime === 'live' ? 'live Hindi-dub feed' : 'vid catalogue');
    document.body.classList.remove('is-busy');

    if (heroId) renderHero();
    renderContinue();
    renderHomeRows();
    renderCatalog();
    renderMovies('all');
    computeLists();
    renderMiniList('continue');
    renderProfile();
    renderNotifications();
    applyBrowseFilters();
    queueLazy();
  }

  function loadCatalog() {
    document.body.classList.add('is-busy');
    fetch('/api/aniroll', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) throw new Error((data && data.error) || 'catalog unavailable');
        applyCatalog(data);
      })
      .catch(function () {
        document.body.classList.remove('is-busy');
        byId('hero-title').innerHTML = 'AniRoll';
        byId('heroDesc').textContent = 'The catalogue could not be loaded right now. Refresh to try again.';
        showToast('Catalogue unavailable — please refresh');
      });
  }

  setHidden(dialog, true);
  setHidden(playerShell, true);
  setHidden(notificationPanel, true);
  setHidden(byId('continueWatching'), true);
  loadCatalog();
})();
