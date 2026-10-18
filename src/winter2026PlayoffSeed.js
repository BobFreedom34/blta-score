// One-off: the play-off brackets of the Winter Opening Series 2026 (Elite 16, Next Gen 8, Novice 8 players) with all their results. They were
// played on Rankedin and shown on the old blta.sk (src/winter2026PlayoffData.json holds the three draws as they were). The work is done by
// playoffImport.js; this only says which data and under which flag.
const { importPlayoffs } = require('./playoffImport');
const DATA = require('./winter2026PlayoffData.json');

const TITLES = { ELITE: 'Elite Play-off', NEXT_GEN: 'Next Gen Play-off', NOVICE: 'Novice Play-off' };

function seedWinter2026Playoffs(db, log) {
  return importPlayoffs(db, { flag: 'winter_2026_playoffs_seeded', label: 'Winter 2026 play-offs', data: DATA, titles: TITLES }, log);
}

module.exports = { seedWinter2026Playoffs };
