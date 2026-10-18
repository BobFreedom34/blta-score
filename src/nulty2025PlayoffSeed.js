// One-off: the play-off bracket of BLTA Nultý Ročník (2025: one common category, played as Elite; 16 players) with all its results. It was
// played on Rankedin and shown on the old blta.sk (src/nulty2025PlayoffData.json holds the draw as it was; it was drawn by lot, without seeds).
// The work is done by playoffImport.js; this only says which data and under which flag.
const { importPlayoffs } = require('./playoffImport');
const DATA = require('./nulty2025PlayoffData.json');

function seedNulty2025Playoffs(db, log) {
  return importPlayoffs(db, { flag: 'nulty_2025_playoffs_seeded', label: 'Nultý ročník play-off', data: DATA, titles: { ELITE: 'Elite Play-off' } }, log);
}

module.exports = { seedNulty2025Playoffs };
