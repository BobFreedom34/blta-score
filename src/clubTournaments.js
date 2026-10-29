// Tournaments of communities and clubs (phase 2). A club tournament is an ordinary tournament season with an organisation_id; the per-tournament routes keep
// working for the admins of the site and also accept the ADMIN of the owning club, through the two functions here. A club admin is never a site admin:
// every route that is not given requireSeasonManager stays requireAdmin.
const db = require('./db');
const auth = require('./auth');
const communities = require('./communities');

// a community or club the public may see: not hidden and, for a club, approved by the super admin
const isPublicOrg = (org) => !!org && !org.hidden && !!org.approved;

const organisationOf = (season) => (season && season.organisation_id ? db.prepare('SELECT * FROM organisations WHERE id = ?').get(season.organisation_id) : undefined);

// the organisation of a season as the public may see it: { id, slug, name } for a tournament of a public club, null for every other season;
// `hidden` is true for a club tournament whose club is hidden or not (any more) approved - such a tournament is not shown anywhere
function publicFace(season) {
  if (!season || !season.organisation_id) return { organisation: null, hidden: false };
  const org = organisationOf(season);
  if (!isPublicOrg(org)) return { organisation: null, hidden: true };
  return { organisation: { id: org.id, slug: org.slug, name: org.name }, hidden: false };
}

// may this request manage this season? An admin of the site, or - for a club tournament of a public organisation - an ACTIVE admin of that organisation
// (checked on every request: a demoted admin, a hidden club or a withdrawn approval end it at once)
function canManageSeason(req, season) {
  if (!season) return false;
  if (auth.isAdmin(req)) return true;
  const org = organisationOf(season);
  if (!isPublicOrg(org)) return false;
  const playerId = auth.getPlayerId(req);
  return !!playerId && communities.isOrgAdmin(org.id, playerId);
}

// A replacement for requireAdmin on a per-tournament route. resolve(req) finds the season the request is about. Anybody who may not manage it gets the
// answer requireAdmin always gave (401), so nothing changes for the callers that were refused before. An admin of the site goes straight through (the
// handler does its own 404 for an id that is not there).
function requireSeasonManager(resolve) {
  return (req, res, next) => {
    if (auth.isAdmin(req)) return next();
    const season = resolve(req);
    if (!canManageSeason(req, season)) return res.status(401).json({ error: 'Admin login required for this action' });
    req.managedSeason = season;
    next();
  };
}

// how many tournaments of an organisation are open: the end date is empty or not past
function openTournamentCount(orgId) {
  return db.prepare("SELECT COUNT(*) AS n FROM seasons WHERE organisation_id = ? AND kind = 'TOURNAMENT' AND (end_date IS NULL OR end_date = '' OR end_date >= date('now'))").get(orgId).n;
}

// The rating gate. A match of a club tournament moves no rating (CourtIQ, the doubles rating, ranking points, badges) unless the super admin has switched
// the club to counts_for_rating: a result entered by the organiser is not checked by anybody. Everything else counts as always.
function matchCountsForRating(row) {
  if (!row || !row.season_id) return true;
  const org = db.prepare('SELECT o.counts_for_rating AS counts FROM seasons s JOIN organisations o ON o.id = s.organisation_id WHERE s.id = ?').get(row.season_id);
  return !org || !!org.counts;
}

// the same as a piece of SQL for the queries that gather matches for a rating or a badge (alias = the alias of the matches table, if it has one)
function countingSql(alias) {
  const column = alias ? `${alias}.season_id` : 'season_id';
  return `(${column} IS NULL OR ${column} NOT IN (SELECT s.id FROM seasons s JOIN organisations o ON o.id = s.organisation_id WHERE o.counts_for_rating = 0))`;
}

// The matches of the tournaments of communities and clubs stay out of the league's own lists (matches page, home page, highlights): this is the SQL that
// leaves them out (alias = the alias of the matches table, if it has one). Their own tournament page lists them.
function leagueOnlySql(alias) {
  const column = alias ? `${alias}.season_id` : 'season_id';
  return `(${column} IS NULL OR ${column} NOT IN (SELECT s.id FROM seasons s WHERE s.organisation_id IS NOT NULL))`;
}

// ---- resolvers: which season is a request about (each returns a season row, or null/undefined when there is none or the ids do not belong together) ----
const seasonById = (id) => (/^\d+$/.test(String(id)) ? db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(id)) : undefined);
const byParamId = (req) => seasonById(req.params.id);
const byGroupId = (req) => {
  const group = /^\d+$/.test(String(req.params.groupId)) ? db.prepare('SELECT season_id FROM season_groups WHERE id = ?').get(Number(req.params.groupId)) : undefined;
  return group ? seasonById(group.season_id) : undefined;
};
const byRegistrationId = (req) => {
  const reg = /^\d+$/.test(String(req.params.rid)) ? db.prepare('SELECT season_id FROM season_registrations WHERE id = ?').get(Number(req.params.rid)) : undefined;
  return reg ? seasonById(reg.season_id) : undefined;
};
// a pair or a match named next to the season in the address must belong to THAT season (one that is not there at all is left to the handler's own 404)
const byIdAndPairId = (req) => {
  const season = seasonById(req.params.id);
  const pair = season && /^\d+$/.test(String(req.params.pairId)) ? db.prepare('SELECT season_id FROM tournament_pairs WHERE id = ?').get(Number(req.params.pairId)) : undefined;
  return !season || (pair && pair.season_id !== season.id) ? undefined : season;
};
const byIdAndMatchToken = (req) => {
  const season = seasonById(req.params.id);
  const match = season ? db.prepare('SELECT season_id FROM matches WHERE share_token = ?').get(String(req.params.token)) : undefined;
  return !season || (match && match.season_id !== season.id) ? undefined : season;
};

// a bracket belongs to a season (or to none: then only an admin may touch it); a new bracket names its season in the body
const byBracketId = (req) => {
  const bracket = /^\d+$/.test(String(req.params.id)) ? db.prepare('SELECT season_id FROM brackets WHERE id = ?').get(Number(req.params.id)) : undefined;
  return bracket && bracket.season_id ? seasonById(bracket.season_id) : undefined;
};
const byBodySeasonId = (req) => seasonById(req.body && req.body.seasonId);

module.exports = { publicFace, matchCountsForRating, countingSql, leagueOnlySql, byBracketId, byBodySeasonId, byParamId, byGroupId, byRegistrationId, byIdAndPairId, byIdAndMatchToken, isPublicOrg, organisationOf, canManageSeason, requireSeasonManager, openTournamentCount };
