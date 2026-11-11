// @mentions: a player is tagged by writing @ and his full name ("@Alan Almaksus") in a comment. The text is stored as typed; the server only looks
// for the names of the people who may be tagged there (the members of the community) and tells them.
//   findMentioned(text, candidates) -> the candidates ({ id, name }) whose "@name" stands in the text (case does not matter; the name must end there)
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function findMentioned(text, candidates) {
  const body = String(text || '');
  if (!body.includes('@')) return [];
  return candidates.filter((c) => c.name && new RegExp(`(?:^|[^\\p{L}\\p{N}])@${escapeRegex(c.name)}(?![\\p{L}\\p{N}])`, 'iu').test(body));
}

module.exports = { findMentioned };
