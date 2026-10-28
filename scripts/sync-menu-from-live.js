// Copies the main menu of the live site into the LOCAL database, so the menu on localhost is the one of the live page (the menu is data, not code: an
// admin edits it in Backend > Menu on the live site, and a development database only ever has the menu it was seeded with).
// Run: node scripts/sync-menu-from-live.js [address of the site, default https://blta.sk]
// It replaces the menu of the first city (league 1) in the database of this folder (DATA_DIR, default ./data). Stop the local server first.
const base = (process.argv[2] || 'https://blta.sk').replace(/\/$/, '');

(async () => {
  const res = await fetch(`${base}/api/header-items`);
  if (!res.ok) throw new Error(`${base}/api/header-items answered ${res.status}`);
  const items = await res.json();
  if (!Array.isArray(items) || !items.length) throw new Error('the live site returned no menu');

  const db = require('../src/db');
  // the helpers that add a menu item once (and set their flag), so the local server does not add them again on top of the live menu
  const seed = require('../src/seasonSeed');
  Object.keys(seed).filter((k) => /^ensure.*MenuItem$/.test(k)).forEach((k) => { try { seed[k](db); } catch { /* an older database may lack a table; the flag then stays unset */ } });

  const columns = db.prepare('PRAGMA table_info(header_items)').all().map((c) => c.name);
  const withLeague = columns.includes('league_id');
  const insert = db.prepare(`INSERT INTO header_items (parent_id, label_sk, label_en, link, sort_order, is_my_profile, highlight${withLeague ? ', league_id' : ''}) VALUES (?, ?, ?, ?, ?, ?, ?${withLeague ? ', 1' : ''})`);
  let count = 0;
  const add = (item, parentId) => {
    const info = insert.run(parentId, item.labelSk, item.labelEn || null, item.link, item.sortOrder || 0, item.isMyProfile ? 1 : 0, item.highlight ? 1 : 0);
    count += 1;
    (item.children || []).forEach((child) => add(child, Number(info.lastInsertRowid)));
  };

  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM header_items${withLeague ? ' WHERE league_id = 1' : ''}`).run();
    items.forEach((item) => add(item, null));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`The menu of ${base} (${count} items) is now the menu of the local database (${db.dataDir}).`);
})().catch((err) => { console.error(err.message); process.exit(1); });
