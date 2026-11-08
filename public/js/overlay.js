// The scoreboard overlay of a court (/overlay/<slug>/<court>, design A of mockups/court-overlay.html at 80%): shown over the camera picture of the YouTube stream
// (a web page source in PRISM or OBS). It shows the match that is live on the court, follows it by itself (Socket.IO matches:changed, and a refresh every 15 seconds in
// case the connection drops), and draws nothing when there is none. ?demo=1 draws a sample, to place it in PRISM before a match is live.
// The page has no common.js on purpose: no menus, no footer, nothing but the scoreboard.
(function () {
  const stage = document.getElementById('ov');
  // the address is /overlay/<slug>/<court>, or /<city>/overlay/<slug>/<court> on the site of a city (slta.sk/<city>/…: window.CITY_BASE is "/<city>" there, see localize.js)
  const parts = window.location.pathname.split('/').filter(Boolean);
  const at = Math.max(0, parts.indexOf('overlay'));
  const slug = decodeURIComponent(parts[at + 1] || '');
  const court = encodeURIComponent(parts[at + 2] || '');
  const cityBase = window.CITY_BASE || '';
  const demo = new URLSearchParams(window.location.search).has('demo');

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

  function render(data) {
    const m = data && data.match;
    if (!m || !m.state) { stage.innerHTML = ''; return; }
    const live = m.status === 'LIVE';
    const current = m.state.currentSet;
    const shown = (m.state.sets || []).map((s, i) => ({ s, i })).filter(({ s, i }) => (live && i === current) || started(s));
    const cells = (player) => shown.map(({ s, i }) => cellHtml(s, player, live && i === current)).join('');
    stage.innerHTML = `
      <div class="ov-panel">
        <div class="ov-tag"><b>Kurt ${escapeHtml(data.court)}</b><span>${escapeHtml(data.tournament)}</span></div>
        <div class="ov-board" style="--sets:${shown.length}">
          <div class="ov-name"><span>${escapeHtml(m.player1.name)}</span></div>${cells(1)}
          <div class="ov-name ov-row2"><span>${escapeHtml(m.player2.name)}</span></div>${cells(2)}
        </div>
      </div>`;
  }

  function scale() { stage.style.transform = `scale(${window.innerWidth / 1920})`; }
  window.addEventListener('resize', scale);
  scale();

  if (demo) { render(DEMO); return; }

  async function load() {
    try {
      const res = await fetch(`${cityBase}/api/seasons/by-slug/${encodeURIComponent(slug)}/court/${court}/live`, { cache: 'no-store' });
      render(res.ok ? await res.json() : null);
    } catch { /* the connection dropped: keep what is drawn, the next refresh tries again */ }
  }
  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
  load();
  setInterval(load, 15000);
  if (typeof io === 'function') io().on('matches:changed', later);
})();
