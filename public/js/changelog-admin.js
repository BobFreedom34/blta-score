// Backend > Points log (/changelog-admin): what each match changed in the ranking points and in the league group table (GET
// /api/changelog, written by src/changeLog.js), newest first, with a search for a player and a filter for the kind of change.
(function changelogAdmin() {
  const host = document.getElementById('changelog-root');
  if (!host) return;

  const KIND = {
    FINISHED: ['Match finished', 'var(--green, #2e9e4f)'],
    CORRECTED: ['Result corrected', 'var(--orange)'],
    REOPENED: ['Match restarted', 'var(--orange)'],
    DELETED: ['Match deleted', 'var(--danger)'],
    MANUAL: ['Manual correction', '#6b7cff'],
  };
  const CATEGORY = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice' };
  const field = 'padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  let items = [];
  let hasMore = false;
  let query = '';
  let kind = '';
  let loading = false;

  const signed = (n) => (n > 0 ? `+${n}` : String(n));
  const tone = (n) => (n > 0 ? 'var(--green, #2e9e4f)' : n < 0 ? 'var(--danger)' : 'var(--gray)');
  const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // a row is a small grid: the name (with a note under it) | the numbers | the change — it keeps its shape on a phone
  const ROW = 'display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:2px 14px;align-items:baseline;padding:5px 0;border-top:1px solid rgba(128,128,128,0.18)';

  function rankingHtml(e) {
    if (!e.ranking || !e.ranking.length) return '';
    const rows = e.ranking.map((r) => `
      <div style="${ROW}">
        <span><b>${escapeHtml(r.name)}</b><br><span style="color:var(--gray);font-size:12px">${escapeHtml(r.tableLabel)}</span></span>
        <span style="font-variant-numeric:tabular-nums">${r.before} → <b>${r.after}</b></span>
        <b style="min-width:44px;text-align:right;color:${tone(r.delta)}">${signed(r.delta)}</b>
      </div>`).join('');
    return `<div style="margin-top:10px"><div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--gray);margin-bottom:2px">Ranking points</div>${rows}</div>`;
  }

  function positionHtml(r) {
    if (r.positionBefore === r.positionAfter) return `<span style="color:var(--gray)">#${r.positionAfter}</span>`;
    const before = r.positionBefore === null ? '–' : `#${r.positionBefore}`;
    const up = r.positionBefore === null || r.positionAfter < r.positionBefore;
    return `<span style="color:var(--gray)">${before} → </span><b style="color:${up ? 'var(--green, #2e9e4f)' : 'var(--danger)'}">#${r.positionAfter} ${up ? '▲' : '▼'}</b>`;
  }

  function groupHtml(e) {
    const g = e.group;
    if (!g) return '';
    const label = [g.seasonName, g.groupName, CATEGORY[g.category]].filter(Boolean).join(' · ');
    const rows = g.rows.map((r) => {
      const played = r.playedBefore === r.playedAfter ? `${r.playedAfter} played` : `played ${r.playedBefore} → ${r.playedAfter}`;
      return `
      <div style="${ROW};${r.inMatch ? '' : 'opacity:0.75'}">
        <span><b style="font-weight:${r.inMatch ? 800 : 500}">${escapeHtml(r.name)}</b><br><span style="color:var(--gray);font-size:12px">${r.inMatch ? played : 'position moved'}</span></span>
        <span style="font-variant-numeric:tabular-nums">${r.pointsBefore === r.pointsAfter ? `${r.pointsAfter} pts` : `${r.pointsBefore} → <b>${r.pointsAfter}</b> pts`}</span>
        <span style="min-width:70px;text-align:right">${positionHtml(r)}</span>
      </div>`;
    }).join('');
    return `<div style="margin-top:14px"><div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--gray);margin-bottom:2px">League table — ${escapeHtml(label)}</div>${rows}</div>`;
  }

  function cardHtml(e) {
    const [label, color] = KIND[e.kind] || [e.kind, 'var(--gray)'];
    const title = e.matchToken && e.kind !== 'DELETED'
      ? `<a href="/match/${encodeURIComponent(e.matchToken)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">${escapeHtml(e.title)}</a>`
      : escapeHtml(e.title);
    return `
      <div class="card" style="margin-bottom:10px">
        <div style="display:flex;gap:8px 12px;align-items:baseline;flex-wrap:wrap">
          <span style="font-size:11px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;border:1.5px solid ${color};color:${color};border-radius:8px;padding:2px 8px">${escapeHtml(label)}</span>
          <strong style="font-size:16px">${title}</strong>
          ${e.score ? `<span style="font-weight:700">${escapeHtml(e.score)}</span>` : ''}
          ${e.category ? `<span style="color:var(--gray);font-size:13px">${escapeHtml(CATEGORY[e.category] || e.category)}</span>` : ''}
          <span style="margin-left:auto;color:var(--gray);font-size:13px">${escapeHtml(when(e.createdAt))}</span>
        </div>
        ${rankingHtml(e)}${groupHtml(e)}
      </div>`;
  }

  function renderList() {
    const list = host.querySelector('#cl-list');
    list.innerHTML = items.length
      ? items.map(cardHtml).join('')
      : `<div class="card"><div class="empty-state">${query || kind ? 'Nothing matches.' : 'Nothing logged yet — it fills as matches are finished, corrected or deleted.'}</div></div>`;
    host.querySelector('#cl-more').hidden = !hasMore;
  }

  async function load(more) {
    if (loading) return;
    loading = true;
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (query) params.set('q', query);
      if (kind) params.set('kind', kind);
      if (more && items.length) params.set('before', String(items[items.length - 1].id));
      const res = await api(`/changelog?${params}`);
      items = more ? items.concat(res.items) : res.items;
      hasMore = res.hasMore;
      renderList();
    } catch (err) {
      host.querySelector('#cl-list').innerHTML = `<div class="card" style="color:var(--danger)">${escapeHtml(err.message)}</div>`;
    }
    loading = false;
  }

  function renderPage() {
    host.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:14px 0">
        <input type="search" id="cl-q" placeholder="Player or match…" style="flex:1;min-width:200px;${field}">
        <select id="cl-kind" style="${field}">
          <option value="">All changes</option>
          ${Object.entries(KIND).map(([k, [label]]) => `<option value="${k}">${label}</option>`).join('')}
        </select>
      </div>
      <div id="cl-list">Loading…</div>
      <div style="text-align:center;margin:14px 0"><button type="button" class="btn btn-outline" id="cl-more" hidden>Show older</button></div>`;
    let timer = null;
    host.querySelector('#cl-q').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { query = e.target.value.trim(); load(false); }, 300);
    });
    host.querySelector('#cl-kind').addEventListener('change', (e) => { kind = e.target.value; load(false); });
    host.querySelector('#cl-more').addEventListener('click', () => load(true));
    load(false);
  }

  checkAdmin().then((isAdmin) => {
    if (isAdmin) { renderPage(); return; }
    host.innerHTML = '<div class="card"><p style="margin:0;color:var(--gray)">The points log requires an admin login. <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.</p></div>';
  });
})();
