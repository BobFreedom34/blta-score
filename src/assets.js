// Speed of the static files (public/css and public/js):
//   1. versioned addresses - every local /css/*.css and /js/*.js in the HTML of a page gets ?v=<hash of the file>, and server.js already answers a request with ?v= with
//      "Cache-Control: public, max-age=31536000, immutable". A visitor (and Cloudflare) keeps the file for a year and asks again only when the file changes (its hash, so its
//      address, changes with it).
//   2. minified files - in production only (NODE_ENV=production, switch off with MINIFY_ASSETS=0) the .js and .css are answered minified by esbuild, made once per file
//      version and kept in memory. The checks (npm test) run without NODE_ENV=production, so they see the readable source, and a file that cannot be minified is served as it is.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
// (Render sets RENDER=true; the checks run on a computer or on GitHub with neither set, so they see the readable source)
const MINIFY = (process.env.NODE_ENV === 'production' || !!process.env.RENDER) && process.env.MINIFY_ASSETS !== '0';

let esbuild = null;
if (MINIFY) {
  try { esbuild = require('esbuild'); } catch (err) { console.error('[assets] esbuild is not available, files are served as they are:', err.message); }
}

// file -> { mtimeMs, size, hash, minified }
const cache = new Map();

function safePath(urlPath) {
  const rel = decodeURIComponent(String(urlPath || '')).replace(/^\/+/, '');
  const abs = path.join(PUBLIC_DIR, rel);
  return abs.startsWith(PUBLIC_DIR + path.sep) ? abs : null;
}

function entryOf(abs) {
  let st;
  try { st = fs.statSync(abs); } catch { return null; }
  if (!st.isFile()) return null;
  const hit = cache.get(abs);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
  const source = fs.readFileSync(abs);
  const entry = { mtimeMs: st.mtimeMs, size: st.size, hash: crypto.createHash('sha1').update(source).digest('hex').slice(0, 10), minified: null, source };
  cache.set(abs, entry);
  return entry;
}

// the short version of a public file ('/css/style.css' -> 'a1b2c3d4e5'), or null for a file that is not there
function versionOf(urlPath) {
  const abs = safePath(urlPath);
  const entry = abs && entryOf(abs);
  return entry ? entry.hash : null;
}

// adds ?v= to the local stylesheets and scripts of an HTML page (not to addresses that have a query already, nor to another website's)
function versionHtml(html) {
  if (typeof html !== 'string') return html;
  return html.replace(/(\b(?:src|href)=")(\/(?:css|js)\/[^"?#]+\.(?:css|js))(")/g, (m, a, file, b) => {
    const v = versionOf(file);
    return v ? `${a}${file}?v=${v}${b}` : m;
  });
}

// the minified body of a .js or .css file, or null when it is not minified (not production, not a js/css file, or esbuild refused it)
function minifiedBody(urlPath) {
  if (!esbuild) return null;
  const ext = path.extname(urlPath).toLowerCase();
  if (ext !== '.js' && ext !== '.css') return null;
  const abs = safePath(urlPath);
  const entry = abs && entryOf(abs);
  if (!entry) return null;
  if (entry.minified === null) {
    try {
      const out = esbuild.transformSync(entry.source.toString('utf8'), { loader: ext === '.js' ? 'js' : 'css', minify: true, legalComments: 'none', charset: 'utf8' });
      entry.minified = Buffer.from(out.code, 'utf8');
    } catch (err) {
      console.error('[assets] cannot minify', urlPath, err.message);
      entry.minified = false;
    }
  }
  return entry.minified || null;
}

// Express middleware: GET /js/x.js and /css/x.css answered minified (production only)
function serveMinified(req, res, next) {
  if (!esbuild || (req.method !== 'GET' && req.method !== 'HEAD') || !/^\/(?:js|css)\/[^/]+\.(?:js|css)$/.test(req.path)) return next();
  const body = minifiedBody(req.path);
  if (!body) return next();
  const version = versionOf(req.path);
  const etag = `W/"${version}-min"`;
  res.setHeader('Content-Type', req.path.endsWith('.css') ? 'text/css; charset=UTF-8' : 'application/javascript; charset=UTF-8');
  // a request with ?v= is for exactly this version of the file: kept for a year; without it the browser asks again each time (the 304 is short)
  res.setHeader('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=0');
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  return res.send(body);
}

// res.send of an HTML page: version the addresses of its scripts and styles
function versionSend(req, res, next) {
  const send = res.send;
  res.send = function patched(body) {
    if (typeof body === 'string' && /html/i.test(String(res.get('Content-Type') || ''))) body = versionHtml(body);
    return send.call(this, body);
  };
  next();
}

module.exports = { versionOf, versionHtml, minifiedBody, serveMinified, versionSend, MINIFY: !!MINIFY };
