// The three rules about unplayed matches in Bodovanie were written as three bold paragraphs, which read badly. They become a list with a short lead-in each
// (the page's own list with the green dots). Works on the Slovak and on the English text; a text that is already a list (or was changed) is left as it is.
const CLEAN = (t) => t.replace(/<\/?(strong|b)>/g, '').trim();

const FORMS = {
  sk: {
    re: /<p>(?:<strong>)?(Ak hráči neodohrajú[\s\S]*?)<\/p>\s*<p>(?:<strong>)?(Takisto ak[\s\S]*?)<\/p>\s*<p>(?:<strong>)?(Hráč, ktorý neodohrá[\s\S]*?)<\/p>/,
    leads: ['Nedohraný vzájomný zápas:', 'Povinnosť vyššie postaveného hráča:', 'Play-off:'],
  },
  en: {
    re: /<p>(?:<strong>)?(If the players have not played[\s\S]*?)<\/p>\s*<p>(?:<strong>)?(Likewise, if the higher-ranked[\s\S]*?)<\/p>\s*<p>(?:<strong>)?(A player who does not play at least half[\s\S]*?)<\/p>/,
    leads: ['Match not played:', 'Duty of the higher-ranked player:', 'Play-off:'],
  },
};

function fix(html, lang) {
  const form = FORMS[lang];
  const m = form.re.exec(html || '');
  if (!m) return null;
  const items = [m[1], m[2], m[3]].map((t, i) => `<li><b>${form.leads[i]}</b> ${CLEAN(t)}</li>`).join('');
  return html.replace(form.re, () => `<ul class="pr-list">${items}</ul>`);
}

module.exports = { fix };
