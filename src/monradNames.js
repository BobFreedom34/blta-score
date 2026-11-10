// The losers brackets of a Monrad draw used to be called "Útecha po 1. kole", "Útecha po 1. kole › po 1. kole" … (the round they are fed from), which does not say what the
// players play for. They are now named by the places they decide ("O 5. – 8. miesto", "O 3. miesto"), see bracketPlaces.placeLabel. This renames the ones made before:
// the places follow from the structure (the losers of round r of a bracket whose best place is `start` are left with the places after the 2^(rounds - r) players who
// got through that round, as many places as the bracket has entrants). Runs at every start and touches only a bracket that still has an old name.
const { placeLabel, roundsOf } = require('./bracketPlaces'); // (no database of its own: the caller hands one in)

const OLD_NAME = /Útecha po \d+\. kole|› po \d+\. kole/;

function run(db) {
  const old = db.prepare("SELECT id FROM brackets WHERE kind = 'CONSOLATION'").all().map((r) => r.id)
    .filter((id) => OLD_NAME.test(db.prepare('SELECT name FROM brackets WHERE id = ?').get(id).name));
  if (!old.length) return 0;
  const get = db.prepare('SELECT * FROM brackets WHERE id = ?');
  const entrants = db.prepare('SELECT COUNT(*) AS n FROM bracket_matches WHERE loser_bracket_id = ?');
  const rename = db.prepare('UPDATE brackets SET name = ? WHERE id = ?');
  // the best place of a bracket: 1 for a main bracket, else the one of its parent plus the 2^(rounds - round) who got through the round that feeds it
  const startOf = (bracket) => {
    if (!bracket.parent_bracket_id || !bracket.feeds_round) return 1;
    const parent = get.get(bracket.parent_bracket_id);
    if (!parent) return 1;
    return startOf(parent) + 2 ** (roundsOf(parent.size) - bracket.feeds_round);
  };
  let renamed = 0;
  old.forEach((id) => {
    const b = get.get(id);
    const count = entrants.get(id).n;
    if (!b.parent_bracket_id || !b.feeds_round || count < 2) return; // (made before the structure was stored: left as it is)
    const prefix = b.name.split(/\s+—\s+Útecha/)[0];
    rename.run(`${prefix} — ${placeLabel(startOf(b), count)}`, id);
    renamed += 1;
  });
  return renamed;
}

module.exports = { run };
