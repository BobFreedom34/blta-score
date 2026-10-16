// "Pavúk turnaja" — the organiser's screen for the draw of a tournament, one block per category (Elite, Next Gen, Novice): the number
// of courts, the seeds of the registered players, and the FORMAT of the category with its settings:
//   PRINCE (a bracket + a consolation bracket for the round-1 losers) · MONRAD (a losers bracket for every round) · Eliminácia (a plain
//   bracket) · Skupiny (round robin) · Skupiny + pavúk (groups, then a bracket of the best of every group).
// Everything can be made automatically or by hand (groups put together by the organiser, an empty bracket to seat). Loaded by
// seasons-admin.html / tournaments-admin.html, used by seasons-admin.js (needs api, toast, escapeHtml).

const DRAW_FORMATS = ['BO1', 'BO3', 'BO3_STB', 'BO5', 'BO5_STB', 'BO3_G4_STB'];
const DRAW_MAIN_DEFAULT = 'BO3_STB';
const DRAW_CONSOLATION_DEFAULT = 'BO3_G4_STB';
const DRAW_FORMAT_INFO = {
  PRINCE: ['PRINCE', 'Pavúk + útecha pre porazených v 1. kole. Kto prehrá neskôr, končí.'],
  MONRAD: ['Monrad', 'Pavúk + útecha pre porazených v každom kole (a v nich zasa útechy): hrá sa, kým nie sú určené všetky miesta. Veľa zápasov.'],
  ELIMINATION: ['Eliminácia', 'Obyčajný pavúk, porazený končí.'],
  GROUPS: ['Skupiny', 'Skupiny každý s každým, tabuľky podľa bodov (3 body za 2:0, 2 za 2:1, 1 za prehru 1:2).'],
  GROUPS_BRACKET: ['Skupiny + pavúk', 'Skupiny každý s každým a potom pavúk z najlepších hráčov každej skupiny.'],
};
const DRAW_BRACKET_TYPES = { ELIMINATION: 'Eliminácia', PRINCE: 'PRINCE', MONRAD: 'Monrad' };

function drawFormatOptions(selected) {
  return DRAW_FORMATS.map((k) => `<option value="${k}"${k === selected ? ' selected' : ''}>${escapeHtml(t(`format.${k}.label`))}</option>`).join('');
}

async function openDrawPanel(host, seasonId, onChanged) {
  host.innerHTML = '<div style="color:var(--gray)">Loading…</div>';
  let overview = await api(`/seasons/${seasonId}/draw`);
  let regs = await api(`/seasons/${seasonId}/registrations`);
  const drafts = new Map(); // registration id -> seed text typed but not saved yet
  const choice = {}; // category -> the settings being edited
  const groupDraft = {}; // category -> { count, assign: Map(registration id -> group index) } (groups put together by hand)

  const settingsFor = (c) => choice[c.category] || (choice[c.category] = { ...c.settings });
  const draftOf = (r) => (drafts.has(r.id) ? drafts.get(r.id) : (r.seed ? String(r.seed) : ''));
  const dirty = (category) => regs.filter((r) => r.category === category && draftOf(r) !== (r.seed ? String(r.seed) : '')).length;
  const isGroups = (f) => f === 'GROUPS' || f === 'GROUPS_BRACKET';
  const inputStyle = 'padding:7px 9px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:13px;max-width:100%';
  const groupLetter = (i) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));

  // how the draw would look: its size and who skips round 1 (the byes go to the highest seeds)
  function summaryText(c) {
    if (c.players < 2) return c.players ? 'Treba aspoň 2 hráčov.' : 'Zatiaľ nikto nie je zaradený.';
    const head = `${c.players} hráčov`;
    // the format being chosen (or the one of the draw that exists)
    const format = c.stage === 'NONE' ? settingsFor(c).format : c.settings.format;
    if (isGroups(format) && c.stage === 'NONE') return head;
    if (!c.byes) return `${head} → pavúk na ${c.size}, všetci hrajú 1. kolo.`;
    const byBye = Math.min(c.byes, c.seeded);
    const random = c.byes - byBye;
    const skip = byBye ? `nasadení 1–${byBye}` : '';
    const lot = random ? `${random} ${random === 1 ? 'hráč vyžrebovaný' : 'hráčov vyžrebovaných'} náhodou (nasaď viac hráčov, ak to nechceš)` : '';
    return `${head} → pavúk na ${c.size}, voľných miest (bye): ${c.byes}. 1. kolo preskočia ${[skip, lot].filter(Boolean).join(' a ')}.`;
  }

  function seedRowsHtml(c) {
    const rows = regs.filter((r) => r.category === c.category);
    if (!rows.length) return '';
    const sorted = [...rows].sort((a, b) => (Number(draftOf(a)) || 1e9) - (Number(draftOf(b)) || 1e9) || a.name.localeCompare(b.name));
    const locked = c.stage !== 'NONE';
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px 14px;margin:8px 0">${sorted.map((r) => `
      <label style="display:flex;gap:8px;align-items:center;font-size:13px">
        <input type="number" min="1" max="${c.players}" inputmode="numeric" class="sd-seed" data-reg="${r.id}" value="${escapeHtml(draftOf(r))}" placeholder="–" style="width:54px;${inputStyle}"${locked ? ' disabled' : ''}>
        <span>${escapeHtml(r.name)}</span>
      </label>`).join('')}</div>`;
  }

  // ---------- the form for a category without a draw ----------

  function groupEditorHtml(c, s) {
    const d = groupDraft[c.category];
    if (!d) return '<div style="font-size:12px;color:var(--gray)">Načítavam návrh skupín…</div>';
    const rows = regs.filter((r) => r.category === c.category);
    const opts = (cur) => Array.from({ length: d.count }, (_, i) => `<option value="${i}"${i === cur ? ' selected' : ''}>${groupLetter(i)}</option>`).join('');
    const sizes = Array.from({ length: d.count }, (_, i) => rows.filter((r) => d.assign.get(r.id) === i).length);
    return `
      <div style="margin:8px 0">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
          <strong style="font-size:13px">Rozdelenie do skupín</strong>
          <label style="font-size:12px;color:var(--gray)">Počet skupín <input type="number" min="1" max="26" class="sd-gcount" data-cat="${c.category}" value="${d.count}" style="width:60px;${inputStyle}"></label>
          <button type="button" class="btn btn-sm btn-outline" data-act="suggest" data-cat="${c.category}">Navrhnúť rozdelenie</button>
          <span style="font-size:12px;color:var(--gray)">${sizes.map((n, i) => `${groupLetter(i)}: ${n}`).join(' · ')}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px 14px">${rows.map((r) => `
          <label style="display:flex;gap:8px;align-items:center;font-size:13px">
            <select class="sd-assign" data-reg="${r.id}" data-cat="${c.category}" style="${inputStyle}">${opts(d.assign.get(r.id))}</select>
            <span>${escapeHtml(r.name)}</span>
          </label>`).join('')}</div>
      </div>`;
  }

  function setupHtml(c) {
    const s = settingsFor(c);
    const formatBtns = Object.keys(DRAW_FORMAT_INFO).map((f) => `<button type="button" class="btn btn-sm ${s.format === f ? 'btn-primary' : 'btn-outline'}" data-act="format" data-cat="${c.category}" data-fmt="${f}">${escapeHtml(DRAW_FORMAT_INFO[f][0])}</button>`).join(' ');
    const sel = (cls, label, options, extra = '') => `<label style="font-size:12px;color:var(--gray)">${label}<select class="${cls}" data-cat="${c.category}" style="${inputStyle};display:block;width:100%;margin-top:3px;color:var(--charcoal)">${options}</select></label>${extra}`;
    const hasLosers = s.format === 'GROUPS_BRACKET' ? s.bracketType !== 'ELIMINATION' : ['PRINCE', 'MONRAD'].includes(s.format);
    const modeLabel = isGroups(s.format) ? ['Skupiny navrhne systém', 'Skupiny zostavím ručne'] : ['Vytvoriť automaticky', 'Zostaviť ručne'];
    let body = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${formatBtns}</div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:10px">${escapeHtml(DRAW_FORMAT_INFO[s.format][1])}</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin:6px 0 10px;font-size:13px">
        <label><input type="radio" name="sd-mode-${c.category}" value="AUTO" data-cat="${c.category}"${s.mode === 'AUTO' ? ' checked' : ''}> ${modeLabel[0]}</label>
        <label><input type="radio" name="sd-mode-${c.category}" value="MANUAL" data-cat="${c.category}"${s.mode === 'MANUAL' ? ' checked' : ''}> ${modeLabel[1]}</label>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:10px">`;
    if (isGroups(s.format)) {
      body += `
        <label style="font-size:12px;color:var(--gray)">Hráčov v skupine (najviac)<input type="number" min="2" max="12" class="sd-gsize" data-cat="${c.category}" value="${s.groupSize}" style="${inputStyle};display:block;width:100%;margin-top:3px"></label>
        ${sel('sd-group-format', 'Formát zápasu — skupiny', drawFormatOptions(s.groupFormat))}`;
    }
    if (s.format === 'GROUPS_BRACKET') {
      body += `
        <label style="font-size:12px;color:var(--gray)">Z každej skupiny postupuje<input type="number" min="1" max="8" class="sd-qual" data-cat="${c.category}" value="${s.qualifiers}" style="${inputStyle};display:block;width:100%;margin-top:3px"></label>
        ${sel('sd-bracket-type', 'Typ pavúka po skupinách', Object.entries(DRAW_BRACKET_TYPES).map(([k, l]) => `<option value="${k}"${k === s.bracketType ? ' selected' : ''}>${l}</option>`).join(''))}`;
    }
    if (!isGroups(s.format) || s.format === 'GROUPS_BRACKET') {
      body += sel('sd-main-format', 'Formát zápasu — hlavný pavúk', drawFormatOptions(s.mainFormat));
      if (hasLosers) body += sel('sd-cons-format', 'Formát zápasu — útecha', drawFormatOptions(s.consolationFormat));
    }
    body += '</div>';
    if (s.format === 'GROUPS_BRACKET') {
      body += `<label style="display:block;font-size:13px;margin-bottom:8px"><input type="checkbox" class="sd-auto-bracket" data-cat="${c.category}"${s.autoBracket ? ' checked' : ''}> Pavúk vytvoriť sám, keď sa odohrá posledný zápas skupín (inak ho vytvoríš tlačidlom)</label>`;
    }
    if (isGroups(s.format) && s.mode === 'MANUAL') body += groupEditorHtml(c, s);
    const ready = c.players >= 2 && !c.withoutProfile.length && !dirty(c.category);
    body += `
      <button type="button" class="btn btn-sm btn-primary" data-act="draw" data-cat="${c.category}" ${ready ? '' : 'disabled'}>${isGroups(s.format) ? 'Vytvoriť skupiny a zápasy' : (s.mode === 'AUTO' ? 'Vytvoriť pavúk' : 'Vytvoriť prázdny pavúk')}</button>
      ${dirty(c.category) ? '<span style="font-size:12px;color:var(--gray);margin-left:8px">Najprv ulož nasadenie.</span>' : ''}
      ${c.withoutProfile.length ? `<div style="color:var(--danger);font-size:12px;margin-top:6px">Bez profilu hráča: ${escapeHtml(c.withoutProfile.join(', '))}</div>` : ''}`;
    return body;
  }

  // ---------- a category with a draw ----------

  function stateHtml(c) {
    const s = c.settings;
    const parts = [`<div style="font-size:13px;margin-bottom:6px"><b>${escapeHtml(DRAW_FORMAT_INFO[s.format] ? DRAW_FORMAT_INFO[s.format][0] : s.format)}</b>${s.format === 'GROUPS_BRACKET' ? ` <span style="color:var(--gray)">— z každej skupiny postupuje ${s.qualifiers}, pavúk: ${escapeHtml(DRAW_BRACKET_TYPES[s.bracketType] || s.bracketType)}${s.autoBracket && s.mode === 'AUTO' ? ', vytvorí sa sám' : ''}</span>` : ''}</div>`];
    if (c.groups) {
      parts.push(`<div style="margin:6px 0"><div style="font-weight:700;font-size:13px">Skupiny <span style="font-weight:400;color:var(--gray)">${c.groups.finished}/${c.groups.matches} zápasov odohraných</span></div>${c.groups.groups.map((g) => `
        <div style="font-size:13px;padding:2px 0"><b>${escapeHtml(groupShortName(g.name))}</b> <span style="color:var(--gray);font-size:12px">${escapeHtml(g.players.map((p) => p.name).join(', '))} · ${g.finished}/${g.matches} zápasov</span></div>`).join('')}</div>`);
    }
    if (c.brackets.length) {
      parts.push(`<div style="margin:6px 0"><div style="font-weight:700;font-size:13px">Pavúky <span style="font-weight:400;color:var(--gray)">${c.brackets.length}</span></div>${c.brackets.map((b) => `
        <div style="font-size:13px;padding:2px 0"><a href="/bracket/${b.id}" target="_blank" rel="noopener" style="font-weight:700">${escapeHtml(b.name.replace(/^.*? — (Elite|Next Gen|Novice) — /, ''))}</a> <span style="color:var(--gray);font-size:12px">${b.size}-pavúk · ${b.finished}/${b.matches} zápasov odohraných · ${escapeHtml(t(`format.${b.format}.label`))}</span></div>`).join('')}</div>`);
    } else if (s.format === 'GROUPS_BRACKET') {
      parts.push('<div style="font-size:13px;color:var(--gray);margin:6px 0">Pavúk ešte nie je vytvorený — vznikne z najlepších hráčov skupín.</div>');
    }
    const buttons = [];
    if (c.canMakeBracket) {
      buttons.push(`<select class="sd-bracket-mode" data-cat="${c.category}" style="${inputStyle}"><option value="AUTO">Vložiť postupujúcich automaticky</option><option value="MANUAL">Prázdny pavúk (posadím ručne)</option></select><button type="button" class="btn btn-sm btn-primary" data-act="bracket" data-cat="${c.category}">Vytvoriť pavúk zo skupín</button>`);
    }
    if (c.canMakeConsolation) {
      const cf = settingsFor(c).consolationFormat;
      buttons.push(`<select class="sd-cons-format" data-cat="${c.category}" style="${inputStyle}">${drawFormatOptions(cf)}</select><button type="button" class="btn btn-sm btn-primary" data-act="consolation" data-cat="${c.category}">Vytvoriť útechu</button>`);
    }
    if (c.main) buttons.push('<a class="btn btn-sm btn-outline" href="/bracket-admin" target="_blank" rel="noopener">Upraviť pavúk</a>');
    buttons.push(`<button type="button" class="btn btn-sm btn-outline" data-act="delete" data-cat="${c.category}" style="color:var(--danger)">Zmazať ${c.groups && !c.main ? 'skupiny' : 'pavúk'}</button>`);
    parts.push(`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">${buttons.join('')}</div>`);
    return parts.join('');
  }

  function blockHtml(c) {
    const noDraw = c.stage === 'NONE';
    return `
      <div class="sd-block" data-cat="${c.category}" style="background:#fff;border-radius:12px;padding:12px 14px;min-width:0">
        <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
          <span style="font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:var(--orange)">${c.label}</span>
          <span style="color:var(--gray);font-size:13px">${escapeHtml(summaryText(c))}</span>
        </div>
        ${c.players ? `<div style="font-weight:700;font-size:13px;margin-top:8px">Nasadenie ${noDraw ? '<span style="font-weight:400;color:var(--gray)">— číslo 1 je najlepší; nenasadení nechajte prázdni</span>' : '<span style="font-weight:400;color:var(--gray)">(žrebovanie je už vytvorené)</span>'}</div>` : ''}
        ${seedRowsHtml(c)}
        ${c.players && noDraw ? `<button type="button" class="btn btn-sm btn-outline" data-act="seeds" data-cat="${c.category}" ${dirty(c.category) ? '' : 'disabled'}>Uložiť nasadenie${dirty(c.category) ? ` (${dirty(c.category)})` : ''}</button>` : ''}
        <div style="border-top:1px solid #eee;margin-top:12px;padding-top:10px">${noDraw ? setupHtml(c) : stateHtml(c)}</div>
        <div class="sd-error" data-cat="${c.category}" style="color:var(--danger);font-weight:600;margin-top:8px"></div>
      </div>`;
  }

  function render() {
    host.innerHTML = `
      <div style="background:var(--gray-light);border-radius:12px;padding:14px">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
          <strong style="font-size:15px">Pavúk turnaja</strong>
          <span style="flex:1"></span>
          <label style="font-size:13px">Počet kurtov
            <input type="number" min="0" max="50" inputmode="numeric" class="sd-courts" value="${overview.courtCount || ''}" placeholder="0" style="width:64px;padding:6px 8px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:13px;margin:0 6px">
          </label>
          <button type="button" class="btn btn-sm btn-outline" data-act="courts">Uložiť kurty</button>
          <a href="/tournament/${encodeURIComponent(overview.slug)}#courts" target="_blank" rel="noopener" style="font-size:13px;font-weight:700">Harmonogram ›</a>
          <span class="sd-courts-note" style="font-size:12px;color:var(--gray)">${overview.courtCount ? Array.from({ length: Math.min(overview.courtCount, 6) }, (_, i) => `Kurt ${i + 1}`).join(', ') + (overview.courtCount > 6 ? ` … Kurt ${overview.courtCount}` : '') : 'Kurty zatiaľ nie sú nastavené'}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:12px">${overview.categories.map(blockHtml).join('')}</div>
      </div>`;
  }

  async function refresh() {
    [overview, regs] = await Promise.all([api(`/seasons/${seasonId}/draw`), api(`/seasons/${seasonId}/registrations`)]);
    drafts.clear();
    Object.keys(choice).forEach((k) => delete choice[k]);
    Object.keys(groupDraft).forEach((k) => delete groupDraft[k]);
    render();
    if (onChanged) onChanged();
  }

  const showError = (cat, message) => {
    const el = host.querySelector(`.sd-error[data-cat="${cat}"]`);
    if (el) el.textContent = message || '';
  };
  const catOf = (cat) => overview.categories.find((c) => c.category === cat);

  // the suggested groups for the organiser to change
  async function loadSuggestion(cat) {
    const s = settingsFor(catOf(cat));
    try {
      const res = await api(`/seasons/${seasonId}/draw/groups-suggestion?category=${cat}&groupSize=${s.groupSize}&groupCount=${groupDraft[cat] ? groupDraft[cat].count : 0}`);
      const assign = new Map();
      res.groups.forEach((g, i) => g.registrationIds.forEach((id) => assign.set(id, i)));
      groupDraft[cat] = { count: res.groups.length, assign };
    } catch (err) { showError(cat, err.message); }
    render();
  }

  host.oninput = (e) => {
    const seed = e.target.closest('.sd-seed');
    if (seed) {
      drafts.set(Number(seed.dataset.reg), seed.value.trim());
      const block = seed.closest('.sd-block');
      const cat = block.dataset.cat;
      const btn = block.querySelector('[data-act="seeds"]');
      const n = dirty(cat);
      if (btn) { btn.disabled = !n; btn.textContent = n ? `Uložiť nasadenie (${n})` : 'Uložiť nasadenie'; }
      const draw = block.querySelector('[data-act="draw"]');
      if (draw) draw.disabled = !!n || catOf(cat).players < 2;
      return;
    }
    const cat = e.target.dataset.cat;
    if (!cat) return;
    const s = settingsFor(catOf(cat));
    if (e.target.matches('.sd-gsize')) s.groupSize = Number(e.target.value) || 4;
    else if (e.target.matches('.sd-qual')) s.qualifiers = Number(e.target.value) || 1;
  };

  host.onchange = async (e) => {
    const cat = e.target.dataset.cat;
    if (!cat) return;
    const c = catOf(cat);
    const s = settingsFor(c);
    if (e.target.matches('input[type=radio]')) {
      s.mode = e.target.value;
      if (s.mode === 'MANUAL' && isGroups(s.format) && !groupDraft[cat]) { render(); await loadSuggestion(cat); return; }
      render();
    } else if (e.target.matches('.sd-main-format')) s.mainFormat = e.target.value;
    else if (e.target.matches('.sd-cons-format')) s.consolationFormat = e.target.value;
    else if (e.target.matches('.sd-group-format')) s.groupFormat = e.target.value;
    else if (e.target.matches('.sd-bracket-type')) { s.bracketType = e.target.value; render(); }
    else if (e.target.matches('.sd-auto-bracket')) s.autoBracket = e.target.checked;
    else if (e.target.matches('.sd-gsize')) { delete groupDraft[cat]; if (s.mode === 'MANUAL') { render(); await loadSuggestion(cat); } }
    else if (e.target.matches('.sd-gcount')) {
      const d = groupDraft[cat];
      d.count = Math.max(1, Math.min(26, Number(e.target.value) || 1));
      d.assign.forEach((v, k) => { if (v >= d.count) d.assign.set(k, d.count - 1); });
      render();
    } else if (e.target.matches('.sd-assign')) {
      groupDraft[cat].assign.set(Number(e.target.dataset.reg), Number(e.target.value));
      render();
    }
  };

  host.onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const cat = btn.dataset.cat;
    if (cat) showError(cat, '');
    btn.disabled = true;
    try {
      if (act === 'courts') {
        const raw = host.querySelector('.sd-courts').value.trim();
        await api(`/seasons/${seasonId}`, { method: 'PATCH', body: { courtCount: raw === '' ? 0 : Number(raw) } });
        toast('Kurty uložené');
        await refresh();
      } else if (act === 'seeds') {
        const seeds = regs.filter((r) => r.category === cat).map((r) => ({ id: r.id, seed: draftOf(r) === '' ? null : Number(draftOf(r)) }));
        regs = await api(`/seasons/${seasonId}/seeds`, { method: 'POST', body: { category: cat, seeds } });
        drafts.clear();
        toast('Nasadenie uložené');
        render();
      } else if (act === 'format') {
        const s = settingsFor(catOf(cat));
        s.format = btn.dataset.fmt;
        if (isGroups(s.format) && s.mode === 'MANUAL' && !groupDraft[cat]) { render(); await loadSuggestion(cat); return; }
        render();
      } else if (act === 'suggest') {
        await loadSuggestion(cat);
      } else if (act === 'draw') {
        const s = settingsFor(catOf(cat));
        const body = { category: cat, ...s };
        if (isGroups(s.format) && s.mode === 'MANUAL') {
          const d = groupDraft[cat];
          const rows = regs.filter((r) => r.category === cat);
          body.groups = Array.from({ length: d.count }, (_, i) => ({ name: `Skupina ${groupLetter(i)}`, registrationIds: rows.filter((r) => d.assign.get(r.id) === i).map((r) => r.id) })).filter((g) => g.registrationIds.length);
        }
        const made = await api(`/seasons/${seasonId}/draw`, { method: 'POST', body });
        toast(isGroups(s.format) ? `Skupiny vytvorené (${made.matches} zápasov)` : (made.consolationNote ? `Pavúk vytvorený (bez útechy: ${made.consolationNote})` : 'Pavúk vytvorený'));
        await refresh();
        if (made.warnings && made.warnings.length) showError(cat, made.warnings.join(' '));
      } else if (act === 'bracket') {
        const mode = host.querySelector(`.sd-bracket-mode[data-cat="${cat}"]`).value;
        let force = false;
        const c = catOf(cat);
        if (c.groups && !c.groups.allFinished) {
          if (!confirm(`Skupinové zápasy ešte nie sú všetky odohrané (${c.groups.finished} z ${c.groups.matches}). Pavúk sa vytvorí z aktuálnych tabuliek. Pokračovať?`)) { btn.disabled = false; return; }
          force = true;
        }
        await api(`/seasons/${seasonId}/draw/bracket`, { method: 'POST', body: { category: cat, mode, force } });
        toast('Pavúk vytvorený');
        await refresh();
      } else if (act === 'consolation') {
        const c = catOf(cat);
        await api(`/brackets/${c.main.id}/consolation`, { method: 'POST', body: { format: settingsFor(c).consolationFormat } });
        toast('Útecha vytvorená');
        await refresh();
      } else if (act === 'delete') {
        if (!confirm('Zmazať žrebovanie tejto kategórie (skupiny, pavúky aj útechy)? Naplánované zápasy sa zmažú.')) { btn.disabled = false; return; }
        await api(`/seasons/${seasonId}/draw/${cat}`, { method: 'DELETE' });
        toast('Žrebovanie zmazané');
        await refresh();
      }
    } catch (err) {
      btn.disabled = false;
      if (cat) showError(cat, err.message); else toast(err.message);
    }
  };
  render();
}
