// Name matching that forgives how people type: capital letters, accents ("Tomas" = "Tomáš"), extra spaces,
// punctuation and word order ("Paulen Tomáš" = "Tomáš Paulen"). Used for searching (matches, players) and to stop
// the same player being created twice when a name is typed instead of picked from the list.
//
// A name that is the same once those differences are ignored is the SAME player. A name that is only similar
// ("Jan Szalay" / "Ján Szalai" are two different people in the league) is never merged by itself: the caller asks
// the user which one they mean.

const SPECIAL = { ł: 'l', đ: 'd', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe', ð: 'd', þ: 'th' };

// lower case, no accents, letters and digits only, single spaces
function fold(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[łđøßæœðþ]/g, (c) => SPECIAL[c])
    .replace(/['’`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(text) {
  return fold(text).split(' ').filter(Boolean);
}

// Word order does not matter: "paulen tomas" and "tomas paulen" share one key.
function key(text) {
  return tokens(text).sort().join(' ');
}

// Search: every word typed has to appear somewhere in the text, in any order ("szalay jan" finds "Jan Szalay").
function matchesQuery(text, query) {
  const q = tokens(query);
  if (!q.length) return true;
  const hay = fold(text);
  return q.every((tok) => hay.includes(tok));
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Does every typed word start one of the player's words (each player word used once)? "Paulen" -> "Tomáš Paulen".
function isPartOf(typedTokens, playerTokens) {
  if (!typedTokens.length || typedTokens.length >= playerTokens.length) return false;
  const free = [...playerTokens];
  return typedTokens.every((tok) => {
    const i = free.findIndex((p) => p.startsWith(tok));
    if (i === -1) return false;
    free.splice(i, 1);
    return true;
  });
}

// players: [{ id, name }]. Returns:
//   exact:   the existing player this is the same as (accents/case/order ignored), or null. When several players
//            already share that key (an old duplicate) the oldest one wins.
//   similar: up to 5 players that look like a typo or a shortened form of the typed name (never includes `exact`).
function findSimilar(name, players) {
  const typedKey = key(name);
  if (!typedKey) return { exact: null, similar: [] };
  const typedTokens = tokens(name).sort();
  let exact = null;
  const similar = [];
  players.forEach((p) => {
    const k = key(p.name);
    if (k === typedKey) {
      if (!exact || p.id < exact.id) exact = p;
      return;
    }
    const distance = typedKey.length >= 4 ? levenshtein(typedKey, k) : 99;
    if (distance <= 2) similar.push({ player: p, rank: distance });
    else if (isPartOf(typedTokens, k.split(' '))) similar.push({ player: p, rank: 3 });
    else if (k.split(' ').length >= 2 && isPartOf(k.split(' '), typedTokens)) similar.push({ player: p, rank: 3 });
  });
  similar.sort((a, b) => a.rank - b.rank || String(a.player.name).localeCompare(String(b.player.name), 'sk'));
  return { exact, similar: similar.slice(0, 5).map((s) => s.player) };
}

module.exports = { fold, tokens, key, matchesQuery, levenshtein, findSimilar };
