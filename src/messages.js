// Správy / Messages: the rules of the private chats (src/routes/messages.js) - who is a stranger, blocks, who is in a conversation.
// A conversation is private to its members: nothing here ever answers a non-member with more than "not found".
const cookieSignature = require('cookie-signature');
const db = require('./db');

// one direct conversation per pair of players
const directKey = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;

// two players are connected - so a first message goes to Main instead of Requests - when they have played (or planned) a match together,
// singles or doubles, or are active members of the same community or club
// Two things are NOT enough, because a stranger could do them to anybody: planning a match (any player can make a planned match against any opponent) and
// joining an open community a moment ago. So: a match that was FINISHED, and a community or club that is public and in which both have been members for
// at least a week.
const CONNECTED_AFTER_DAYS = 7;

function areConnected(a, b) {
  const match = db.prepare(`
    SELECT 1 FROM matches
    WHERE status = 'FINISHED' AND ? IN (player1_id, player2_id, player1b_id, player2b_id) AND ? IN (player1_id, player2_id, player1b_id, player2b_id) LIMIT 1
  `).get(a, b);
  if (match) return true;
  const cutoff = new Date(Date.now() - CONNECTED_AFTER_DAYS * 86400000).toISOString();
  const org = db.prepare(`
    SELECT 1 FROM organisation_members m1
    JOIN organisation_members m2 ON m2.organisation_id = m1.organisation_id
    JOIN organisations o ON o.id = m1.organisation_id
    WHERE m1.player_id = ? AND m2.player_id = ? AND m1.status = 'ACTIVE' AND m2.status = 'ACTIVE'
      AND o.hidden = 0 AND o.approved = 1 AND m1.joined_at <= ? AND m2.joined_at <= ? LIMIT 1
  `).get(a, b, cutoff, cutoff);
  return !!org;
}

// blocked in either direction
function isBlocked(a, b) {
  return !!db.prepare('SELECT 1 FROM message_blocks WHERE (blocker_player_id = ? AND blocked_player_id = ?) OR (blocker_player_id = ? AND blocked_player_id = ?) LIMIT 1').get(a, b, b, a);
}

function memberOf(conversationId, playerId) {
  if (!conversationId || !playerId) return undefined;
  return db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND player_id = ?').get(conversationId, playerId);
}

// what a client may know about a player: the name and the picture, never the phone or the e-mail
const card = (row) => ({ playerId: row.id, name: row.name, slug: row.slug || '', photoUrl: row.photo_url || '' });

function otherPlayer(conversationId, playerId) {
  const row = db.prepare(`
    SELECT p.id, p.name, p.slug, p.photo_url FROM conversation_members m JOIN players p ON p.id = m.player_id
    WHERE m.conversation_id = ? AND m.player_id != ? LIMIT 1
  `).get(conversationId, playerId);
  return row ? card(row) : null;
}

// at most 30 messages a minute per player, in all his conversations (in memory: one server process)
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;
const recent = new Map();
function rateLimitOk(playerId) {
  const now = Date.now();
  const times = (recent.get(playerId) || []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= MAX_PER_WINDOW) {
    recent.set(playerId, times);
    return false;
  }
  times.push(now);
  recent.set(playerId, times);
  return true;
}

// what a client is told about a message; mine = it was written by the viewer
// An invitation message carries the community and what the viewer can do with it: SENT (he wrote it), INVITED (he can join from it), MEMBER (he has joined),
// GONE (the invitation is not valid any more: withdrawn, or the community is hidden)
function inviteOf(row, viewerId) {
  if (!row.invite_org_id) return undefined;
  const org = db.prepare('SELECT id, slug, name, type, logo_url, hidden, approved FROM organisations WHERE id = ?').get(row.invite_org_id);
  const organisation = org ? { id: org.id, slug: org.slug, name: org.name, type: org.type, logoUrl: org.logo_url || '' } : null;
  let status = 'GONE';
  if (org && !org.hidden && org.approved) {
    if (row.sender_player_id === viewerId) status = 'SENT';
    else if (db.prepare("SELECT 1 FROM organisation_members WHERE organisation_id = ? AND player_id = ? AND status = 'ACTIVE'").get(org.id, viewerId)) status = 'MEMBER';
    else if (db.prepare('SELECT 1 FROM organisation_invites WHERE organisation_id = ? AND player_id = ?').get(org.id, viewerId)) status = 'INVITED';
  }
  return { organisation, status };
}
// The request to approve a new club: SENT (the founder wrote it), WAITING (the club is not approved yet), APPROVED, GONE (the club does not exist any more or is hidden)
function approvalOf(row, viewerId) {
  if (!row.approval_org_id) return undefined;
  const org = db.prepare('SELECT id, slug, name, type, logo_url, hidden, approved FROM organisations WHERE id = ?').get(row.approval_org_id);
  const organisation = org ? { id: org.id, slug: org.slug, name: org.name, type: org.type, logoUrl: org.logo_url || '' } : null;
  let status = 'GONE';
  if (org && !org.hidden) status = row.sender_player_id === viewerId ? 'SENT' : org.approved ? 'APPROVED' : 'WAITING';
  return { organisation, status };
}
const serializeMessage = (row, viewerId) => {
  const out = { id: row.id, body: row.body, createdAt: row.created_at, mine: row.sender_player_id === viewerId };
  const invite = inviteOf(row, viewerId);
  if (invite) out.invite = invite;
  const approval = approvalOf(row, viewerId);
  if (approval) out.approval = approval;
  return out;
};

// a message is 1-2000 characters (emoji count as one), trimmed; null when it is not acceptable
function cleanBody(value) {
  if (typeof value !== 'string') return null; // a number, a list or an object is not a message
  const body = value.trim();
  const length = Array.from(body).length;
  // something must be visible: a text of zero-width characters only would be an invisible message
  if (length < 1 || length > 2000 || !/[^\s​-‍⁠﻿]/u.test(body)) return null;
  return body;
}

// The live connection: a socket belongs to a player only through the SIGNED cookie of its handshake (the same cookie and secret as the rest of the
// site). Only a value that carries the signature counts - an unsigned "blta_player=5" is nobody. The room of a player is `player:<id>`; a client can
// never join it by name (server.js refuses such rooms), so only the server puts a socket there.
function playerIdFromSocket(socket) {
  const headers = socket && socket.request && socket.request.headers;
  const header = headers && headers.cookie;
  if (!header) return null;
  // A WebSocket handshake is not stopped by CORS and the cookie is sent from any page of the same site: only a page of this very host may be given a
  // private room (a client with no Origin is not a browser page and is as before).
  if (headers.origin) {
    let host;
    try { host = new URL(headers.origin).host; } catch { return null; }
    if (![headers.host, headers['x-forwarded-host']].filter(Boolean).includes(host)) return null;
  }
  const part = header.split(';').map((p) => p.trim()).find((p) => p.startsWith('blta_player='));
  if (!part) return null;
  let raw;
  try { raw = decodeURIComponent(part.slice('blta_player='.length)); } catch { return null; }
  if (!raw.startsWith('s:')) return null;
  const value = cookieSignature.unsign(raw.slice(2), process.env.SESSION_SECRET || 'dev-only-insecure-secret');
  const id = Number(value);
  if (value === false || !Number.isInteger(id) || id <= 0) return null;
  return db.prepare('SELECT 1 FROM players WHERE id = ?').get(id) ? id : null;
}

function emitToPlayers(io, playerIds, event, payload) {
  if (!io) return;
  [...new Set(playerIds)].forEach((id) => io.to(`player:${id}`).emit(event, payload));
}

module.exports = { approvalOf, inviteOf, directKey, areConnected, isBlocked, memberOf, otherPlayer, card, rateLimitOk, serializeMessage, cleanBody, playerIdFromSocket, emitToPlayers };
