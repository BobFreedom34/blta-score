// One-off: the winners blta.sk lists on https://www.blta.sk/vitazi/ (2026-10-07), so the app's winners page starts with the
// same content. Runs once (flag in app_flags); after that the winners are managed in Backend > Winners and are never
// re-created or overwritten, even if an admin deletes them. Photos are not imported.
const nameMatch = require('./nameMatch');

// names in slot order: winner, finalist, semifinalist, semifinalist
const EDITIONS = [
  {
    title: 'BLTA Winter Series 2026',
    blocks: [
      { category: 'ELITE', names: ['Róbert Sloboda', 'Branislav Ivan', 'Pavol Piroha', 'Pavol Blahut'] },
      { category: 'NEXT_GEN', names: ['Peter Bicko', 'Artur Hlukhota', 'Yurii Yumashev', 'Volodymyr Sadykov'] },
      { category: 'NOVICE', names: ['Ján Beňo', 'Radko Cíger', 'Ladislav Nagy', 'Juraj Urblík'] },
    ],
  },
  {
    title: 'BLTA nultý ročník 2025',
    blocks: [
      { category: null, blockTitle: 'Konečné poradie', names: ['Róbert Sloboda', 'Pavol Piroha', 'Tomáš Podhorný', 'Michal Bori'] },
    ],
  },
];

function seedWinners(db) {
  if (db.prepare("SELECT 1 FROM app_flags WHERE key = 'winners_seeded'").get()) return { skipped: true };
  const players = db.prepare('SELECT id, name FROM players').all();
  const seasons = db.prepare('SELECT id, name FROM seasons').all();
  const insertEdition = db.prepare('INSERT INTO winner_editions (title, season_id, sort_order) VALUES (?, ?, ?)');
  const insertBlock = db.prepare('INSERT INTO winner_blocks (edition_id, category, title, sort_order) VALUES (?, ?, ?, ?)');
  const insertPlace = db.prepare('INSERT INTO winner_places (block_id, slot, player_id, name) VALUES (?, ?, ?, ?)');
  db.exec('BEGIN');
  try {
    EDITIONS.forEach((edition, editionIndex) => {
      // a season is linked only when exactly one has this very name (case aside); the admin links the rest
      const sameName = seasons.filter((s) => String(s.name).toLowerCase() === edition.title.toLowerCase());
      const seasonId = sameName.length === 1 ? sameName[0].id : null;
      const editionId = Number(insertEdition.run(edition.title, seasonId, editionIndex).lastInsertRowid);
      edition.blocks.forEach((block, blockIndex) => {
        const blockId = Number(insertBlock.run(editionId, block.category, block.blockTitle || '', blockIndex).lastInsertRowid);
        block.names.forEach((typed, i) => {
          const match = nameMatch.findSimilar(typed, players).exact;
          insertPlace.run(blockId, i + 1, match ? match.id : null, match ? match.name : typed);
        });
      });
    });
    db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('winners_seeded')").run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { editions: EDITIONS.length };
}

module.exports = { seedWinners };
