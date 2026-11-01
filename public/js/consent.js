// The cookie banner of the Tag Manager tag (see src/tracking.js, which puts this script on a page only when "Ask visitors for cookie consent first" is on).
// The container has started with every kind of storage denied (Google Consent Mode v2); here the visitor decides, the choice is kept in this browser
// ('blta-cookies' = granted | denied) and passed on to the container. A small "Cookies" link in the footer opens the banner again to change the choice.
(function cookieConsent() {
  const KEY = 'blta-cookies';
  const TEXT = {
    sk: {
      title: 'Cookies a meranie návštevnosti',
      body: 'Používame cookies na meranie návštevnosti a zlepšovanie stránky. Môžeš ich povoliť alebo odmietnuť; stránka funguje v oboch prípadoch rovnako.',
      accept: 'Súhlasím', reject: 'Odmietnuť', link: 'Cookies',
    },
    en: {
      title: 'Cookies and measuring visits',
      body: 'We use cookies to measure visits and improve the site. You can allow or refuse them; the site works the same either way.',
      accept: 'Accept', reject: 'Refuse', link: 'Cookies',
    },
  };
  const text = () => TEXT[(document.documentElement.lang || 'sk').slice(0, 2)] || TEXT.sk;
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const write = (value) => { try { localStorage.setItem(KEY, value); } catch { /* no storage: asked again next time */ } };

  function apply(choice) {
    const state = choice === 'granted' ? 'granted' : 'denied';
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', { ad_storage: state, ad_user_data: state, ad_personalization: state, analytics_storage: state });
    }
  }

  function close() {
    const el = document.querySelector('.cookie-banner');
    if (el) el.remove();
  }

  function open() {
    close();
    const t = text();
    const el = document.createElement('div');
    el.className = 'cookie-banner';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', t.title);
    el.innerHTML = `<p><strong>${t.title}</strong><br>${t.body}</p><div class="cookie-banner-btns"><button type="button" class="btn btn-outline" data-cookies="denied">${t.reject}</button><button type="button" class="btn btn-primary" data-cookies="granted">${t.accept}</button></div>`;
    el.querySelectorAll('[data-cookies]').forEach((b) => b.addEventListener('click', () => {
      write(b.dataset.cookies);
      apply(b.dataset.cookies);
      close();
    }));
    document.body.appendChild(el);
  }

  function addFooterLink() {
    const spot = document.querySelector('.sf-legal') || document.querySelector('.site-footer-inner > div') || document.querySelector('footer.credit') || document.querySelector('.site-footer-inner');
    if (!spot || spot.querySelector('.cookie-settings-link')) return;
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'cookie-settings-link';
    a.textContent = text().link;
    a.addEventListener('click', (e) => { e.preventDefault(); open(); });
    spot.appendChild(a);
  }

  window.openCookieSettings = open;
  const start = () => {
    addFooterLink();
    if (!read()) open();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
