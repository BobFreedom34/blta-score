// Who may read the API and the pages from JavaScript on ANOTHER site (CORS). Own sites only: blta.sk, slta.sk and their sub-domains
// (score., old., www.), the own domain of a city (Backend > Cities) and a local development host. A request without an Origin header
// (the page itself, curl, a search robot, an <iframe>) is not a cross-site read and is not affected.
const leagues = require('./leagues');

const OWN = /(^|\.)(blta|slta)\.sk$/;
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

function allowed(origin) {
  if (!origin) return true;
  let host;
  try { host = new URL(origin).hostname.toLowerCase(); } catch (e) { return false; }
  if (OWN.test(host) || LOCAL.test(host) || host.endsWith('.localhost')) return true;
  try { return !!leagues.forHost(host); } catch (e) { return false; }
}

// the form both `cors` and Socket.IO accept: (origin, callback)
function origin(requestOrigin, callback) { callback(null, allowed(requestOrigin)); }

module.exports = { allowed, origin };
