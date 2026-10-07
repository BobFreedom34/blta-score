// The contact window ("Kontakt" in the menu): who runs the league and how to reach them. One set of texts, edited in Backend >
// Menu (the "Contact window" card), stored as JSON in site_settings. The first values are the ones of blta.sk.
const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();

const DEFAULTS = {
  orgName: 'OZ Ziegelfeld',
  address: 'Bárdošova 2939/23\n83101 Bratislava',
  ico: '51237971',
  iban: 'SK13 1111 0000 0015 4476 3000',
  phone: '0902 955 945',
  email: 'info@blta.sk',
  facebookUrl: 'https://www.facebook.com/bltaliga',
  instagramUrl: 'https://www.instagram.com/blta_tennis',
  youtubeUrl: 'https://www.youtube.com/@bltatennis',
  whatsappUrl: 'https://wa.me/421902955945',
};

// field → [longest allowed text, kind]
const FIELDS = {
  orgName: [120, 'text'],
  address: [300, 'text'],
  ico: [20, 'text'],
  iban: [60, 'text'],
  phone: [40, 'text'],
  email: [120, 'email'],
  facebookUrl: [300, 'url'],
  instagramUrl: [300, 'url'],
  youtubeUrl: [300, 'url'],
  whatsappUrl: [300, 'url'],
};
const LABELS = { orgName: 'Name', address: 'Address', ico: 'IČO', iban: 'IBAN', phone: 'Phone', email: 'Email', facebookUrl: 'Facebook link', instagramUrl: 'Instagram link', youtubeUrl: 'YouTube link', whatsappUrl: 'WhatsApp link' };

function read() {
  const row = db.prepare("SELECT value FROM site_settings WHERE key = 'contact'").get();
  let stored = {};
  try { stored = row ? JSON.parse(row.value) : {}; } catch { stored = {}; }
  // a saved (even empty) value wins over the first value, so a field can be cleared
  return Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, typeof stored[k] === 'string' ? stored[k] : DEFAULTS[k]]));
}

// Public — the window opens for every visitor.
router.get('/', (req, res) => {
  res.json(read());
});

router.put('/', requireAdmin, (req, res) => {
  const body = req.body || {};
  const next = {};
  for (const [key, [max, kind]] of Object.entries(FIELDS)) {
    const raw = body[key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value.length > max) return res.status(400).json({ error: `${LABELS[key]} is too long (max ${max} characters)` });
    if (value && kind === 'url' && !/^https?:\/\/\S+$/i.test(value)) return res.status(400).json({ error: `${LABELS[key]} must start with https://` });
    if (value && kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return res.status(400).json({ error: 'Email is not a valid address' });
    next[key] = value;
  }
  db.prepare("INSERT INTO site_settings (key, value) VALUES ('contact', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
  res.json(read());
});

module.exports = router;
