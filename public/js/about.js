// The "O nás – info o lige" window on the home page: five tabs (About us, Rules, Categories, League dates, Tournaments) with the text of
// the old blta.sk info block. The text lives in i18n.js (about.*); this file only builds the window.

const ABOUT_ICONS = {
  us: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  rules: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  cats: '<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  dates: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  tour: '<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6a9 9 0 0 1 0 12.8M18.4 5.6a9 9 0 0 0 0 12.8"/>',
};

function aboutIcon(name, size = 18) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ABOUT_ICONS[name]}</svg>`;
}

const ABOUT_TABS = ['us', 'rules', 'cats', 'dates', 'tour'];

// the text with a {link} in it: the link goes where the word is
function aboutTextWithLink(textKey, linkKey, href) {
  const parts = escapeHtml(t(textKey)).split('{link}');
  return parts.length < 2 ? parts[0] : `${parts[0]}<a href="${href}">${escapeHtml(t(linkKey))}</a>${parts[1]}`;
}

function aboutCta(href, labelKey) {
  return `<a class="about-cta" href="${href}">${escapeHtml(t(labelKey))}<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>`;
}

function aboutPanel(tab) {
  if (tab === 'us') {
    return `
      <h3 class="about-h">${escapeHtml(t('about.us.h'))}</h3>
      <p class="about-lead">${escapeHtml(t('about.us.lead'))}</p>
      <p>${escapeHtml(t('about.us.p1'))}</p>
      <p>${escapeHtml(t('about.us.p2'))}</p>
      <p>${escapeHtml(t('about.us.p3'))}</p>
      <p>${escapeHtml(t('about.us.p4'))}</p>
      <p>${escapeHtml(t('about.us.p5'))}</p>
      <div class="about-sign">${aboutIcon('ball', 20)}${escapeHtml(t('about.us.sign'))}</div>`;
  }
  if (tab === 'rules') {
    const items = [1, 2, 3, 4].map((n) => `
      <li><span class="about-n">${n}</span><div><strong>${escapeHtml(t(`about.rules.i${n}t`))}</strong><span>${escapeHtml(t(`about.rules.i${n}d`))}</span></div></li>`).join('');
    return `
      <h3 class="about-h">${escapeHtml(t('about.rules.h'))}</h3>
      <p class="about-lead">${escapeHtml(t('about.rules.lead'))}</p>
      <p>${aboutTextWithLink('about.rules.p1', 'about.rules.link', '/propozicie')}</p>
      <div class="about-sub">${escapeHtml(t('about.rules.inside'))}</div>
      <ol class="about-list">${items}</ol>
      <p>${escapeHtml(t('about.rules.p2'))}</p>
      ${aboutCta('/propozicie', 'about.rules.cta')}`;
  }
  if (tab === 'cats') {
    const cats = [['novice', 'Novice'], ['nextgen', 'Next Gen'], ['elite', 'Elite']].map(([key, name]) => `
      <div class="about-card ${key}"><div class="about-card-name">${name}</div><div class="about-card-text">${escapeHtml(t(`about.cats.${key}`))}</div></div>`).join('');
    return `
      <h3 class="about-h">${escapeHtml(t('about.cats.h'))}</h3>
      <p>${escapeHtml(t('about.cats.p'))}</p>
      <div class="about-cards three">${cats}</div>
      ${aboutCta('/propozicie#kategorie', 'about.cats.cta')}`;
  }
  if (tab === 'dates') {
    const cycles = [['winter', 'Winter Opening Series'], ['summer', 'Summer Rally Series'], ['autumn', 'Autumn Finals Series']].map(([key, name], i) => `
      <div class="about-card ${key}"><div class="about-card-step">${i + 1}</div><div class="about-card-name">${name}</div><div class="about-card-text">${escapeHtml(t(`about.dates.${key}`))}</div></div>`).join('');
    return `
      <h3 class="about-h">${escapeHtml(t('about.dates.h'))}</h3>
      <p>${escapeHtml(t('about.dates.p'))}</p>
      <div class="about-cards three">${cycles}</div>
      <p>${escapeHtml(t('about.dates.foot'))}</p>
      ${aboutCta('/harmonogram', 'about.dates.cta')}`;
  }
  return `
    <h3 class="about-h">${escapeHtml(t('about.tour.h'))}</h3>
    <p>${aboutTextWithLink('about.tour.p1', 'about.tour.link', '/harmonogram')}</p>
    <div class="about-callout"><strong>${escapeHtml(t('about.tour.strong'))}</strong> ${escapeHtml(t('about.tour.p2'))}</div>
    ${aboutCta('/harmonogram', 'about.tour.cta')}`;
}

function openAbout(startTab) {
  if (document.getElementById('about-modal')) return;
  const wrap = document.createElement('div');
  wrap.className = 'about-backdrop';
  wrap.id = 'about-modal';
  wrap.innerHTML = `
    <div class="about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <div class="about-head">
        <h2 id="about-title">${escapeHtml(t('about.title'))}</h2>
        <button type="button" class="about-x" data-close aria-label="${escapeHtml(t('about.close'))}">&times;</button>
      </div>
      <div class="about-tabs" role="tablist">
        ${ABOUT_TABS.map((k) => `<button type="button" role="tab" class="about-tab" data-tab="${k}">${aboutIcon(k)}<span>${escapeHtml(t(`about.tab.${k}`))}</span></button>`).join('')}
      </div>
      <div class="about-body" id="about-body" role="tabpanel"></div>
    </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('about-open');
  const body = wrap.querySelector('#about-body');
  const show = (tab) => {
    wrap.querySelectorAll('.about-tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    body.innerHTML = aboutPanel(tab);
    body.scrollTop = 0;
  };
  const close = () => {
    wrap.remove();
    document.body.classList.remove('about-open');
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) { close(); return; }
    const tab = e.target.closest('.about-tab');
    if (tab) show(tab.dataset.tab);
  });
  show(ABOUT_TABS.includes(startTab) ? startTab : 'us');
  wrap.querySelector('.about-tab.on').focus();
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#home-about-btn')) openAbout('us');
});
