// "Zaradenie do kategórií" — the screen where the organiser of a tournament sorts the registered players into Elite, Next Gen and Novice
// (a tournament entry has no category). It lists the players not sorted yet and the three categories, each player with their BLTA rank,
// CourtIQ and the category written in their profile to help; a click on E / N / V moves a player, "Navrhnúť automaticky" fills in the
// players not sorted yet (the profile's category, else by strength — CourtIQ and BLTA rank together: the strongest third Elite, the middle third Next Gen, the rest Novice),
// and nothing is saved until "Uložiť zaradenie". Loaded by seasons-admin.html, used by seasons-admin.js (needs api, toast, escapeHtml).

const ASSIGN_CATEGORIES = [
  ['ELITE', 'Elite', 'E'],
  ['NEXT_GEN', 'Next Gen', 'N'],
  ['NOVICE', 'Novice', 'V'],
];

function assignProfileCategory(raw) {
  const key = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  return key === 'ELITE' ? 'ELITE' : key === 'NEXTGEN' ? 'NEXT_GEN' : key === 'NOVICE' ? 'NOVICE' : '';
}

// How strong a player looks, 0 (weakest) to 1 (strongest) among everybody registered: the average of the two signals the player has —
// the place by CourtIQ rating and the place by BLTA rank. null when the player has neither.
function assignStrengthScores(all) {
  const place = (list, better) => {
    const sorted = [...list].sort(better);
    const map = new Map();
    sorted.forEach((p, i) => map.set(p.id, sorted.length > 1 ? 1 - i / (sorted.length - 1) : 1));
    return map;
  };
  const byRating = place(all.filter((p) => p.rating != null), (x, y) => y.rating - x.rating);
  const byRank = place(all.filter((p) => p.rank != null), (x, y) => x.rank - y.rank);
  const scores = new Map();
  all.forEach((p) => {
    const parts = [byRating.get(p.id), byRank.get(p.id)].filter((v) => v !== undefined);
    scores.set(p.id, parts.length ? parts.reduce((x, y) => x + y, 0) / parts.length : null);
  });
  return scores;
}

// Splits players into thirds by strength (strongest third Elite, middle Next Gen, the rest Novice); a player without any signal is Novice.
function assignSuggestByStrength(todo, all) {
  const scores = assignStrengthScores(all);
  const known = todo.filter((p) => scores.get(p.id) != null).sort((x, y) => scores.get(y.id) - scores.get(x.id));
  const third = Math.ceil(known.length / 3);
  const out = new Map();
  known.forEach((p, i) => out.set(p.id, i < third ? 'ELITE' : i < third * 2 ? 'NEXT_GEN' : 'NOVICE'));
  todo.filter((p) => scores.get(p.id) == null).forEach((p) => out.set(p.id, 'NOVICE'));
  return out;
}

async function openAssignPanel(host, seasonId, onSaved) {
  host.innerHTML = '<div style="color:var(--gray)">Loading…</div>';
  const soft = (promise, fallback) => promise.catch(() => fallback);
  const [regs, courtiq, rankings, profiles] = await Promise.all([
    api(`/seasons/${seasonId}/registrations`),
    soft(api('/courtiq'), { rows: [] }),
    soft(api('/rankings'), { tables: [] }),
    soft(api('/players'), []),
  ]);
  const iqByPlayer = new Map((courtiq.rows || []).map((r) => [r.playerId, r]));
  const blta = ((rankings.tables || []).find((t) => t.key === 'blta') || { rows: [] }).rows;
  const rankByName = new Map(blta.map((r) => [String(r.name).toLowerCase(), r.rank]));
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  const players = regs.map((r) => {
    const iq = r.playerId ? iqByPlayer.get(r.playerId) : null;
    const profile = r.playerId ? profileById.get(r.playerId) : null;
    return {
      id: r.id,
      name: r.name,
      saved: r.category || '',
      draft: r.category || '',
      rating: iq ? iq.rating : null,
      band: iq ? iq.band : null,
      rank: rankByName.get(String(r.name).toLowerCase()) || null,
      profile: profile ? assignProfileCategory(profile.category) : '',
      suggested: false,
    };
  });

  const strength = (p) => (p.rating != null ? p.rating : -1);
  const dirty = () => players.filter((p) => p.draft !== p.saved);
  const label = (key) => (ASSIGN_CATEGORIES.find(([k]) => k === key) || ['', key])[1];

  function rowHtml(p) {
    const chips = [
      p.rank ? `<span class="sa-chip future" title="BLTA rank">#${p.rank}</span>` : '',
      p.band != null ? `<span class="sa-chip future" title="CourtIQ">courtIQ ${Number(p.band).toFixed(1)}</span>` : '<span style="font-size:11px;color:var(--gray)">no courtIQ</span>',
      p.profile ? `<span style="font-size:11px;color:var(--gray)">profile: ${escapeHtml(label(p.profile))}</span>` : '',
      p.suggested ? '<span style="font-size:11px;color:var(--orange);font-weight:700">suggested</span>' : '',
    ].filter(Boolean).join(' ');
    const buttons = ASSIGN_CATEGORIES.map(([key, name, short]) => `<button type="button" class="btn btn-sm ${p.draft === key ? 'btn-primary' : 'btn-outline'}" data-assign="${key}" title="${name}" style="min-width:34px;padding:4px 8px">${short}</button>`).join('')
      + (p.draft ? '<button type="button" class="sg-x" data-assign="" title="Not sorted yet">&times;</button>' : '');
    return `
      <div class="as-row" data-id="${p.id}" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:7px 0;border-top:1px solid #eee">
        <div style="flex:1;min-width:170px"><strong>${escapeHtml(p.name)}</strong><div style="margin-top:2px">${chips}</div></div>
        <div style="display:flex;gap:4px;align-items:center">${buttons}</div>
      </div>`;
  }

  function sectionHtml(title, list) {
    return `
      <div class="as-col" style="background:#fff;border-radius:12px;padding:12px 14px;min-width:0">
        <div style="font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:var(--orange)">${title} <span style="color:var(--gray)">(${list.length})</span></div>
        ${list.length ? list.sort((a, b) => strength(b) - strength(a) || a.name.localeCompare(b.name)).map(rowHtml).join('') : '<div class="sg-empty" style="margin-top:6px">—</div>'}
      </div>`;
  }

  function render() {
    const changed = dirty().length;
    const unsorted = players.filter((p) => !p.draft);
    host.innerHTML = `
      <div style="background:var(--gray-light);border-radius:12px;padding:14px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
          <strong style="font-size:15px">Zaradenie do kategórií</strong>
          <span style="color:var(--gray);font-size:13px">${players.length} players · not sorted ${unsorted.length}${ASSIGN_CATEGORIES.map(([k, name]) => ` · ${name} ${players.filter((p) => p.draft === k).length}`).join('')}</span>
          <span style="flex:1"></span>
          <button type="button" class="btn btn-sm btn-outline" data-act="suggest" ${unsorted.length ? '' : 'disabled'}>Navrhnúť automaticky</button>
          <button type="button" class="btn btn-sm btn-outline" data-act="reset" ${changed ? '' : 'disabled'}>Zahodiť zmeny</button>
          <button type="button" class="btn btn-sm btn-primary" data-act="save" ${changed ? '' : 'disabled'}>Uložiť zaradenie${changed ? ` (${changed})` : ''}</button>
        </div>
        <div class="as-error" style="color:var(--danger);font-weight:600;margin-bottom:8px"></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">
          ${sectionHtml('Nezaradení', unsorted)}
          ${ASSIGN_CATEGORIES.map(([key, name]) => sectionHtml(name, players.filter((p) => p.draft === key))).join('')}
        </div>
      </div>`;
  }

  host.onclick = async (e) => {
    const move = e.target.closest('[data-assign]');
    if (move) {
      const p = players.find((x) => x.id === Number(move.closest('.as-row').dataset.id));
      p.draft = move.dataset.assign;
      p.suggested = false;
      render();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'suggest') {
      const todo = players.filter((p) => !p.draft);
      const byStrength = assignSuggestByStrength(todo.filter((p) => !p.profile), players);
      todo.forEach((p) => { p.draft = p.profile || byStrength.get(p.id) || 'NOVICE'; p.suggested = true; });
      render();
    } else if (act.dataset.act === 'reset') {
      players.forEach((p) => { p.draft = p.saved; p.suggested = false; });
      render();
    } else if (act.dataset.act === 'save') {
      const assignments = dirty().map((p) => ({ id: p.id, category: p.draft }));
      act.disabled = true;
      try {
        await api(`/seasons/${seasonId}/registrations/categories`, { method: 'POST', body: { assignments } });
        players.forEach((p) => { p.saved = p.draft; p.suggested = false; });
        toast(`${assignments.length} saved`);
        render();
        if (onSaved) onSaved();
      } catch (err) {
        render();
        host.querySelector('.as-error').textContent = err.message;
      }
    }
  };
  render();
}
