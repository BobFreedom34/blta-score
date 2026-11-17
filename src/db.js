require('./db/matchesPlayers');
require('./db/notifications');
require('./db/badges');
require('./db/photosRanking');
require('./db/access');
require('./db/site');
require('./db/courtiqBrackets');
require('./db/seasons');
require('./db/content');
require('./db/cities');
require('./db/communities');
const { db } = require('./db/core');

// Every handler of the app calls db.prepare(sql) on each request, and compiling the SQL is a good part of the time of a list (a list of matches compiled the same few statements
// thousands of times). From here on (after the schema above is final) a statement is compiled once per SQL text and reused; the cache is capped, so SQL built with changing text
// (an IN (...) list) cannot grow it without end. A statement is reused only between synchronous calls, so two users never share a half-used one.
const rawPrepare = db.prepare.bind(db);
const statements = new Map();
const MAX_STATEMENTS = 800;
db.prepare = function prepareCached(sql) {
  let statement = statements.get(sql);
  if (!statement) {
    statement = rawPrepare(sql);
    if (statements.size >= MAX_STATEMENTS) statements.delete(statements.keys().next().value);
    statements.set(sql, statement);
  }
  return statement;
};

module.exports = db;

// the bell row of an admin about a registration: 'REGISTER' (somebody registered) or 'UNREGISTER' (somebody dropped out), see src/routes/seasons.js
if (!db.prepare('PRAGMA table_info(registration_notifications)').all().some((c) => c.name === 'kind')) {
  db.exec("ALTER TABLE registration_notifications ADD COLUMN kind TEXT NOT NULL DEFAULT 'REGISTER'");
}
