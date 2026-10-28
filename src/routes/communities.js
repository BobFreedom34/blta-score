// Komunity a kluby (communities and clubs): any logged-in player can create one; its admins run it (members, news, pictures, settings).
// See docs/superpowers/specs/2026-10-28-communities-and-clubs-design.md. The routes of one organisation are addressed by its id; the
// public page and the detail are addressed by its slug. A club admin has no admin rights anywhere else (auth.isAdmin is not involved).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const auth = require('../auth');
const leagues = require('../leagues');
const communities = require('../communities');
const courtIQ = require('../courtIQEngine');

const router = express.Router();
const { serialize, slugFor, isOrgAdmin } = communities;

const TYPES = ['CLUB', 'COMMUNITY'];
const POLICIES = ['OPEN', 'APPROVAL'];
const MAX_PER_DAY = 3;

const tidy = (value) => String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();

// the fields a creator or an admin writes; `current` (an organisation row) is what an update starts from
function readFields(body, current) {
  const out = {};
  if (current === undefined || body.name !== undefined) {
    const name = tidy(body.name);
    if (!name) return { error: 'The name is required' };
    if (name.length > 120) return { error: 'The name is too long (max 120 characters)' };
    out.name = name;
  }
  if (current === undefined || body.description !== undefined) {
    const description = String(body.description || '').trim();
    if (description.length > 2000) return { error: 'The description is too long (max 2000 characters)' };
    out.description = description;
  }
  if (current === undefined || body.contact !== undefined) {
    const contact = tidy(body.contact);
    if (contact.length > 200) return { error: 'The contact is too long (max 200 characters)' };
    out.contact = contact;
  }
  if (body.joinPolicy !== undefined) {
    if (!POLICIES.includes(body.joinPolicy)) return { error: 'Joining is OPEN (anyone) or APPROVAL (on approval)' };
    out.joinPolicy = body.joinPolicy;
  }
  return { fields: out };
}

function orgById(id) {
  return /^\d+$/.test(String(id)) ? db.prepare('SELECT * FROM organisations WHERE id = ?').get(Number(id)) : undefined;
}

// the organisation of an organisation route (its id is the :id of the address), or a 404. mode:
//   'read'   - what canRead says (a hidden one only for an admin of the site, a club that waits for approval only for its own admins and the site's);
//   'manage' - an action of the admins of the organisation: nothing can be done in a hidden one (not even by its own admins), a club that waits can be set up;
//   'join'   - a player joining: only a public one (not hidden, and a club only once approved).
function orgOr404(req, res, mode) {
  const org = orgById(req.params.id);
  const ok = org && (mode === 'join' ? !org.hidden && !!org.approved : mode === 'manage' ? !org.hidden && communities.canRead(req, org) : communities.canRead(req, org));
  if (!ok) {
    res.status(404).json({ error: 'Community not found' });
    return null;
  }
  return org;
}

// the player behind the request (null for a visitor); a club is made and run by players, never by an admin without a player identity
function needPlayer(req, res) {
  const playerId = auth.getPlayerId(req);
  if (!playerId) {
    res.status(401).json({ error: 'Please log in as a player to do this' });
    return null;
  }
  return playerId;
}

// the organisation of the address of an organisation route, and the player only if he is one of its admins
function needOrgAdmin(req, res) {
  const playerId = needPlayer(req, res);
  if (!playerId) return null;
  const org = orgOr404(req, res, 'manage');
  if (!org) return null;
  if (!isOrgAdmin(org.id, playerId)) {
    res.status(403).json({ error: 'Only an admin of this community or club can do this' });
    return null;
  }
  return { org, playerId };
}

router.get('/', (req, res) => {
  const leagueId = leagues.actingIdOf(req);
  // an admin may ask for the hidden ones too (the Backend page)
  const withHidden = req.query.includeHidden === '1' && auth.isAdmin(req);
  const viewer = auth.getPlayerId(req);
  // a club that waits for approval is listed for its own admins only
  const items = db.prepare(`SELECT * FROM organisations WHERE league_id = ?${withHidden ? '' : ' AND hidden = 0'}`).all(leagueId)
    .filter((row) => withHidden || row.approved || (viewer && isOrgAdmin(row.id, viewer)))
    .map((row) => serialize(row, req))
    .sort((a, b) => b.memberCount - a.memberCount || b.id - a.id);
  res.json({ items });
});

// the clubs and communities the logged-in player belongs to, and the one he is acting as (null = himself)
router.get('/mine', (req, res) => {
  const playerId = needPlayer(req, res);
  if (!playerId) return;
  const items = db.prepare(`
    SELECT o.* FROM organisations o JOIN organisation_members m ON m.organisation_id = o.id
    WHERE m.player_id = ? AND m.status = 'ACTIVE' AND o.hidden = 0 ORDER BY o.name COLLATE NOCASE
  `).all(playerId).map((row) => serialize(row, req));
  const acting = communities.actingOrganisation(req);
  res.json({ items, acting: acting ? serialize(acting, req) : null });
});

// switch to the profile of a club he runs (organisationId) or back to himself (null)
router.post('/act-as', (req, res) => {
  const playerId = needPlayer(req, res);
  if (!playerId) return;
  const wanted = req.body.organisationId;
  if (wanted === null) {
    auth.clearActingOrg(res);
    return res.json({ acting: null });
  }
  if (!Number.isInteger(wanted) || wanted <= 0) return res.status(400).json({ error: 'organisationId must be a number or null' });
  const org = orgById(wanted);
  if (!org || org.hidden) return res.status(404).json({ error: 'Community not found' });
  if (!isOrgAdmin(org.id, playerId)) return res.status(403).json({ error: 'Only an admin of this community or club can act as it' });
  auth.setActingOrg(res, org.id);
  res.json({ acting: serialize(org, req) });
});

router.get('/:slug', (req, res) => {
  const org = db.prepare('SELECT * FROM organisations WHERE slug = ? AND league_id = ?').get(String(req.params.slug), leagues.actingIdOf(req));
  if (!org || !communities.canRead(req, org)) return res.status(404).json({ error: 'Community not found' });
  res.json(serialize(org, req));
});

router.post('/', (req, res) => {
  const playerId = needPlayer(req, res);
  if (!playerId) return;
  if (!TYPES.includes(req.body.type)) return res.status(400).json({ error: 'The type must be CLUB or COMMUNITY' });
  const read = readFields(req.body);
  if (read.error) return res.status(400).json({ error: read.error });
  const f = read.fields;
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const recent = db.prepare('SELECT COUNT(*) AS n FROM organisations WHERE created_by_player_id = ? AND created_at >= ?').get(playerId, since).n;
  if (recent >= MAX_PER_DAY) return res.status(429).json({ error: `You can create at most ${MAX_PER_DAY} communities or clubs per day` });
  const slug = slugFor(f.name);
  const leagueId = leagues.actingIdOf(req);
  let id;
  db.exec('BEGIN');
  try {
    const info = db.prepare('INSERT INTO organisations (league_id, type, name, slug, description, contact, join_policy, approved, created_by_player_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(leagueId, req.body.type, f.name, slug, f.description, f.contact, f.joinPolicy || 'OPEN', req.body.type === 'COMMUNITY' ? 1 : 0, playerId);
    id = Number(info.lastInsertRowid);
    db.prepare("INSERT INTO organisation_members (organisation_id, player_id, role, status) VALUES (?, ?, 'ADMIN', 'ACTIVE')").run(id, playerId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.status(201).json(serialize(orgById(id), req));
});

router.patch('/:id', (req, res) => {
  const ctx = needOrgAdmin(req, res);
  if (!ctx) return;
  const read = readFields(req.body, ctx.org);
  if (read.error) return res.status(400).json({ error: read.error });
  const f = read.fields;
  db.prepare('UPDATE organisations SET name = ?, description = ?, contact = ?, join_policy = ? WHERE id = ?')
    .run(f.name !== undefined ? f.name : ctx.org.name, f.description !== undefined ? f.description : ctx.org.description,
      f.contact !== undefined ? f.contact : ctx.org.contact, f.joinPolicy !== undefined ? f.joinPolicy : ctx.org.join_policy, ctx.org.id);
  res.json(serialize(orgById(ctx.org.id), req));
});

// ---------------- moderation ----------------

// an admin of the site (a city admin only for the organisations of his own city: src/cityScope.js) hides or shows an organisation; there is no
// approval before an organisation goes public, this is the way to take one down afterwards
router.patch('/:id/moderation', auth.requireAdmin, (req, res) => {
  const org = orgById(req.params.id);
  if (!org) return res.status(404).json({ error: 'Community not found' });
  if (typeof req.body.hidden !== 'boolean') return res.status(400).json({ error: 'hidden must be true or false' });
  db.prepare('UPDATE organisations SET hidden = ? WHERE id = ?').run(req.body.hidden ? 1 : 0, org.id);
  res.json(serialize(orgById(org.id), req));
});

// A community is public as soon as it is made; a CLUB waits until the super admin approves it (a city admin cannot): the Backend page lists the clubs that
// wait. Taking the approval back hides the club from the public again.
router.patch('/:id/approval', auth.requireSuperAdmin, (req, res) => {
  const org = orgById(req.params.id);
  if (!org) return res.status(404).json({ error: 'Community not found' });
  if (typeof req.body.approved !== 'boolean') return res.status(400).json({ error: 'approved must be true or false' });
  if (org.type !== 'CLUB') return res.status(400).json({ error: 'Only a club needs approval' });
  db.prepare('UPDATE organisations SET approved = ? WHERE id = ?').run(req.body.approved ? 1 : 0, org.id);
  res.json(serialize(orgById(org.id), req));
});

// ---------------- members and the join policy ----------------

const adminCount = (orgId) => db.prepare("SELECT COUNT(*) AS n FROM organisation_members m JOIN players p ON p.id = m.player_id WHERE m.organisation_id = ? AND m.status = 'ACTIVE' AND m.role = 'ADMIN'").get(orgId).n;
const nowIso = () => new Date().toISOString();

// a player asks to join (APPROVAL) or joins at once (OPEN); asking again is harmless, a rejected player waits REREQUEST_DAYS
router.post('/:id/join', (req, res) => {
  const playerId = needPlayer(req, res);
  if (!playerId) return;
  const org = orgOr404(req, res, 'join');
  if (!org) return;
  const m = communities.memberOf(org.id, playerId);
  if (m && (m.status === 'ACTIVE' || m.status === 'PENDING')) return res.json({ status: m.status });
  const wait = communities.canRequestAgainAt(m);
  if (wait) return res.status(409).json({ error: 'Your request was declined; you can ask again later', canRequestAgainAt: wait });
  const status = org.join_policy === 'OPEN' ? 'ACTIVE' : 'PENDING';
  if (m) db.prepare("UPDATE organisation_members SET status = ?, role = 'MEMBER', joined_at = ?, decided_at = NULL WHERE organisation_id = ? AND player_id = ?").run(status, nowIso(), org.id, playerId);
  else db.prepare("INSERT INTO organisation_members (organisation_id, player_id, role, status) VALUES (?, ?, 'MEMBER', ?)").run(org.id, playerId, status);
  res.json({ status });
});

router.post('/:id/cancel-request', (req, res) => {
  const playerId = needPlayer(req, res);
  if (!playerId) return;
  if (!orgOr404(req, res, 'manage')) return;
  const info = db.prepare("DELETE FROM organisation_members WHERE organisation_id = ? AND player_id = ? AND status = 'PENDING'").run(Number(req.params.id) || 0, playerId);
  if (!info.changes) return res.status(404).json({ error: 'You have no waiting request here' });
  res.json({ ok: true });
});

router.post('/:id/leave', (req, res) => {
  const playerId = needPlayer(req, res);
  if (!playerId) return;
  const org = orgOr404(req, res, 'manage');
  if (!org) return;
  const m = communities.memberOf(org.id, playerId);
  if (!m || m.status !== 'ACTIVE') return res.status(404).json({ error: 'You are not a member' });
  if (m.role === 'ADMIN' && adminCount(org.id) <= 1) return res.status(409).json({ error: 'You are the last admin: make another member an admin first' });
  db.prepare('DELETE FROM organisation_members WHERE organisation_id = ? AND player_id = ?').run(org.id, playerId);
  res.json({ ok: true });
});

// the member list is public; the waiting requests are shown to the admins of the organisation only
router.get('/:id/members', (req, res) => {
  const org = orgOr404(req, res, 'read');
  if (!org) return;
  const members = db.prepare(`
    SELECT m.player_id, m.role, m.joined_at, p.name, p.slug FROM organisation_members m JOIN players p ON p.id = m.player_id
    WHERE m.organisation_id = ? AND m.status = 'ACTIVE' ORDER BY (m.role = 'ADMIN') DESC, m.joined_at, p.name
  `).all(org.id).map((r) => ({ playerId: r.player_id, name: r.name, slug: r.slug, role: r.role, joinedAt: r.joined_at }));
  const viewer = auth.getPlayerId(req);
  let pending = [];
  if (viewer && isOrgAdmin(org.id, viewer)) {
    pending = db.prepare(`
      SELECT m.player_id, m.joined_at, p.name, p.slug, cr.rating FROM organisation_members m JOIN players p ON p.id = m.player_id
      LEFT JOIN courtiq_ratings cr ON cr.player_id = m.player_id
      WHERE m.organisation_id = ? AND m.status = 'PENDING' ORDER BY m.joined_at
    `).all(org.id).map((r) => ({
      playerId: r.player_id, name: r.name, slug: r.slug, requestedAt: r.joined_at,
      level: r.rating == null ? null : Number(courtIQ.ratingToBand(r.rating).toFixed(1)),
    }));
  }
  res.json({ members, pending });
});

function decide(status) {
  return (req, res) => {
    const ctx = needOrgAdmin(req, res);
    if (!ctx) return;
    const now = nowIso();
    const info = db.prepare("UPDATE organisation_members SET status = ?, decided_at = ?, joined_at = CASE WHEN ? = 'ACTIVE' THEN ? ELSE joined_at END WHERE organisation_id = ? AND player_id = ? AND status = 'PENDING'")
      .run(status, now, status, now, ctx.org.id, Number(req.params.playerId) || 0);
    if (!info.changes) return res.status(404).json({ error: 'There is no waiting request of this player' });
    res.json({ ok: true });
  };
}
router.post('/:id/members/:playerId/approve', decide('ACTIVE'));
router.post('/:id/members/:playerId/reject', decide('REJECTED'));

router.post('/:id/approve-all', (req, res) => {
  const ctx = needOrgAdmin(req, res);
  if (!ctx) return;
  const now = nowIso();
  const info = db.prepare("UPDATE organisation_members SET status = 'ACTIVE', decided_at = ?, joined_at = ? WHERE organisation_id = ? AND status = 'PENDING'").run(now, now, ctx.org.id);
  res.json({ ok: true, approved: Number(info.changes) });
});

router.patch('/:id/members/:playerId', (req, res) => {
  const ctx = needOrgAdmin(req, res);
  if (!ctx) return;
  if (!['ADMIN', 'MEMBER'].includes(req.body.role)) return res.status(400).json({ error: 'The role is ADMIN or MEMBER' });
  const target = communities.memberOf(ctx.org.id, Number(req.params.playerId) || 0);
  if (!target || target.status !== 'ACTIVE') return res.status(404).json({ error: 'Member not found' });
  if (target.role === 'ADMIN' && req.body.role === 'MEMBER' && adminCount(ctx.org.id) <= 1) return res.status(409).json({ error: 'This is the last admin: make another member an admin first' });
  db.prepare('UPDATE organisation_members SET role = ? WHERE organisation_id = ? AND player_id = ?').run(req.body.role, ctx.org.id, Number(req.params.playerId));
  res.json({ ok: true });
});

router.delete('/:id/members/:playerId', (req, res) => {
  const ctx = needOrgAdmin(req, res);
  if (!ctx) return;
  const target = communities.memberOf(ctx.org.id, Number(req.params.playerId) || 0);
  if (!target || target.status !== 'ACTIVE') return res.status(404).json({ error: 'Member not found' });
  if (target.role === 'ADMIN' && adminCount(ctx.org.id) <= 1) return res.status(409).json({ error: 'This is the last admin: make another member an admin first' });
  // not a plain delete: a removed member waits like a declined request, so a troublemaker cannot walk straight back in
  db.prepare("UPDATE organisation_members SET status = 'REJECTED', role = 'MEMBER', decided_at = ? WHERE organisation_id = ? AND player_id = ?").run(nowIso(), ctx.org.id, Number(req.params.playerId));
  res.json({ ok: true });
});

// ---------------- the news of an organisation ----------------

const POSTS_PAGE = 20;

// the news are public; the text is plain text (every page escapes it), newest first, POSTS_PAGE at a time (?before=<id> goes further back)
router.get('/:id/posts', (req, res) => {
  const org = orgOr404(req, res, 'read');
  if (!org) return;
  const before = /^\d+$/.test(String(req.query.before || '')) ? Number(req.query.before) : null;
  const rows = db.prepare(`
    SELECT po.id, po.body, po.author_player_id, po.created_at, p.name, p.slug FROM organisation_posts po LEFT JOIN players p ON p.id = po.author_player_id
    WHERE po.organisation_id = ? AND po.hidden = 0 ${before ? 'AND po.id < ?' : ''} ORDER BY po.id DESC LIMIT ${POSTS_PAGE + 1}
  `).all(...(before ? [org.id, before] : [org.id]));
  const viewer = auth.getPlayerId(req);
  const viewerAdmin = !!viewer && isOrgAdmin(org.id, viewer);
  const items = rows.slice(0, POSTS_PAGE).map((r) => ({
    id: r.id, body: r.body, authorName: r.name || '', authorSlug: r.slug || '', createdAt: r.created_at,
    canDelete: communities.siteAdminFor(req, org) || viewerAdmin || (!!viewer && r.author_player_id === viewer),
  }));
  res.json({ items, more: rows.length > POSTS_PAGE });
});

router.post('/:id/posts', (req, res) => {
  const ctx = needOrgAdmin(req, res);
  if (!ctx) return;
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write something first' });
  if (body.length > 2000) return res.status(400).json({ error: 'The text is too long (max 2000 characters)' });
  const info = db.prepare('INSERT INTO organisation_posts (organisation_id, author_player_id, body) VALUES (?, ?, ?)').run(ctx.org.id, ctx.playerId, body);
  const row = db.prepare('SELECT po.id, po.body, po.created_at, p.name, p.slug FROM organisation_posts po LEFT JOIN players p ON p.id = po.author_player_id WHERE po.id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json({ id: row.id, body: row.body, authorName: row.name || '', authorSlug: row.slug || '', createdAt: row.created_at, canDelete: true });
});

// the author, an admin of the organisation or an admin of the site
router.delete('/:id/posts/:postId', (req, res) => {
  const org = orgOr404(req, res, 'manage');
  if (!org) return;
  const post = /^\d+$/.test(req.params.postId) ? db.prepare('SELECT * FROM organisation_posts WHERE id = ? AND organisation_id = ?').get(Number(req.params.postId), org.id) : null;
  const viewer = auth.getPlayerId(req);
  if (!viewer && !communities.siteAdminFor(req, org)) return res.status(401).json({ error: 'Please log in to do this' });
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (!communities.siteAdminFor(req, org) && !isOrgAdmin(org.id, viewer) && post.author_player_id !== viewer) return res.status(403).json({ error: 'Only the author or an admin of this community can delete a post' });
  db.prepare('DELETE FROM organisation_posts WHERE id = ?').run(post.id);
  res.json({ ok: true });
});

// ---------------- the logo and the cover ----------------

// Pictures live on the persistent disk (not under public/, which is replaced on every deploy), like the photos of the venues. Only a file this router
// wrote (its address starts with /community-images/) is ever removed.
const IMAGE_DIR = path.join(db.dataDir, 'community-images');
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });
const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, Object.prototype.hasOwnProperty.call(MIME_EXT, file.mimetype)),
});
const IMAGE_COLUMN = { logo: 'logo_url', cover: 'cover_url' };

function deleteImageFile(url) {
  if (typeof url !== 'string' || !url.startsWith('/community-images/')) return;
  fs.unlink(path.join(IMAGE_DIR, path.basename(url)), () => { /* fine if it is already gone */ });
}

router.post('/:id/:which(logo|cover)', (req, res) => {
  const ctx = needOrgAdmin(req, res);
  if (!ctx) return;
  imageUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The picture must be under 6 MB' : 'Could not process the uploaded file' });
    if (!req.file) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP picture' });
    // the file took its time: the club may have been hidden, or the player demoted, meanwhile
    const fresh = orgById(ctx.org.id);
    if (!fresh || fresh.hidden || !isOrgAdmin(fresh.id, ctx.playerId)) return res.status(403).json({ error: 'Only an admin of this community or club can do this' });
    ctx.org = fresh;
    const column = IMAGE_COLUMN[req.params.which];
    const filename = `${ctx.org.id}-${req.params.which}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${MIME_EXT[req.file.mimetype]}`;
    fs.writeFileSync(path.join(IMAGE_DIR, filename), req.file.buffer);
    db.prepare(`UPDATE organisations SET ${column} = ? WHERE id = ?`).run(`/community-images/${filename}`, ctx.org.id);
    deleteImageFile(ctx.org[column]);
    res.json(serialize(orgById(ctx.org.id), req));
  });
});

router.delete('/:id/:which(logo|cover)', (req, res) => {
  const ctx = needOrgAdmin(req, res);
  if (!ctx) return;
  const column = IMAGE_COLUMN[req.params.which];
  db.prepare(`UPDATE organisations SET ${column} = NULL WHERE id = ?`).run(ctx.org.id);
  deleteImageFile(ctx.org[column]);
  res.json(serialize(orgById(ctx.org.id), req));
});

module.exports = router;
module.exports.needOrgAdmin = needOrgAdmin;
module.exports.needPlayer = needPlayer;
module.exports.orgById = orgById;
