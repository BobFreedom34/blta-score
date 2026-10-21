// The "How CourtIQ works" page (/courtiq). Opened from the "Read more" button of the little CourtIQ window (see ensureCourtIQInfoModal in
// common.js); it is not in the menu. The text lives in i18n.js (courtiq.page.*); the facts come from src/courtIQEngine.js (start at 4.0,
// "?" until 5 matches and a settled number, 30 days of rest, margin of victory at most +50%, super tiebreak = one game).

(function renderCourtIQPage() {
  const root = document.getElementById('ciq-page');
  if (!root) return;

  const tx = (key) => escapeHtml(t(key));
  const section = (title, body) => `
    <section class="pr-sec">
      <h2 class="pr-title">${escapeHtml(title)}</h2>
      ${body}
    </section>`;
  const item = (titleKey, textKey) => `<li><b>${tx(titleKey)}</b> – ${tx(textKey)}</li>`;

  // half-step levels, the first row covers 1.0–2.0
  const LEVELS = ['1.0 – 2.0', '2.0 – 2.5', '2.5 – 3.0', '3.0 – 3.5', '3.5 – 4.0', '4.0 – 4.5', '4.5 – 5.0', '5.0 – 5.5', '5.5 – 6.0', '6.0 – 7.0'];
  const guideRows = LEVELS.map((range, i) => `
    <div class="ciq-level">
      <div class="ciq-level-n">${range}</div>
      <div class="ciq-level-name">${tx(`courtiq.page.g${i + 1}n`)}</div>
      <div class="ciq-level-desc">${tx(`courtiq.page.g${i + 1}d`)}</div>
    </div>`).join('');

  root.innerHTML = `
    <h1 style="margin-top:22px">${tx('courtiq.page.title')}</h1>
    <p class="home-sub">${tx('courtiq.page.sub')}</p>
    <div class="pr-card ciq-lead"><p>${tx('courtiq.page.lead')}</p></div>

    ${section(t('courtiq.page.keyH'), `
      <div class="ciq-key">
        <div class="ciq-key-card"><div class="ciq-key-n">1.0 – 7.0</div><h3>${tx('courtiq.page.levelH')}</h3><p>${tx('courtiq.page.levelP')}</p></div>
        <div class="ciq-key-card q"><div class="ciq-key-n">?</div><h3>${tx('courtiq.page.provH')}</h3><p>${tx('courtiq.page.provP')}</p></div>
      </div>`)}

    ${section(t('courtiq.page.moveH'), `
      <div class="pr-card">
        <p>${tx('courtiq.page.moveLead')}</p>
        <ol class="pr-list num">
          ${item('courtiq.page.m1t', 'courtiq.page.m1d')}
          ${item('courtiq.page.m2t', 'courtiq.page.m2d')}
          ${item('courtiq.page.m3t', 'courtiq.page.m3d')}
          ${item('courtiq.page.m4t', 'courtiq.page.m4d')}
        </ol>
      </div>`)}

    ${section(t('courtiq.page.certH'), `
      <div class="pr-card">
        <p>${tx('courtiq.page.certLead')}</p>
        <ul class="pr-list">
          ${item('courtiq.page.c1t', 'courtiq.page.c1d')}
          ${item('courtiq.page.c2t', 'courtiq.page.c2d')}
          ${item('courtiq.page.c3t', 'courtiq.page.c3d')}
        </ul>
      </div>`)}

    ${section(t('courtiq.page.guideH'), `
      <div class="pr-card">
        <p>${tx('courtiq.page.guideLead')}</p>
        <div class="ciq-levels">
          <div class="ciq-level head"><div>${tx('courtiq.page.colLevel')}</div><div>${tx('courtiq.page.colName')}</div><div>${tx('courtiq.page.colDesc')}</div></div>
          ${guideRows}
        </div>
      </div>`)}

    ${section(t('courtiq.page.fairH'), `
      <div class="pr-card">
        <ul class="pr-list">
          <li>${tx('courtiq.page.f1')}</li>
          <li>${tx('courtiq.page.f2')}</li>
          <li>${tx('courtiq.page.f3')}</li>
        </ul>
      </div>`)}

    <section class="pr-sec">
      <div class="pr-card ciq-cta">
        <div>
          <h2 class="pr-title" style="margin-bottom:6px">${tx('courtiq.page.ctaH')}</h2>
          <p>${tx('courtiq.page.ctaP')}</p>
        </div>
        <a class="btn btn-primary" href="/rankings?tab=courtiq">${tx('courtiq.page.ctaBtn')}</a>
      </div>
    </section>

    <p class="ciq-updated">${tx('courtiq.page.updated')}</p>`;
}());
