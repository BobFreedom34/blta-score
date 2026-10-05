// The picture shown in a link preview (WhatsApp, Messenger, Slack…) of a finished match: the result in the app's style.
//
// 1200 x 630 is the size those apps show as a large card without cropping (aspect ratio 1.91:1); everything that
// matters stays inside a 60px margin so no app that rounds the corners or trims the edge can cut anything off.
// Drawn as an SVG and rasterised to PNG with resvg (no browser needed); the Montserrat font files live in
// assets/fonts so the text looks like the app on any server.

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const WIDTH = 1200;
const HEIGHT = 630;
const M = 60; // safe margin

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const RESVG_FONT = {
  fontFiles: ['Montserrat-SemiBold.ttf', 'Montserrat-Bold.ttf', 'Montserrat-ExtraBold.ttf'].map((f) => path.join(FONT_DIR, f)),
  loadSystemFonts: false,
  defaultFontFamily: 'Montserrat',
};

let logoDataUri = null;
function logo() {
  if (!logoDataUri) {
    const file = path.join(__dirname, '..', 'public', 'img', 'blta-logo.png');
    logoDataUri = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  }
  return logoDataUri;
}
const LOGO_RATIO = 834 / 624;

const CATEGORY_LABELS = {
  ELITE: 'BLTA ELITE',
  NEXT_GEN: 'BLTA NEXT GEN',
  NOVICE: 'BLTA NOVICE',
  FRIENDLY: 'PRIATEĽSKÝ',
  VIP_CUP: 'VIP CUP',
  ATA_TENNIS: 'ATA TENNIS',
  OTHER: 'INÉ',
};
const LEVEL_DOTS = { ELITE: 3, NEXT_GEN: 2, NOVICE: 1 };

const COLORS = {
  bg: '#0d0c0a',
  card: '#0a0a0a',
  grey: '#37373e',
  green: '#b2fa06',
  orange: '#ff5500',
  white: '#ffffff',
  soft: '#d3d6dc',
  dim: '#c3c7cf',
};

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// ---------- text measuring (the real font, via resvg) ----------

const widthCache = new Map();
// Width in px of `text` at font-size 100 (it scales linearly with the size).
function width100(text, weight, spacing = 0) {
  const key = `${weight}|${spacing}|${text}`;
  if (widthCache.has(key)) return widthCache.get(key);
  let w;
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="300"><text x="0" y="200" font-family="Montserrat" font-weight="${weight}" font-size="100" letter-spacing="${spacing}">${esc(text)}</text></svg>`;
    const box = new Resvg(svg, { font: RESVG_FONT }).getBBox();
    w = box ? box.width : text.length * 66;
  } catch {
    w = text.length * 66;
  }
  if (widthCache.size > 2000) widthCache.clear();
  widthCache.set(key, w);
  return w;
}

function textWidth(text, size, weight, spacing = 0) {
  return (width100(text, weight, spacing / (size / 100)) * size) / 100;
}

// The biggest font size (<= start) at which `text` fits `maxWidth`; below `min` the text is shortened with "…".
function fitText(text, maxWidth, start, min, weight) {
  const per100 = width100(text, weight);
  let size = Math.min(start, Math.floor((maxWidth * 100) / per100));
  if (size >= min) return { text, size };
  let cut = text;
  while (cut.length > 3 && textWidth(`${cut}…`, min, weight) > maxWidth) cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}…`, size: min };
}

// ---------- match -> drawing data ----------

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('sk-SK', { timeZone: 'Europe/Bratislava', day: 'numeric', month: 'numeric', year: 'numeric' }).format(d);
}

// One entry per played set: what each player's box shows and who won the set.
function setsOf(state) {
  return (state.sets || [])
    .filter((s) => s.winner || s.p1 > 0 || s.p2 > 0 || (s.tiebreak && (s.tiebreak.p1 > 0 || s.tiebreak.p2 > 0)))
    .map((s) => {
      if (s.isSuperTiebreak) {
        return { a: s.tiebreak.p1, b: s.tiebreak.p2, winner: s.winner, sup: { 1: null, 2: null } };
      }
      const sup = { 1: null, 2: null };
      if (s.tiebreak && s.winner) {
        // the loser's tiebreak points go in small next to their games, as in "7-6(4)"
        if (s.winner === 1) sup[2] = s.tiebreak.p2; else sup[1] = s.tiebreak.p1;
      }
      return { a: s.p1, b: s.p2, winner: s.winner, sup };
    });
}

// match: { player1: {name}, player2: {name}, winnerId, player1Id..., state, endReason, category, group, season,
// startTime/scheduledAt/endTime, location }
function drawingData(match) {
  const winnerSide = match.winnerId && match.winnerId === match.player1.id ? 1 : (match.winnerId && match.winnerId === match.player2.id ? 2 : 0);
  return {
    names: [match.player1.name, match.player2.name],
    winnerSide,
    walkover: match.endReason === 'WALKOVER',
    sets: setsOf(match.state || {}),
    category: match.category,
    group: match.group ? match.group.name : '',
    season: match.season ? match.season.name : (match.league || ''),
    date: formatDate(match.startTime || match.endTime || match.scheduledAt),
    location: match.location || '',
  };
}

// ---------- the drawing ----------

function pill(x, y, h, label, kind, category) {
  const size = 19;
  const dots = kind === 'cat' && LEVEL_DOTS[category] ? 3 : 0; // always three dots, the level fills some of them
  const text = label;
  const textW = textWidth(text, size, 800, 1.2);
  const dotsW = dots ? dots * 11 + (dots - 1) * 5 + 12 : 0;
  const w = Math.ceil(textW + dotsW + 36);
  const left = x - w;
  const color = kind === 'cat' ? COLORS.orange : COLORS.white;
  let out = kind === 'cat'
    ? `<rect x="${left}" y="${y}" width="${w}" height="${h}" rx="12" fill="none" stroke="${COLORS.orange}" stroke-width="2"/>`
    : `<rect x="${left}" y="${y}" width="${w}" height="${h}" rx="12" fill="${COLORS.grey}"/>`;
  let cursor = left + 18;
  for (let i = 0; i < dots; i += 1) {
    const filled = i < (LEVEL_DOTS[category] || 0);
    out += `<circle cx="${cursor + 5.5}" cy="${y + h / 2}" r="4.5" fill="${filled ? COLORS.orange : 'none'}" stroke="${COLORS.orange}" stroke-width="2"/>`;
    cursor += 16;
  }
  if (dots) cursor += 6;
  out += `<text x="${cursor}" y="${y + h / 2 + size * 0.35}" font-family="Montserrat" font-weight="800" font-size="${size}" letter-spacing="1.2" fill="${color}">${esc(text)}</text>`;
  return { svg: out, left };
}

function buildSvg(match) {
  const d = drawingData(match);
  const parts = [];

  parts.push(`<defs>
    <radialGradient id="g1" cx="85%" cy="8%" r="60%"><stop offset="0" stop-color="#787e8c" stop-opacity="0.30"/><stop offset="1" stop-color="#787e8c" stop-opacity="0"/></radialGradient>
    <radialGradient id="g2" cx="4%" cy="100%" r="55%"><stop offset="0" stop-color="${COLORS.orange}" stop-opacity="0.16"/><stop offset="1" stop-color="${COLORS.orange}" stop-opacity="0"/></radialGradient>
  </defs>`);
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="${COLORS.bg}"/><rect width="${WIDTH}" height="${HEIGHT}" fill="url(#g1)"/><rect width="${WIDTH}" height="${HEIGHT}" fill="url(#g2)"/>`);

  // header: logo + wordmark on the left, category and group pills on the right
  const logoH = 72;
  parts.push(`<image x="${M}" y="48" width="${Math.round(logoH * LOGO_RATIO)}" height="${logoH}" href="${logo()}"/>`);
  const wordX = M + Math.round(logoH * LOGO_RATIO) + 18;
  parts.push(`<text x="${wordX}" y="78" font-family="Montserrat" font-weight="600" font-size="15" letter-spacing="5" fill="${COLORS.soft}">TENNIS</text>`);
  parts.push(`<text x="${wordX}" y="114" font-family="Montserrat" font-weight="800" font-size="38" letter-spacing="1" fill="${COLORS.white}">SCORE</text>`);

  let pillRight = WIDTH - M;
  const pillY = 64;
  const pillH = 44;
  if (d.group) {
    const g = pill(pillRight, pillY, pillH, d.group.toUpperCase(), 'group');
    parts.push(g.svg);
    pillRight = g.left - 12;
  }
  const c = pill(pillRight, pillY, pillH, CATEGORY_LABELS[d.category] || String(d.category || ''), 'cat', d.category);
  parts.push(c.svg);

  parts.push(`<text x="${M}" y="192" font-family="Montserrat" font-weight="800" font-size="17" letter-spacing="3" fill="${COLORS.dim}">VÝSLEDOK ZÁPASU</text>`);

  // the two player rows
  const rowH = 112;
  const rowGap = 16;
  const rowTop = [206, 206 + rowH + rowGap];
  const BOX = 72;
  const BOX_GAP = 10;
  const rightEdge = WIDTH - M - 26;
  const sets = d.sets.slice(0, 5);

  [1, 2].forEach((side, i) => {
    const y = rowTop[i];
    const isWinner = d.winnerSide === side;
    parts.push(isWinner
      ? `<rect x="${M}" y="${y}" width="${WIDTH - 2 * M}" height="${rowH}" rx="26" fill="${COLORS.card}" stroke="#ffffff" stroke-opacity="0.55" stroke-width="2"/>`
      : `<rect x="${M}" y="${y}" width="${WIDTH - 2 * M}" height="${rowH}" rx="26" fill="${COLORS.grey}" fill-opacity="0.55" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1"/>`);

    // right side: set boxes, or a walkover chip on the winner's row
    let rightStart = rightEdge;
    if (d.walkover) {
      if (isWinner) {
        const label = 'KONTUMÁCIA';
        const w = Math.ceil(textWidth(label, 22, 800, 2) + 40);
        rightStart = rightEdge - w;
        parts.push(`<rect x="${rightStart}" y="${y + (rowH - 48) / 2}" width="${w}" height="48" rx="12" fill="${COLORS.green}"/>`);
        parts.push(`<text x="${rightStart + 20}" y="${y + rowH / 2 + 7.7}" font-family="Montserrat" font-weight="800" font-size="22" letter-spacing="2" fill="${COLORS.card}">${label}</text>`);
      }
    } else if (sets.length) {
      const total = sets.length * BOX + (sets.length - 1) * BOX_GAP;
      rightStart = rightEdge - total;
      sets.forEach((s, k) => {
        const bx = rightStart + k * (BOX + BOX_GAP);
        const by = y + (rowH - BOX) / 2;
        const value = side === 1 ? s.a : s.b;
        const won = s.winner === side;
        parts.push(`<rect x="${bx}" y="${by}" width="${BOX}" height="${BOX}" rx="16" fill="${COLORS.grey}"/>`);
        parts.push(`<text x="${bx + BOX / 2}" y="${by + BOX / 2 + 15}" text-anchor="middle" font-family="Montserrat" font-weight="800" font-size="44" fill="${won ? COLORS.green : COLORS.white}">${esc(value)}</text>`);
        if (s.sup[side] !== null && s.sup[side] !== undefined) {
          parts.push(`<text x="${bx + BOX - 9}" y="${by + 25}" text-anchor="end" font-family="Montserrat" font-weight="700" font-size="19" fill="${COLORS.dim}">${esc(s.sup[side])}</text>`);
        }
      });
    }

    const nameX = M + 34;
    const maxName = rightStart - 30 - nameX;
    const fit = fitText(d.names[i], maxName, 54, 30, 800);
    parts.push(`<text x="${nameX}" y="${y + rowH / 2 + fit.size * 0.35}" font-family="Montserrat" font-weight="800" font-size="${fit.size}" fill="${isWinner ? COLORS.green : COLORS.white}">${esc(fit.text)}</text>`);
  });

  // footer: season · date · place on the left, address on the right
  const footY = 580;
  parts.push(`<line x1="${M}" y1="540" x2="${WIDTH - M}" y2="540" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1"/>`);
  const address = 'score.blta.sk';
  const addrW = textWidth(address, 26, 800, 0.5);
  parts.push(`<text x="${WIDTH - M}" y="${footY}" text-anchor="end" font-family="Montserrat" font-weight="800" font-size="26" letter-spacing="0.5" fill="${COLORS.white}">${address}</text>`);
  const room = WIDTH - 2 * M - addrW - 40;
  let info = [d.season, d.date].filter(Boolean).join('  ·  ');
  if (d.location && textWidth(`${info}  ·  ${d.location}`, 22, 700) <= room) info = `${info}  ·  ${d.location}`;
  const infoFit = fitText(info, room, 22, 16, 700);
  parts.push(`<text x="${M}" y="${footY - 1}" font-family="Montserrat" font-weight="700" font-size="${infoFit.size}" fill="${COLORS.soft}">${esc(infoFit.text)}</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${parts.join('')}</svg>`;
}

function renderPng(match) {
  const resvg = new Resvg(buildSvg(match), { font: RESVG_FONT, fitTo: { mode: 'width', value: WIDTH } });
  return resvg.render().asPng();
}

// Small in-memory cache: a result image only changes when the match does (the key is the match's updated_at).
const cache = new Map();
function cachedPng(token, version, match) {
  const hit = cache.get(token);
  if (hit && hit.version === version) return hit.png;
  const png = renderPng(match);
  if (cache.size >= 200) cache.delete(cache.keys().next().value);
  cache.set(token, { version, png });
  return png;
}

module.exports = { buildSvg, renderPng, cachedPng, WIDTH, HEIGHT };
