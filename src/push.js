const webpush = require('web-push');

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:score@blta.sk',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  configured = true;
  return true;
}

// Throws on failure so callers can tell a dead subscription (410/404 — the
// browser dropped it, safe to delete) apart from a transient error.
async function sendPush(subscription, payload) {
  if (!ensureConfigured()) {
    throw new Error('VAPID keys not configured — see .env.example');
  }
  await webpush.sendNotification(subscription, JSON.stringify(payload));
}

module.exports = { sendPush, isConfigured: ensureConfigured };
