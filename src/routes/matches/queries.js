const leagues = require('../../leagues');
const { isAdmin, getPlayerId } = require('../../auth');
const ratingChanges = require('../../ratingChanges');
const router = require('./router');
const { selectMatchRows, setListMemo, serialize, countMatchRows, getRowOr404, managesMatchSeason } = require('./shared');

router.get('/', (req, res) => {
  const limit = Math.max(0, Math.min(500, parseInt(req.query.limit, 10) || 0));
  let rows = selectMatchRows({ ...req.query, _league: leagues.actingIdOf(req), _viewer: getPlayerId(req) || '' });
  // Optional cap (the home page and the embeds only need the latest few); no limit = everything, as before.
  if (limit) rows = rows.slice(0, limit);
  setListMemo(new Map());
  try { res.json(rows.map(serialize)); } finally { setListMemo(null); }
});

// The numbers on the matches page's tabs in one small response instead of downloading every list just to count it.
// Takes the page's own filters — category (a list is fine), q (name search), from/to (a time range) or tbd=1 ("no date")
// — and optionally playerId for the "My matches" total. The counts follow exactly what each tab's list would show.
router.get('/counts', (req, res) => {
  const { category, q, from, to, tbd, playerId } = req.query;
  const range = from && to ? { from, to } : null;
  const base = { _league: leagues.actingIdOf(req), ...(category ? { category } : {}), ...(q ? { q } : {}), ...(req.query.seasonId ? { seasonId: req.query.seasonId } : {}) };
  // The time filter narrows Planned / Finished / Unfinished (a range, or "no date"); the Scheduled tab only takes a range,
  // "Not yet scheduled" has no date to narrow and Live ignores it.
  const timed = range || (tbd === '1' ? { noDate: '1' } : {});
  const count = (extra, extraBase = base) => countMatchRows({ ...extraBase, ...extra });
  const live = count({ status: 'LIVE' });
  const counts = {
    ALL: count({ status: 'PLANNED', ...timed }) + live,
    SCHEDULED: count({ status: 'PLANNED', hasDate: '1', ...(range || {}) }),
    UNSCHEDULED: count({ status: 'PLANNED', noDate: '1' }),
    LIVE: live,
    FINISHED: count({ status: 'FINISHED', ...timed }),
    UNFINISHED: count({ status: 'UNFINISHED', ...timed }),
  };
  if (playerId) {
    const mine = { ...base, playerId: String(playerId), ...(req.query.withDoubles === '1' ? { withDoubles: '1' } : {}) };
    counts.MY_MATCHES = count({ status: 'LIVE' }, mine)
      + count({ status: 'PLANNED', hasDate: '1', ...(range || {}) }, mine)
      + count({ status: 'PLANNED', noDate: '1' }, mine)
      + count({ status: 'FINISHED', ...timed }, mine)
      + count({ status: 'UNFINISHED', ...timed }, mine);
  }
  res.json(counts);
});

router.get('/:token', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  res.json(serialize(row));
});

// Whether the visitor is the admin of the club or community that runs the tournament this match belongs to (or an admin of the site): the match page asks, to show
// him the score controls and the result entry (the server lets him do them: checkLiveScoreAccess / checkMatchAccess). Not an admin: false, also for a match of no club.
router.get('/:token/can-manage', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  res.json({ canManage: isAdmin(req) || managesMatchSeason(req, row) });
});

// What a finished match did to the level (CourtIQ, or the doubles rating) of each of its players - the card "Zmeny úrovne" of the match page
router.get('/:token/rating-changes', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  res.json(ratingChanges.forMatch(row));
});
