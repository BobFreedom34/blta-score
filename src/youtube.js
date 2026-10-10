// A YouTube link of a match (a live stream or a recording): any of the usual forms is accepted and kept as one normal address.
//   https://www.youtube.com/watch?v=ID   https://youtu.be/ID   https://www.youtube.com/live/ID   /embed/ID   /shorts/ID   (also m.youtube.com)
// The page embeds https://www.youtube-nocookie.com/embed/ID, so only the 11-character id is ever put into the page.

const ID = /^[A-Za-z0-9_-]{11}$/;

// -> the video id, or null when the text is not a YouTube video address
function parseVideoId(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  let url;
  try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (['live', 'embed', 'shorts', 'v'].includes(parts[0])) id = parts[1];
  }
  return id && ID.test(id) ? id : null;
}

const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

module.exports = { parseVideoId, watchUrl };
