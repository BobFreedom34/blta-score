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

// One-off: the two lists the seed made are linked to the seasons they are about (by the name of the season, since the title of the list differs). Runs once
// (flag in app_flags); a list is linked only when it is still linked to nothing, exactly one season has that name and no other list is linked to it.
// The winners are then edited in the last tab of that season (and shown at the end of its page). Returns what it linked.
const LINKS = [
  { edition: 'BLTA Winter Series 2026', season: 'Winter Opening Series 2026' },
  { edition: 'BLTA nultý ročník 2025', season: 'BLTA Nultý Ročník' },
];
const LINK_FLAG = 'winners_linked_to_seasons';
function linkOlderEditions(db) {
  if (db.prepare('SELECT 1 FROM app_flags WHERE key = ?').get(LINK_FLAG)) return { skipped: true };
  const linked = [];
  LINKS.forEach((link) => {
    const editions = db.prepare('SELECT id, season_id FROM winner_editions WHERE LOWER(title) = LOWER(?)').all(link.edition);
    const seasons = db.prepare('SELECT id FROM seasons WHERE LOWER(name) = LOWER(?)').all(link.season);
    if (editions.length !== 1 || editions[0].season_id || seasons.length !== 1) return;
    if (db.prepare('SELECT 1 FROM winner_editions WHERE season_id = ?').get(seasons[0].id)) return;
    db.prepare('UPDATE winner_editions SET season_id = ? WHERE id = ?').run(seasons[0].id, editions[0].id);
    linked.push(link.edition);
  });
  db.prepare('INSERT OR IGNORE INTO app_flags (key) VALUES (?)').run(LINK_FLAG);
  return { linked };
}

module.exports = { seedWinners, linkOlderEditions };
