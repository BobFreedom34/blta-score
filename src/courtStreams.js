// The live video of the courts of a tournament: one YouTube link per court ("Kurt 1" … "Kurt n"), kept in seasons.court_streams as a JSON list of video ids
// (index 0 = court 1, '' = no video on that court). The link forms are those of src/youtube.js; only the 11-character id is ever stored or put into a page.

const { parseVideoId, watchUrl } = require('./youtube');

// the stored list as an array of ids (bad or missing JSON = none)
function storedIds(season) {
  try {
    const list = JSON.parse((season && season.court_streams) || '[]');
    return Array.isArray(list) ? list.map((v) => (typeof v === 'string' ? v : '')) : [];
  } catch { return []; }
}

// the list sent by the admin page: one entry per court, '' for a court without video -> { ids } padded to the number of courts, or { error }
function parseCourtStreams(raw, courtCount) {
  if (!Array.isArray(raw)) return { error: 'courtStreams must be a list with one YouTube link (or nothing) for each court' };
  if (raw.length > courtCount) return { error: `There are more video links (${raw.length}) than courts (${courtCount})` };
  const ids = [];
  for (let i = 0; i < raw.length; i += 1) {
    const text = raw[i];
    if (typeof text !== 'string') return { error: `Court ${i + 1}: the video link must be text` };
    if (!text.trim()) { ids.push(''); continue; }
    const id = parseVideoId(text);
    if (!id) return { error: `Court ${i + 1}: enter the link of a YouTube video or live stream (a youtube.com/watch, youtu.be or youtube.com/live link; a channel page does not work)` };
    ids.push(id);
  }
  while (ids.length < courtCount) ids.push('');
  return { ids };
}

// what the pages get: for each court { videoId, url } or null
function streamsOf(season) {
  const count = (season && season.court_count) || 0;
  const ids = storedIds(season);
  return Array.from({ length: count }, (_, i) => {
    const id = ids[i] ? parseVideoId(`https://youtu.be/${ids[i]}`) : null; // a stored value that is no id is ignored
    return id ? { videoId: id, url: watchUrl(id) } : null;
  });
}

// the stored ids cut or padded to a new number of courts (the courts that stay keep their video)
function fitToCount(season, count) {
  const ids = storedIds(season).slice(0, count);
  while (ids.length < count) ids.push('');
  return ids;
}

module.exports = { parseCourtStreams, streamsOf, fitToCount };
