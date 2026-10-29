// Automatic push for the bell and for direct messages: every time something is written for a player's bell (or a direct message arrives),
// the player's devices that turned push on get it as a push notification. Never throws: a failed push must not break the action that caused it.
// Without VAPID keys nothing is sent (PUSH_DRY_RUN=1 writes the pushes into player_push_log instead - the tests read it there).
const db = require('./db');
const push = require('./push');
const texts = require('./pushTexts');
const seo = require('./seo');

const MAX_DEVICES = 10;
const MAX_ENDPOINT = 2048;
const dryRun = () => process.env.PUSH_DRY_RUN === '1';

const langOf = (value) => (value === 'en' ? 'en' : 'sk');

// A subscription as the browser gives it (PushSubscription.toJSON()): an https endpoint and the two keys. Returns the cleaned value or null.
function cleanSubscription(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint.trim() : '';
  const keys = raw.keys && typeof raw.keys === 'object' ? raw.keys : {};
  if (!endpoint || endpoint.length > MAX_ENDPOINT || !/^https:\/\//i.test(endpoint)) return null;
  try { new URL(endpoint); } catch { return null; }
  if (typeof keys.p256dh !== 'string' || !keys.p256dh || typeof keys.auth !== 'string' || !keys.auth) return null;
  return { endpoint, keys: { p256dh: keys.p256dh.slice(0, 200), auth: keys.auth.slice(0, 100) } };
}

// Adds (or takes over) a device for a player; keeps at most MAX_DEVICES per player, the newest ones.
function subscribe(playerId, rawSubscription, lang) {
  const sub = cleanSubscription(rawSubscription);
  if (!sub) return false;
  db.prepare(`
    INSERT INTO player_push_subscriptions (player_id, endpoint, subscription, lang) VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET player_id = excluded.player_id, subscription = excluded.subscription, lang = excluded.lang
  `).run(playerId, sub.endpoint, JSON.stringify(sub), langOf(lang));
  db.prepare(`
    DELETE FROM player_push_subscriptions WHERE player_id = ? AND id NOT IN (
      SELECT id FROM player_push_subscriptions WHERE player_id = ? ORDER BY id DESC LIMIT ?
    )
  `).run(playerId, playerId, MAX_DEVICES);
  return true;
}

function unsubscribe(playerId, endpoint) {
  db.prepare('DELETE FROM player_push_subscriptions WHERE player_id = ? AND endpoint = ?').run(playerId, String(endpoint || ''));
}

const isSubscribed = (playerId, endpoint) => !!db.prepare('SELECT 1 FROM player_push_subscriptions WHERE player_id = ? AND endpoint = ?').get(playerId, String(endpoint || ''));
const available = () => dryRun() || push.isConfigured();

// Sends one kind of push to every device of the player. Fire and forget: returns a promise that always resolves.
async function notifyPlayer(playerId, kind, data) {
  try {
    if (!playerId || !available()) return;
    const subs = db.prepare('SELECT * FROM player_push_subscriptions WHERE player_id = ?').all(playerId);
    for (const row of subs) {
      try {
        const text = texts.build(kind, data, row.lang);
        const payload = { title: text.title, body: text.body, url: seo.pageUrl(text.url, langOf(row.lang)), tag: text.tag };
        if (dryRun()) {
          db.prepare('INSERT INTO player_push_log (player_id, endpoint, payload) VALUES (?, ?, ?)').run(playerId, row.endpoint, JSON.stringify(payload));
        } else {
          await push.sendPush(JSON.parse(row.subscription), payload);
        }
      } catch (err) {
        // a device the browser dropped (404/410) is gone for good; any other failure may be temporary
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          db.prepare('DELETE FROM player_push_subscriptions WHERE id = ?').run(row.id);
        } else {
          console.error('[playerPush] push failed:', err && err.message);
        }
      }
    }
  } catch (err) {
    console.error('[playerPush] could not notify:', err && err.message);
  }
}

module.exports = { notifyPlayer, subscribe, unsubscribe, isSubscribed, available, cleanSubscription, MAX_DEVICES };
