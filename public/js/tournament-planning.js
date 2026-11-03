// The "Plánovanie turnaja" part of the form that makes a tournament: the numbers the court planner works with (the length of a match, the start and the end of the
// playing day, the rest of a player between his matches, the most matches of a player in a day, and whether the system builds the schedule itself). The same six
// settings the Rozpis (court schedule) of the tournament shows; here they are chosen when the tournament is made, and can be changed there later.
//   TournamentPlanning.html(id, settings) -> markup (settings = { matchMinutes, dayStart, dayEnd, restMinutes, maxPerDay, autoSchedule }; null = the defaults of the server)
//   TournamentPlanning.read(root)         -> the fields the API takes (src/tournamentSchedule.js readSettings); a field left empty is not sent, the server's default stays
const TournamentPlanning = (() => {
  const DEFAULTS = { matchMinutes: 90, dayStart: '09:00', dayEnd: '20:00', restMinutes: 30, maxPerDay: 0, autoSchedule: true };
  const TEXT = {
    sk: {
      hint: 'Podľa týchto údajov systém skladá rozvrh zápasov na kurty. Počet kurtov sa nastavuje v časti Formát turnaja; všetko sa dá neskôr zmeniť v Rozpise.',
      matchMinutes: 'Dĺžka zápasu (min)', dayStart: 'Začiatok dňa', dayEnd: 'Koniec dňa', restMinutes: 'Oddych hráča (min)',
      maxPerDay: 'Max. zápasov hráča za deň (0 = bez limitu)', autoSchedule: 'Rozvrh skladá systém sám',
    },
    en: {
      hint: 'The system builds the schedule of the matches on the courts from these. The number of courts is set under Tournament format; everything can be changed later in the Schedule.',
      matchMinutes: 'Match length (min)', dayStart: 'Start of the day', dayEnd: 'End of the day', restMinutes: 'Player rest (min)',
      maxPerDay: 'Max. matches per player per day (0 = no limit)', autoSchedule: 'The system builds the schedule itself',
    },
  };
  const textFor = () => TEXT[typeof currentLang !== 'undefined' && currentLang === 'en' ? 'en' : 'sk'];
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function html(id, settings) {
    const tx = textFor();
    const v = { ...DEFAULTS, ...(settings || {}) };
    const field = (key, type, attrs) => `<div class="field"><label for="tp-${esc(id)}-${key}">${esc(tx[key])}</label><input type="${type}" id="tp-${esc(id)}-${key}" data-tp="${key}" value="${esc(v[key])}" ${attrs}></div>`;
    return `<div class="tp-box" data-tp-root>
      <p class="tp-hint">${esc(tx.hint)}</p>
      <div class="com-t-row">${field('matchMinutes', 'number', 'min="15" max="300" step="5"')}${field('restMinutes', 'number', 'min="0" max="240" step="5"')}</div>
      <div class="com-t-row">${field('dayStart', 'time', '')}${field('dayEnd', 'time', '')}</div>
      <div class="com-t-row">${field('maxPerDay', 'number', 'min="0" max="10"')}</div>
      <label class="com-radio"><input type="checkbox" data-tp="autoSchedule"${v.autoSchedule ? ' checked' : ''}> ${esc(tx.autoSchedule)}</label>
    </div>`;
  }

  function read(root) {
    const out = {};
    root.querySelectorAll('input[data-tp]').forEach((input) => {
      const key = input.dataset.tp;
      if (input.type === 'checkbox') out[key] = input.checked;
      else if (input.value !== '') out[key] = input.type === 'number' ? Number(input.value) : input.value;
    });
    return out;
  }

  return { html, read, DEFAULTS };
})();
