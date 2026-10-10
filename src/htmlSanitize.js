// A small allow-list sanitizer for the HTML of blog articles (written in Backend > Blog or imported from the old website). Only the tags and
// attributes of an article are kept; scripts, styles, frames, forms, event handlers (onclick=…), style attributes and javascript: addresses
// are removed, and the tags are balanced so one article can never break the page around it.
//
//   sanitizeHtml('<p onclick="x()">Hi <script>alert(1)</script><a href="javascript:x()">link</a></p>')  ->  '<p>Hi <a>link</a></p>'
//
// It reads the text with a tokenizer (not with regular expressions over the whole string), so odd things like <scr<script>ipt> or
// attributes with > inside quotes do not get through.

const ALLOWED = new Set(['p', 'br', 'hr', 'h2', 'h3', 'h4', 'h5', 'strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub', 'ul', 'ol', 'li', 'blockquote',
  'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
const VOID = new Set(['br', 'hr', 'img']);
// the whole element goes, with what is inside it
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'form', 'textarea', 'select', 'title', 'head']);
const RENAME = { h1: 'h2', h6: 'h5', div: null, span: null, section: null, article: null, center: null, font: null };

const ATTRS = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'width', 'height', 'title'],
  th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan'],
  ol: ['start'],
};

// an address an article may link to or show: http(s), mailto, tel, a path on this site, or an anchor
function safeUrl(raw, { image = false } = {}) {
  const value = String(raw || '').replace(/[\u0000- \u007f-\u009f]+/g, '').trim();
  if (!value || value.length > 2000) return null;
  if (/^(https?:)?\/\//i.test(value) || /^https?:/i.test(value)) return value.replace(/^\/\//, 'https://');
  if (value.startsWith('/') || (!image && value.startsWith('#'))) return value;
  if (!image && /^(mailto|tel):/i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null; // javascript:, data:, vbscript: …
  return null;
}

const escapeText = (s) => s.replace(/</g, '&lt;');
const escapeAttr = (s) => String(s).replace(/&(?!#?\w+;)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TOKEN = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^\s/>]*(?:"[^"]*"|'[^']*'|[^'">])*>|<|[^<]+/g;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(source) {
  const attrs = {};
  let m;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(source))) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
  }
  return attrs;
}

function sanitizeHtml(input) {
  const html = String(input || '');
  const out = [];
  const stack = []; // the allowed tags that are open
  let skipping = null; // { name, depth } while inside a dropped element
  let match;
  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(html))) {
    const token = match[0];
    if (token.startsWith('<!--')) continue;
    const tag = /^<(\/?)([a-zA-Z][^\s/>]*)([\s\S]*?)(\/?)>$/.exec(token);
    if (!tag) {
      if (skipping) continue;
      out.push(token === '<' ? '&lt;' : escapeText(token));
      continue;
    }
    const closing = tag[1] === '/';
    let name = tag[2].toLowerCase();
    if (skipping) {
      if (name === skipping.name) {
        if (closing) { skipping.depth -= 1; if (skipping.depth === 0) skipping = null; } else if (!tag[4]) skipping.depth += 1;
      }
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !tag[4]) skipping = { name, depth: 1 };
      continue;
    }
    if (name in RENAME) { if (RENAME[name] === null) continue; name = RENAME[name]; }
    if (!ALLOWED.has(name)) continue; // an unknown tag goes, its text stays
    if (closing) {
      if (VOID.has(name)) continue;
      const at = stack.lastIndexOf(name);
      if (at === -1) continue;
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    const attrs = parseAttrs(tag[3]);
    let text = `<${name}`;
    if (name === 'a') {
      const href = safeUrl(attrs.href);
      if (href) text += ` href="${escapeAttr(href)}"`;
      if (attrs.title) text += ` title="${escapeAttr(attrs.title.slice(0, 300))}"`;
      if (href && /^https?:/i.test(href)) text += ' target="_blank" rel="noopener"';
    } else if (name === 'img') {
      const src = safeUrl(attrs.src, { image: true });
      if (!src) continue; // a picture without an address is nothing
      text += ` src="${escapeAttr(src)}" alt="${escapeAttr((attrs.alt || '').slice(0, 300))}" loading="lazy"`;
      ['width', 'height'].forEach((k) => { if (/^\d{1,4}$/.test(attrs[k] || '')) text += ` ${k}="${attrs[k]}"`; });
      if (attrs.title) text += ` title="${escapeAttr(attrs.title.slice(0, 300))}"`;
    } else if (ATTRS[name]) {
      ATTRS[name].forEach((k) => { if (/^\d{1,4}$/.test(attrs[k] || '')) text += ` ${k}="${attrs[k]}"`; });
    }
    text += VOID.has(name) ? ' />' : '>';
    out.push(text);
    if (!VOID.has(name)) stack.push(name);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('').replace(/<p>(?:\s|&nbsp;|<br \/>)*<\/p>/g, '').trim();
}

// the plain text of an article (for an excerpt or a description): tags out, entities kept as text, spaces tidy
function plainText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&#8211;/g, '–').replace(/&#8212;/g, '—').replace(/&#8217;/g, '’').replace(/&#8222;/g, '„').replace(/&#8220;/g, '“')
    .replace(/\s+/g, ' ').trim();
}

module.exports = { sanitizeHtml, plainText, safeUrl };
