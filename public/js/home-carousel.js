// The image carousel at the top of the home page: the slides come from Backend > Carousel. A swipeable, snapping row of
// pictures with arrows and dots; it changes by itself every few seconds (not while the pointer is over it, the tab is hidden
// or the visitor prefers less motion). With no slide the block is not there at all; with one it is just the picture.
(function homeCarousel() {
  const host = document.getElementById('home-carousel');
  if (!host) return;
  const AUTOPLAY_MS = 5500;

  function slideHtml(s, index) {
    const en = currentLang === 'en';
    const caption = (en && s.captionEn) ? s.captionEn : s.captionSk;
    const subtext = (en && s.subtextEn) ? s.subtextEn : s.subtextSk;
    const inner = `<img src="${escapeHtml(s.imageUrl)}" alt="${escapeHtml(caption || '')}" ${index === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} draggable="false">${caption || subtext ? `<span class="hc-caption">${caption ? `<b>${escapeHtml(caption)}</b>` : ''}${subtext ? `<small>${escapeHtml(subtext)}</small>` : ''}</span>` : ''}`;
    return s.link
      ? `<a class="hc-slide" href="${escapeHtml(s.link)}"${/^https?:/.test(s.link) ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>`
      : `<div class="hc-slide">${inner}</div>`;
  }

  function mount(slides) {
    const many = slides.length > 1;
    host.innerHTML = `
      <div class="hc-track" id="hc-track">${slides.map(slideHtml).join('')}</div>
      ${many ? `
        <button type="button" class="hc-arrow prev" aria-label="Previous">‹</button>
        <button type="button" class="hc-arrow next" aria-label="Next">›</button>
        <div class="hc-dots">${slides.map((_, i) => `<button type="button" class="hc-dot${i === 0 ? ' on' : ''}" data-i="${i}" aria-label="${i + 1}"></button>`).join('')}</div>` : ''}`;
    host.hidden = false;
    if (!many) return;

    const track = host.querySelector('.hc-track');
    const dots = [...host.querySelectorAll('.hc-dot')];
    let current = 0;
    let paused = false;
    const go = (i) => {
      current = (i + slides.length) % slides.length;
      track.scrollTo({ left: current * track.clientWidth, behavior: 'smooth' });
    };
    // the dot follows whatever is on screen (a swipe, an arrow, the timer)
    track.addEventListener('scroll', () => {
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      if (i !== current || !dots[i].classList.contains('on')) {
        current = i;
        dots.forEach((d, n) => d.classList.toggle('on', n === i));
      }
    }, { passive: true });
    host.querySelector('.prev').addEventListener('click', () => go(current - 1));
    host.querySelector('.next').addEventListener('click', () => go(current + 1));
    dots.forEach((d) => d.addEventListener('click', () => go(Number(d.dataset.i))));
    window.addEventListener('resize', () => track.scrollTo({ left: current * track.clientWidth }));

    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (calm) return;
    host.addEventListener('mouseenter', () => { paused = true; });
    host.addEventListener('mouseleave', () => { paused = false; });
    host.addEventListener('touchstart', () => { paused = true; }, { passive: true });
    host.addEventListener('touchend', () => { setTimeout(() => { paused = false; }, AUTOPLAY_MS); }, { passive: true });
    setInterval(() => { if (!paused && !document.hidden) go(current + 1); }, AUTOPLAY_MS);
  }

  api('/carousel').then((slides) => { if (slides && slides.length) mount(slides); }).catch(() => { /* no carousel is fine */ });
})();
