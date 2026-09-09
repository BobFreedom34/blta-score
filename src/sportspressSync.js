// Pushes a finished match's result into the corresponding SportsPress
// event on blta.sk (the WordPress site), via the sportspress-sheets-importer
// plugin's own POST /wp-json/ssi/v1/push-result endpoint, and can undo
// that via POST /wp-json/ssi/v1/clear-result when a match is un-finished
// or deleted — see that plugin's README for exactly what each does and
// doesn't touch (short version: push-result finds the ONE existing
// sp_event that already has both named players as participants and fills
// in sets-won, per-set games, an optional match tiebreak score, and the
// played date; clear-result finds the one such event that currently has a
// result and blanks just the score keys back out. Neither ever creates
// anything, and both do nothing rather than guess when the match can't be
// found or is ambiguous).
//
// Fire-and-forget, same pattern as sendMatchFinishedEmail's own call sites
// in routes/matches.js — most matches here (an informal FRIENDLY game,
// say) have no corresponding WordPress event at all, and the plugin's own
// "not found" response for that is completely normal, not an error. This
// never blocks or fails the actual match-finishing flow either way,
// regardless of whether blta.sk is reachable, configured, or finds a match.
const SPORTSPRESS_URL = process.env.SPORTSPRESS_SITE_URL; // e.g. https://www.blta.sk
const SPORTSPRESS_USER = process.env.SPORTSPRESS_API_USER;
const SPORTSPRESS_APP_PASSWORD = process.env.SPORTSPRESS_API_APP_PASSWORD;

function isConfigured() {
  return !!(SPORTSPRESS_URL && SPORTSPRESS_USER && SPORTSPRESS_APP_PASSWORD);
}

function authHeader() {
  const auth = Buffer.from(`${SPORTSPRESS_USER}:${SPORTSPRESS_APP_PASSWORD}`).toString('base64');
  return { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` };
}

function endpoint(path) {
  return `${SPORTSPRESS_URL.replace(/\/+$/, '')}/wp-json/ssi/v1/${path}`;
}

// `match` is a raw matches table row (needs .state, .player1_id, .player2_id,
// .scheduled_at/.start_time), `player1`/`player2` the corresponding player rows.
async function pushResultToSportsPress(match, player1, player2) {
  if (!isConfigured()) return;

  let state;
  try {
    state = JSON.parse(match.state);
  } catch {
    return;
  }
  const setsWon = state.setsWon || {};
  const player1Sets = Number(setsWon[1] || 0);
  const player2Sets = Number(setsWon[2] || 0);
  // 0-0 means nothing was actually decided by sets (e.g. a walkover before
  // a single game was played) — nothing meaningful to push.
  if (player1Sets === 0 && player2Sets === 0) return;

  const dateSource = match.scheduled_at || match.start_time || match.updated_at || '';
  const body = {
    player1_name: player1.name,
    player2_name: player2.name,
    player1_sets: player1Sets,
    player2_sets: player2Sets,
  };
  // Full ISO UTC datetime (not just the date) — WordPress converts this to
  // the site's own local timezone itself (get_date_from_gmt), so the real
  // match time shows correctly rather than defaulting to midnight/TBD.
  if (dateSource) body.date = String(dateSource);

  // Per-set games for the S1..S5 columns, plus a separate match/super
  // tiebreak score (the "T" column) — a super-tiebreak "set" replaces a
  // full deciding set rather than being an extra numbered set of its own
  // (see matchEngine.js's own construction of isSuperTiebreak sets, where
  // .p1/.p2 ARE the tiebreak points), so it's kept out of `sets` and sent
  // as `tiebreak` instead.
  const playedSets = Array.isArray(state.sets)
    ? state.sets.filter((s) => s && (s.winner || s.p1 > 0 || s.p2 > 0 || (s.tiebreak && (s.tiebreak.p1 > 0 || s.tiebreak.p2 > 0))))
    : [];
  const games = [];
  let tiebreak = null;
  for (const set of playedSets) {
    if (set.isSuperTiebreak) {
      tiebreak = { p1: Number(set.p1) || 0, p2: Number(set.p2) || 0 };
    } else {
      games.push({ p1: Number(set.p1) || 0, p2: Number(set.p2) || 0 });
    }
  }
  if (games.length) body.sets = games;
  if (tiebreak) body.tiebreak = tiebreak;

  try {
    const res = await fetch(endpoint('push-result'), {
      method: 'POST',
      headers: authHeader(),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[sportspressSync] push-result HTTP error:', res.status, data.message || data.error || '');
      return;
    }
    if ('updated' === data.status) {
      console.log(`[sportspressSync] pushed result to SportsPress event #${data.event_id} (${player1.name} ${player1Sets}-${player2Sets} ${player2.name})`);
    } else {
      // player_not_found / event_not_found / ambiguous / error — all
      // expected, non-exceptional outcomes for a match with no WordPress
      // counterpart. Logged for visibility, nothing more.
      console.warn(`[sportspressSync] push-result: ${data.status} — ${data.message || ''}`);
    }
  } catch (err) {
    console.error('[sportspressSync] push-result failed:', err.message);
  }
}

// Undoes a previous pushResultToSportsPress() for these two players — used
// when a match is un-finished (restarted) or deleted, so the SportsPress
// event stops showing a score that's no longer real. `player1`/`player2`
// are player rows (needs .name); no match/state needed since this just
// blanks whatever score currently exists for this pair. A no-op (logged,
// not an error) when there's nothing recorded to clear, or it's genuinely
// ambiguous which event to touch.
async function clearResultFromSportsPress(player1, player2) {
  if (!isConfigured()) return;

  try {
    const res = await fetch(endpoint('clear-result'), {
      method: 'POST',
      headers: authHeader(),
      body: JSON.stringify({ player1_name: player1.name, player2_name: player2.name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[sportspressSync] clear-result HTTP error:', res.status, data.message || data.error || '');
      return;
    }
    if ('cleared' === data.status) {
      console.log(`[sportspressSync] cleared SportsPress event #${data.event_id} (${player1.name} vs ${player2.name})`);
    } else {
      console.warn(`[sportspressSync] clear-result: ${data.status} — ${data.message || ''}`);
    }
  } catch (err) {
    console.error('[sportspressSync] clear-result failed:', err.message);
  }
}

module.exports = { pushResultToSportsPress, clearResultFromSportsPress, isConfigured };
