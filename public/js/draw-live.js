// "Žreb naživo" - the draw of a tournament category in front of the camera (public/draw-live.html). See src/liveDraw.js for how the draw is made and kept honest.
//   /draw-live?season=<id>&category=<ELITE|NEXT_GEN|NOVICE|DOUBLES|OPEN>&o=<json of the draw settings>   the organiser's draw (needs the organiser's login)
//   /draw-live?record=<id>                                                                                  the replay of a saved draw (public)
// The server makes the key and the plan (who goes where, in which order); this page only SHOWS it: the countdown, the seeded players going to their seats, then the
// roulette over the players that are left, stopping on the one the plan names, and the player flying to his seat. At the end the key is shown and the shuffle is checked
// again in the browser (public/js/draw-verify.js).
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qs = new URLSearchParams(location.search);
  const recordId = Number(qs.get('record')) || 0;
  const seasonId = Number(qs.get('season')) || 0;
  const category = qs.get('category') || '';
  let options = {};
  try { options = JSON.parse(qs.get('o') || '{}') || {}; } catch { options = {}; }
  const REPLAY = recordId > 0;

  const FORMAT_LABELS = {
    PRINCE: 'PRINCE', MONRAD: 'Monrad', ELIMINATION: 'Eliminácia', GROUPS: 'Skupiny', GROUPS_BRACKET: 'Skupiny + pavúk', SWISS: 'Švajčiarsky systém', SIX_ROUNDS: '6 hráčov, 3 kolá',
  };

  const S = {
    plan: null, seed: '', seedHash: '', recordId, attempt: 0, attempts: 0, record: null,
    tempo: 1, sound: true, paused: false, running: false, finished: false, committed: false,
    entrantEls: new Map(), slotEls: new Map(), done: 0, season: null,
  };
  try { S.sound = localStorage.getItem('dl_sound') !== '0'; } catch { /* the choice is just not remembered */ }

  // ---------- helpers ----------

  async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // waits ms (the time stands still while the draw is paused)
  async function sleep(ms) {
    let left = ms;
    while (left > 0) {
      const step = Math.min(left, 40);
      await new Promise((r) => setTimeout(r, step));
      if (!S.paused) left -= step;
    }
  }

  const collator = new Intl.Collator('sk');
  const entrantOf = (id) => S.plan.entrants.find((e) => e.id === id);
  const keyOf = (slot) => (slot.g !== undefined ? `g${slot.g}-${slot.i}` : slot.p !== undefined ? `p${slot.p}` : `t${slot.i}`);

  // ---------- sounds ----------

  const sfx = {
    ctx: null,
    init() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; }
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone(freq, ms, type, vol, when) {
      if (!S.sound || !this.ctx) return;
      const t = this.ctx.currentTime + (when || 0);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol || 0.08, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + ms / 1000 + 0.03);
    },
    tick(p) { this.tone(520 + 700 * p, 40, 'square', 0.035); },
    ding() { this.tone(880, 220, 'sine', 0.12); this.tone(1318, 460, 'sine', 0.1, 0.09); },
    land() { this.tone(170, 150, 'triangle', 0.18); },
    beep(high) { this.tone(high ? 1250 : 820, high ? 520 : 170, 'sine', 0.15); },
    whoosh() { this.tone(300, 260, 'sawtooth', 0.025); this.tone(540, 220, 'sine', 0.035, 0.05); },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 300, 'triangle', 0.13, i * 0.13)); this.tone(1319, 700, 'triangle', 0.12, 0.55); },
  };

  // ---------- confetti ----------

  const cv = $('dl-confetti');
  const cx = cv.getContext('2d');
  let parts = [];
  let raf = 0;
  function fitCanvas() { cv.width = window.innerWidth; cv.height = window.innerHeight; }
  window.addEventListener('resize', fitCanvas);
  fitCanvas();
  function burst(x, y, n, power) {
    const colors = ['#b2fa06', '#ff5500', '#ffffff', '#e4ff7a', '#ffb802'];
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const sp = (3 + Math.random() * 9) * power;
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 5 * power, g: 0.22 + Math.random() * 0.14, s: 5 + Math.random() * 8, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: colors[i % colors.length], life: 80 + Math.random() * 70 });
    }
    if (!raf) raf = requestAnimationFrame(confettiLoop);
  }
  function confettiLoop() {
    cx.clearRect(0, 0, cv.width, cv.height);
    parts = parts.filter((p) => p.life > 0 && p.y < cv.height + 40);
    parts.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.992; p.r += p.vr; p.life -= 1;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.globalAlpha = Math.min(1, p.life / 30); cx.fillStyle = p.c; cx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.6); cx.restore();
    });
    raf = parts.length ? requestAnimationFrame(confettiLoop) : 0;
  }
  const burstAt = (el, n, power) => { const r = el.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, n, power); };

  // ---------- the page ----------

  function setCaption(label, html) { $('dl-cap-label').textContent = label; $('dl-cap-main').innerHTML = html; }
  function setProgress(done, total) {
    $('dl-progress').hidden = false;
    $('dl-progress-n').textContent = `${done} / ${total}`;
    $('dl-bar-i').style.width = `${total ? Math.round((100 * done) / total) : 0}%`;
  }
  function showError(text) { const box = $('dl-error'); box.hidden = !text; box.textContent = text || ''; }
  const shortHash = (h) => `${h.slice(0, 10)}…${h.slice(-8)}`;

  function describeTarget(slot) {
    const layout = S.plan.layout;
    if (layout.type === 'GROUPS') return `${esc(layout.groups[slot.g].name)} <small>· miesto ${slot.i + 1}</small>`;
    if (layout.type === 'BRACKET') return `Zápas ${Math.floor(slot.p / 2) + 1} <small>· pozícia ${slot.p % 2 === 0 ? 'A' : 'B'}</small>`;
    return `Tabuľka <small>· miesto ${slot.i + 1}</small>`;
  }
  const cardOfSlot = (slotEl) => slotEl.closest('.dl-card-box');

  // sizes (in units of the page: 1/1920 of the width) so that the players and the board fill the screen whatever their number
  function fitBoard(cards, rowsOfCard, minWidth, boardW, boardH, fixedH, gap, cap) {
    // -> { cols, slotH }: the fewest columns of cards whose seats can be as tall as `cap` (else the columns that give the tallest seats): few wide cards with big names beat many small ones
    let best = null;
    for (let cols = 1; cols <= cards; cols += 1) {
      if (boardW / cols - gap < minWidth && cols > 1) break;
      const gridRows = Math.ceil(cards / cols);
      const slotH = ((boardH - (gridRows - 1) * gap) / gridRows - fixedH - (rowsOfCard - 1) * 5) / rowsOfCard;
      if (slotH >= cap) return { cols, slotH };
      if (!best || slotH > best.slotH + 0.5) best = { cols, slotH };
    }
    return best || { cols: 1, slotH: 30 };
  }

  function buildBoard() {
    const plan = S.plan;
    S.entrantEls = new Map();
    S.slotEls = new Map();
    S.done = 0;
    // the players on the left (in the order of the alphabet, so the list says nothing about the draw)
    const list = $('dl-pool-list');
    const sorted = [...plan.entrants].sort((a, b) => collator.compare(a.name, b.name));
    const n = sorted.length;
    const cols = n > 60 ? 3 : n > 22 ? 2 : 1;
    const rows = Math.ceil(n / cols);
    const poolW = cols === 1 ? 400 : cols === 2 ? 640 : 880;
    $('dl-main').style.setProperty('--pool-w', `calc(var(--u) * ${poolW})`);
    list.style.setProperty('--cols', cols);
    list.style.setProperty('--rows', rows);
    list.style.setProperty('--pool-font', Math.max(12, Math.min(26, Math.floor((600 / rows) * 0.52))));
    list.innerHTML = sorted.map((e) => `<li class="dl-pool-item" data-e="${e.id}"><span class="dl-n">${esc(e.name)}</span>${e.seed ? `<span class="dl-seed">S${e.seed}</span>` : ''}</li>`).join('');
    list.querySelectorAll('.dl-pool-item').forEach((li) => S.entrantEls.set(Number(li.dataset.e), li));
    $('dl-pool-n').textContent = `${n}`;

    // the seats that are kept for the seeded players show their seed number from the start
    const reserved = new Map(plan.steps.filter((s) => s.kind === 'SEED').map((s) => [keyOf(s.slot), entrantOf(s.e).seed]));
    const slotHtml = (key, no, extra) => {
      const seedNo = reserved.get(key);
      const ph = extra === 'bye' ? 'voľný žreb' : seedNo ? `nasadený #${seedNo}` : '—';
      return `<div class="dl-slot${seedNo ? ' dl-reserved' : ''}${extra === 'bye' ? ' dl-bye' : ''}" data-key="${key}"><span class="dl-slot-no">${no}</span><span class="dl-slot-name"><span class="dl-slot-ph">${ph}</span></span></div>`;
    };
    const board = $('dl-board');
    const layout = plan.layout;
    const boardW = 1920 - 72 - 24 - poolW;
    const boardH = 650;
    let html = '';
    let cardCols = 1;
    let slotH = 40;
    let headFont = 22;
    if (layout.type === 'GROUPS') {
      const maxSize = Math.max(...layout.groups.map((g) => g.size));
      const fit = fitBoard(layout.groups.length, maxSize, 250, boardW, boardH, 56, 16, 52);
      cardCols = fit.cols; slotH = Math.max(24, Math.min(66, fit.slotH));
      html = layout.groups.map((g, gi) => `<div class="dl-card-box" data-g="${gi}"><div class="dl-card-head"><span>${esc(g.name)}</span><span>${g.size}</span></div><div class="dl-card-body">${Array.from({ length: g.size }, (_, i) => slotHtml(`g${gi}-${i}`, i + 1)).join('')}</div></div>`).join('');
    } else if (layout.type === 'BRACKET') {
      const matches = layout.size / 2;
      const fit = fitBoard(matches, 2, 270, boardW, boardH, 56, 16, 48);
      cardCols = fit.cols; slotH = Math.max(22, Math.min(60, fit.slotH)); headFont = 17;
      html = Array.from({ length: matches }, (_, m) => {
        const seats = [layout.seats[2 * m], layout.seats[2 * m + 1]];
        return `<div class="dl-card-box" data-m="${m}"><div class="dl-card-head"><span>Zápas ${m + 1}</span><span>1. kolo</span></div><div class="dl-card-body">${seats.map((seat, k) => slotHtml(`p${seat.p}`, k === 0 ? 'A' : 'B', seat.bye ? 'bye' : '')).join('')}</div></div>`;
      }).join('');
    } else {
      const size = layout.size;
      const two = size > 9;
      const per = two ? Math.ceil(size / 2) : size;
      const fit = fitBoard(1, per, 400, boardW, boardH, 56, 16, 70);
      slotH = Math.max(26, Math.min(70, fit.slotH));
      html = `<div class="dl-card-box" style="grid-column: 1 / -1"><div class="dl-card-head"><span>${plan.format === 'SWISS' ? 'Švajčiarsky systém' : 'Tabuľka 6 hráčov'}</span><span>${size}</span></div><div class="dl-card-body" style="grid-template-columns: repeat(${two ? 2 : 1}, minmax(0, 1fr)); grid-auto-flow: column; grid-template-rows: repeat(${per}, auto)">${Array.from({ length: size }, (_, i) => slotHtml(`t${i}`, i + 1)).join('')}</div></div>`;
    }
    board.style.setProperty('--bcols', cardCols);
    board.style.setProperty('--slot-h', slotH.toFixed(1));
    board.style.setProperty('--slot-font', Math.max(13, Math.min(30, Math.floor(slotH * 0.5))));
    board.style.setProperty('--head-font', headFont);
    board.innerHTML = html;
    board.querySelectorAll('.dl-slot').forEach((el) => S.slotEls.set(el.dataset.key, el));
    setProgress(0, plan.steps.length);
    $('dl-title').textContent = plan.season.name;
    $('dl-cat').hidden = false; $('dl-cat').textContent = plan.categoryLabel;
    $('dl-format').hidden = false; $('dl-format').textContent = FORMAT_LABELS[plan.format] || plan.format;
    const lock = $('dl-lock');
    lock.hidden = false;
    lock.textContent = `🔒 zámok ${shortHash(S.seedHash)}`;
    lock.title = `Zámok žrebu (SHA-256 kľúča): ${S.seedHash}. Kliknutím ho skopíruješ. Kľúč sa ukáže po žrebe.`;
  }

  // ---------- the draw ----------

  // the player flies from his place in the list to his seat
  function fly(li, slotEl, ms, seeded) {
    return new Promise((resolve) => {
      const a = li.getBoundingClientRect();
      const b = slotEl.getBoundingClientRect();
      const el = document.createElement('div');
      el.className = `dl-fly${seeded ? ' dl-seeded' : ''}`;
      el.textContent = li.querySelector('.dl-n').textContent;
      const f0 = getComputedStyle(li).fontSize;
      const f1 = getComputedStyle(slotEl).fontSize;
      el.style.cssText = `left:${a.left}px;top:${a.top}px;width:${a.width}px;height:${a.height}px;font-size:${f0}`;
      $('dl-app').appendChild(el);
      const frames = [
        { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`, fontSize: f0, transform: 'translateY(0) scale(1)' },
        { left: `${(a.left + b.left) / 2}px`, top: `${(a.top + b.top) / 2}px`, width: `${(a.width + b.width) / 2}px`, height: `${(a.height + b.height) / 2}px`, fontSize: f1, transform: 'translateY(-34px) scale(1.12)', offset: 0.5 },
        { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`, fontSize: f1, transform: 'translateY(0) scale(1)' },
      ];
      sfx.whoosh();
      const anim = el.animate(frames, { duration: ms, easing: 'cubic-bezier(.45,.05,.2,1)', fill: 'forwards' });
      anim.onfinish = () => { el.remove(); resolve(); };
    });
  }

  // the player is in his seat
  function place(step, slotEl) {
    const ent = entrantOf(step.e);
    const li = S.entrantEls.get(step.e);
    slotEl.classList.remove('dl-next', 'dl-reserved');
    slotEl.classList.add('dl-filled');
    if (step.kind === 'SEED') slotEl.classList.add('dl-was-seed');
    slotEl.querySelector('.dl-slot-name').innerHTML = `${esc(ent.name)}${ent.seed && step.kind === 'SEED' ? ` <span class="dl-seed">S${ent.seed}</span>` : ''}`;
    li.classList.remove('dl-hot', 'dl-seedhot', 'dl-picked');
    li.classList.add('dl-gone');
    S.done += 1;
    setProgress(S.done, S.plan.steps.length);
    sfx.land();
    const card = cardOfSlot(slotEl);
    if (card) card.classList.remove('dl-active');
  }

  async function seatSeeded(step) {
    const ent = entrantOf(step.e);
    const li = S.entrantEls.get(step.e);
    const slotEl = S.slotEls.get(keyOf(step.slot));
    setCaption(`NASADENÝ #${ent.seed}`, `<em>${esc(ent.name)}</em> <small>→ ${describeTarget(step.slot)}</small>`);
    li.classList.add('dl-seedhot');
    const card = cardOfSlot(slotEl);
    if (card) card.classList.add('dl-active');
    await sleep(650 / S.tempo);
    await fly(li, slotEl, 950 / S.tempo, true);
    place(step, slotEl);
    await sleep(330 / S.tempo);
  }

  // the roulette: the light runs over the players that are left, slows down and stops on the one the plan names
  async function spin(rem, targetLi, ms) {
    const n = rem.length;
    const idx = rem.indexOf(targetLi);
    const hot = (li) => { rem.forEach((x) => x.classList.remove('dl-hot')); li.classList.add('dl-hot'); };
    if (n === 1) { hot(rem[0]); sfx.tick(1); await sleep(700 / S.tempo); return; }
    const start = Math.floor(Math.random() * n); // (only where the light starts; where it stops is the plan)
    const wanted = Math.max(14, Math.round(ms / 80));
    const laps = Math.max(1, Math.ceil(wanted / n));
    const total = laps * n + ((idx - start + n) % n);
    for (let k = 1; k <= total; k += 1) {
      hot(rem[(start + k) % n]);
      sfx.tick(k / total);
      let wait = ms * (Math.pow(k / total, 2.5) - Math.pow((k - 1) / total, 2.5));
      if (k > total - 4) wait *= 1.55;
      await sleep(Math.max(20, wait));
    }
  }

  async function drawOne(step, index, count) {
    const ent = entrantOf(step.e);
    const li = S.entrantEls.get(step.e);
    const slotEl = S.slotEls.get(keyOf(step.slot));
    const rem = [...S.entrantEls.values()].filter((x) => !x.classList.contains('dl-gone'));
    const card = cardOfSlot(slotEl);
    if (card) card.classList.add('dl-active');
    slotEl.classList.add('dl-next');
    setCaption('ŽREBUJE SA', `${describeTarget(step.slot)}`);
    await sleep(380 / S.tempo);
    const left = count - index;
    const ms = (left <= 2 ? 2300 : left <= 4 ? 3000 : 3700) / S.tempo;
    await spin(rem, li, ms);
    rem.forEach((x) => x.classList.remove('dl-hot'));
    li.classList.add('dl-picked');
    sfx.ding();
    burstAt(li, 36, 0.8);
    setCaption(rem.length === 1 ? 'POSLEDNÝ HRÁČ' : 'VYŽREBOVANÝ', `<em>${esc(ent.name)}</em> <small>→ ${describeTarget(step.slot)}</small>`);
    await sleep(1050 / S.tempo);
    await fly(li, slotEl, 1000 / S.tempo, false);
    place(step, slotEl);
    await sleep(380 / S.tempo);
  }

  async function run() {
    S.running = true;
    S.finished = false;
    $('dl-t-pause').hidden = false;
    document.body.classList.add('dl-running');
    const seeds = S.plan.steps.filter((s) => s.kind === 'SEED');
    const rest = S.plan.steps.filter((s) => s.kind !== 'SEED');
    if (seeds.length) {
      setCaption('NASADENÍ HRÁČI', 'Nasadení hráči idú na svoje miesta');
      await sleep(1100 / S.tempo);
      for (const step of seeds) await seatSeeded(step);
      await sleep(500 / S.tempo);
    }
    if (rest.length) {
      setCaption('ŽREB', 'Ostatných hráčov určí náhoda');
      await sleep(1300 / S.tempo);
      for (let i = 0; i < rest.length; i += 1) await drawOne(rest[i], i, rest.length);
    }
    await finish();
  }

  // ---------- the end ----------

  async function finish() {
    S.running = false;
    S.finished = true;
    $('dl-t-pause').hidden = true;
    document.body.classList.remove('dl-running', 'dl-idle');
    setCaption('ŽREB JE HOTOVÝ', `<em>${esc(S.plan.season.name)}</em> <small>· ${esc(S.plan.categoryLabel)}</small>`);
    sfx.fanfare();
    const w = window.innerWidth;
    const h = window.innerHeight;
    burst(w * 0.2, h * 0.85, 120, 1.5);
    setTimeout(() => burst(w * 0.8, h * 0.85, 120, 1.5), 250);
    setTimeout(() => burst(w * 0.5, h * 0.7, 160, 1.7), 520);
    renderFinal();
    const autosave = !REPLAY && $('dl-autosave').checked;
    if (autosave) { await sleep(2500); commit(); }
  }

  async function renderFinal() {
    $('dl-caption').hidden = true;
    $('dl-final').hidden = false;
    $('dl-final-title').textContent = `${S.plan.season.name} · ${S.plan.categoryLabel}`;
    $('dl-v-lock').textContent = S.seedHash;
    $('dl-v-seed').textContent = S.seed;
    const result = $('dl-v-result');
    result.className = 'dl-v-result';
    result.textContent = 'Overujem…';
    result.title = 'Rozhodol kľúč, ktorý server vytvoril pred začiatkom (zámok bol hore na obrazovke). Z kľúča a zoznamu hráčov sa dá žreb zopakovať: overenie to práve spravilo v tomto prehliadači. Kolotoč je len zobrazenie už určeného výsledku.';
    const actions = $('dl-final-actions');
    const buttons = [];
    if (!REPLAY && !S.committed) buttons.push('<button type="button" class="dl-btn dl-btn-primary" id="dl-a-save">Uložiť žreb do turnaja</button>');
    buttons.push('<button type="button" class="dl-btn" id="dl-a-replay">Prehrať znova</button>');
    if (!REPLAY && !S.committed) buttons.push('<button type="button" class="dl-btn" id="dl-a-new">Nový žreb (tento sa zahodí)</button>');
    buttons.push(`<a class="dl-btn" href="/tournament/${encodeURIComponent(S.plan.season.slug)}">Stránka turnaja</a>`);
    actions.innerHTML = buttons.join('');
    const save = $('dl-a-save'); if (save) save.onclick = commit;
    $('dl-a-replay').onclick = replay;
    const again = $('dl-a-new'); if (again) again.onclick = () => { if (confirm('Žreb sa zahodí a spustí sa nový. Každé spustenie sa zapisuje do záznamu. Pokračovať?')) { S.committed = true; location.reload(); } };
    try {
      const v = await window.DrawVerify.verifyRecord({ seed: S.seed, seedHash: S.seedHash, plan: S.plan });
      if (v.ok) { result.className = 'dl-v-result ok'; result.textContent = '✓ Overené: zámok sedí a žreb sa dá z kľúča zopakovať'; } else { result.className = 'dl-v-result bad'; result.textContent = `✗ ${v.problems.join('; ')}`; }
    } catch (err) { result.className = 'dl-v-result bad'; result.textContent = `Overenie sa nepodarilo: ${err.message}`; }
  }

  async function commit() {
    const btn = $('dl-a-save');
    if (btn) btn.disabled = true;
    try {
      const made = await api(`/seasons/${seasonId}/draw/live/commit`, { method: 'POST', body: { recordId: S.recordId } });
      S.committed = true;
      const url = `${location.origin}/draw-live?record=${made.recordId || S.recordId}`;
      const box = $('dl-saved');
      box.hidden = false;
      box.innerHTML = `✓ Žreb je uložený v turnaji. Záznam, ktorý môže ktokoľvek prehrať a overiť: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a> <button type="button" class="dl-btn" id="dl-a-copy" style="padding:3px 10px;font-size:inherit">Kopírovať</button>`;
      $('dl-a-copy').onclick = () => { navigator.clipboard.writeText(url).catch(() => {}); $('dl-a-copy').textContent = 'Skopírované'; };
      ['dl-a-save', 'dl-a-new'].forEach((id) => { const b = $(id); if (b) b.remove(); });
    } catch (err) {
      if (btn) btn.disabled = false;
      const box = $('dl-saved');
      box.hidden = false;
      box.textContent = `Žreb sa nepodarilo uložiť: ${err.message}`;
    }
  }

  async function replay() {
    $('dl-final').hidden = true;
    $('dl-caption').hidden = false;
    buildBoard();
    S.tempo = Number($('dl-tempo').value) || 1;
    await sleep(500);
    await run();
  }

  // ---------- the start ----------

  async function start() {
    if (S.running) return;
    S.running = true;
    sfx.init();
    S.tempo = Number($('dl-tempo').value) || 1;
    showError('');
    $('dl-setup').hidden = true;
    const ov = $('dl-countdown');
    ov.hidden = false;
    $('dl-count-text').textContent = 'Žreb sa začína';
    // the lot is made on the server while the countdown runs
    const prepared = REPLAY ? null : api(`/seasons/${seasonId}/draw/live/prepare`, { method: 'POST', body: { category, ...options } }).catch((err) => ({ failed: err }));
    for (let n = 5; n >= 1; n -= 1) {
      if (n === 3) {
        if (REPLAY) buildBoard();
        else {
          const r = await prepared;
          if (r.failed) { ov.hidden = true; $('dl-setup').hidden = false; S.running = false; showError(r.failed.message); return; }
          S.plan = r.plan; S.seed = r.seed; S.seedHash = r.seedHash; S.recordId = r.recordId; S.attempt = r.attempt;
          buildBoard();
        }
        $('dl-pool-list').scrollTop = 0;
      }
      const num = $('dl-count-num');
      num.textContent = n;
      num.classList.remove('dl-tick'); void num.offsetWidth; num.classList.add('dl-tick');
      sfx.beep(false);
      await sleep(1000);
    }
    sfx.beep(true);
    $('dl-count-text').textContent = 'Žrebujeme!';
    $('dl-count-num').textContent = '✓';
    await sleep(650);
    ov.hidden = true;
    setCaption(REPLAY ? 'ZÁZNAM ŽREBU' : 'ŽREB', REPLAY ? `Záznam č. ${S.recordId} <small>· spustení žrebu: ${S.record.attempts}</small>` : `Pokus č. ${S.attempt} <small>· každé spustenie sa zapisuje</small>`);
    await sleep(900);
    await run();
  }

  // ---------- opening the page ----------

  function fact(label, value) { return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`; }

  async function initLive() {
    $('dl-autosave-wrap').hidden = false;
    if (!seasonId || !category) throw new Error('Chýba turnaj alebo kategória. Otvor žreb tlačidlom v nastaveniach turnaja.');
    const [season, overview] = await Promise.all([api(`/seasons/${seasonId}`), api(`/seasons/${seasonId}/draw`)]);
    const cat = overview.categories.find((c) => c.category === category);
    if (!cat) throw new Error('Táto kategória v turnaji nie je.');
    S.season = season;
    $('dl-title').textContent = season.name;
    $('dl-setup-title').textContent = season.name;
    $('dl-setup-sub').textContent = `Žreb kategórie ${cat.label}`;
    const format = options.format || (cat.settings && cat.settings.format) || '';
    $('dl-facts').innerHTML = [
      fact('Hráčov', cat.players), fact('Nasadených', cat.seeded), fact('Formát', FORMAT_LABELS[format] || format),
      /GROUPS/.test(format) ? fact('Skupín', options.groupCount || 'auto') : fact('Pavúk', cat.size ? `na ${cat.size}` : '—'),
    ].join('');
    if (cat.stage !== 'NONE') throw new Error('Žreb tejto kategórie už existuje. Najprv ho zmaž v nastaveniach turnaja.');
    if (cat.players < 2) throw new Error('Treba aspoň 2 hráčov.');
    $('dl-start').disabled = false;
    $('dl-start').textContent = 'Spustiť žreb';
  }

  async function initReplay() {
    $('dl-controls').querySelectorAll('.dl-check').forEach((el) => { el.hidden = true; });
    $('dl-eyebrow').textContent = 'ZÁZNAM ŽREBU';
    $('dl-setup-eyebrow').textContent = 'ZÁZNAM ŽREBU';
    const rec = await api(`/draw-records/${recordId}`);
    S.record = rec;
    S.plan = rec.plan; S.seed = rec.seed; S.seedHash = rec.seedHash; S.attempts = rec.attempts;
    $('dl-title').textContent = rec.seasonName;
    $('dl-setup-title').textContent = rec.seasonName;
    $('dl-setup-sub').textContent = `Žreb kategórie ${rec.plan.categoryLabel}${rec.deleted ? ' (tento žreb bol neskôr zmazaný organizátorom)' : ''}`;
    const when = rec.committedAt ? new Date(rec.committedAt).toLocaleDateString('sk-SK') : '';
    $('dl-facts').innerHTML = [fact('Hráčov', rec.plan.entrants.length), fact('Formát', FORMAT_LABELS[rec.format] || rec.format), fact('Uložený', when), fact('Spustení žrebu', rec.attempts)].join('');
    $('dl-start').disabled = false;
    $('dl-start').textContent = 'Prehrať žreb';
    $('dl-hint').innerHTML = 'Na konci sa ukáže kľúč žrebu a prehliadač zopakuje žreb z kľúča: tak sa dá overiť, že výsledok nebol vopred upravený. Spustení žrebu = koľkokrát organizátor žreb tejto kategórie spustil.';
  }

  async function boot() {
    try {
      if (REPLAY) await initReplay(); else await initLive();
    } catch (err) {
      $('dl-setup-title').textContent = REPLAY ? 'Záznam sa nenašiel' : 'Žreb sa nedá spustiť';
      showError(err.status === 401 || err.status === 403 ? 'Žreb môže spustiť len organizátor turnaja: prihlás sa do Backendu a otvor žreb tlačidlom v nastaveniach turnaja.' : err.message);
      $('dl-start').hidden = true;
      $('dl-controls').hidden = true;
    }
  }

  // ---------- controls ----------

  function togglePause() { if (!S.running) return; S.paused = !S.paused; document.getElementById('dl-app').classList.toggle('dl-paused', S.paused); }
  function toggleSound() { S.sound = !S.sound; $('dl-t-sound').classList.toggle('dl-off', !S.sound); $('dl-sound').checked = S.sound; try { localStorage.setItem('dl_sound', S.sound ? '1' : '0'); } catch { /* not remembered */ } }
  function toggleFull() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }

  $('dl-start').onclick = start;
  $('dl-t-pause').onclick = togglePause;
  $('dl-t-sound').onclick = toggleSound;
  $('dl-t-full').onclick = toggleFull;
  $('dl-sound').checked = S.sound;
  $('dl-t-sound').classList.toggle('dl-off', !S.sound);
  $('dl-sound').onchange = () => { if ($('dl-sound').checked !== S.sound) toggleSound(); };
  $('dl-lock').onclick = () => { navigator.clipboard.writeText(S.seedHash).catch(() => {}); };
  document.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'f') toggleFull();
    else if (k === 'm') toggleSound();
    else if (e.code === 'Space' || e.key === 'Enter') {
      e.preventDefault();
      if (!S.running && !S.finished && !$('dl-setup').hidden && !$('dl-start').disabled) start(); else togglePause();
    }
  });
  // the cursor and the buttons go away while the draw runs (a clean picture for the stream)
  let idleTimer = 0;
  document.addEventListener('mousemove', () => {
    document.body.classList.remove('dl-idle');
    clearTimeout(idleTimer);
    if (S.running) idleTimer = setTimeout(() => document.body.classList.add('dl-idle'), 2500);
  });
  window.addEventListener('beforeunload', (e) => {
    if (!REPLAY && S.plan && !S.committed && (S.running || S.finished)) { e.preventDefault(); e.returnValue = ''; }
  });

  boot();
}());
