// Starts a local copy of the app on a temporary data directory with a small demo tournament for trying out the COURT KIOSK (a phone on each court: pick your match, score it, back to
// the list), without touching the live site (nothing here is connected to score.blta.sk or its database).
// Run: node scripts/demo-kiosk.js        -> http://localhost:3056   (admin password: test; Ctrl+C stops it, the data is thrown away)
// The demo: "Kiosk Open" for today and tomorrow, 2 courts, 16 Elite players (4 seeded), drawn as PRINCE (bracket + consolation bracket), the matches placed on the courts, and the kiosk
// switched on: the script prints the short link, its code and the long link.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-kiosk-'));
const port = Number(process.env.PORT) || 3056;
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
    const t = await call('POST', '/api/seasons', { name: 'Kiosk Open', kind: 'TOURNAMENT', startDate: day(0), endDate: day(1), venue: 'Tennis ONE' });
    await call('PATCH', `/api/seasons/${t.id}`, { courtCount: 2, maxPlayers: 16, registrationOpen: true, entryFee: '40 €', maxMatchesPerDay: 3 });
    const regs = [];
    for (let i = 0; i < 16; i += 1) {
      const p = await call('POST', '/api/players', { name: NAMES[i] });
      regs.push(await call('POST', `/api/seasons/${t.id}/registrations/admin`, { playerId: p.id, category: 'ELITE', phone: `0903${String(100000 + i)}`, email: `demo${i}@example.com` }));
    }
    await call('POST', `/api/seasons/${t.id}/seeds`, { category: 'ELITE', seeds: regs.slice(0, 4).map((r, n) => ({ id: r.id, seed: n + 1 })) });
    await call('POST', `/api/seasons/${t.id}/draw`, { category: 'ELITE', format: 'PRINCE', mode: 'AUTO' });
    const kiosk = await call('POST', `/api/seasons/${t.id}/kiosk`);
    console.log(`
Demo tournament ready: 2 courts, 16 players, PRINCE.
  Tournament page : ${base}/tournament/${t.slug}   (tab Harmonogram > Kiosk kurtov)
  Kiosk, short    : ${kiosk.shortUrl}   code: ${kiosk.code}
  Kiosk, long     : ${kiosk.url}
  Admin (password test): ${base}/tournaments-admin
Ctrl+C stops the demo and throws the data away.
`);
  } catch (err) {
    console.error('Seeding failed:', err.message);
  }
});

const stop = () => { child.kill(); setTimeout(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(0); }, 300); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', () => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(0); });
