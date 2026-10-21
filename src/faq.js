// The questions and answers of the national page (slta.sk), written in Backend > Q&A: a question and an answer in Slovak and in English, in
// the order the super admin puts them. The questions that came with the page are put in once (a flag keeps a deleted question deleted).
const db = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS faq_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position INTEGER NOT NULL DEFAULT 0,
    q_sk TEXT NOT NULL DEFAULT '',
    a_sk TEXT NOT NULL DEFAULT '',
    q_en TEXT NOT NULL DEFAULT '',
    a_en TEXT NOT NULL DEFAULT ''
  );
`);

const FIRST = [
  ['Čo je SLTA?', 'SLTA je Slovenská liga tenisových amatérov. Spája ligy amatérskych hráčov z rôznych miest na jednom mieste. Každé mesto má vlastnú ligu, sezóny, rebríček a organizátora, no všetko funguje rovnako a tvoj CourtIQ platí na celom Slovensku.',
    'What is SLTA?', 'SLTA is the Slovak Amateur Tennis League. It brings the leagues of amateur players from different cities together in one place. Every city has its own league, seasons, ranking and organiser, but everything works the same way and your CourtIQ counts across Slovakia.'],
  ['Kto môže hrať?', 'Hrať môže každý amatér, ktorý chce odohrať zápasy so súpermi svojej úrovne. Žiadna licencia ani klubová príslušnosť nie je potrebná.',
    'Who can play?', 'Any amateur who wants to play matches against opponents of their own level. No licence or club membership is needed.'],
  ['Ako sa zaregistrujem?', 'Vyber si svoje mesto a na jeho karte klikni na Registrácia. Tlačidlo je dostupné vtedy, keď organizátor mesta otvorí registráciu do sezóny. Vyberieš si kategóriu a zaplatíš štartovné online.',
    'How do I register?', 'Pick your city and press Register on its card. The button is available when the organiser of the city opens registration for a season. You choose a category and pay the entry fee online.'],
  ['Aké sú kategórie?', 'Hrá sa v troch kategóriách: Novice, Next Gen a Elite. Ktoré kategórie sa hrajú v tvojom meste, uvidíš na karte mesta.',
    'What are the categories?', 'There are three categories: Novice, Next Gen and Elite. The card of a city shows which ones are played there.'],
  ['Koľko stojí štartovné?', 'Výšku štartovného určuje organizátor v danom meste. Uvidíš ju pri registrácii do sezóny.',
    'How much is the entry fee?', 'The organiser of each city sets the entry fee. You will see it when you register for a season.'],
  ['Čo je CourtIQ?', 'CourtIQ je hodnotenie tvojej výkonnosti, ktoré sa mení podľa odohraných zápasov. Platí na celom Slovensku, takže si ho zoberieš so sebou aj do inej ligy.',
    'What is CourtIQ?', 'CourtIQ is a rating of your performance that changes with the matches you play. It counts across Slovakia, so you take it with you to another league.'],
  ['Kde nájdem rozpis, výsledky a rebríček?', 'Na stránke ligy svojho mesta. Klikni na Vstúpiť na karte mesta. Harmonogram najbližších turnajov a sezón nájdeš aj tu na úvodnej stránke.',
    'Where do I find the schedule, results and ranking?', 'On the page of the league of your city. Press Enter on the card of the city. The schedule of the coming tournaments and seasons is also on this home page.'],
  ['Moje mesto tu nie je. Čo mám robiť?', 'Môžeš sa stať organizátorom ligy vo svojom meste. Ozvi sa nám cez blok Organizátori nižšie a dohodneme sa na ďalších krokoch.',
    'My city is not here. What can I do?', 'You can become the organiser of a league in your city. Get in touch with us through the Organisers block below and we will agree on the next steps.'],
  ['Ako sa stať organizátorom ligy?', 'Napíš nám. Pripravíme pre tvoje mesto vlastnú stránku s ligou, sezónami, rebríčkom a registráciou, ktorú budeš spravovať ty.',
    'How do I become an organiser of a league?', 'Write to us. We will prepare a page of your own for your city with the league, seasons, ranking and registration, which you will manage yourself.'],
];

if (!db.prepare("SELECT 1 FROM app_flags WHERE key = 'faq_seeded'").get()) {
  if (!db.prepare('SELECT 1 FROM faq_items').get()) {
    const put = db.prepare('INSERT INTO faq_items (position, q_sk, a_sk, q_en, a_en) VALUES (?, ?, ?, ?, ?)');
    FIRST.forEach((r, i) => put.run(i + 1, ...r));
  }
  db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('faq_seeded')").run();
}

const FIELDS = ['q_sk', 'a_sk', 'q_en', 'a_en'];
const MAX_Q = 200;
const MAX_A = 3000;

const list = () => db.prepare('SELECT id, q_sk, a_sk, q_en, a_en FROM faq_items ORDER BY position, id').all();

// -> { error } or the cleaned fields; the question and the answer of the Slovak side are needed, the English may stay empty (then the Slovak is shown)
function clean(body) {
  const out = {};
  for (const f of FIELDS) {
    const v = body && typeof body[f] === 'string' ? body[f] : '';
    out[f] = f.startsWith('q_') ? v.replace(/\s+/g, ' ').trim() : v.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  if (!out.q_sk) return { error: 'The question in Slovak is needed' };
  if (!out.a_sk) return { error: 'The answer in Slovak is needed' };
  if (FIELDS.some((f) => out[f].length > (f.startsWith('q_') ? MAX_Q : MAX_A))) return { error: 'A question is up to 200 characters, an answer up to 3000' };
  return out;
}

function add(body) {
  const c = clean(body);
  if (c.error) return c;
  const next = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM faq_items').get().n;
  const r = db.prepare('INSERT INTO faq_items (position, q_sk, a_sk, q_en, a_en) VALUES (?, ?, ?, ?, ?)').run(next, c.q_sk, c.a_sk, c.q_en, c.a_en);
  return { id: Number(r.lastInsertRowid) };
}

function update(id, body) {
  const c = clean(body);
  if (c.error) return c;
  const r = db.prepare('UPDATE faq_items SET q_sk = ?, a_sk = ?, q_en = ?, a_en = ? WHERE id = ?').run(c.q_sk, c.a_sk, c.q_en, c.a_en, id);
  return r.changes ? { saved: true } : { error: 'Not found', status: 404 };
}

const remove = (id) => db.prepare('DELETE FROM faq_items WHERE id = ?').run(id).changes > 0;

// ids = the questions in the order they are to be shown (the ones left out keep their place at the end)
function reorder(ids) {
  const known = new Set(list().map((r) => r.id));
  const order = (Array.isArray(ids) ? ids : []).map(Number).filter((n, i, a) => known.has(n) && a.indexOf(n) === i);
  const set = db.prepare('UPDATE faq_items SET position = ? WHERE id = ?');
  order.forEach((id, i) => set.run(i + 1, id));
  return list();
}

module.exports = { list, add, update, remove, reorder };
