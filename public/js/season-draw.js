// "Formát turnaja" — the organiser's screen for the draw of a tournament, one block per category (Elite, Next Gen, Novice): the number
// of courts, the seeds of the registered players, and the FORMAT of the category with its settings:
//   PRINCE (a bracket + a consolation bracket for the round-1 losers) · MONRAD (a losers bracket for every round) · Eliminácia (a plain
//   bracket) · Skupiny (round robin) · Skupiny + pavúk (groups, then a bracket of the best of every group) · Švajčiarsky systém (rounds against players of about the
//   same strength, no rematch, nobody is out).
// Everything can be made automatically or by hand (groups put together by the organiser, an empty bracket to seat). Loaded by
// seasons-admin.html / tournaments-admin.html, used by seasons-admin.js (needs api, toast, escapeHtml).

const DRAW_FORMATS = ['BO1', 'BO3', 'BO3_STB', 'BO5', 'BO5_STB', 'BO3_G4_STB', 'BO1_G5_TB'];
const DRAW_MAIN_DEFAULT = 'BO3_STB';
const DRAW_CONSOLATION_DEFAULT = 'BO3_G4_STB';
// the order of the buttons: the special format for exactly 6 players is always the last one
const DRAW_FORMAT_INFO = {
  PRINCE: ['PRINCE', tl('Pavúk + útecha pre porazených v 1. kole. Kto prehrá neskôr, končí.', 'A bracket + a consolation bracket for those who lose in round 1. Whoever loses later is out.')],
  MONRAD: ['Monrad', tl('Pavúk + útecha pre porazených v každom kole (a v nich zasa útechy): hrá sa, kým nie sú určené všetky miesta. Veľa zápasov.', 'A bracket + a consolation bracket for the losers of every round (and consolations again within those): play goes on until every place is decided. Many matches.')],
  ELIMINATION: [tl('Eliminácia', 'Elimination'), tl('Obyčajný pavúk, porazený končí.', 'A plain bracket, the loser is out.')],
  GROUPS: [tl('Skupiny', 'Groups'), tl('Skupiny každý s každým, tabuľky podľa bodov.', 'Round-robin groups, tables by points.')],
  GROUPS_BRACKET: [tl('Skupiny + pavúk', 'Groups + bracket'), tl('Skupiny každý s každým a potom pavúk z najlepších hráčov každej skupiny, alebo (pri 2 skupinách) zápasy o umiestnenie: 1. s 1., 2. s 2. …', 'Round-robin groups and then a bracket of the best players of every group, or (with 2 groups) matches for the places: 1st with 1st, 2nd with 2nd …')],
  SWISS: [tl('Švajčiarsky systém', 'Swiss system'), tl("Každý hráč odohrá rovnaký počet kôl, v každom kole jeden zápas, a nikto nevypadáva.\n\n1. kolo: ak sú hráči nasadení, hrá najlepší proti najslabším (pri 8 hráčoch 1. s 5., 2. so 6., 3. so 7. a 4. s 8.). Ak nasadení nie sú, páry sa vyžrebujú náhodne.\n\n2. kolo a ďalšie: vznikne po odohraní všetkých zápasov predchádzajúceho kola. Systém zoradí hráčov podľa tabuľky a páruje tých s rovnakým (alebo najbližším) počtom bodov, teda víťaz s víťazom a porazený s porazeným. Nikto nehrá s tým istým súperom dvakrát.\n\nBuchholz: keď majú viacerí hráči rovnako bodov, vyššie je ten, ktorého súperi mali spolu viac bodov, lebo hral proti silnejším. Ak ani to nerozhodne, platia podmienky turnaja (set, výhry, gemy).\n\nPri nepárnom počte hráčov má jeden hráč v kole voľno a dostane body za výhru (každý najviac raz). Po poslednom kole je tabuľka konečným poradím.", "Every player plays the same number of rounds, one match in each round, and nobody is knocked out.\n\nRound 1: when the players are seeded, the best play the weakest (with 8 players 1st v 5th, 2nd v 6th, 3rd v 7th and 4th v 8th). When nobody is seeded, the pairs are drawn by lot.\n\nRound 2 and the next ones: made once every match of the previous round is played. The system puts the players in the order of the table and pairs the ones with the same (or the nearest) points: a winner with a winner, a loser with a loser. Nobody plays the same opponent twice.\n\nBuchholz: when several players have the same points, the one whose opponents had more points together ranks higher, because he played stronger opponents. If that does not decide either, the conditions of the tournament apply (sets, wins, games).\n\nWith an odd number of players one player has a bye in a round and gets the points of a win (each at most once). After the last round the table is the final standing.")],
  SIX_ROUNDS: [tl('6 hráčov, 3 kolá', '6 players, 3 rounds'), tl('Presne 6 hráčov v jednej tabuľke: 3 kolá po 3 zápasy (všetky naraz na 3 kurtoch), každý hráč odohrá 3 zápasy. Hráči sa vždy vyžrebujú náhodne (nasadenie sa nepoužije).', 'Exactly 6 players in one table: 3 rounds of 3 matches (all at once on 3 courts), every player plays 3 matches. The players are always drawn by lot (the seeding is not used).')],
};
const DRAW_BRACKET_TYPES = { ELIMINATION: tl('Eliminácia', 'Elimination'), PRINCE: 'PRINCE', MONRAD: 'Monrad', PLACEMENT: tl('Zápasy o umiestnenie (1. s 1., 2. s 2. …) — pri 2 skupinách', 'Placement matches (1st with 1st, 2nd with 2nd …) — with 2 groups') };
// the server names the categories in Slovak; the two that are words (not Elite / Next Gen / Novice) follow the language of the page
const drawCategoryLabel = (c) => (c.category === 'DOUBLES' ? tl('Štvorhra', 'Doubles') : (c.category === 'OPEN' ? tl('Bez kategórie', 'No category') : c.label));

function drawFormatOptions(selected) {
  return DRAW_FORMATS.map((k) => `<option value="${k}"${k === selected ? ' selected' : ''}>${escapeHtml(t(`format.${k}.label`))}</option>`).join('');
}

async function openDrawPanel(host, seasonId, onChanged) {
  host.innerHTML = `<div style="color:var(--gray)">${tl('Načítavam…', 'Loading…')}</div>`;
  let overview = await api(`/seasons/${seasonId}/draw`);
  // a doubles tournament has the category Štvorhra only (its pairs are made below); a singles tournament has no pairs at all
  const isDoubles = overview.playType === 'DOUBLES';
  const noPairs = { pairs: [], registrationsWithPartner: 0, locked: false };
  let doubles = isDoubles ? await api(`/seasons/${seasonId}/doubles`) : noPairs;
  // the pairs of the tournament are the players of the category DOUBLES (Štvorhra): listed with the registrations, one row per pair
  const withPairs = (list) => [...list, ...doubles.pairs.map((p) => ({
    id: p.registrationId, pairId: p.id, name: `${p.player.name} / ${p.partner.name}`, category: 'DOUBLES', seed: p.seed, paid: null, partner: true,
  }))];
  let regs = withPairs((await api(`/seasons/${seasonId}/registrations`)).filter((r) => !r.substitute)); // (the substitutes wait outside the draw)
  const playerNames = (await api('/players').catch(() => [])).map((p) => p.name).sort((a, b) => a.localeCompare(b, 'sk'));
  const drafts = new Map(); // registration id -> seed text typed but not saved yet
  const choice = {}; // category -> the settings being edited
  const groupDraft = {}; // category -> { count, assign: Map(registration id -> group index) } (groups put together by hand)

  const settingsFor = (c) => choice[c.category] || (choice[c.category] = { ...c.settings });
  const draftOf = (r) => (drafts.has(r.id) ? drafts.get(r.id) : (r.seed ? String(r.seed) : ''));
  // the players of a category (in a tournament without categories, 'OPEN', everybody who registered)
  const rowsOf = (category) => (category === 'OPEN' ? regs : regs.filter((r) => r.category === category));
  const dirty = (category) => rowsOf(category).filter((r) => draftOf(r) !== (r.seed ? String(r.seed) : '')).length;
  const isGroups = (f) => f === 'GROUPS' || f === 'GROUPS_BRACKET';
  const isSwiss = (f) => f === 'SWISS';
  // the rounds suggested for a number of players (the same as src/swiss.js roundsFor)
  const swissRounds = (n) => Math.max(1, Math.min(n - 1, Math.max(2, Math.ceil(Math.log2(Math.max(2, n))))));
  const isSix = (f) => f === 'SIX_ROUNDS'; // one table of 6 with a fixed schedule (the matches are made at once, no groups to suggest or bracket after)
  const inputStyle = 'padding:7px 9px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:13px;max-width:100%';
  const groupLetter = (i) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));

  // how the draw would look: its size and who skips round 1 (the byes go to the highest seeds)
  function summaryText(c) {
    const pairs = c.category === 'DOUBLES';
    if (c.players < 2) return c.players ? (pairs ? tl('Treba aspoň 2 páry.', 'At least 2 pairs are needed.') : tl('Treba aspoň 2 hráčov.', 'At least 2 players are needed.')) : (pairs ? tl('Zatiaľ nie sú žiadne páry.', 'There are no pairs yet.') : tl('Zatiaľ nikto nie je zaradený.', 'Nobody is assigned yet.'));
    const head = pairs ? `${tl('Párov', 'Pairs')}: ${c.players}` : `${c.players} ${nounFor(c.players, 'hráč', 'hráči', 'hráčov', 'player', 'players')}`;
    // the format being chosen (or the one of the draw that exists)
    const format = c.stage === 'NONE' ? settingsFor(c).format : c.settings.format;
    if (isSwiss(format)) return c.players < 4 ? `${head} — ${tl('švajčiarsky systém potrebuje aspoň 4 hráčov', 'the Swiss system needs at least 4 players')}` : `${head} → ${tl('švajčiarsky systém', 'Swiss system')}: ${settingsFor(c).rounds || swissRounds(c.players)} ${tl('kôl', 'rounds')}`;
    if (isSix(format)) return `${head}${c.players === 6 ? '' : ` — ${tl('tento formát je pre presne 6 hráčov', 'this format is for exactly 6 players')}`}`;
    if (isGroups(format) && c.stage !== 'BRACKET') return head;
    if (!c.byes) return tl(`${head} → pavúk na ${c.size}, všetci hrajú 1. kolo.`, `${head} → a bracket of ${c.size}, everybody plays round 1.`);
    const byBye = Math.min(c.byes, c.seeded);
    const random = c.byes - byBye;
    const skip = byBye ? tl(`nasadení 1–${byBye}`, `seeds 1–${byBye}`) : '';
    const lot = random ? tl(`${random} ${random === 1 ? 'hráč vyžrebovaný' : 'hráčov vyžrebovaných'} náhodou (nasaď viac hráčov, ak to nechceš)`, `${random} ${random === 1 ? 'player' : 'players'} drawn at random (seed more players if you do not want that)`) : '';
    return tl(`${head} → pavúk na ${c.size}, voľných miest (bye): ${c.byes}. 1. kolo preskočia ${[skip, lot].filter(Boolean).join(' a ')}.`, `${head} → a bracket of ${c.size}, byes: ${c.byes}. Round 1 is skipped by ${[skip, lot].filter(Boolean).join(' and ')}.`);
  }

  function seedRowsHtml(c) {
    const rows = rowsOf(c.category);
    if (!rows.length) return '';
    const sorted = [...rows].sort((a, b) => (Number(draftOf(a)) || 1e9) - (Number(draftOf(b)) || 1e9) || a.name.localeCompare(b.name));
    const locked = c.stage !== 'NONE';
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(210px,100%),1fr));gap:14px 28px;margin:16px 0 20px">${sorted.map((r) => `
      <label style="display:flex;gap:12px;align-items:center;font-size:14px">
        <input type="number" min="1" max="${c.players}" inputmode="numeric" class="sd-seed" data-reg="${r.id}" value="${escapeHtml(draftOf(r))}" placeholder="–" style="width:54px;${inputStyle}"${locked ? ' disabled' : ''}>
        <span>${escapeHtml(r.name)}</span>
      </label>`).join('')}</div>`;
  }

  // ---------- the form for a category without a draw ----------

  function groupEditorHtml(c, s) {
    const d = groupDraft[c.category];
    if (!d) return `<div style="font-size:12px;color:var(--gray)">${tl('Načítavam návrh skupín…', 'Loading the suggested groups…')}</div>`;
    const rows = rowsOf(c.category);
    const opts = (cur) => Array.from({ length: d.count }, (_, i) => `<option value="${i}"${i === cur ? ' selected' : ''}>${groupLetter(i)}</option>`).join('');
    const sizes = Array.from({ length: d.count }, (_, i) => rows.filter((r) => d.assign.get(r.id) === i).length);
    return `
      <div style="margin:8px 0">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
          <strong style="font-size:13px">${tl('Rozdelenie do skupín', 'Division into groups')}</strong>
          <label style="font-size:12px;color:var(--gray)">${tl('Počet skupín', 'Number of groups')} <input type="number" min="1" max="26" class="sd-gcount" data-cat="${c.category}" value="${d.count}" style="width:60px;${inputStyle}"></label>
          <button type="button" class="btn btn-sm btn-outline" data-act="suggest" data-cat="${c.category}">${tl('Navrhnúť rozdelenie', 'Suggest a division')}</button>
          <span style="font-size:12px;color:var(--gray)">${sizes.map((n, i) => `${groupLetter(i)}: ${n}`).join(' · ')}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(210px,100%),1fr));gap:6px 14px">${rows.map((r) => `
          <label style="display:flex;gap:8px;align-items:center;font-size:13px">
            <select class="sd-assign" data-reg="${r.id}" data-cat="${c.category}" style="${inputStyle}">${opts(d.assign.get(r.id))}</select>
            <span>${escapeHtml(r.name)}</span>
          </label>`).join('')}</div>
      </div>`;
  }

  function setupHtml(c) {
    const s = settingsFor(c);
    const formatBtns = Object.keys(DRAW_FORMAT_INFO).map((f) => `<button type="button" class="btn btn-sm ${s.format === f ? 'btn-primary' : 'btn-outline'}" data-act="format" data-cat="${c.category}" data-fmt="${f}">${escapeHtml(DRAW_FORMAT_INFO[f][0])}</button>`).join(' ');
    const sel = (cls, label, options, extra = '') => `<label style="font-size:12px;color:var(--gray)">${label}<select class="${cls}" data-cat="${c.category}" style="${inputStyle};display:block;width:100%;margin-top:8px">${options}</select></label>${extra}`;
    const placement = s.format === 'GROUPS_BRACKET' && s.bracketType === 'PLACEMENT'; // the 1st of one group plays the 1st of the other …: no qualifiers, no consolation
    const hasLosers = s.format === 'GROUPS_BRACKET' ? !['ELIMINATION', 'PLACEMENT'].includes(s.bracketType) : ['PRINCE', 'MONRAD'].includes(s.format);
    const modeLabel = isGroups(s.format) ? [tl('Skupiny navrhne systém', 'The system suggests the groups'), tl('Skupiny zostavím ručne', 'I put the groups together by hand')] : [tl('Vytvoriť automaticky', 'Create automatically'), tl('Zostaviť ručne', 'Set up by hand')];
    let body = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">${formatBtns}</div>
      <div style="font-size:13px;line-height:1.5;color:var(--gray);margin-bottom:20px;white-space:pre-line">${escapeHtml(DRAW_FORMAT_INFO[s.format][1])}</div>
      ${isSix(s.format) || isSwiss(s.format) ? '' : `<div style="display:flex;gap:28px;row-gap:12px;flex-wrap:wrap;margin:0 0 22px;font-size:14px">
        <label><input type="radio" name="sd-mode-${c.category}" value="AUTO" data-cat="${c.category}"${s.mode === 'AUTO' ? ' checked' : ''}> ${modeLabel[0]}</label>
        <label><input type="radio" name="sd-mode-${c.category}" value="MANUAL" data-cat="${c.category}"${s.mode === 'MANUAL' ? ' checked' : ''}> ${modeLabel[1]}</label>
      </div>`}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:18px 20px;margin-bottom:22px">`;
    if (isSix(s.format)) body += sel('sd-group-format', tl('Formát zápasu', 'Match format'), drawFormatOptions(s.groupFormat));
    if (isSwiss(s.format)) {
      body += `
        <label style="font-size:12px;color:var(--gray)">${tl('Počet kôl (prázdne = navrhne systém)', 'Number of rounds (empty = suggested)')}<input type="number" min="1" max="50" class="sd-rounds" data-cat="${c.category}" value="${s.rounds || ''}" placeholder="${c.players >= 4 ? swissRounds(c.players) : ''}" style="${inputStyle};display:block;width:100%;margin-top:8px"></label>
        ${sel('sd-group-format', tl('Formát zápasu', 'Match format'), drawFormatOptions(s.groupFormat))}`;
    }
    if (isGroups(s.format)) {
      body += `
        <label style="font-size:12px;color:var(--gray)">${tl('Hráčov v skupine (najviac)', 'Players per group (at most)')}<input type="number" min="2" max="12" class="sd-gsize" data-cat="${c.category}" value="${s.groupSize}" style="${inputStyle};display:block;width:100%;margin-top:3px"></label>
        ${sel('sd-group-format', tl('Formát zápasu — skupiny', 'Match format — groups'), drawFormatOptions(s.groupFormat))}`;
    }
    if (s.format === 'GROUPS_BRACKET') {
      body += `
        ${placement ? '' : `<label style="font-size:12px;color:var(--gray)">${tl('Z každej skupiny postupuje', 'Advancing from each group')}<input type="number" min="1" max="8" class="sd-qual" data-cat="${c.category}" value="${s.qualifiers}" style="${inputStyle};display:block;width:100%;margin-top:3px"></label>`}
        ${sel('sd-bracket-type', tl('Typ pavúka po skupinách', 'Type of the bracket after the groups'), Object.entries(DRAW_BRACKET_TYPES).map(([k, l]) => `<option value="${k}"${k === s.bracketType ? ' selected' : ''}>${l}</option>`).join(''))}`;
    }
    if ((!isGroups(s.format) && !isSix(s.format) && !isSwiss(s.format)) || s.format === 'GROUPS_BRACKET') {
      body += sel('sd-main-format', placement ? tl('Formát zápasu — zápasy o umiestnenie', 'Match format — placement matches') : tl('Formát zápasu — hlavný pavúk', 'Match format — main bracket'), drawFormatOptions(s.mainFormat));
      if (hasLosers) body += sel('sd-cons-format', tl('Formát zápasu — útecha', 'Match format — consolation'), drawFormatOptions(s.consolationFormat));
    }
    body += '</div>';
    if (isSwiss(s.format)) {
      body += `<label style="display:block;font-size:13px;margin-bottom:8px"><input type="checkbox" class="sd-auto-bracket" data-cat="${c.category}"${s.autoBracket ? ' checked' : ''}> ${tl('Ďalšie kolo vytvoriť samo, keď sa odohrajú všetky zápasy kola', 'Make the next round by itself once every match of the round is played')}</label>`;
    }
    if (s.format === 'GROUPS_BRACKET') {
      body += `<label style="display:block;font-size:13px;margin-bottom:8px"><input type="checkbox" class="sd-auto-bracket" data-cat="${c.category}"${s.autoBracket ? ' checked' : ''}> ${tl('Pavúk vytvoriť sám, keď sa odohrá posledný zápas skupín (inak ho vytvoríš tlačidlom)', 'Create the bracket by itself when the last group match is played (otherwise you create it with the button)')}</label>`;
    }
    if (isGroups(s.format) && s.mode === 'MANUAL') body += groupEditorHtml(c, s);
    const ready = (isSix(s.format) ? c.players === 6 : isSwiss(s.format) ? c.players >= 4 : c.players >= 2) && !c.withoutProfile.length && !dirty(c.category);
    body += `
      <button type="button" class="btn btn-sm btn-primary" data-act="draw" data-cat="${c.category}" ${ready ? '' : 'disabled'}>${isSwiss(s.format) ? tl('Vytvoriť 1. kolo', 'Create round 1') : isSix(s.format) ? tl('Vytvoriť tabuľku a zápasy', 'Create the table and matches') : isGroups(s.format) ? tl('Vytvoriť skupiny a zápasy', 'Create groups and matches') : (s.mode === 'AUTO' ? tl('Vytvoriť pavúk', 'Create bracket') : tl('Vytvoriť prázdny pavúk', 'Create an empty bracket'))}</button>
      ${dirty(c.category) ? `<span style="font-size:12px;color:var(--gray);margin-left:8px">${tl('Najprv ulož nasadenie.', 'Save the seeding first.')}</span>` : ''}
      ${c.withoutProfile.length ? `<div style="color:var(--danger);font-size:12px;margin-top:6px">${tl('Bez profilu hráča', 'Without a player profile')}: ${escapeHtml(c.withoutProfile.join(', '))}</div>` : ''}`;
    return body;
  }

  // ---------- a category with a draw ----------

  function stateHtml(c) {
    const s = c.settings;
    const parts = [`<div style="font-size:13px;margin-bottom:6px"><b>${escapeHtml(DRAW_FORMAT_INFO[s.format] ? DRAW_FORMAT_INFO[s.format][0] : s.format)}</b>${s.format === 'GROUPS_BRACKET' ? ` <span style="color:var(--gray)">— ${s.bracketType === 'PLACEMENT' ? tl('po skupinách', 'after the groups') : tl(`z každej skupiny postupuje ${s.qualifiers}, pavúk`, `${s.qualifiers} advance from each group, bracket`)}: ${escapeHtml(DRAW_BRACKET_TYPES[s.bracketType] || s.bracketType)}${s.autoBracket && s.mode === 'AUTO' ? tl(', vytvorí sa sám', ', it is created by itself') : ''}</span>` : ''}</div>`];
    if (c.groups) {
      parts.push(`<div style="margin:6px 0"><div style="font-weight:700;font-size:13px">${tl('Skupiny', 'Groups')} <span style="font-weight:400;color:var(--gray)">${c.groups.finished}/${c.groups.matches} ${tl('zápasov odohraných', 'matches played')}</span></div>${c.groups.groups.map((g) => `
        <div style="font-size:13px;padding:2px 0"><b>${escapeHtml(groupShortName(g.name))}</b> <span style="color:var(--gray);font-size:12px">${escapeHtml(g.players.map((p) => p.name).join(', '))} · ${g.finished}/${g.matches} ${tl('zápasov', 'matches')}</span></div>`).join('')}</div>`);
    }
    if (c.brackets.length) {
      parts.push(`<div style="margin:6px 0"><div style="font-weight:700;font-size:13px">${tl('Pavúky', 'Brackets')} <span style="font-weight:400;color:var(--gray)">${c.brackets.length}</span></div>${c.brackets.map((b) => `
        <div style="font-size:13px;padding:2px 0"><a data-public href="/bracket/${b.id}" target="_blank" rel="noopener" style="font-weight:700">${escapeHtml(b.name.replace(/^.*? — (Elite|Next Gen|Novice) — /, ''))}</a> <span style="color:var(--gray);font-size:12px">${b.size}-${tl('pavúk', 'bracket')} · ${b.finished}/${b.matches} ${tl('zápasov odohraných', 'matches played')} · ${escapeHtml(t(`format.${b.format}.label`))}</span></div>`).join('')}</div>`);
    }
    if (c.swiss) {
      const w = c.swiss;
      parts.push(`<div style="margin:6px 0;font-size:13px"><b>${tl('Kolo', 'Round')} ${w.round} ${tl('z', 'of')} ${w.rounds}</b>${w.finished ? ` <span style="color:var(--gray)">— ${tl('všetky kolá sú odohrané, tabuľka je konečné poradie', 'all the rounds are played, the table is the final standing')}</span>` : w.roundFinished ? ` <span style="color:var(--gray)">— ${tl('kolo je odohrané', 'the round is played')}</span>` : ` <span style="color:var(--gray)">— ${tl('čaká sa na zápasy kola', 'waiting for the matches of the round')}</span>`}${w.bye ? `<div style="color:var(--gray);font-size:12px">${tl('Voľno v tomto kole', 'Bye in this round')}: ${escapeHtml(w.bye.name)}</div>` : ''}</div>`);
    }
    if (!c.brackets.length && s.format === 'GROUPS_BRACKET') {
      parts.push(`<div style="font-size:13px;color:var(--gray);margin:6px 0">${tl('Pavúk ešte nie je vytvorený — vznikne z najlepších hráčov skupín.', 'The bracket is not made yet — it will be made from the best players of the groups.')}</div>`);
    }
    const buttons = [];
    if (c.canMakeBracket) {
      buttons.push(`<select class="sd-bracket-mode" data-cat="${c.category}" style="${inputStyle}"><option value="AUTO">${tl('Vložiť hráčov automaticky', 'Seat the players automatically')}</option><option value="MANUAL">${tl('Prázdne zápasy (posadím ručne)', 'Empty matches (I seat them by hand)')}</option></select><button type="button" class="btn btn-sm btn-primary" data-act="bracket" data-cat="${c.category}">${s.bracketType === 'PLACEMENT' ? tl('Vytvoriť zápasy o umiestnenie', 'Create the placement matches') : tl('Vytvoriť pavúk zo skupín', 'Create the bracket from the groups')}</button>`);
    }
    if (c.swiss && c.swiss.canMakeNext) buttons.push(`<button type="button" class="btn btn-sm btn-primary" data-act="swiss-round" data-cat="${c.category}">${tl('Vytvoriť ďalšie kolo', 'Make the next round')}</button>`);
    if (c.canMakeConsolation) {
      const cf = settingsFor(c).consolationFormat;
      buttons.push(`<select class="sd-cons-format" data-cat="${c.category}" style="${inputStyle}">${drawFormatOptions(cf)}</select><button type="button" class="btn btn-sm btn-primary" data-act="consolation" data-cat="${c.category}">${tl('Vytvoriť útechu', 'Create the consolation')}</button>`);
    }
    if (c.main && !document.querySelector('[data-club]')) buttons.push(`<a class="btn btn-sm btn-outline" href="/bracket-admin" target="_blank" rel="noopener">${tl('Upraviť pavúk', 'Edit the bracket')}</a>`);
    buttons.push(`<button type="button" class="btn btn-sm btn-outline" data-act="delete" data-cat="${c.category}" style="color:var(--danger)">${c.groups && !c.main ? tl('Zmazať skupiny', 'Delete the groups') : tl('Zmazať pavúk', 'Delete the bracket')}</button>`);
    parts.push(`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">${buttons.join('')}</div>`);
    return parts.join('');
  }

  function blockHtml(c) {
    const noDraw = c.stage === 'NONE';
    return `
      <section class="sa-section sd-block" data-cat="${c.category}">
        <h4>${drawCategoryLabel(c)}</h4>
        <div class="sa-hint" style="margin:-6px 0 6px">${escapeHtml(summaryText(c))}</div>
        ${c.players ? `<div style="font-weight:700;font-size:14px;margin-top:20px;line-height:1.5">${tl('Nasadenie', 'Seeding')} ${noDraw ? `<span style="font-weight:400;color:var(--gray)">${tl('— číslo 1 je najlepší; nenasadení nechajte prázdni', '— number 1 is the best; leave the unseeded empty')}</span>` : `<span style="font-weight:400;color:var(--gray)">${tl('(žrebovanie je už vytvorené)', '(the draw has been made already)')}</span>`}</div>` : ''}
        ${seedRowsHtml(c)}
        ${c.players && noDraw ? `<button type="button" class="btn btn-sm btn-outline" data-act="seeds" data-cat="${c.category}" ${dirty(c.category) ? '' : 'disabled'}>${tl('Uložiť nasadenie', 'Save seeding')}${dirty(c.category) ? ` (${dirty(c.category)})` : ''}</button>` : ''}
        <div style="border-top:1px solid rgba(255,255,255,0.12);margin-top:22px;padding-top:22px">${noDraw ? setupHtml(c) : stateHtml(c)}</div>
        <div class="sd-error" data-cat="${c.category}" style="color:var(--danger);font-weight:600;margin-top:12px"></div>
      </section>`;
  }

  // The pairs of the tournament (the "Štvorhra" category below is drawn like the others, with the pairs as its players): made here by hand or
  // from the partners the players named when registering. Locked while the category has a draw.
  function pairsBlockHtml() {
    const d = doubles;
    const locked = d.locked;
    const rows = d.pairs.map((p) => `
      <div style="display:flex;gap:8px;align-items:center;margin:4px 0;font-size:13px">
        <span style="flex:1"><b>${escapeHtml(p.player.name)}</b> / <b>${escapeHtml(p.partner.name)}</b></span>
        ${locked ? '' : `<button type="button" class="btn btn-sm btn-outline" data-act="dbl-remove" data-id="${p.id}" title="${escapeHtml(tl('Zrušiť pár', 'Remove the pair'))}">✕</button>`}
      </div>`).join('');
    return `
      <section class="sa-section">
        <h4>${tl('Páry na štvorhru', 'Doubles pairs')}</h4>
        <div style="font-size:12px;line-height:1.5;color:var(--gray);margin:0 0 16px">${tl('Hráči sa môžu pri registrácii prihlásiť s partnerom. Z párov sa žrebuje kategória <b>Štvorhra</b> vyššie, rovnako ako ostatné (nasadenie, formát, skupiny, útecha, ručne). Zápasy sa nepočítajú do ligy ani do CourtIQ.', 'Players can register with a partner. The category <b>Doubles</b> above is drawn from the pairs like the others (seeding, format, groups, consolation, by hand). The matches do not count for the league or for CourtIQ.')}</div>
        ${rows || `<div style="font-size:13px;color:var(--gray);margin:6px 0">${tl('Zatiaľ nie sú žiadne páry.', 'There are no pairs yet.')}</div>`}
        ${locked ? `<div style="font-size:12px;color:var(--gray);margin-top:6px">${tl('Žrebovanie štvorhry už existuje — páry sa dajú meniť po jeho zmazaní.', 'The doubles draw already exists — the pairs can be changed after it is deleted.')}</div>` : `
        <datalist id="sd-dplayers">${playerNames.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('')}</datalist>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px">
          <input type="text" class="sd-dplayer" list="sd-dplayers" placeholder="${escapeHtml(tl('Hráč', 'Player'))}" autocomplete="off" style="${inputStyle}">
          <input type="text" class="sd-dpartner" list="sd-dplayers" placeholder="${escapeHtml(tl('Partner', 'Partner'))}" autocomplete="off" style="${inputStyle}">
          <button type="button" class="btn btn-sm btn-outline" data-act="dbl-add">${tl('Pridať pár', 'Add a pair')}</button>
          ${d.registrationsWithPartner ? `<button type="button" class="btn btn-sm btn-outline" data-act="dbl-from-regs">${tl('Páry z registrácií', 'Pairs from the registrations')} (${d.registrationsWithPartner})</button>` : ''}
        </div>`}
      </section>`;
  }

  async function doublesAction(act, btn) {
    const base = `/seasons/${seasonId}/doubles`;
    if (act === 'dbl-add') {
      const player = host.querySelector('.sd-dplayer').value.trim();
      const partner = host.querySelector('.sd-dpartner').value.trim();
      if (!player || !partner) throw new Error(tl('Zadaj oboch hráčov páru', 'Enter both players of the pair'));
      await api(`${base}/pairs`, { method: 'POST', body: { player, partner } });
      toast(tl('Pár pridaný', 'Pair added'));
    } else if (act === 'dbl-from-regs') {
      const made = await api(`${base}/pairs`, { method: 'POST', body: { fromRegistrations: true } });
      toast(`${tl('Vytvorených párov', 'Pairs created')}: ${made.created}${made.skipped.length ? ` · ${tl('preskočené', 'skipped')}: ${made.skipped.map((x) => `${x.name} + ${x.partner} (${x.reason})`).join('; ')}` : ''}`);
    } else if (act === 'dbl-remove') {
      await api(`${base}/pairs/${btn.dataset.id}`, { method: 'DELETE' });
    }
    await refresh();
  }

  function render() {
    host.innerHTML = `
      <div class="sd-grid">${overview.categories.map(blockHtml).join('')}</div>
      ${isDoubles ? pairsBlockHtml() : ''}`;
  }

  async function refresh() {
    let real;
    [overview, real] = await Promise.all([api(`/seasons/${seasonId}/draw`), api(`/seasons/${seasonId}/registrations`)]);
    doubles = isDoubles ? await api(`/seasons/${seasonId}/doubles`) : noPairs;
    regs = withPairs(real.filter((r) => !r.substitute));
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
      if (btn) { btn.disabled = !n; btn.textContent = n ? `${tl('Uložiť nasadenie', 'Save seeding')} (${n})` : tl('Uložiť nasadenie', 'Save seeding'); }
      const draw = block.querySelector('[data-act="draw"]');
      if (draw) draw.disabled = !!n || catOf(cat).players < 2;
      return;
    }
    const cat = e.target.dataset.cat;
    if (!cat) return;
    const s = settingsFor(catOf(cat));
    if (e.target.matches('.sd-gsize')) s.groupSize = Number(e.target.value) || 4;
    else if (e.target.matches('.sd-qual')) s.qualifiers = Number(e.target.value) || 1;
    else if (e.target.matches('.sd-rounds')) s.rounds = Math.max(0, Number(e.target.value) || 0);
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

  // the live video links of the courts follow the number of courts (host.oninput above handles the draw controls only)

  host.onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const cat = btn.dataset.cat;
    if (cat) showError(cat, '');
    btn.disabled = true;
    try {
      if (act.startsWith('dbl-')) {
        await doublesAction(act, btn);
      } else if (act === 'seeds') {
        const seeds = rowsOf(cat).map((r) => ({ id: r.id, seed: draftOf(r) === '' ? null : Number(draftOf(r)) }));
        const savedList = await api(`/seasons/${seasonId}/seeds`, { method: 'POST', body: { category: cat, seeds } });
        if (cat === 'DOUBLES') doubles = await api(`/seasons/${seasonId}/doubles`); // the seeds of the pairs are kept with the pairs
        regs = withPairs(savedList);
        drafts.clear();
        toast(tl('Nasadenie uložené', 'Seeding saved'));
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
          const rows = rowsOf(cat);
          body.groups = Array.from({ length: d.count }, (_, i) => ({ name: `Skupina ${groupLetter(i)}`, registrationIds: rows.filter((r) => d.assign.get(r.id) === i).map((r) => r.id) })).filter((g) => g.registrationIds.length);
        }
        const made = await api(`/seasons/${seasonId}/draw`, { method: 'POST', body });
        toast(isSwiss(s.format) ? tl(`1. kolo vytvorené (${made.matches} zápasov, ${made.rounds} kôl)`, `Round 1 created (${made.matches} matches, ${made.rounds} rounds)`) : isGroups(s.format) || isSix(s.format) ? tl(`Skupiny vytvorené (${made.matches} zápasov)`, `Groups created (${made.matches} matches)`) : (made.consolationNote ? tl(`Pavúk vytvorený (bez útechy: ${made.consolationNote})`, `Bracket created (no consolation: ${made.consolationNote})`) : tl('Pavúk vytvorený', 'Bracket created')));
        await refresh();
        if (made.warnings && made.warnings.length) showError(cat, made.warnings.join(' '));
      } else if (act === 'swiss-round') {
        const made = await api(`/seasons/${seasonId}/draw/swiss-round`, { method: 'POST', body: { category: cat } });
        toast(tl(`Kolo ${made.round} vytvorené (${made.matches} zápasov)`, `Round ${made.round} created (${made.matches} matches)`));
        await refresh();
      } else if (act === 'bracket') {
        const mode = host.querySelector(`.sd-bracket-mode[data-cat="${cat}"]`).value;
        let force = false;
        const c = catOf(cat);
        if (c.groups && !c.groups.allFinished) {
          if (!confirm(tl(`Skupinové zápasy ešte nie sú všetky odohrané (${c.groups.finished} z ${c.groups.matches}). Pavúk sa vytvorí z aktuálnych tabuliek. Pokračovať?`, `Not all group matches have been played yet (${c.groups.finished} of ${c.groups.matches}). The bracket will be made from the current tables. Continue?`))) { btn.disabled = false; return; }
          force = true;
        }
        await api(`/seasons/${seasonId}/draw/bracket`, { method: 'POST', body: { category: cat, mode, force } });
        toast(tl('Pavúk vytvorený', 'Bracket created'));
        await refresh();
      } else if (act === 'consolation') {
        const c = catOf(cat);
        await api(`/brackets/${c.main.id}/consolation`, { method: 'POST', body: { format: settingsFor(c).consolationFormat } });
        toast(tl('Útecha vytvorená', 'Consolation created'));
        await refresh();
      } else if (act === 'delete') {
        if (!confirm(tl('Zmazať žrebovanie tejto kategórie (skupiny, pavúky aj útechy)? Naplánované zápasy sa zmažú.', 'Delete the draw of this category (groups, brackets and consolations)? Planned matches will be deleted.'))) { btn.disabled = false; return; }
        await api(`/seasons/${seasonId}/draw/${cat}`, { method: 'DELETE' });
        toast(tl('Žrebovanie zmazané', 'Draw deleted'));
        await refresh();
      }
    } catch (err) {
      btn.disabled = false;
      if (cat) showError(cat, err.message); else toast(err.message);
    }
  };
  render();
}
