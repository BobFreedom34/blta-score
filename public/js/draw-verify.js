// The check of a draw that was made in front of the camera (see src/liveDraw.js): from the KEY of the record and the list of players the shuffle is made again, here in the
// browser (WebCrypto), and compared with what was shown and saved. Used by the page /draw-live (the box "Overenie") and by the checks (npm test), so the page and the
// server are proven to agree.
//   random number i = first 6 bytes of HMAC-SHA256(key, i in decimal) / 2^48; a shuffle is Fisher-Yates from the end: j = floor(random * (i + 1)).
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.DrawVerify = lib;
}(typeof self !== 'undefined' ? self : this, function () {
  const subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
  const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const unhex = (text) => new Uint8Array((text.match(/../g) || []).map((h) => parseInt(h, 16)));

  async function sha256Hex(text) {
    return hex(await subtle.digest('SHA-256', new TextEncoder().encode(text)));
  }

  async function randomFor(seedHex) {
    const key = await subtle.importKey('raw', unhex(seedHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    let counter = 0;
    return async () => {
      const sig = new Uint8Array(await subtle.sign('HMAC', key, new TextEncoder().encode(String(counter))));
      counter += 1;
      let v = 0;
      for (let i = 0; i < 6; i += 1) v = v * 256 + sig[i];
      return v / 2 ** 48;
    };
  }

  async function shuffled(list, random) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor((await random()) * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // the seed number of every seat of a bracket of this size, top to bottom (the standard seeding)
  function standardSeedOrder(size) {
    let order = [1, 2];
    while (order.length < size) {
      const newSize = order.length * 2;
      const mirrored = [];
      order.forEach((seed) => { mirrored.push(seed, newSize + 1 - seed); });
      order = mirrored;
    }
    return order;
  }

  // -> { ok, lockOk, problems: [text] }
  async function verifyRecord(record) {
    const problems = [];
    if (!subtle) return { ok: false, lockOk: false, problems: ['This browser cannot do the check (no WebCrypto)'] };
    const lockOk = (await sha256Hex(record.seed)) === record.seedHash;
    if (!lockOk) problems.push('The key does not fit the lock shown before the draw');
    const plan = record.plan;
    const entrants = [...plan.entrants].sort((a, b) => a.input - b.input);
    const seeded = entrants.filter((e) => e.seed).sort((a, b) => a.seed - b.seed);
    const unseeded = entrants.filter((e) => !e.seed);
    const random = await randomFor(record.seed);
    const layout = plan.layout;
    const shown = new Map(plan.steps.map((s) => [s.e, s.slot]));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const check = (id, slot) => { if (!same(shown.get(id), slot)) problems.push(`The seat of ${(entrants.find((e) => e.id === id) || {}).name || id} does not match the shuffle`); };

    if (layout.type === 'TABLE') {
      let order;
      if (plan.format === 'SIX_ROUNDS') order = await shuffled(entrants, random);
      else {
        const keyed = [];
        for (const e of unseeded) keyed.push({ e, k: await random() });
        order = [...seeded, ...keyed.sort((a, b) => a.k - b.k).map((x) => x.e)];
      }
      order.forEach((e, i) => check(e.id, { i }));
    } else if (layout.type === 'BRACKET') {
      const order = [...seeded, ...(await shuffled(unseeded, random))]; // seed numbers 1..n
      const seats = standardSeedOrder(layout.size);
      seats.forEach((seedNo, p) => { if (seedNo <= order.length) check(order[seedNo - 1].id, { p }); });
    } else {
      const order = [...seeded, ...(await shuffled(unseeded, random))];
      const count = layout.groups.length;
      order.forEach((e, i) => {
        const row = Math.floor(i / count);
        const col = i % count;
        check(e.id, { g: row % 2 === 0 ? col : count - 1 - col, i: row });
      });
    }
    return { ok: !problems.length, lockOk, problems };
  }

  return { verifyRecord, sha256Hex, randomFor, shuffled, standardSeedOrder };
}));
