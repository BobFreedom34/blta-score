// The places a losers bracket plays for, in words (no database here, so a check can use it alone).
// A losers bracket whose entrants fill the places start … start + count - 1: a bracket of two plays for one place ("O 3. miesto"), a bigger one for a range
// ("O 5. – 8. miesto"). The losers brackets of a Monrad draw are named so instead of "Útecha po 1. kole" (see bracketEngine.buildLosers, monradNames.js).
function placeLabel(start, count) {
  return count <= 2 ? `O ${start}. miesto` : `O ${start}. – ${start + count - 1}. miesto`;
}

// the rounds of a bracket of this size (a power of two)
const roundsOf = (size) => Math.log2(size);

module.exports = { placeLabel, roundsOf };
