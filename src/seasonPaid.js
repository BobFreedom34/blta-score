// One-off: the "Prihlásení hráči" list of the Autumn Finals Series 2026 from its blta.sk page
// (https://www.blta.sk/project/autumn-finals-series-2026/, copied 2026-10-06): who registered, in which category, and who has
// paid the entry fee. It becomes the season's registrations in the app (so the Hráči tab shows them with the paid column).
// Players are linked by name to the existing player records; a registration made in the app meanwhile is kept (only its paid
// tick is raised when blta.sk says paid). Runs once (flag in app_flags), only on a database that really has the season's
// matches; after that registrations and the paid ticks are managed in /seasons-admin.
//
// One line per player: name | category (E = Elite, N = Next Gen, V = Novice) | 1 paid / 0 not paid
const nameMatch = require('./nameMatch');

const SEASON_SLUG = 'autumn-finals-series-2026';
const FLAG = 'registrations_autumn_finals_2026';
const CATEGORIES = { E: 'ELITE', N: 'NEXT_GEN', V: 'NOVICE' };

const LIST = `Ľubomír Šimkovič|N|1
Yurii Yumashev|E|1
Volodymyr Sadykov|E|1
Vlado Rybár|E|1
Vladimír Ježek|N|1
Viliam Alaksa|E|1
Vadim Zenkevich|V|1
Tomáš Slávik|N|0
Tomáš Skukalík|V|1
Tomáš Podhorný|E|1
Tomáš Paulen|E|1
Tomáš Krjak|E|0
Tomáš Kováčik|V|1
Tomáš Hadari|V|1
Tomáš Elexhauser|E|1
Tomáš Demovič|N|1
Tomasz Szopinski|N|1
Stefan Dobrev|N|1
Stano Kemen|V|1
Stanislav Mihalovič|E|1
Samuel Michalek|N|1
Róbert Sloboda|E|1
Radovan Šoltés|N|1
Radko Cíger|N|1
Peter Valach|N|1
Peter Schmidt|V|1
Peter Pálenek|E|0
Peter Laučík|E|1
Peter Hladký|E|1
Peter Bilkovič|V|1
Peter Bicko|E|1
Pavol Piroha|E|0
Pavol Blahut|E|1
Pavel Mariani|E|1
Patrik Matula|V|1
Miroslav Špaček|N|0
Michal Lipták|E|0
Michal Bori|E|1
Michael Dojčan|E|1
Max BA|V|1
Matej Varga|E|0
Matej Szalay|E|1
Martin Szalay|V|1
Martin Hronček|N|1
Martin Bielik|E|1
Marek Šarudy|E|1
Marek Drašar|V|1
Lukáš Obselka|V|0
Lukáš Hnilica|V|1
Lukáš Hanus|E|1
Lukáš Böhm|N|1
Ján Szalai|E|1
Ján Beňo|N|1
Juraj Urblík|N|1
Jozef Lukča|N|1
Jerry O’Neil|N|1
Jan Szalay|E|1
Jakub Paločný|E|1
Jakub Matula|N|1
Ivan Belei|V|1
Herman Prihunov|N|1
Guillaume Raoux|N|1
Gabriel Koscelanský|N|1
Filip Ujfalusi|N|1
Dávid Hudák|E|1
David Stanek|E|1
Bruno Pavličko|N|0
Braňo Ivan|E|1
Branislav Bložon|E|0
Augusta Tobiášová|E|1
Artur Hlukhota|E|1
Anna Goruskova|N|1
Andrey Stolyarchuk|N|1
Andrej Pačuta|N|1
Aleksandr Piliptsevich|V|1
Alan Almaksus|N|1`;

function parsedList() {
  return LIST.split('\n').map((line) => {
    const [name, cat, paid] = line.split('|');
    return { name, category: CATEGORIES[cat], paid: paid === '1' };
  });
}

// Adds the registrations (and raises paid ticks). Returns { inserted, paidRaised }.
function importAutumn2026Registrations(db) {
  if (db.prepare('SELECT 1 FROM app_flags WHERE key = ?').get(FLAG)) return { skipped: true };
  const season = db.prepare('SELECT id FROM seasons WHERE slug = ?').get(SEASON_SLUG);
  if (!season) return { skipped: true };
  if (!db.prepare('SELECT 1 FROM matches WHERE season_id = ? LIMIT 1').get(season.id)) return { skipped: true };
  const players = new Map(db.prepare('SELECT id, name FROM players').all().map((p) => [nameMatch.key(p.name), p]));
  const existing = new Map(db.prepare('SELECT id, name, paid FROM season_registrations WHERE season_id = ?').all(season.id).map((r) => [nameMatch.key(r.name), r]));
  const insert = db.prepare("INSERT INTO season_registrations (season_id, player_id, name, phone, email, category, paid) VALUES (?, ?, ?, '', '', ?, ?)");
  const raise = db.prepare('UPDATE season_registrations SET paid = 1 WHERE id = ?');
  let inserted = 0;
  let paidRaised = 0;
  db.exec('BEGIN');
  try {
    parsedList().forEach((entry) => {
      const key = nameMatch.key(entry.name);
      const have = existing.get(key);
      if (have) {
        if (entry.paid && !have.paid) { raise.run(have.id); paidRaised += 1; }
        return;
      }
      const player = players.get(key);
      insert.run(season.id, player ? player.id : null, player ? player.name : entry.name, entry.category, entry.paid ? 1 : 0);
      inserted += 1;
    });
    if (inserted + paidRaised > 0) db.prepare('INSERT OR IGNORE INTO app_flags (key) VALUES (?)').run(FLAG);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { inserted, paidRaised };
}

module.exports = { importAutumn2026Registrations, parsedList };
