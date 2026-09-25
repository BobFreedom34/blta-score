// CourtIQ — a Glicko-2 skill rating computed entirely from local match
// results, completely separate from the "BLTA GENERAL" ranking
// (ranking_overrides/ranking_snapshots in db.js), which is scraped from
// blta.sk and keyed by player name rather than computed here at all.
//
// Glicko-2 itself is pure win/loss — this adds one thing on top: a
// margin-of-victory (MOV) multiplier scales the *rating* component of each
// update (never deviation/volatility, which represent confidence, not
// margin) by how lopsided the score was, capped so a huge favorite blowing
// out a huge underdog can't run away with it. See MOV_WEIGHT/MOV_CAP below.
//
// This module is deliberately pure/stateless (every function takes the
// state it needs and returns the new state — no reads or writes of its
// own) so the exact same functions serve both:
//   - the live hook (routes/matches.js, right after a match finishes):
//     one match, updates two players from their current stored ratings.
//   - scripts/backfillCourtIQ.js: replays a player's ENTIRE finished-match
//     history from scratch, chronologically, through this same code.
// Keeping them on one shared implementation is what makes "re-run the
// backfill after tuning a constant" actually trustworthy — the live path
// can never quietly drift from what a full replay would produce.
//
// Path-dependence: like any Elo/Glicko system, correcting a match from
// months ago technically invalidates every rating computed after it. This
// module does not attempt a partial/incremental fix for that — see
// isAlreadyRated in the live hook (routes/matches.js) and
// scripts/backfillCourtIQ.js's own header comment. A correction to an
// already-rated match's score means re-running the backfill, same as
// tuning a constant.

// ---- Tunable constants -----------------------------------------------
// Every one of these can be changed and the backfill re-run safely (it
// always replays from scratch — see scripts/backfillCourtIQ.js).

const DEFAULT_RATING = 1500;
const DEFAULT_DEVIATION = 350; // maximum uncertainty — a brand-new player
const DEFAULT_VOLATILITY = 0.06;
const MAX_DEVIATION = 350; // inactivity widening (below) never exceeds this

// Glicko-2's own system constant — how much a single surprising result is
// allowed to move a player's volatility. 0.3–1.2 is the range Glickman's
// paper suggests; 0.5 is a reasonable, moderate default.
const TAU = 0.5;
const CONVERGENCE_EPSILON = 0.000001;
// Glicko-1 <-> Glicko-2 internal scale factor, from Glickman's paper —
// not really "tunable", it's a mathematical constant of the conversion.
const GLICKO2_SCALE = 173.7178;

// How much a lopsided score can amplify a rating change, and the ceiling
// on that amplification — see marginMultiplier below. 0 disables MOV
// entirely (pure win/loss Glicko-2); 0.5/1.5 means the most lopsided
// possible match earns at most 50% more rating movement than a nailbiter.
const MOV_WEIGHT = 0.5;
const MOV_CAP = 1.5;

// A player who hasn't played in this many days has their deviation widen
// by one full Glicko-2 "no games this period" step (see applyInactivity)
// for each additional period that's elapsed since their last match, up to
// MAX_DEVIATION.
const INACTIVITY_PERIOD_DAYS = 30;

// CourtIQ (NTRP-style 1.0–7.0) band mapping — see ratingToBand below.
const BAND_CENTER_RATING = DEFAULT_RATING;
const BAND_CENTER = 4.0;
const BAND_POINTS_PER_STEP = 200;
const BAND_MIN = 1.0;
const BAND_MAX = 7.0;

// A player shows as "provisional" (see isProvisional) until both of these
// are satisfied — few enough games or too little play history yet that the
// number isn't trustworthy as a fixed rating.
const PROVISIONAL_DEVIATION_THRESHOLD = 100;
const PROVISIONAL_GAMES_THRESHOLD = 5;

// ---- Glicko-2 core ------------------------------------------------------

function toGlicko2Scale(rating, deviation) {
  return { mu: (rating - DEFAULT_RATING) / GLICKO2_SCALE, phi: deviation / GLICKO2_SCALE };
}

function fromGlicko2Scale(mu, phi) {
  return { rating: mu * GLICKO2_SCALE + DEFAULT_RATING, deviation: phi * GLICKO2_SCALE };
}

function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expectedScore(mu, opponentMu, opponentPhi) {
  return 1 / (1 + Math.exp(-g(opponentPhi) * (mu - opponentMu)));
}

// Solves for the new volatility via the Illinois algorithm (regula falsi
// variant), exactly as specified in Glickman's Glicko-2 paper — the one
// genuinely fiddly part of Glicko-2, kept as close to the reference
// algorithm as possible rather than simplified, since small deviations
// here are easy to get subtly wrong.
function newVolatility(phi, v, delta, sigma) {
  const a = Math.log(sigma * sigma);
  const f = (x) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * (phi * phi + v + ex) * (phi * phi + v + ex);
    return num / den - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k += 1;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > CONVERGENCE_EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

// How much a lopsided score amplifies the rating (never deviation/
// volatility) component of an update. games margin is normalized 0..1 —
// e.g. a 6-0 6-0 sweep is closer to 1 than a 7-6 7-6 squeaker.
function marginMultiplier(winnerGames, loserGames) {
  const total = winnerGames + loserGames;
  if (total <= 0) return 1;
  const marginSignal = (winnerGames - loserGames) / total;
  return Math.min(MOV_CAP, 1 + MOV_WEIGHT * marginSignal);
}

// Turns a match's raw per-set scores (matchEngine.js's state.sets) into a
// single {winnerGames, loserGames} pair for marginMultiplier above — every
// ordinary set counts by its own game score (e.g. 6-2), but a
// super-tiebreak set (set.isSuperTiebreak — used to decide a match instead
// of playing a full final set) replaces a whole set with a single
// tiebreak, so its raw points (e.g. 10-7) aren't on the same scale as a
// game count. It's counted as exactly one game-equivalent for whichever
// side won it, keeping every set on the same unit. An incomplete set
// (set.winner == null — can happen on a WALKOVER/RETIREMENT/UNFINISHED
// match) is skipped, not counted as 0-0.
function gameMarginFromSets(sets, winner) {
  let p1 = 0;
  let p2 = 0;
  (sets || []).forEach((set) => {
    if (!set || set.winner == null) return;
    if (set.isSuperTiebreak) {
      if (set.winner === 1) p1 += 1; else p2 += 1;
    } else {
      p1 += set.p1 || 0;
      p2 += set.p2 || 0;
    }
  });
  return winner === 1 ? { winnerGames: p1, loserGames: p2 } : { winnerGames: p2, loserGames: p1 };
}

// One player's Glicko-2 update from a single match against one opponent —
// "rating period" is this one match, not a calendar window (see the file
// header). `score` is 1 for a win, 0 for a loss. Returns the player's new
// {rating, deviation, volatility}; does not touch the opponent.
function updateRating(player, opponent, score, movMultiplier) {
  const { mu, phi } = toGlicko2Scale(player.rating, player.deviation);
  const { mu: muJ, phi: phiJ } = toGlicko2Scale(opponent.rating, opponent.deviation);

  const gPhiJ = g(phiJ);
  const e = expectedScore(mu, muJ, phiJ);
  const v = 1 / (gPhiJ * gPhiJ * e * (1 - e));
  const delta = v * gPhiJ * (score - e);

  const sigmaPrime = newVolatility(phi, v, delta, player.volatility);
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  // MOV only scales the rating movement itself, applied on the Glicko-2
  // internal (mu) scale before converting back — deviation/volatility are
  // pure Glicko-2, unaffected by how lopsided the score was.
  const muPrime = mu + phiPrime * phiPrime * gPhiJ * (score - e) * movMultiplier;

  const { rating, deviation } = fromGlicko2Scale(muPrime, phiPrime);
  return { rating, deviation, volatility: sigmaPrime };
}

// The Glicko-2 "player sat out this many periods" step — deviation widens
// (uncertainty grows) with no change to rating or volatility, capped at
// MAX_DEVIATION so a years-inactive player doesn't end up with an
// unbounded number. periods is how many INACTIVITY_PERIOD_DAYS windows
// elapsed since this player's last rated match (0 = no widening).
function applyInactivity(player, periods) {
  if (periods <= 0) return player;
  const { mu, phi } = toGlicko2Scale(player.rating, player.deviation);
  let widenedPhi = phi;
  for (let i = 0; i < periods; i += 1) {
    widenedPhi = Math.sqrt(widenedPhi * widenedPhi + player.volatility * player.volatility);
    if (widenedPhi * GLICKO2_SCALE >= MAX_DEVIATION) {
      widenedPhi = MAX_DEVIATION / GLICKO2_SCALE;
      break;
    }
  }
  const { deviation } = fromGlicko2Scale(mu, widenedPhi);
  return { ...player, deviation };
}

function periodsSince(lastMatchAt, matchDate) {
  if (!lastMatchAt) return 0;
  const days = (new Date(matchDate) - new Date(lastMatchAt)) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.floor(days / INACTIVITY_PERIOD_DAYS));
}

// The full update for one finished match — both players, in one call, so
// neither the live hook nor the backfill can accidentally update only one
// side. `sets` is the match's raw state.sets (see gameMarginFromSets).
// `matchDate` is the match's own chronological timestamp (used for
// inactivity widening), not "now". Returns
// {player1: {...ratingState}, player2: {...ratingState}}, each a complete
// {rating, deviation, volatility} ready to store — inactivity widening
// already folded in before the game update itself.
function processMatch({
  player1, player2, winner, sets, matchDate,
}) {
  const p1 = applyInactivity(player1, periodsSince(player1.lastMatchAt, matchDate));
  const p2 = applyInactivity(player2, periodsSince(player2.lastMatchAt, matchDate));

  const { winnerGames, loserGames } = gameMarginFromSets(sets, winner);
  const mov = marginMultiplier(winnerGames, loserGames);

  const score1 = winner === 1 ? 1 : 0;
  const score2 = winner === 2 ? 1 : 0;
  return {
    player1: updateRating(p1, p2, score1, mov),
    player2: updateRating(p2, p1, score2, mov),
  };
}

// ---- CourtIQ band mapping ------------------------------------------------

function ratingToBand(rating) {
  const raw = BAND_CENTER + (rating - BAND_CENTER_RATING) / BAND_POINTS_PER_STEP;
  return Math.min(BAND_MAX, Math.max(BAND_MIN, raw));
}

function isProvisional(deviation, gamesPlayed) {
  return deviation > PROVISIONAL_DEVIATION_THRESHOLD || gamesPlayed < PROVISIONAL_GAMES_THRESHOLD;
}

function defaultRatingState() {
  return { rating: DEFAULT_RATING, deviation: DEFAULT_DEVIATION, volatility: DEFAULT_VOLATILITY };
}

module.exports = {
  processMatch,
  marginMultiplier,
  applyInactivity,
  periodsSince,
  ratingToBand,
  isProvisional,
  defaultRatingState,
  DEFAULT_RATING,
  DEFAULT_DEVIATION,
  DEFAULT_VOLATILITY,
  INACTIVITY_PERIOD_DAYS,
};
