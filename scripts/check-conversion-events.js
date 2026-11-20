// Checks the ad conversions (Meta Pixel via Google Tag Manager): blta_complete_registration and blta_lead are pushed to the dataLayer only AFTER the server
// said yes (right after the awaited POST), never on page load, and trackConversion never throws.
// Run: node scripts/check-conversion-events.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8');

function test(name, fn) { try { fn(); console.log('ok  ', name); } catch (e) { console.error('FAIL', name, '-', e.message); process.exitCode = 1; } }

test('trackConversion pushes the event with a unique event_id to the dataLayer and never throws', () => {
  const src = read('common.js');
  const code = src.slice(src.indexOf('function trackConversion'), src.indexOf('function escapeHtml'));
  const win = {};
  const f = new Function('window', `${code}; return trackConversion;`)(win);
  f('blta_lead', { content_name: 'X' }); f('blta_lead');
  assert.strictEqual(win.dataLayer.length, 2);
  assert.strictEqual(win.dataLayer[0].event, 'blta_lead');
  assert.strictEqual(win.dataLayer[0].content_name, 'X');
  assert.notStrictEqual(win.dataLayer[0].event_id, win.dataLayer[1].event_id);
  const broken = new Function('window', `${code}; return trackConversion;`)(Object.defineProperty({}, 'dataLayer', { get() { throw new Error('x'); } }));
  broken('blta_lead');
});

test('the player sign-up fires blta_complete_registration right after the POST /player/register succeeded', () => {
  const s = read('common-player.js');
  const post = s.indexOf("api('/player/register'");
  const ev = s.indexOf("trackConversion('blta_complete_registration')");
  assert.ok(post > 0 && ev > post && ev - post < 400, 'after the awaited POST');
  assert.ok(s.slice(post, ev).indexOf('catch') === -1, 'not in the catch');
});

test('the event registration fires blta_lead right after the POST of the registration succeeded, not on load', () => {
  const s = read('season.js');
  const post = s.indexOf('`/seasons/${season.id}/registrations`, {\n        method: \'POST\'') >= 0 ? s.indexOf('`/seasons/${season.id}/registrations`, {') : s.indexOf('/registrations`, {');
  const ev = s.indexOf("trackConversion('blta_lead'");
  assert.ok(post > 0 && ev > post, 'after the POST');
  assert.ok(!s.slice(post, ev).includes('} catch (err)'), 'before the catch, so a refusal sends nothing');
  assert.strictEqual(s.split("trackConversion('blta_lead'").length, 2, 'one place only');
});
