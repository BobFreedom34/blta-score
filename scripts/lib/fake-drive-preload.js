// A fake Google Drive for a child server in a check script: run it with  node --require this-file  (or NODE_OPTIONS=--require …).
// google-auth-library hands out a fixed token, and global.fetch answers the Drive calls of src/drivePhotos.js from memory:
// upload, permission create / delete, file delete. Any other URL goes on to the real fetch.
//   FAKE_DRIVE_LOG   path of a file that gets one JSON line appended per Drive call: { op, id, mime?, size? }
//                    op = upload | permCreate | permDelete | fileDelete
//   FAKE_DRIVE_FAIL  path of a file; while it exists every Drive call answers 500 (nothing is logged or stored)
//   FAKE_DRIVE_DELAY milliseconds an upload takes (default 40), so that two simultaneous uploads really overlap
const fs = require('fs');
const Module = require('module');

const realLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'google-auth-library') {
    return { OAuth2Client: class { setCredentials() {} async getAccessToken() { return { token: 'fake-token' }; } } };
  }
  return realLoad.call(this, request, ...rest);
};

const files = new Map(); // id -> { name, mime, size }
let nextId = 1;
const delay = Number(process.env.FAKE_DRIVE_DELAY || 40);

function log(entry) {
  if (process.env.FAKE_DRIVE_LOG) fs.appendFileSync(process.env.FAKE_DRIVE_LOG, `${JSON.stringify(entry)}\n`);
}

const realFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.includes('googleapis.com')) return realFetch(url, init);
  const reply = (data, status = 200) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
  if (process.env.FAKE_DRIVE_FAIL && fs.existsSync(process.env.FAKE_DRIVE_FAIL)) return reply({ error: 'fake drive is told to fail' }, 500);
  const method = (init.method || 'GET').toUpperCase();

  if (method === 'POST' && u.includes('/upload/drive/v3/files')) {
    const body = Buffer.from(init.body);
    const text = body.toString('latin1');
    // two parts: the metadata JSON, then the file ("Content-Type: <mime>", a blank line, the bytes, the closing boundary)
    const secondHeader = text.indexOf('Content-Type: ', text.indexOf('Content-Type: ') + 1);
    const mime = text.slice(secondHeader + 14, text.indexOf('\r\n', secondHeader));
    const dataStart = text.indexOf('\r\n\r\n', secondHeader) + 4;
    const size = text.lastIndexOf('\r\n--') - dataStart;
    await new Promise((r) => setTimeout(r, delay));
    const id = `fake${nextId++}`;
    files.set(id, { name: JSON.parse(text.match(/\{.*\}/)[0]).name, mime, size });
    log({ op: 'upload', id, mime, size });
    return reply({ id, name: files.get(id).name });
  }
  let m = u.match(/\/drive\/v3\/files\/([^/?]+)\/permissions\/anyoneWithLink/);
  if (method === 'DELETE' && m) {
    log({ op: 'permDelete', id: decodeURIComponent(m[1]) });
    return reply({}, 204);
  }
  m = u.match(/\/drive\/v3\/files\/([^/?]+)\/permissions/);
  if (method === 'POST' && m) {
    log({ op: 'permCreate', id: decodeURIComponent(m[1]) });
    return reply({ id: 'anyoneWithLink' });
  }
  m = u.match(/\/drive\/v3\/files\/([^/?]+)$/);
  if (method === 'DELETE' && m) {
    const id = decodeURIComponent(m[1]);
    files.delete(id);
    log({ op: 'fileDelete', id });
    return reply({}, 204);
  }
  throw new Error(`fake Drive: unexpected request ${method} ${u}`);
};
