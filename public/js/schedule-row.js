// THE ONE TEMPLATE of a schedule row: the card of a league season / a tournament with its date, name, tags, categories, poster and buttons. The Harmonogram of the league (harmonogram.js) and the
// tournament cards of the communities and clubs (community-post.js) both draw their rows with schRow.html(), so a change made here (or in the matching rules of style.css, written for
// ".sch-lists, .com-news-tournament") changes both. Needs common.js (t, escapeHtml, currentLang).
//
// schRow.html(ev, today) -> the markup of one row. ev:
//   { name, startDate, endDate, kind: 'LEAGUE' | 'TOURNAMENT', kindLabel (optional, instead of the words League / Tournament), link, venue, categories: ['ELITE', ...],
//     ended (a tournament whose playing window is over), registration: 'open' | 'closed' | 'none', organisation: { name, slug } | null, heroUrl, heroMobileUrl }
// The clicks on the green button and on the club tag are handled by the page (they sit inside the link of the row and lead by their data-href).
(function scheduleRowTemplate() {
  const CATEGORY_NAMES = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice' };
  const categoryName = (c) => (c === 'DOUBLES' ? t('season.catDoubles') : CATEGORY_NAMES[c] || c);

  // "2026-05-04" as a local date at noon, so no timezone can move it to the neighbouring day
  const parseDay = (iso) => new Date(`${iso}T12:00:00`);
  const daysBetween = (fromIso, toIso) => Math.round((parseDay(toIso) - parseDay(fromIso)) / 864e5);
  const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  function dayWord(n) {
    if (n === 1) return t('schedule.dayOne');
    if (currentLang === 'en') return t('schedule.dayMany');
    return n >= 2 && n <= 4 ? t('schedule.dayFew') : t('schedule.dayMany');
  }
  // "1.5. – 31.8.", "14. – 15.11.", "13.12."
  function dateRange(startDate, endDate) {
    if (!startDate) return '';
    const a = parseDay(startDate);
    const b = parseDay(endDate || startDate);
    // (no zero in front: 1.9., not 01.09.)
    const dm = (d) => `${d.getDate()}.${d.getMonth() + 1}.`;
    if (!endDate || startDate === endDate) return dm(a);
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${a.getDate()}. – ${dm(b)}`;
    return `${dm(a)} – ${dm(b)}`;
  }
  function yearText(startDate, endDate) {
    if (!startDate) return '';
    const a = parseDay(startDate).getFullYear();
    const b = parseDay(endDate || startDate).getFullYear();
    return a === b ? String(a) : `${a} – ${b}`;
  }
  // past (over, or the playing window of its last day is over), future, or now
  function statusOf(ev, today) {
    const end = ev.endDate || ev.startDate || '';
    if (!ev.startDate) return 'future';
    if (end < today || ev.ended) return 'past';
    if (ev.startDate > today) return 'future';
    return 'now';
  }
  // how far through a running event we are, in percent
  function progressOf(ev, today) {
    const total = Math.max(1, daysBetween(ev.startDate, ev.endDate || ev.startDate));
    return Math.min(100, Math.max(0, Math.round((daysBetween(ev.startDate, today) / total) * 100)));
  }

  // the poster of the event: only an address the server wrote (a picture of the site)
  const safeUrl = (u) => (/^\/[\w\/.-]+$/.test(u || '') ? u : '');

  function html(ev, today) {
    const start = ev.startDate || '';
    const end = ev.endDate || ev.startDate || '';
    const status = statusOf(ev, today);
    const isLeague = ev.kind === 'LEAGUE';
    let eta = '';
    let bar = '';
    if (status === 'now') {
      const left = Math.max(0, daysBetween(today, end));
      eta = t('schedule.daysLeft', { n: left, d: dayWord(left) });
      bar = `<div class="home-bar mini"><i style="width:${progressOf(ev, today)}%"></i></div>`;
    } else if (status === 'future' && start) {
      const n = daysBetween(today, start);
      eta = t('schedule.startsIn', { n, d: dayWord(n) });
    }
    const org = ev.organisation;
    const tags = `<span class="sch-tags"><span class="sch-tag${isLeague ? '' : ' tour'}">${escapeHtml(ev.kindLabel || t(isLeague ? 'schedule.league' : 'schedule.tournament'))}</span>`
      + (status === 'now' ? `<span class="sch-tag now">${escapeHtml(t('schedule.running'))}</span>` : '')
      + (status === 'past' ? `<span class="sch-tag past">${escapeHtml(t('schedule.finishedTag'))}</span>` : '')
      + (org ? `<span class="sch-tag sch-club" role="link" tabindex="0" title="${escapeHtml(t('schedule.organiser', { name: org.name }))}" data-href="/community/${encodeURIComponent(org.slug)}">${escapeHtml(org.name)}</span>` : '')
      + '</span>';
    const chips = (ev.categories || []).map((c) => `<span class="sch-chip">${escapeHtml(categoryName(c))}</span>`).join('');
    const sub = `${ev.venue ? `<span class="sch-venue">${escapeHtml(ev.venue)}<i class="sch-dot"> · </i></span>` : ''}<b class="sch-cats">${chips}</b><span class="sch-extra">${eta ? escapeHtml(` · ${eta}`) : ''}</span>`;
    // the green button of an open registration (it sits inside the link of the row, so it is a link by role: the page's click handler leads it); a closed one is the grey button
    let reg = '';
    if (ev.link && status !== 'past' && ev.registration === 'open') reg = `<span class="sch-reg" role="link" tabindex="0" data-href="${escapeHtml(`${ev.link}#register`)}">${escapeHtml(t('schedule.register'))}</span>`;
    else if (ev.link && status !== 'past' && ev.registration === 'closed') reg = `<span class="sch-reg off">${escapeHtml(t('season.registerClosed'))}</span>`;
    const go = ev.link ? `<span class="sch-go">${escapeHtml(t('schedule.more'))} ›</span>` : '';
    const more = reg ? `<span class="sch-acts">${reg}${go}</span>` : (go || '<span></span>');
    const wide = safeUrl(ev.heroUrl) || safeUrl(ev.heroMobileUrl);
    const tall = safeUrl(ev.heroMobileUrl) || safeUrl(ev.heroUrl);
    const posterClass = wide ? ' has-poster' : '';
    const posterStyle = wide ? ` style="--poster:url('${wide}');--poster-m:url('${tall}')"` : '';
    const open = ev.link
      ? `<a class="sch-row link ${status}${posterClass}"${posterStyle} href="${escapeHtml(ev.link)}"${/^https?:/i.test(ev.link) ? ' target="_blank" rel="noopener"' : ''}>`
      : `<div class="sch-row ${status}${posterClass}"${posterStyle}>`;
    return `
    ${open}
      <div class="sch-date">${escapeHtml(dateRange(start, end) || t('com.eventNoDate'))}<small>${escapeHtml(yearText(start, end))}</small></div>
      <span class="sch-eta">${escapeHtml(eta)}</span>
      <div class="sch-info"><div class="sch-text"><div class="sch-name"><span class="sch-title">${escapeHtml(ev.name)}</span>${tags}</div><div class="sch-sub">${sub}</div>${bar}</div></div>
      ${more}
    ${ev.link ? '</a>' : '</div>'}`;
  }

  window.schRow = { html, statusOf, progressOf, dateRange, yearText, daysBetween, dayWord, todayIso, parseDay, categoryName };
}());
