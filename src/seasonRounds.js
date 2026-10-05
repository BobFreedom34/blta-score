// One-off: the round schedule ("Rozpis zápasov") of the Autumn Finals Series 2026, copied from its blta.sk page
// (https://www.blta.sk/project/autumn-finals-series-2026/) on 2026-10-06. The matches already exist in the app (with their
// group) but have no round number, so the season page's "Rozpis" tab was empty. This only sets `matches.round` on the
// existing group-stage matches (matched by group + the two players); it never creates, moves or deletes a match, and
// never overwrites a round that is already set. Runs once (flag in app_flags), after which rounds are managed by the season
// maker in /seasons-admin.
//
// Per group: the rounds in order; each round is a list of "player | player".

const nameMatch = require('./nameMatch');

const SEASON_SLUG = 'autumn-finals-series-2026';
const FLAG = 'rounds_autumn_finals_2026';

const ROUNDS = {
  Babolat: [
    ['Jan Szalay | Pavel Mariani', 'Michal Bori | Volodymyr Sadykov', 'Peter Bicko | Branislav Bložon'],
    ['Peter Bicko | Michal Bori', 'Volodymyr Sadykov | Pavel Mariani', 'Jan Szalay | Branislav Bložon'],
    ['Michal Bori | Pavel Mariani', 'Jan Szalay | Peter Bicko', 'Volodymyr Sadykov | Branislav Bložon'],
    ['Jan Szalay | Michal Bori', 'Pavel Mariani | Branislav Bložon', 'Volodymyr Sadykov | Peter Bicko'],
    ['Michal Bori | Branislav Bložon', 'Volodymyr Sadykov | Jan Szalay', 'Pavel Mariani | Peter Bicko'],
  ],
  Dunlop: [
    ['Vlado Rybár | Michal Lipták', 'Pavol Piroha | Viliam Alaksa', 'Tomáš Paulen | Tomáš Elexhauser'],
    ['Vlado Rybár | Marek Šarudy', 'Tomáš Paulen | Michal Lipták', 'Pavol Piroha | Tomáš Elexhauser'],
    ['Marek Šarudy | Viliam Alaksa', 'Tomáš Paulen | Vlado Rybár', 'Pavol Piroha | Michal Lipták'],
    ['Tomáš Paulen | Marek Šarudy', 'Viliam Alaksa | Tomáš Elexhauser', 'Pavol Piroha | Vlado Rybár'],
    ['Marek Šarudy | Tomáš Elexhauser', 'Pavol Piroha | Tomáš Paulen', 'Viliam Alaksa | Michal Lipták'],
    ['Pavol Piroha | Marek Šarudy', 'Tomáš Elexhauser | Michal Lipták', 'Viliam Alaksa | Vlado Rybár'],
    ['Marek Šarudy | Michal Lipták', 'Tomáš Elexhauser | Vlado Rybár', 'Viliam Alaksa | Tomáš Paulen'],
  ],
  Head: [
    ['Dávid Hudák | Tomáš Podhorný', 'Matej Szalay | Peter Pálenek', 'Peter Hladký | Matej Varga'],
    ['Tomáš Podhorný | David Stanek', 'Peter Hladký | Dávid Hudák', 'Matej Szalay | Matej Varga'],
    ['David Stanek | Peter Pálenek', 'Peter Hladký | Tomáš Podhorný', 'Matej Szalay | Dávid Hudák'],
    ['Peter Hladký | David Stanek', 'Peter Pálenek | Matej Varga', 'Matej Szalay | Tomáš Podhorný'],
    ['David Stanek | Matej Varga', 'Matej Szalay | Peter Hladký', 'Peter Pálenek | Dávid Hudák'],
    ['Matej Szalay | David Stanek', 'Matej Varga | Dávid Hudák', 'Peter Pálenek | Tomáš Podhorný'],
    ['David Stanek | Dávid Hudák', 'Matej Varga | Tomáš Podhorný', 'Peter Pálenek | Peter Hladký'],
  ],
  Wilson: [
    ['Peter Laučík | Martin Bielik', 'Yurii Yumashev | Augusta Tobiášová', 'Jakub Paločný | Róbert Sloboda'],
    ['Yurii Yumashev | Artur Hlukhota', 'Peter Laučík | Augusta Tobiášová', 'Jakub Paločný | Martin Bielik'],
    ['Artur Hlukhota | Róbert Sloboda', 'Peter Laučík | Yurii Yumashev', 'Jakub Paločný | Augusta Tobiášová'],
    ['Peter Laučík | Artur Hlukhota', 'Róbert Sloboda | Martin Bielik', 'Jakub Paločný | Yurii Yumashev'],
    ['Artur Hlukhota | Martin Bielik', 'Jakub Paločný | Peter Laučík', 'Róbert Sloboda | Augusta Tobiášová'],
    ['Jakub Paločný | Artur Hlukhota', 'Martin Bielik | Augusta Tobiášová', 'Róbert Sloboda | Yurii Yumashev'],
    ['Artur Hlukhota | Augusta Tobiášová', 'Martin Bielik | Yurii Yumashev', 'Peter Laučík | Róbert Sloboda'],
  ],
  Yonex: [
    ['Ján Szalai | Lukáš Hanus', 'Michael Dojčan | Tomáš Krjak', 'Stanislav Mihalovič | Pavol Blahut'],
    ['Ján Szalai | Braňo Ivan', 'Stanislav Mihalovič | Lukáš Hanus', 'Michael Dojčan | Pavol Blahut'],
    ['Braňo Ivan | Tomáš Krjak', 'Stanislav Mihalovič | Ján Szalai', 'Michael Dojčan | Lukáš Hanus'],
    ['Stanislav Mihalovič | Braňo Ivan', 'Tomáš Krjak | Pavol Blahut', 'Michael Dojčan | Ján Szalai'],
    ['Braňo Ivan | Pavol Blahut', 'Michael Dojčan | Stanislav Mihalovič', 'Tomáš Krjak | Lukáš Hanus'],
    ['Michael Dojčan | Braňo Ivan', 'Pavol Blahut | Lukáš Hanus', 'Tomáš Krjak | Ján Szalai'],
    ['Braňo Ivan | Lukáš Hanus', 'Pavol Blahut | Ján Szalai', 'Tomáš Krjak | Stanislav Mihalovič'],
  ],
  Asics: [
    ['Anna Goruskova | Juraj Urblík', 'Jozef Lukča | Jakub Matula', 'Ján Beňo | Andrey Stolyarchuk'],
    ['Ján Beňo | Andrej Pačuta', 'Jozef Lukča | Andrey Stolyarchuk', 'Anna Goruskova | Jakub Matula'],
    ['Andrej Pačuta | Juraj Urblík', 'Jozef Lukča | Ján Beňo', 'Anna Goruskova | Andrey Stolyarchuk'],
    ['Jozef Lukča | Andrej Pačuta', 'Juraj Urblík | Jakub Matula', 'Anna Goruskova | Ján Beňo'],
    ['Andrej Pačuta | Jakub Matula', 'Anna Goruskova | Jozef Lukča', 'Juraj Urblík | Andrey Stolyarchuk'],
    ['Anna Goruskova | Andrej Pačuta', 'Jakub Matula | Andrey Stolyarchuk', 'Juraj Urblík | Ján Beňo'],
    ['Andrej Pačuta | Andrey Stolyarchuk', 'Jakub Matula | Ján Beňo', 'Juraj Urblík | Jozef Lukča'],
  ],
  Prince: [
    ['Samuel Michalek | Filip Ujfalusi', 'Lukáš Böhm | Ľubomír Šimkovič', 'Tomáš Skukalík | Tomáš Demovič'],
    ['Samuel Michalek | Alan Almaksus', 'Tomáš Skukalík | Filip Ujfalusi', 'Lukáš Böhm | Tomáš Demovič'],
    ['Alan Almaksus | Ľubomír Šimkovič', 'Tomáš Skukalík | Samuel Michalek', 'Lukáš Böhm | Filip Ujfalusi'],
    ['Alan Almaksus | Tomáš Skukalík', 'Ľubomír Šimkovič | Tomáš Demovič', 'Lukáš Böhm | Samuel Michalek'],
    ['Alan Almaksus | Tomáš Demovič', 'Lukáš Böhm | Tomáš Skukalík', 'Ľubomír Šimkovič | Filip Ujfalusi'],
    ['Lukáš Böhm | Alan Almaksus', 'Tomáš Demovič | Filip Ujfalusi', 'Ľubomír Šimkovič | Samuel Michalek'],
    ['Alan Almaksus | Filip Ujfalusi', 'Tomáš Demovič | Samuel Michalek', 'Ľubomír Šimkovič | Tomáš Skukalík'],
  ],
  Slazenger: [
    ['Vladimír Ježek | Gabriel Koscelanský', 'Martin Hronček | Tomasz Szopinski', 'Peter Valach | Miroslav Špaček'],
    ['Vladimír Ježek | Bruno Pavličko', 'Peter Valach | Gabriel Koscelanský', 'Martin Hronček | Miroslav Špaček'],
    ['Bruno Pavličko | Tomasz Szopinski', 'Peter Valach | Vladimír Ježek', 'Martin Hronček | Gabriel Koscelanský'],
    ['Peter Valach | Bruno Pavličko', 'Tomasz Szopinski | Miroslav Špaček', 'Martin Hronček | Vladimír Ježek'],
    ['Bruno Pavličko | Miroslav Špaček', 'Martin Hronček | Peter Valach', 'Tomasz Szopinski | Gabriel Koscelanský'],
    ['Martin Hronček | Bruno Pavličko', 'Miroslav Špaček | Gabriel Koscelanský', 'Tomasz Szopinski | Vladimír Ježek'],
    ['Bruno Pavličko | Gabriel Koscelanský', 'Miroslav Špaček | Vladimír Ježek', 'Tomasz Szopinski | Peter Valach'],
  ],
  Technifibre: [
    ['Herman Prihunov | Tomáš Slávik', 'Radko Cíger | Radovan Šoltés', 'Jerry O’Neil | Stefan Dobrev'],
    ['Tomáš Slávik | Guillaume Raoux', 'Radovan Šoltés | Herman Prihunov', 'Jerry O’Neil | Radko Cíger'],
    ['Guillaume Raoux | Stefan Dobrev', 'Radovan Šoltés | Tomáš Slávik', 'Jerry O’Neil | Herman Prihunov'],
    ['Radovan Šoltés | Guillaume Raoux', 'Stefan Dobrev | Radko Cíger', 'Jerry O’Neil | Tomáš Slávik'],
    ['Guillaume Raoux | Radko Cíger', 'Jerry O’Neil | Radovan Šoltés', 'Herman Prihunov | Stefan Dobrev'],
    ['Jerry O’Neil | Guillaume Raoux', 'Herman Prihunov | Radko Cíger', 'Stefan Dobrev | Tomáš Slávik'],
    ['Guillaume Raoux | Herman Prihunov', 'Radko Cíger | Tomáš Slávik', 'Stefan Dobrev | Radovan Šoltés'],
  ],
  Solinco: [
    ['Tomáš Hadari | Ivan Belei', 'Peter Schmidt | Martin Szalay', 'Lukáš Obselka | Stano Kemen'],
    ['Aleksandr Piliptsevich | Tomáš Hadari', 'Peter Schmidt | Ivan Belei', 'Lukáš Obselka | Martin Szalay'],
    ['Aleksandr Piliptsevich | Stano Kemen', 'Peter Schmidt | Tomáš Hadari', 'Lukáš Obselka | Ivan Belei'],
    ['Peter Schmidt | Aleksandr Piliptsevich', 'Stano Kemen | Martin Szalay', 'Lukáš Obselka | Tomáš Hadari'],
    ['Aleksandr Piliptsevich | Martin Szalay', 'Lukáš Obselka | Peter Schmidt', 'Stano Kemen | Ivan Belei'],
    ['Lukáš Obselka | Aleksandr Piliptsevich', 'Martin Szalay | Ivan Belei', 'Stano Kemen | Tomáš Hadari'],
    ['Aleksandr Piliptsevich | Ivan Belei', 'Martin Szalay | Tomáš Hadari', 'Stano Kemen | Peter Schmidt'],
  ],
  Volkl: [
    ['Max BA | Vadim Zenkevich', 'Peter Bilkovič | Marek Drašar', 'Tomáš Kováčik | Patrik Matula'],
    ['Peter Bilkovič | Lukáš Hnilica', 'Tomáš Kováčik | Marek Drašar', 'Max BA | Patrik Matula'],
    ['Lukáš Hnilica | Vadim Zenkevich', 'Tomáš Kováčik | Peter Bilkovič', 'Max BA | Marek Drašar'],
    ['Tomáš Kováčik | Lukáš Hnilica', 'Vadim Zenkevich | Patrik Matula', 'Max BA | Peter Bilkovič'],
    ['Lukáš Hnilica | Patrik Matula', 'Max BA | Tomáš Kováčik', 'Vadim Zenkevich | Marek Drašar'],
    ['Max BA | Lukáš Hnilica', 'Patrik Matula | Marek Drašar', 'Vadim Zenkevich | Peter Bilkovič'],
    ['Lukáš Hnilica | Marek Drašar', 'Patrik Matula | Peter Bilkovič', 'Vadim Zenkevich | Tomáš Kováčik'],
  ],
};

function pairKey(text) {
  return text.split('|').map((n) => nameMatch.key(n)).sort().join('|');
}

// Sets the round of every existing group-stage match listed above. Returns { assigned, missing } (missing = listed pairs that
// have no match in the app; nothing is created for them).
function assignAutumn2026Rounds(db) {
  if (db.prepare('SELECT 1 FROM app_flags WHERE key = ?').get(FLAG)) return { skipped: true };
  const season = db.prepare('SELECT id FROM seasons WHERE slug = ?').get(SEASON_SLUG);
  if (!season) return { skipped: true };
  const players = new Map(db.prepare('SELECT id, name FROM players').all().map((p) => [p.id, p.name]));
  const setRound = db.prepare('UPDATE matches SET round = ? WHERE id = ? AND round IS NULL');
  let assigned = 0;
  const missing = [];
  db.exec('BEGIN');
  try {
    Object.entries(ROUNDS).forEach(([groupName, rounds]) => {
      const group = db.prepare('SELECT id FROM season_groups WHERE season_id = ? AND name = ? COLLATE NOCASE').get(season.id, groupName);
      if (!group) return;
      const open = db.prepare("SELECT id, player1_id, player2_id FROM matches WHERE group_id = ? AND COALESCE(stage, 'GROUP') = 'GROUP' AND round IS NULL ORDER BY id").all(group.id)
        .map((m) => ({ id: m.id, key: [players.get(m.player1_id), players.get(m.player2_id)].map((n) => nameMatch.key(n || '')).sort().join('|'), used: false }));
      rounds.forEach((pairs, i) => pairs.forEach((pair) => {
        const k = pairKey(pair);
        const match = open.find((m) => !m.used && m.key === k);
        if (!match) { missing.push(`${groupName} ${i + 1}. kolo: ${pair}`); return; }
        match.used = true;
        assigned += setRound.run(i + 1, match.id).changes;
      }));
    });
    // done for good only when the season really had these matches (a fresh database has none and tries again later)
    if (assigned > 0) db.prepare('INSERT OR IGNORE INTO app_flags (key) VALUES (?)').run(FLAG);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { assigned, missing };
}

module.exports = { assignAutumn2026Rounds, ROUNDS };
