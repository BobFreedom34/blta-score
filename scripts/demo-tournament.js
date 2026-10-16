// Starts a local copy of the app on a temporary data directory with a demo tournament, so a tournament can be tried out without
// touching the live site (nothing here is connected to score.blta.sk or its database).
// Run: node scripts/demo-tournament.js        -> http://localhost:3055   (admin password: test; Ctrl+C stops it, the data is thrown away)
// The demo: "Demo Open" for the next 3 days, 4 courts, 12 Elite players (4 seeded), 8 Next Gen and 5 Novice, registered and sorted into
// categories, with the Elite and Next Gen draws made (main + consolation bracket) and the matches placed on the courts. Novice is left
// without a draw so you can make it yourself (Backend > Tournaments > Pavúk turnaja).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-tournament-'));
const port = Number(process.env.PORT) || 3055;
const base = `http://localhost:${port}`;
const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_')) delete env[k];
const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'inherit'] });

const NAMES = ['Marek Drašar', 'Filip Ujfalusi', 'Max Bakos', 'Tomáš Hudec', 'Peter Kováč', 'Juraj Novák', 'Ivan Horváth', 'Martin Baláž', 'Jakub Tóth', 'Adam Lukáč', 'Michal Varga', 'Dávid Kollár',
  'Lukáš Zeman', 'Roman Polák', 'Oliver Kmeť', 'Samuel Ďurica', 'Erik Šimko', 'Daniel Mráz', 'Patrik Beňo', 'Viktor Hajdú', 'Andrej Sedlák',
  'Boris Čech', 'Cyril Dvorský', 'Dušan Eliáš', 'Gabriel Fico', 'Henrich Gál'];

child.stdout.on('data', async (d) => {
  if (!String(d).includes('listening') || global.seeded) return;
  global.seeded = true;
  try {
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const call = async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${method} ${url}: ${json.error || res.status}`);
      return json;
    };
    const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const t = await call('POST', '/api/seasons', { name: 'Demo Open', kind: 'TOURNAMENT', startDate: day(0), endDate: day(2), venue: 'Tennis ONE' });
    await call('PATCH', `/api/seasons/${t.id}`, { courtCount: 4, registrationOpen: true, entryFee: '40 €', maxMatchesPerDay: 2 });
    const groups = [['ELITE', 12], ['NEXT_GEN', 8], ['NOVICE', 5]];
    let i = 0;
    const regs = { ELITE: [] };
    for (const [category, count] of groups) {
      for (let k = 0; k < count; k += 1) {
        const p = await call('POST', '/api/players', { name: NAMES[i] });
        const reg = await call('POST', `/api/seasons/${t.id}/registrations/admin`, { playerId: p.id, category, phone: `0903${String(100000 + i)}`, email: `demo${i}@example.com` });
        if (category === 'ELITE') regs.ELITE.push(reg);
        i += 1;
      }
    }
    await call('POST', `/api/seasons/${t.id}/seeds`, { category: 'ELITE', seeds: regs.ELITE.slice(0, 4).map((r, n) => ({ id: r.id, seed: n + 1 })) });
    await call('POST', `/api/seasons/${t.id}/draw`, { category: 'ELITE', mode: 'AUTO' });
    await call('POST', `/api/seasons/${t.id}/draw`, { category: 'NEXT_GEN', mode: 'AUTO' });
    console.log(`\nDemo tournament ready.\n  Tournament page : ${base}/season/${t.slug}\n  Admin (password test): ${base}/tournaments-admin\n  Brackets admin  : ${base}/bracket-admin\nCtrl+C stops the demo and throws the data away.\n`);
  } catch (err) {
    console.error('Seeding failed:', err.message);
  }
});

const stop = () => { child.kill(); setTimeout(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(0); }, 300); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', () => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(0); });
