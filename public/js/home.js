// League overview (the home page): series progress, league numbers, group leaders, latest results, upcoming
// matches, the top of the rankings, players looking for a match and a line for matches being played live.
// Everything is read from the same APIs the other pages use and refreshes whenever a match changes.

const rootEl = document.getElementById('home-root');

const HOME_CATEGORY_ORDER = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const HOME_CATEGORY_NAMES = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice' };

let homeData = null;
let homeCategory = null; // selected tab of the group leaders
let mineFor = null; // the player the "My season" card was loaded for

// ---------- helpers ----------

function weekRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { from: start.toISOString(), to: new Date(end.getTime() - 1).toISOString() };
}

// The season whose dates include today; otherwise the newest one that has matches.
function pickSeason(seasons) {
  const today = new Date().toISOString().slice(0, 10);
  const current = seasons.find((s) => s.startDate && s.endDate && s.startDate <= today && today <= s.endDate && s.groups.length);
  return current || seasons.find((s) => s.matchCount > 0) || seasons[0] || null;
}

function soft(promise, fallback) {
  return promise.catch(() => fallback);
}

// ---------- data ----------

async function loadHome() {
  const nowMinus = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const week = weekRange();
  const playerId = loggedInPlayer();
  mineFor = playerId;
  const [seasons, live, finished, upcoming, weekMatches, looking, rankings, mine, iq] = await Promise.all([
    soft(api('/seasons'), null),
    soft(api('/matches?status=LIVE'), []),
    soft(api('/matches?status=FINISHED&limit=4'), []),
    soft(api(`/matches?status=PLANNED&hasDate=1&from=${encodeURIComponent(nowMinus)}&to=${encodeURIComponent('2100-01-01T00:00:00.000Z')}&limit=4`), []),
    soft(api(`/matches?from=${encodeURIComponent(week.from)}&to=${encodeURIComponent(week.to)}`), []),
    soft(api('/availability'), []),
    soft(api('/rankings'), null),
    playerId ? soft(api(`/matches?playerId=${playerId}`), []) : Promise.resolve(null),
    playerId ? soft(api(`/courtiq/player/${playerId}`), null) : Promise.resolve(null),
  ]);
  if (seasons === null) throw new Error('seasons');
  const season = pickSeason(seasons.filter((s) => s.kind !== 'TOURNAMENT'));
  const standings = season ? await soft(api(`/seasons/${season.id}/standings`), null) : null;
  return { seasons, season, standings, live, finished, upcoming, weekMatches, looking, rankings, mine, iq, playerId };
}

// ---------- "My season": only for a logged-in player ----------

function matchTime(m) {
  return new Date(m.scheduledAt || m.startTime || m.endTime || m.createdAt).getTime();
}

function mineHtml(d) {
  if (!d.playerId || !d.mine) return '';
  const pid = Number(d.playerId);
  const mine = d.mine;
  const opponentOf = (m) => (m.player1.id === pid ? m.player2 : m.player1);

  // the player's place in a group of the current season
  const groups = d.standings ? d.standings.groups : [];
  let group = null;
  let row = null;
  groups.some((g) => {
    const r = g.rows.find((x) => x.player && Number(x.player.id) === pid);
    if (r) { group = g; row = r; return true; }
    return false;
  });

  // next match: a live one first, then the soonest dated one, then one still without a date
  const now = Date.now();
  const live = mine.find((m) => m.status === 'LIVE');
  const dated = mine
    .filter((m) => m.status === 'PLANNED' && m.scheduledAt && new Date(m.scheduledAt).getTime() >= now - 60 * 60 * 1000)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  const undated = mine.filter((m) => m.status === 'PLANNED' && !m.scheduledAt);
  const next = live || dated[0] || undated[0] || null;

  // form: the last five decided matches, oldest to newest
  const form = mine.filter((m) => m.status === 'FINISHED' && m.winnerId).sort((a, b) => matchTime(a) - matchTime(b)).slice(-5);

  // overall BLTA ranking position (the same table as the Rankings page)
  const rankRows = blta(d);
  const ranked = rankRows && currentPlayerSlug ? rankRows.find((r) => r.slug && r.slug === currentPlayerSlug) : null;
  // CourtIQ: rated at least once when gamesPlayed > 0
  const iq = d.iq && d.iq.gamesPlayed > 0 && d.iq.band !== null ? d.iq : null;

  if (!next && !row && !form.length && !ranked && !iq) return '';

  let nextCell;
  if (next) {
    const opp = opponentOf(next);
    const sub = live
      ? `<span class="home-chip live">${escapeHtml(t('home.live'))}</span>`
      : (next.scheduledAt ? `<span class="home-chip date">${escapeHtml(chipDate(next.scheduledAt))}</span>` : `<span class="home-mine-dim">${escapeHtml(t('home.mineNoDate'))}</span>`);
    nextCell = `
      <a class="home-mine-cell next" href="/match/${next.token}">
        <div class="k">${escapeHtml(t('home.mineNext'))}</div>
        <div class="v">${escapeHtml(opp.name)}</div>
        <div class="s">${sub}${next.location ? `<span class="home-mine-dim">${escapeHtml(next.location)}</span>` : ''}</div>
      </a>`;
  } else {
    nextCell = `
      <div class="home-mine-cell next">
        <div class="k">${escapeHtml(t('home.mineNext'))}</div>
        <div class="v dim">${escapeHtml(t('home.mineNoNext'))}</div>
      </div>`;
  }

  // Every number tile has the same build: the big number on the left, at most two lines beside it behind a thin divider.
    // `cover` makes the whole tile a link without being an <a> itself (it holds links of its own, the form squares)
    const tile = ({ href, cover, label, num, sup, lines, below }) => `
      <${href ? `a class="home-mine-cell" href="${href}"` : `div class="home-mine-cell${cover ? ' linked' : ''}"`}>
        ${cover ? `<a class="home-mine-cover" href="${cover}" aria-label="${escapeHtml(label)}"></a>` : ''}
        <div class="k">${escapeHtml(label)}</div>
        <div class="home-mine-body">
          <div class="big">${num}${sup ? `<sup>${sup}</sup>` : ''}</div>
          <div class="side">${lines}</div>
        </div>${below || ''}
      </${href ? 'a' : 'div'}>`;
  const of = (text) => `<span class="of">${escapeHtml(text)}</span>`;
  const grp = (text) => `<span class="grp">${escapeHtml(text)}</span>`;
  const pts = (text) => `<span class="pts">${escapeHtml(text)}</span>`;
  // two small facts on one line
  const together = (...parts) => `<span class="row">${parts.join('')}</span>`;

  let groupCells = '';
  if (row && group) {
    const opponents = Math.max(0, group.rows.length - 1);
    const left = Math.max(0, opponents - row.played);
    const pct = opponents ? Math.min(100, Math.round((row.played / opponents) * 100)) : 0;
    groupCells = tile({
      href: d.season && d.season.id ? `/tables?season=${d.season.id}` : '/tables', // the tables of this season
      label: t('home.minePos'),
      num: `${row.position}.`,
      lines: of(t('home.minePlayers', { n: group.rows.length })) + together(grp(group.name), pts(t('home.minePts', { n: row.points }))),
    }) + tile({
      label: t('home.mineLeft'),
      num: left,
      lines: of(t('home.minePlayed', { done: row.played, total: opponents })),
      below: `<div class="home-bar mini"><i style="width:${pct}%"></i></div>`,
    });
  }

  const wins = form.filter((m) => m.winnerId === pid).length;
  const squares = form.map((m) => {
    const won = m.winnerId === pid;
    return `<a class="form-square ${won ? 'win' : 'loss'}" href="/match/${m.token}" title="${escapeHtml(opponentOf(m).name)}">${won ? 'W' : 'L'}</a>`;
  }).join('');
  const formCell = form.length
    ? tile({
      cover: `/player/${encodeURIComponent(currentPlayerSlug || pid)}`, // my profile
      label: t('home.mineForm'),
      num: wins,
      lines: of(t('home.mineFormSub', { w: wins, l: form.length - wins })) + pts(t('home.mineLastN', { n: form.length })),
      below: `<div class="home-mine-form">${squares}</div>`,
    })
    : `
      <a class="home-mine-cell" href="/player/${encodeURIComponent(currentPlayerSlug || pid)}">
        <div class="k">${escapeHtml(t('home.mineForm'))}</div>
        <div class="v dim">${escapeHtml(t('home.mineNoForm'))}</div>
      </a>`;

  let rankCell = '';
  if (rankRows) {
    rankCell = ranked
      ? tile({
        href: '/rankings',
        label: t('home.mineRank'),
        num: `${ranked.rank}.`,
        lines: of(t('home.minePlayers', { n: rankRows.length }))
          + together(pts(t('home.minePts', { n: ranked.points })), ranked.move ? `<span class="home-mine-move ${ranked.move.direction === 'up' ? 'up' : 'down'}">${ranked.move.direction === 'up' ? '▲' : '▼'} ${ranked.move.amount}</span>` : ''),
      })
      : `
      <a class="home-mine-cell" href="/rankings">
        <div class="k">${escapeHtml(t('home.mineRank'))}</div>
        <div class="v dim">${escapeHtml(t('home.mineNotRanked'))}</div>
      </a>`;
  }

  let iqCell = '';
  if (d.iq) {
    const profile = `/player/${encodeURIComponent(currentPlayerSlug || pid)}`;
    iqCell = iq
      ? tile({
        href: profile,
        label: t('home.mineIq'),
        num: iq.band.toFixed(1),
        sup: iq.provisional ? `<span title="${escapeHtml(t('courtiq.provisional'))}">?</span>` : '',
        lines: of(`${t('courtiq.ratingCol')} ${iq.rating}`) + pts(t('courtiq.gamesPlayed', { count: iq.gamesPlayed })),
      })
      : `
      <a class="home-mine-cell" href="${profile}">
        <div class="k">${escapeHtml(t('home.mineIq'))}</div>
        <div class="v dim">${escapeHtml(t('home.mineNotRated'))}</div>
      </a>`;
  }

  // how many tiles there are: on a tablet the next-match tile has a row to itself and the rest sit in pairs
  const tileCount = 2 + (row && group ? 2 : 0) + (rankCell ? 1 : 0) + (iqCell ? 1 : 0);
  const note = [d.season && d.season.name, group && group.name].filter(Boolean).join(' · ');
  return `
  <section class="home-mine">
    ${secTitle(t('home.mine'), note, '', '')}
    <div class="home-mine-grid${tileCount % 2 === 0 ? ' rest-odd' : ''}">${nextCell}${groupCells}${formCell}${rankCell}${iqCell}</div>
  </section>`;
}

// ---------- season timeline ----------

// "Sep – Dec 2026" / "Dec 2025 – Apr 2026"
function monthRange(startIso, endIso) {
  const a = new Date(`${startIso}T12:00:00`);
  const b = new Date(`${endIso}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '';
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const left = a.getFullYear() === b.getFullYear() ? cap(monthShort(a)) : `${cap(monthShort(a))} ${a.getFullYear()}`;
  return `${left} – ${cap(monthShort(b))} ${b.getFullYear()}`;
}

function seasonState(s, today) {
  if (s.startDate && s.endDate) {
    if (s.endDate < today) return 'past';
    if (s.startDate > today) return 'future';
    return 'now';
  }
  return 'future';
}

// All seasons in date order: finished ones greyed out, the running one highlighted, the coming ones outlined.
function timelineHtml(d) {
  const seasons = [...(d.seasons || [])].filter((s) => s.kind !== 'TOURNAMENT').sort((a, b) => String(a.startDate || '9999').localeCompare(String(b.startDate || '9999')));
  if (seasons.length < 2) return '';
  const today = new Date().toISOString().slice(0, 10);
  const label = { past: t('home.tlPast'), now: t('home.tlNow'), future: t('home.tlFuture') };
  const cards = seasons.map((s) => {
    const state = seasonState(s, today);
    let elapsed = 0;
    if (state === 'now') {
      const span = dayNum(s.endDate) - dayNum(s.startDate) + 1;
      elapsed = Math.max(0, Math.min(100, ((dayNum(today) - dayNum(s.startDate) + 1) / span) * 100));
    }
    // every season has its own page (/season/<name>); an upcoming one without groups yet shows its empty tabs
    const href = `/season/${encodeURIComponent(s.slug)}`;
    const range = s.startDate && s.endDate ? monthRange(s.startDate, s.endDate) : '';
    const inner = `
      <div class="home-tl-body">
        ${s.logoUrl ? `<img class="home-tl-logo" src="${escapeHtml(s.logoUrl)}" alt="" loading="lazy">` : ''}
        <span class="home-tl-chip">${state === 'now' ? '<i></i>' : ''}${escapeHtml(label[state])}</span>
        <div class="home-tl-name">${escapeHtml(s.name)}</div>
        <div class="home-tl-range">${escapeHtml(range)}</div>
      </div>`;
    return href
      ? `<a class="home-tl ${state}" style="--p:${elapsed.toFixed(1)}%" href="${href}"${state === 'now' ? ' data-current="1"' : ''}>${inner}</a>`
      : `<div class="home-tl ${state}" style="--p:${elapsed.toFixed(1)}%">${inner}</div>`;
  }).join('');
  return `<div class="home-tl-wrap" id="home-tl-wrap">
    <button type="button" class="home-tl-nav prev" aria-label="←">‹</button>
    <div class="home-timeline" id="home-timeline" aria-label="${escapeHtml(t('home.timeline'))}">${cards}</div>
    <button type="button" class="home-tl-nav next" aria-label="→">›</button>
  </div>`;
}

// The row scrolls sideways when it is wider than the screen: show which sides have more (edge fade + arrows),
// let a mouse drag it, and keep the running season in view.
function updateTimelineEdges() {
  const wrap = document.getElementById('home-tl-wrap');
  const row = document.getElementById('home-timeline');
  if (!wrap || !row) return;
  const max = row.scrollWidth - row.clientWidth;
  wrap.classList.toggle('can-prev', row.scrollLeft > 4);
  wrap.classList.toggle('can-next', row.scrollLeft < max - 4);
}

function initTimelineScroll(keepLeft) {
  const wrap = document.getElementById('home-tl-wrap');
  const row = document.getElementById('home-timeline');
  if (!wrap || !row) return;
  const cur = row.querySelector('[data-current]');
  if (typeof keepLeft === 'number') row.scrollLeft = keepLeft;
  else if (cur && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, cur.offsetLeft - (row.clientWidth - cur.offsetWidth) / 2);
  row.addEventListener('scroll', updateTimelineEdges, { passive: true });
  wrap.querySelector('.prev').addEventListener('click', () => row.scrollBy({ left: -row.clientWidth * 0.7, behavior: 'smooth' }));
  wrap.querySelector('.next').addEventListener('click', () => row.scrollBy({ left: row.clientWidth * 0.7, behavior: 'smooth' }));

  // Drag with a mouse (touch and trackpads already scroll natively).
  let startX = 0;
  let startLeft = 0;
  let dragging = false;
  let moved = false;
  row.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    dragging = true; moved = false; startX = e.clientX; startLeft = row.scrollLeft;
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 5) { moved = true; row.classList.add('dragging'); }
    if (moved) row.scrollLeft = startLeft - dx;
  });
  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    row.classList.remove('dragging');
  });
  // A drag must not count as a click on a season card.
  row.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
  updateTimelineEdges();
}

window.addEventListener('resize', updateTimelineEdges);

// ---------- pieces ----------

function progressHtml(d) {
  if (!d.season) return `<div class="empty-state">${escapeHtml(t('home.noSeason'))}</div>`;
  return seasonProgressHtml(d.season, d.standings);
}

function statsHtml(d) {
  const groups = d.standings ? d.standings.groups : [];
  const frozen = d.standings && d.standings.frozen;
  const counted = groups.reduce((s, g) => s + (g.matchesCounted || 0), 0);
  const players = groups.reduce((s, g) => s + g.rows.length, 0);
  const weekLive = d.weekMatches.filter((m) => m.status === 'LIVE').length;
  const tile = (k, v, s) => `<div class="home-stat"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(String(v))}</div><div class="s">${escapeHtml(s)}</div></div>`;
  return `<div class="home-stats">
    ${tile(t('home.statPlayed'), frozen ? '–' : counted, t('home.statPlayedSub'))}
    ${tile(t('home.statPlayers'), players, t('home.statPlayersSub', { n: groups.length }))}
    ${tile(t('home.statWeek'), d.weekMatches.length, t('home.statWeekSub', { n: weekLive }))}
    ${tile(t('home.statLooking'), d.looking.length, t('home.statLookingSub'))}
  </div>`;
}

function leadersHtml(d) {
  const groups = d.standings ? d.standings.groups : [];
  const cats = HOME_CATEGORY_ORDER.filter((c) => groups.some((g) => g.category === c));
  if (!cats.length) return '';
  if (!cats.includes(homeCategory)) homeCategory = cats[0];
  const inCat = groups.filter((g) => g.category === homeCategory);
  const card = (g) => {
    const top = g.rows.slice(0, 3);
    const started = top.length && top[0].played > 0;
    return `
    <div class="home-col">
      <h3 class="home-grp-t">${escapeHtml(g.name)}</h3>
      <div class="home-card">
        ${started ? `
        <div class="home-t-head"><span>#</span><span>${escapeHtml(t('tables.player'))}</span><span>${escapeHtml(t('tables.points'))}</span></div>
        ${top.map((r) => `
        <div class="home-t-row${r.position === 1 ? ' lead' : ''}">
          <span class="pos">${r.position}</span>
          ${r.player.slug || r.player.id ? `<a class="nm" href="/player/${encodeURIComponent(r.player.slug || r.player.id)}">${escapeHtml(r.player.name)}</a>` : `<span class="nm">${escapeHtml(r.player.name)}</span>`}
          <span class="pts">${r.points}</span>
        </div>`).join('')}` : `<div class="home-empty">${escapeHtml(t('home.noGames'))}</div>`}
      </div>
    </div>`;
  };
  return `
  <section class="home-sec" id="home-leaders">
    ${secTitle(t('home.leaders'), '', '/tables', t('home.allTables'))}
    <div class="tabs" id="home-cats" role="tablist">${cats.map((c) => `<button type="button" class="tab${c === homeCategory ? ' active' : ''}" data-cat="${c}">${HOME_CATEGORY_NAMES[c]}</button>`).join('')}</div>
    <div class="home-cols-3">${inCat.map(card).join('')}</div>
  </section>`;
}

function matchesBlockHtml(d) {
  return `
  <section class="home-sec">
    <div class="home-cols">
      <div class="home-col">
        ${secTitle(t('home.results'), '', '/matches', t('home.all'))}
        <div class="home-card">${d.finished.length ? d.finished.map(resultRow).join('') : `<div class="home-empty">${escapeHtml(t('home.noResults'))}</div>`}</div>
      </div>
      <div class="home-col">
        ${secTitle(t('home.upcoming'), '', '/matches', t('home.all'))}
        <div class="home-card">${d.upcoming.length ? d.upcoming.map(upcomingRow).join('') : `<div class="home-empty">${escapeHtml(t('home.noUpcoming'))}</div>`}</div>
      </div>
    </div>
  </section>`;
}

function blta(d) {
  const table = d.rankings && d.rankings.tables ? d.rankings.tables.find((x) => x.key === 'blta') : null;
  return table && table.rows.length ? table.rows : null;
}

function moveHtml(move) {
  if (!move) return '<span class="mv none">–</span>';
  return `<span class="mv ${move.direction === 'up' ? 'up' : 'down'}">${move.direction === 'up' ? '▲' : '▼'} ${move.amount}</span>`;
}

function rankingHtml(rows) {
  return `
  <div class="home-col">
    ${secTitle(t('home.ranking'), t('home.top5'), '/rankings', t('home.whole'))}
    <div class="home-card">
      <div class="home-t-head rank"><span>#</span><span>${escapeHtml(t('tables.player'))}</span><span>${escapeHtml(t('home.change'))}</span><span>${escapeHtml(t('tables.points'))}</span></div>
      ${rows.slice(0, 5).map((r) => `
      <div class="home-t-row rank${r.rank === 1 ? ' lead' : ''}">
        <span class="pos">${r.rank}</span>
        ${r.slug ? `<a class="nm" href="/player/${encodeURIComponent(r.slug)}">${escapeHtml(r.name)}</a>` : `<span class="nm">${escapeHtml(r.name)}</span>`}
        ${moveHtml(r.move)}
        <span class="pts">${escapeHtml(String(r.points))}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

function nextSlot(post) {
  const now = Date.now();
  const iso = (post.slots || []).filter((s) => new Date(s).getTime() > now).sort()[0];
  return iso ? chipDate(iso) : '';
}

function lookingHtml(posts) {
  return `
  <div class="home-col">
    ${secTitle(t('home.looking'), posts.length ? String(posts.length) : '', '/looking-to-play', t('home.everyone'))}
    <div class="home-card">
      ${posts.length ? posts.slice(0, 4).map((p) => {
        const cats = (p.categories || []).map((c) => categoryLabel(c)).join(' · ');
        const sub = [cats, nextSlot(p), p.location || t('home.anywhere')].filter(Boolean).join(' · ');
        return `
      <a class="home-m-row" href="/looking-to-play">
        <div><div class="n"><b>${escapeHtml(p.player ? p.player.name : '')}</b></div><div class="s">${escapeHtml(sub)}</div></div>
        <span class="home-chip btn">${escapeHtml(t('home.play'))}</span>
      </a>`;
      }).join('') : `<div class="home-empty">${escapeHtml(t('home.noLooking'))}</div>`}
    </div>
  </div>`;
}

function rankingAndLookingHtml(d) {
  const rows = blta(d);
  if (!rows && !d.looking.length) return '';
  return `<section class="home-sec"><div class="home-cols">${rows ? rankingHtml(rows) : ''}${lookingHtml(d.looking)}</div></section>`;
}

function moversHtml(d) {
  const rows = blta(d);
  if (!rows) return '';
  const ups = rows.filter((r) => r.move && r.move.direction === 'up').sort((a, b) => b.move.amount - a.move.amount);
  const downs = rows.filter((r) => r.move && r.move.direction === 'down').sort((a, b) => b.move.amount - a.move.amount);
  const tile = (k, r, text, cls) => `<div class="home-mv"><div class="k">${escapeHtml(k)}</div><div class="nm">${escapeHtml(r.name)}</div><div class="d ${cls}">${escapeHtml(text)}</div></div>`;
  const tiles = [tile(t('home.moverLeader'), rows[0], `#1 · ${rows[0].points}`, '')];
  if (ups[0]) tiles.push(tile(t('home.moverUp'), ups[0], `▲ ${ups[0].move.amount} · #${ups[0].rank}`, 'up'));
  if (downs[0]) tiles.push(tile(t('home.moverDown'), downs[0], `▼ ${downs[0].move.amount} · #${downs[0].rank}`, 'down'));
  return `<section class="home-sec">${secTitle(t('home.movers'), '', '/rankings', t('home.whole'))}<div class="home-movers n${tiles.length}">${tiles.join('')}</div></section>`;
}

function liveHtml(d) {
  if (!d.live.length) return '';
  const items = d.live.slice(0, 2).map((m) => `<a class="item" href="/match/${m.token}"><b>${escapeHtml(m.player1.name)}</b> ${escapeHtml(m.scoreSummary || '–')} <b>${escapeHtml(m.player2.name)}</b></a>`).join('<span class="sep">·</span>');
  return `<section class="home-sec home-sec-live"><div class="home-live"><span class="p"><i></i>${escapeHtml(t('home.live'))} · ${d.live.length}</span>${items}<a class="go" href="/matches">${escapeHtml(t('home.watch'))}</a></div></section>`;
}

// ---------- render ----------

function sub(d) {
  if (!d.season) return '';
  const end = d.season.endDate ? ` · ${t('home.endsOn', { date: dayMonth(d.season.endDate) })}` : '';
  return `<p class="home-sub"><b>${escapeHtml(d.season.name)}</b>${escapeHtml(end)}</p>`;
}

function renderHome() {
  const d = homeData;
  const oldRow = document.getElementById('home-timeline');
  const keepLeft = oldRow ? oldRow.scrollLeft : undefined;
  document.getElementById('home-sub').innerHTML = sub(d);
  const stateEl = document.getElementById('home-state');
  if (d.season) {
    const state = seasonState(d.season, new Date().toISOString().slice(0, 10));
    stateEl.className = `home-head-state ${state}`;
    stateEl.innerHTML = `${state === 'now' ? '<i></i>' : ''}${escapeHtml(t({ past: 'home.tlPast', now: 'home.tlNow', future: 'home.tlFuture' }[state]))}`;
    stateEl.hidden = false;
  } else {
    stateEl.hidden = true;
  }
  const headLogo = document.getElementById('home-head-logo');
  if (d.season && d.season.logoUrl) { headLogo.src = d.season.logoUrl; headLogo.hidden = false; } else { headLogo.hidden = true; }
  rootEl.innerHTML = `
    ${mineHtml(d)}
    <section class="home-current">
      ${d.season ? secTitle(t('home.current'), d.season.name, '/harmonogram', t('home.fullSchedule')) : ''}
      ${timelineHtml(d)}
      ${progressHtml(d)}
      ${d.season ? statsHtml(d) : ''}
    </section>
    ${pomShellHtml()}
    ${leadersHtml(d)}
    ${matchesBlockHtml(d)}
    ${rankingAndLookingHtml(d)}
    ${moversHtml(d)}
    ${liveHtml(d)}
    ${inviteShellHtml(d)}`;
  initTimelineScroll(keepLeft);
  loadPom();
  loadInvite();
}

// ---------- "Player of the month": a slim card under the stats tiles ----------

let pomData; // undefined = not asked yet, null = nobody (or the request failed), else the answer of /api/highlights/month

function pomShellHtml() {
  return '<section class="home-sec" id="home-pom" hidden></section>';
}

// the player's profile photo, or their initials in the same round frame when there is none
function pomPhotoHtml(p) {
  if (p.photoUrl) return `<img class="pom-photo" src="${escapeHtml(p.photoUrl)}" alt="${escapeHtml(p.name)}" loading="lazy">`;
  const initials = String(p.name || '').trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join('').toUpperCase();
  return `<div class="pom-photo pom-initials" aria-hidden="true">${escapeHtml(initials)}</div>`;
}

function pomCardHtml(d) {
  const p = d.player;
  const monthName = new Date(`${d.month}-15T12:00:00`).toLocaleDateString(currentLang === 'en' ? 'en-GB' : 'sk-SK', { month: 'long' });
  const num = (label, value, green) => `<div><small>${escapeHtml(label)}</small><span${green ? ' class="green"' : ''}>${escapeHtml(value)}</span></div>`;
  const improved = d.improved
    ? `<div class="pom-imp">${escapeHtml(t('pom.improved'))}: <a href="/player/${encodeURIComponent(d.improved.slug || d.improved.id)}"><b>${escapeHtml(d.improved.name)}</b></a> · courtIQ ${d.improved.from.toFixed(1)} → <span class="green">${d.improved.to.toFixed(1)} ▲</span></div>`
    : '';
  return `
    <div class="pom-card">
      ${pomPhotoHtml(p)}
      <div class="pom-who"><div class="pom-k">${escapeHtml(t('pom.title'))} · ${escapeHtml(monthName)}</div><b>${escapeHtml(p.name)}</b></div>
      <div class="pom-nums">${num(t('pom.wins'), t('pom.winsOf', { w: p.wins, n: p.played }))}${p.points ? num(t('pom.points'), `+${p.points}`, true) : ''}${p.streak >= 2 ? num(t('pom.streak'), String(p.streak)) : ''}</div>
      <a class="pom-more" href="/player/${encodeURIComponent(p.slug || p.id)}">${escapeHtml(t('pom.profile'))} →</a>
      ${improved}
    </div>`;
}

async function loadPom() {
  const el = document.getElementById('home-pom');
  if (!el) return;
  if (pomData === undefined) {
    try { pomData = await api('/highlights/month'); } catch { pomData = null; }
  }
  if (pomData && pomData.player) { el.innerHTML = pomCardHtml(pomData); el.hidden = false; } else el.remove();
}

// ---------- "Invite a friend": the last section, for a logged-in player ----------

let inviteData = null; // { slug, opened, registered, played } of the logged-in player
let inviteFor = null;

function inviteShellHtml(d) {
  if (!d.playerId) return '';
  return `<section class="home-sec" id="home-invite">${secTitle(t('invite.title'), '', '', '')}<div id="home-invite-body"></div></section>`;
}

const inviteLink = () => `${window.location.origin}/pozvanka/${encodeURIComponent(inviteData.slug)}`;

function inviteCardHtml() {
  const stat = (label, value, green) => `<div><small>${escapeHtml(label)}</small><b${green ? ' class="green"' : ''}>${value}</b></div>`;
  return `
    <div class="inv-card">
      <div>
        <h3>${escapeHtml(t('invite.heading'))}</h3>
        <p>${escapeHtml(t('invite.text'))}</p>
        <div class="inv-stats">${stat(t('invite.opened'), inviteData.opened)}${stat(t('invite.registered'), inviteData.registered, true)}${stat(t('invite.played'), inviteData.played)}</div>
      </div>
      <div>
        <div class="inv-link"><span>${escapeHtml(inviteLink().replace(/^https?:\/\//, ''))}</span><button type="button" class="inv-btn" data-invite="copy">${escapeHtml(t('invite.copy'))}</button></div>
        <div class="inv-row">
          <button type="button" class="inv-btn main" data-invite="wa">${escapeHtml(t('invite.whatsapp'))}</button>
          <button type="button" class="inv-btn" data-invite="mail">${escapeHtml(t('invite.email'))}</button>
        </div>
      </div>
    </div>`;
}

function paintInvite() {
  const body = document.getElementById('home-invite-body');
  if (!body) return;
  if (inviteData && inviteData.slug) body.innerHTML = inviteCardHtml();
  else document.getElementById('home-invite').remove(); // a player without an address of their own has no link
}

async function loadInvite() {
  const id = loggedInPlayer();
  if (!id || !document.getElementById('home-invite-body')) return;
  if (inviteData && inviteFor === id) paintInvite();
  try {
    inviteData = await api('/invites/mine');
    inviteFor = id;
    paintInvite();
  } catch {
    const shell = document.getElementById('home-invite');
    if (shell) shell.remove();
  }
}

rootEl.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-invite]');
  if (!b || !inviteData) return;
  const link = inviteLink();
  const message = t('invite.message', { link });
  if (b.dataset.invite === 'wa') {
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  } else if (b.dataset.invite === 'mail') {
    window.location.href = `mailto:?subject=${encodeURIComponent(t('invite.subject'))}&body=${encodeURIComponent(message)}`;
  } else {
    const label = b.textContent;
    try { await navigator.clipboard.writeText(link); b.textContent = t('invite.copied'); } catch { window.prompt(t('invite.copy'), link); }
    setTimeout(() => { b.textContent = label; }, 2000);
  }
});

function loggedInPlayer() {
  return playerAuthed && currentPlayerId ? currentPlayerId : null;
}

async function refreshHome() {
  try {
    homeData = await loadHome();
  } catch {
    if (!homeData) rootEl.innerHTML = `<div class="empty-state">${escapeHtml(t('home.loadError'))}</div>`;
    return;
  }
  renderHome();
  // On a plain reload the login status is usually read while this page data is still loading, so it was unknown when
  // this load started. If it differs from what this load used, load again with it (mineFor now matches, so it stops there).
  if (loggedInPlayer() !== mineFor) refreshHome();
}

// The session is read after the page loads (and changes on login/logout): load the player's own data when it does.
window.addEventListener('blta:auth-changed', () => {
  if (homeData && loggedInPlayer() !== mineFor) refreshHome();
});

rootEl.addEventListener('click', (e) => {
  const b = e.target.closest('#home-cats [data-cat]');
  if (!b || !homeData) return;
  homeCategory = b.dataset.cat;
  renderHome();
});

// The two buttons beside the heading are for visitors who are not logged in: they open the same login / registration window
// as the menu does. The "i" next to Register explains what it is for (hover, keyboard focus, or a tap on a phone).
(function homeAuthButtons() {
  const box = document.getElementById('home-auth');
  if (!box) return;
  const wrap = document.getElementById('home-reg-wrap');
  const info = document.getElementById('home-info');
  info.setAttribute('aria-label', t('home.infoLabel'));
  let known = false;
  const show = () => { known = true; box.hidden = !!playerAuthed; if (box.hidden) wrap.classList.remove('tip-open'); };
  window.addEventListener('blta:auth-changed', show);
  setTimeout(() => { if (!known) show(); }, 3000); // in case the session answer came before this script was ready
  document.getElementById('home-login').addEventListener('click', () => openPlayerLoginModal());
  document.getElementById('home-register').addEventListener('click', () => openPlayerLoginModal(null, { startAtRegister: true }));
  const setTip = (open) => { wrap.classList.toggle('tip-open', open); info.setAttribute('aria-expanded', String(open)); };
  let pinned = false;
  info.addEventListener('mouseenter', () => setTip(true));
  info.addEventListener('mouseleave', () => { if (!pinned) setTip(false); });
  info.addEventListener('focus', () => setTip(true));
  info.addEventListener('blur', () => { if (!pinned) setTip(false); });
  info.addEventListener('click', (e) => { e.stopPropagation(); pinned = !pinned; setTip(pinned); });
  document.addEventListener('click', () => { if (pinned) { pinned = false; setTip(false); } });
})();

(async () => {
  await refreshHome();
  if (typeof io === 'function') {
    const socket = io();
    let timer = null;
    socket.on('matches:changed', () => { clearTimeout(timer); timer = setTimeout(refreshHome, 800); });
  }
})();
