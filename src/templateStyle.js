// What the text sanitizers (src/rules.js for Rules/Info, src/htmlSanitize.js for the blog) let through for the text templates
// (public/js/text-templates.js): the classes of the existing page elements and a `style` attribute with COLOURS only, so the colours of a template
// can be changed in its HTML (and the alignment of the toolbar: text-align). Anything else in a style (url(), expression(), position, ...) is dropped.

// the elements of the page (pr-*: Propozície), the two tiles, and the category/win/bad modifiers the Propozície already use
const TEMPLATE_CLASS = /^(pr-[a-z-]+|grey-tile|black-tile|win|bad|yes|no|elite|nextgen|novice|num)$/;

const PROPS = new Set(['color', 'background', 'background-color', 'border-color', 'border-left-color']);
const ALIGN = /^(left|center|right|justify)$/;
const NAMED = /^[a-z]{3,20}$/i;
const HEX = /^#[0-9a-f]{3,8}$/i;
const FN = /^(rgb|rgba|hsl|hsla)\(\s*[0-9.%\s,/-]+\)$/i;
const VAR = /^var\(--[a-z0-9-]+\)$/i;

const okValue = (v) => HEX.test(v) || FN.test(v) || VAR.test(v) || (NAMED.test(v) && !/^(url|expression|image|inherit)$/i.test(v));

// -> the allowed declarations joined with ';' (an empty string when nothing is left)
function safeStyle(css) {
  const out = [];
  String(css || '').split(';').forEach((decl) => {
    const i = decl.indexOf(':');
    if (i < 1) return;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (prop === 'text-align' ? ALIGN.test(value) : PROPS.has(prop) && okValue(value)) out.push(`${prop}:${value}`);
  });
  return out.join(';');
}

module.exports = { TEMPLATE_CLASS, safeStyle };
