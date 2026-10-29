// Komunity a kluby (communities and clubs): the helpers of src/routes/communities.js - slugs, who is a member and what a client is told about an
// organisation. A club admin is NOT an admin of the site (auth.isAdmin stays false for him): everything here is about one organisation only.
const db = require('./db');
const auth = require('./auth');

const REREQUEST_DAYS = 7;
// the first part of an address under /api/communities that is a route of its own: no organisation may get it as its slug
const RESERVED_SLUGS = new Set(['mine', 'act-as']);

function slugify(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'community';
}

// the address of an organisation: its name without diacritics, unique among all (a twin gets -2, -3 ...)
function slugFor(name, exceptId) {
  const base = slugify(name);
  let slug = base;
  let n = 2;
  while (true) {
    const row = db.prepare('SELECT id FROM organisations WHERE slug = ?').get(slug);
    if (!RESERVED_SLUGS.has(slug) && (!row || row.id === exceptId)) return slug;
    slug = `${base}-${n}`;
    n += 1;
  }
}

const cityName = (leagueId) => (db.prepare('SELECT name FROM leagues WHERE id = ?').get(leagueId) || {}).name || '';

function memberOf(orgId, playerId) {
  if (!orgId || !playerId) return undefined;
  return db.prepare('SELECT role, status, joined_at, decided_at FROM organisation_members WHERE organisation_id = ? AND player_id = ?').get(orgId, playerId);
}

// an ACTIVE member with the role ADMIN (a pending or rejected request, or a plain member, is not)
function isOrgAdmin(orgId, playerId) {
  const m = memberOf(orgId, playerId);
  return !!m && m.status === 'ACTIVE' && m.role === 'ADMIN';
}

function memberCount(orgId) {
  return db.prepare("SELECT COUNT(*) AS n FROM organisation_members m JOIN players p ON p.id = m.player_id WHERE m.organisation_id = ? AND m.status = 'ACTIVE'").get(orgId).n;
}

// when a rejected request may be sent again (an ISO time in the future), else null
function canRequestAgainAt(m) {
  if (!m || m.status !== 'REJECTED' || !m.decided_at) return null;
  const at = new Date(new Date(m.decided_at).getTime() + REREQUEST_DAYS * 86400000);
  return at.getTime() > Date.now() ? at.toISOString() : null;
}

// the organisation as every client sees it; me = what the visitor is to it (null when not a logged-in player)
function serialize(row, req) {
  const playerId = req ? auth.getPlayerId(req) : null;
  let me = null;
  if (playerId) {
    const m = memberOf(row.id, playerId);
    const active = m && m.status === 'ACTIVE';
    me = {
      status: m && (m.status === 'ACTIVE' || m.status === 'PENDING') ? m.status : null,
      role: active ? m.role : null,
      canRequestAgainAt: canRequestAgainAt(m),
    };
  }
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    name: row.name,
    description: row.description || '',
    contact: row.contact || '',
    logoUrl: row.logo_url || '',
    coverUrl: row.cover_url || '',
    joinPolicy: row.join_policy,
    leagueId: row.league_id,
    city: cityName(row.league_id),
    hidden: !!row.hidden,
    approved: !!row.approved,
    countsForRating: !!row.counts_for_rating,
    maxOpenTournaments: row.max_open_tournaments || 5,
    memberCount: memberCount(row.id),
    createdAt: row.created_at,
    me,
  };
}

// an admin of the site over this organisation: the super admin, or the admin of the city it belongs to
function siteAdminFor(req, org) {
  const me = auth.adminSession(req);
  return !!me && (me.role === 'SUPER' || me.leagueId === org.league_id);
}

// who may read an organisation: everybody when it is public; a hidden one (moderation) only an admin of the site; a club that is not approved yet only
// its own admins and the admins of the site
function canRead(req, org) {
  const siteAdmin = siteAdminFor(req, org);
  if (org.hidden) return siteAdmin;
  if (org.approved) return true;
  const playerId = auth.getPlayerId(req);
  return siteAdmin || (!!playerId && isOrgAdmin(org.id, playerId));
}

// the organisation the logged-in player is acting as (the club profile he switched to), or null: the cookie must name an organisation that exists, is
// not hidden and is still run by this very player
function actingOrganisation(req) {
  const orgId = auth.getActingOrgId(req);
  const playerId = auth.getPlayerId(req);
  if (!orgId || !playerId) return null;
  const org = db.prepare('SELECT * FROM organisations WHERE id = ? AND hidden = 0').get(orgId);
  return org && isOrgAdmin(org.id, playerId) ? org : null;
}

module.exports = { siteAdminFor, canRead, actingOrganisation, REREQUEST_DAYS, slugify, slugFor, memberOf, isOrgAdmin, memberCount, canRequestAgainAt, serialize };
