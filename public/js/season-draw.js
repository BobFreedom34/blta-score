// "Pavúk turnaja" — the organiser's screen for the draw of a tournament, one block per category (Elite, Next Gen, Novice): the number
// of courts, the seeds of the registered players (with how many places stay empty in the draw, so how many seeds skip round 1), the
// match formats of the main and of the consolation draw, and making the main bracket (automatically or by hand) with its consolation
// draw ("útecha"). Loaded by seasons-admin.html / tournaments-admin.html, used by seasons-admin.js (needs api, toast, escapeHtml).

const DRAW_FORMATS = ['BO1', 'BO3', 'BO3_STB', 'BO5', 'BO5_STB', 'BO3_G4_STB'];
const DRAW_MAIN_DEFAULT = 'BO3_STB';
const DRAW_CONSOLATION_DEFAULT = 'BO3_G4_STB';

function drawFormatOptions(selected) {
  return DRAW_FORMATS.map((k) => `<option value="${k}"${k === selected ? ' selected' : ''}>${escapeHtml(t(`format.${k}.label`))}</option>`).join('');
}

async function openDrawPanel(host, seasonId, onChanged) {
  host.innerHTML = '<div style="color:var(--gray)">Loading…</div>';
  let overview = await api(`/seasons/${seasonId}/draw`);
  let regs = await api(`/seasons/${seasonId}/registrations`);
  const drafts = new Map(); // registration id -> seed text typed but not saved yet (per category block)
  const choice = {}; // category -> { mode, mainFormat, consolationFormat }
  const optionsOf = (category) => choice[category] || (choice[category] = { mode: 'AUTO', mainFormat: DRAW_MAIN_DEFAULT, consolationFormat: DRAW_CONSOLATION_DEFAULT });

  const draftOf = (r) => (drafts.has(r.id) ? drafts.get(r.id) : (r.seed ? String(r.seed) : ''));
  const dirty = (category) => regs.filter((r) => r.category === category && draftOf(r) !== (r.seed ? String(r.seed) : '')).length;

  // how the draw would look: its size and who skips round 1 (the byes go to the highest seeds)
  function summaryText(c) {
    if (c.players < 2) return c.players ? 'Treba aspoň 2 hráčov.' : 'Zatiaľ nikto nie je zaradený.';
    const head = `${c.players} hráčov → pavúk na ${c.size}`;
    if (!c.byes) return `${head}, všetci hrajú 1. kolo.`;
    const byBye = Math.min(c.byes, c.seeded);
    const random = c.byes - byBye;
    const skip = byBye ? `nasadení 1–${byBye}` : '';
    const lot = random ? `${random} ${random === 1 ? 'hráč vyžrebovaný' : 'hráčov vyžrebovaných'} náhodou (nasaď viac hráčov, ak to nechceš)` : '';
    return `${head}, voľných miest (bye): ${c.byes}. 1. kolo preskočia ${[skip, lot].filter(Boolean).join(' a ')}.`;
  }

  function seedRowsHtml(c) {
    const rows = regs.filter((r) => r.category === c.category);
    if (!rows.length) return '';
    const sorted = [...rows].sort((a, b) => {
      const sa = Number(draftOf(a)) || 1e9;
      const sb = Number(draftOf(b)) || 1e9;
      return sa - sb || a.name.localeCompare(b.name);
    });
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px 14px;margin:8px 0">${sorted.map((r) => `
      <label style="display:flex;gap:8px;align-items:center;font-size:13px">
        <input type="number" min="1" max="${c.players}" inputmode="numeric" class="sd-seed" data-reg="${r.id}" value="${escapeHtml(draftOf(r))}" placeholder="–" style="width:54px;padding:5px 7px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:13px"${c.main ? ' disabled' : ''}>
        <span>${escapeHtml(r.name)}</span>
      </label>`).join('')}</div>`;
  }

  function bracketLinks(c) {
    const part = (label, b) => `<a href="/bracket/${b.id}" target="_blank" rel="noopener" style="font-weight:700;font-size:14px">${label}</a> <span style="color:var(--gray);font-size:12px">${b.size}-pavúk · ${b.finished}/${b.matches} zápasov odohraných · ${escapeHtml(t(`format.${b.format}.label`))}</span>`;
    return `
      <div style="display:grid;gap:4px;margin:8px 0">
        <div>${part('Hlavný pavúk', c.main)}</div>
        <div>${c.consolation ? part('Útecha', c.consolation) : '<span style="color:var(--gray);font-size:13px">Útecha ešte nie je vytvorená' + (c.players >= 2 ? ' — vznikne, keď sú obsadené všetky zápasy 1. kola.' : '.') + '</span>'}</div>
      </div>`;
  }

  function blockHtml(c) {
    const o = optionsOf(c.category);
    const inputStyle = 'padding:7px 9px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:13px;max-width:100%';
    let body;
    if (c.main) {
      body = `
        ${bracketLinks(c)}
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          ${c.canMakeConsolation ? `<select class="sd-cons-format" data-cat="${c.category}" style="${inputStyle}">${drawFormatOptions(o.consolationFormat)}</select><button type="button" class="btn btn-sm btn-primary" data-act="consolation" data-cat="${c.category}">Vytvoriť útechu</button>` : ''}
          <a class="btn btn-sm btn-outline" href="/bracket-admin" target="_blank" rel="noopener">Upraviť pavúk</a>
          <button type="button" class="btn btn-sm btn-outline" data-act="delete" data-cat="${c.category}" style="color:var(--danger)">Zmazať pavúk</button>
        </div>`;
    } else {
      body = `
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin:6px 0 10px;font-size:13px">
          <label><input type="radio" name="sd-mode-${c.category}" value="AUTO" data-cat="${c.category}"${o.mode === 'AUTO' ? ' checked' : ''}> Vytvoriť automaticky</label>
          <label><input type="radio" name="sd-mode-${c.category}" value="MANUAL" data-cat="${c.category}"${o.mode === 'MANUAL' ? ' checked' : ''}> Zostaviť ručne</label>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-bottom:10px">
          <label style="font-size:12px;color:var(--gray)">Formát zápasu — hlavný pavúk<select class="sd-main-format" data-cat="${c.category}" style="${inputStyle};display:block;width:100%;margin-top:3px;color:var(--charcoal)">${drawFormatOptions(o.mainFormat)}</select></label>
          <label style="font-size:12px;color:var(--gray)">Formát zápasu — útecha<select class="sd-cons-format" data-cat="${c.category}" style="${inputStyle};display:block;width:100%;margin-top:3px;color:var(--charcoal)">${drawFormatOptions(o.consolationFormat)}</select></label>
        </div>
        <button type="button" class="btn btn-sm btn-primary" data-act="draw" data-cat="${c.category}" ${c.players >= 2 && !c.withoutProfile.length && !dirty(c.category) ? '' : 'disabled'}>${o.mode === 'AUTO' ? 'Vytvoriť pavúk' : 'Vytvoriť prázdny pavúk'}</button>
        ${dirty(c.category) ? '<span style="font-size:12px;color:var(--gray);margin-left:8px">Najprv ulož nasadenie.</span>' : ''}
        ${c.withoutProfile.length ? `<div style="color:var(--danger);font-size:12px;margin-top:6px">Bez profilu hráča: ${escapeHtml(c.withoutProfile.join(', '))}</div>` : ''}
        <div style="font-size:12px;color:var(--gray);margin-top:6px">${o.mode === 'AUTO' ? 'Nasadení sa rozmiestnia podľa pravidiel, ostatných vyžrebuje náhoda; útecha vznikne hneď.' : 'Vznikne prázdny pavúk, hráčov do 1. kola posadíš v Upraviť pavúk. Útechu vytvoríš potom tu.'}</div>`;
    }
    return `
      <div class="sd-block" data-cat="${c.category}" style="background:#fff;border-radius:12px;padding:12px 14px;min-width:0">
        <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
          <span style="font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:var(--orange)">${c.label}</span>
          <span style="color:var(--gray);font-size:13px">${escapeHtml(summaryText(c))}</span>
        </div>
        ${c.players ? `<div style="font-weight:700;font-size:13px;margin-top:8px">Nasadenie ${c.main ? '<span style="font-weight:400;color:var(--gray)">(pavúk je už vytvorený)</span>' : '<span style="font-weight:400;color:var(--gray)">— číslo 1 je najlepší; nenasadení nechajte prázdni</span>'}</div>` : ''}
        ${seedRowsHtml(c)}
        ${c.players && !c.main ? `<button type="button" class="btn btn-sm btn-outline" data-act="seeds" data-cat="${c.category}" ${dirty(c.category) ? '' : 'disabled'}>Uložiť nasadenie${dirty(c.category) ? ` (${dirty(c.category)})` : ''}</button>` : ''}
        <div style="border-top:1px solid #eee;margin-top:12px;padding-top:10px">${body}</div>
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
          <span class="sd-courts-note" style="font-size:12px;color:var(--gray)">${overview.courtCount ? Array.from({ length: Math.min(overview.courtCount, 6) }, (_, i) => `Kurt ${i + 1}`).join(', ') + (overview.courtCount > 6 ? ` … Kurt ${overview.courtCount}` : '') : 'Kurty zatiaľ nie sú nastavené'}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px">${overview.categories.map(blockHtml).join('')}</div>
      </div>`;
  }

  async function refresh() {
    [overview, regs] = await Promise.all([api(`/seasons/${seasonId}/draw`), api(`/seasons/${seasonId}/registrations`)]);
    drafts.clear();
    render();
    if (onChanged) onChanged();
  }

  const showError = (cat, message) => {
    const el = host.querySelector(`.sd-error[data-cat="${cat}"]`);
    if (el) el.textContent = message || '';
  };

  host.oninput = (e) => {
    const seed = e.target.closest('.sd-seed');
    if (!seed) return;
    const id = Number(seed.dataset.reg);
    drafts.set(id, seed.value.trim());
    const block = seed.closest('.sd-block');
    const cat = block.dataset.cat;
    const btn = block.querySelector('[data-act="seeds"]');
    const n = dirty(cat);
    if (btn) { btn.disabled = !n; btn.textContent = n ? `Uložiť nasadenie (${n})` : 'Uložiť nasadenie'; }
    const draw = block.querySelector('[data-act="draw"]');
    if (draw) draw.disabled = !!n || overview.categories.find((c) => c.category === cat).players < 2;
  };

  host.onchange = (e) => {
    const cat = e.target.dataset.cat;
    if (!cat) return;
    const o = optionsOf(cat);
    if (e.target.matches('input[type=radio]')) { o.mode = e.target.value; render(); }
    else if (e.target.matches('.sd-main-format')) o.mainFormat = e.target.value;
    else if (e.target.matches('.sd-cons-format')) o.consolationFormat = e.target.value;
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
      } else if (act === 'draw') {
        const o = optionsOf(cat);
        const made = await api(`/seasons/${seasonId}/draw`, { method: 'POST', body: { category: cat, mode: o.mode, mainFormat: o.mainFormat, consolationFormat: o.consolationFormat } });
        toast(made.consolationNote ? `Pavúk vytvorený (bez útechy: ${made.consolationNote})` : 'Pavúk vytvorený');
        await refresh();
        if (made.warnings && made.warnings.length) showError(cat, made.warnings.join(' '));
      } else if (act === 'consolation') {
        const c = overview.categories.find((x) => x.category === cat);
        await api(`/brackets/${c.main.id}/consolation`, { method: 'POST', body: { format: optionsOf(cat).consolationFormat } });
        toast('Útecha vytvorená');
        await refresh();
      } else if (act === 'delete') {
        if (!confirm('Zmazať pavúk aj s útechou? Naplánované zápasy pavúka sa zmažú.')) { btn.disabled = false; return; }
        await api(`/seasons/${seasonId}/draw/${cat}`, { method: 'DELETE' });
        toast('Pavúk zmazaný');
        await refresh();
      }
    } catch (err) {
      btn.disabled = false;
      if (cat) showError(cat, err.message); else toast(err.message);
    }
  };
  render();
}
