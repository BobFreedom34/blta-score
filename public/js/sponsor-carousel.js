// The arrows of the "Partners" strip. While all the logos fit on the line they stay centred and there are no arrows; when there are more than
// fit, an arrow appears on each side and a click scrolls the line by (nearly) a screenful of logos. Shared by the home page, a season page, the
// national page (slta.html) — each puts a .sp-box > .sp-strip on the page and hands the box to initSponsorCarousel().
function initSponsorCarousel(box) {
  const strip = box && box.querySelector('.sp-strip');
  if (!strip || box.dataset.carousel) return;
  box.dataset.carousel = '1';
  const mk = (cls, label, glyph) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `sp-arrow ${cls}`;
    b.setAttribute('aria-label', label);
    b.textContent = glyph;
    return b;
  };
  const prev = mk('sp-prev', 'Previous', '‹');
  const next = mk('sp-next', 'Next', '›');
  box.insertBefore(prev, strip);
  box.appendChild(next);

  const update = () => {
    const max = strip.scrollWidth - strip.clientWidth;
    const overflow = max > 2;
    box.classList.toggle('sp-overflow', overflow);
    prev.disabled = !overflow || strip.scrollLeft <= 2;
    next.disabled = !overflow || strip.scrollLeft >= max - 2;
  };
  const go = (dir) => strip.scrollBy({ left: dir * Math.max(120, strip.clientWidth * 0.8), behavior: 'smooth' });
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  strip.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  // the logos load lazily and change the width of the line as they do: measure again whenever the line or one of the logos changes size
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(update);
    ro.observe(strip);
    [...strip.children].forEach((c) => ro.observe(c));
  }
  update();
}
window.initSponsorCarousel = initSponsorCarousel;
