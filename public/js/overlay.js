// The scoreboard overlay (design A of mockups/court-overlay.html at 80%): shown over the camera picture of a YouTube stream (a web page source in PRISM or OBS).
// Two kinds of address:
//   /overlay/<tournament-slug>/<court>   the match that is live on that court of a tournament (only a court with a YouTube link has one)
//   /overlay/match/<token>               ONE match (a league match), only a match that has a YouTube link
// It follows the match by itself (Socket.IO, and a refresh every 15 seconds in case the connection drops) and draws nothing when there is nothing to show.
// ?demo=1 draws a sample, to place it in PRISM before a match is live. The page has no common.js on purpose: no menus, no footer, nothing but the scoreboard.
(function () {
  const stage = document.getElementById('ov');
  // the address is /overlay/..., or /<city>/overlay/... on the site of a city (slta.sk/<city>/…: window.CITY_BASE is "/<city>" there, see localize.js)
  const parts = window.location.pathname.split('/').filter(Boolean);
  const at = Math.max(0, parts.indexOf('overlay'));
  const first = decodeURIComponent(parts[at + 1] || '');
  const second = decodeURIComponent(parts[at + 2] || '');
  // /overlay/match/<token>: one match (a tournament that happens to be called "match" has a court number, 1 to 3 digits, where the token is)
  const matchMode = first === 'match' && !/^\d{1,3}$/.test(second);
  const demo = new URLSearchParams(window.location.search).has('demo');
  const cityBase = window.CITY_BASE || '';
  const FINISHED_SHOW_MS = 3 * 60 * 1000; // after the end the final score stays this long (the same as the court overlay, src/tournamentSchedule.js)
  const CATEGORIES = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice', FRIENDLY: 'Priateľský zápas', VIP_CUP: 'VIP Cup', ATA_TENNIS: 'ATA Tennis' };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const DEMO = {
    court: 1,
    tournament: 'Live Cup 2027',
    match: {
      status: 'LIVE',
      winnerId: null,
      player1: { name: 'Róbert Sloboda' },
      player2: { name: 'Peter Pálenek' },
      state: { currentSet: 1, sets: [{ p1: 6, p2: 1, winner: 1 }, { p1: 3, p2: 2, winner: null }] },
    },
  };

  // a doubles side is called "A / B" (two full names): its row is narrow, so it shows the surnames; a single player keeps the full name
  const rowName = (name) => (String(name || '').includes(' / ') ? String(name).split(' / ').map((n) => n.trim().split(/\s+/).pop()).join(' / ') : name);

  const started = (s) => !!(s.winner || s.p1 || s.p2 || (s.tiebreak && (s.tiebreak.p1 || s.tiebreak.p2)));

  // the number of one player in one set, and the small tie-break points next to it
  function cellHtml(set, player, isNow) {
    const other = player === 1 ? 2 : 1;
    const tb = set.tiebreak || null;
    const mtb = !!set.isSuperTiebreak;
    // a match tie-break counts points, and they are kept in its tie-break (a finished one too: only a normal tie-break copies them into the set, see finalizeSet in
    // src/matchEngine.js); a result entered by hand has no tie-break and the points are the set's own numbers
    const points = mtb && tb;
    let value = points ? tb['p' + player] : set['p' + player];
    let sup = '';
    if (tb && !mtb) {
      // in a tie-break that is being played both players' points show, afterwards only the loser's
      if (isNow) sup = tb['p' + player];
      else if (set.winner && set.winner !== player) sup = Math.min(tb.p1, tb.p2);
    }
    const lost = !isNow && set.winner && set.winner !== player;
    const mine = points ? tb['p' + player] : set['p' + player];
    const theirs = points ? tb['p' + other] : set['p' + other];
    const classes = ['ov-cell'];
    if (isNow) classes.push('ov-now');
    if (isNow && mine < theirs) classes.push('ov-trail');
    if (lost) classes.push('ov-lost');
    if (player === 2) classes.push('ov-row2');
    return `<div class="${classes.join(' ')}">${mtb && player === 1 ? '<span class="ov-mtb">MTB</span>' : ''}${escapeHtml(value)}${sup !== '' ? `<sup>${escapeHtml(sup)}</sup>` : ''}</div>`;
  }

  // data: { tag (the orange tab) or court, subtitle or tournament, match: { status, player1: { name }, player2: { name }, state } or null }
  function render(data) {
    const m = data && data.match;
    if (!m || !m.state) { stage.innerHTML = ''; return; }
    const live = m.status === 'LIVE';
    const current = m.state.currentSet;
    const shown = (m.state.sets || []).map((s, i) => ({ s, i })).filter(({ s, i }) => (live && i === current) || started(s));
    const cells = (player) => shown.map(({ s, i }) => cellHtml(s, player, live && i === current)).join('');
    const tag = data.tag != null ? data.tag : `Kurt ${data.court}`;
    const subtitle = data.subtitle != null ? data.subtitle : data.tournament;
    stage.innerHTML = `
      <div class="ov-panel">
        <div class="ov-tag"><b>${escapeHtml(tag)}</b>${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ''}</div>
        <div class="ov-board" style="--sets:${shown.length}">
          <div class="ov-name"><span>${escapeHtml(rowName(m.player1.name))}</span></div>${cells(1)}
          <div class="ov-name ov-row2"><span>${escapeHtml(rowName(m.player2.name))}</span></div>${cells(2)}
        </div>
      </div>`;
  }

  function scale() { stage.style.transform = `scale(${window.innerWidth / 1920})`; }
  window.addEventListener('resize', scale);
  scale();

  if (demo) { render(DEMO); return; }

  // an answer older than one already drawn is ignored (the poll and a push can overlap)
  let latest = 0;
  let timer = null;
  const later = (load) => { clearTimeout(timer); timer = setTimeout(load, 300); };

  if (matchMode) {
    // ONE match: its data is the public match data; it is shown while it is live and for a while after it ends, and only when it has a YouTube link
    let lastMatch = null;
    let skew = 0; // the server's clock minus this computer's: the end of a match is the server's time
    const fromMatch = (m) => {
      if (!m || !m.videoId) return null;
      const endMs = m.endTime ? Date.parse(m.endTime) : NaN;
      const ended = (m.status === 'FINISHED' || m.status === 'UNFINISHED') && Number.isFinite(endMs) && (Date.now() + skew) - endMs <= FINISHED_SHOW_MS;
      const visible = m.status === 'LIVE' || ended;
      return {
        tag: m.location || 'BLTA',
        subtitle: (m.season && m.season.name) || m.league || CATEGORIES[m.category] || '',
        match: visible && m.state ? { status: m.status, winnerId: m.winnerId, player1: m.player1, player2: m.player2, state: m.state } : null,
      };
    };
    const draw = () => render(fromMatch(lastMatch));
    const load = async () => {
      const mine = ++latest;
      try {
        const res = await fetch(`${cityBase}/api/matches/${encodeURIComponent(second)}`, { cache: 'no-store' });
        if (mine !== latest) return;
        if (res.status === 404) lastMatch = null;
        else if (res.ok) {
          const date = Date.parse(res.headers.get('Date') || '');
          if (Number.isFinite(date)) skew = date - Date.now();
          lastMatch = await res.json();
        } else return; // the server is busy (a deploy): keep what is drawn
        draw();
      } catch { /* the connection dropped: keep what is drawn, the next refresh tries again */ }
    };
    load();
    setInterval(load, 15000);
    setInterval(draw, 5000); // the final score goes away by itself 3 minutes after the end
    if (typeof io === 'function') {
      const socket = io();
      socket.on('connect', () => socket.emit('join', `match:${second}`));
      socket.on('match:update', (m) => { if (m && m.token === second) { latest += 1; lastMatch = m; draw(); } });
    }
    return;
  }

  // a court of a tournament
  const slug = first;
  const court = encodeURIComponent(second);
  async function load() {
    const mine = ++latest;
    try {
      const res = await fetch(`${cityBase}/api/seasons/by-slug/${encodeURIComponent(slug)}/court/${court}/live`, { cache: 'no-store' });
      if (mine !== latest) return;
      if (res.ok) render(await res.json());
      else if (res.status === 404) render(null); // no overlay for this court
      // any other answer is a server that is busy (a deploy): keep what is drawn
    } catch { /* the connection dropped: keep what is drawn, the next refresh tries again */ }
  }
  load();
  setInterval(load, 15000);
  if (typeof io === 'function') io().on('matches:changed', () => later(load));
})();
