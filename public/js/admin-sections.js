// Backend: every section (card) of a tab can be folded and unfolded, with its title on a bar above it. All of them are folded each
// time the tab is opened; the bar of an "add" section (Add a venue, New edition, Upload pictures...) is green with black text. A section
// the admin opened stays open while the page draws itself again (after an add, a save, a delete).
//
// The cards are drawn by each tab's own script, so this works on the finished page: it watches for cards and puts a bar before
// each one (the card itself is not touched, so the script that drew it keeps working with it). A card with no title (an error, a
// note, "Loading...") is not a section and is left as it is. Marks on a card:
//   data-sec-title="…"   the title for a card with no heading (else the text of its first heading)
//   data-sec-open="1"    opened when drawn (a form that was just filled for editing)
//   data-sec="fold"      on a page marked below: this card is folded
// Only the cards straight inside the page (.container or a …-root box) count; a card inside another card or a list is left.
// On a page with <body data-sec-mode="marked"> (a page that is public as well) only the cards marked data-sec="fold" are folded.
(function () {
  const pageKey = location.pathname;
  const opened = new Set(); // "page|title" of the sections the admin opened (a count in the title, like "Venues (7)", is not part of it)
  const keyOf = (title) => `${pageKey}|${title.replace(/\s*\(\d+\)\s*$/, '')}`;
  const marked = document.body.dataset.secMode === 'marked';
  const ADD = /^((add|create|new|upload)\b|prida)/i; // the title of an "add" section (Slovak: Pridat)

  const eligible = (card) => {
    if (card.tagName === 'DETAILS' || card.closest('details, .modal, [role="dialog"]')) return false;
    if (card.parentElement.closest('.card')) return false;
    if (marked) return card.dataset.sec === 'fold';
    const p = card.parentElement;
    return p.classList.contains('container') || /-root$/.test(p.id) || p.hasAttribute('data-sec-host');
  };

  const heading = (card) => card.querySelector('h2, h3, h4');
  const titleOf = (card, head) => {
    if (card.dataset.secTitle) return card.dataset.secTitle;
    const h = heading(card);
    const text = h ? h.textContent.replace(/\s+/g, ' ').trim().split(/ [—·] /)[0] : '';
    return text || (head && head.dataset.last) || '';
  };

  function setOpen(card, head, on) {
    card.classList.toggle('sec-closed', !on);
    head.classList.toggle('open', on);
    head.setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  function toggle(head) {
    const card = head._card;
    const on = card.classList.contains('sec-closed');
    setOpen(card, head, on);
    const key = keyOf(head.dataset.last);
    if (on) opened.add(key); else opened.delete(key);
  }

  function makeHead(card) {
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'sec-head';
    head._card = card;
    head.innerHTML = '<span class="sec-title"></span><span class="sec-chev" aria-hidden="true">›</span>';
    head.addEventListener('click', () => toggle(head));
    card.before(head);
    card.classList.add('sec-card');
    return head;
  }

  function pass() {
    // a bar whose card has gone (the page drew itself again, or the script removed the card) goes too
    document.querySelectorAll('.sec-head').forEach((h) => { if (!h._card.isConnected || h._card.previousElementSibling !== h) h.remove(); });
    [...document.querySelectorAll('.card')].filter(eligible).forEach((card) => {
      let head = card.previousElementSibling && card.previousElementSibling.classList.contains('sec-head') ? card.previousElementSibling : null;
      const title = titleOf(card, head);
      if (!title) return;
      const fresh = !head;
      if (!head) head = makeHead(card);
      head.querySelector('.sec-title').textContent = title;
      head.dataset.last = title;
      head.classList.toggle('add', ADD.test(title));
      const h = heading(card);
      if (h) h.classList.add('sec-orig-title'); // the bar shows the title, so the card's own heading is not shown again
      // a card the page itself hides (display:none) has no bar either
      head.hidden = card.style.display === 'none';
      if (fresh) setOpen(card, head, card.dataset.secOpen === '1' || opened.has(keyOf(title)));
      else if (card.dataset.secOpen === '1' && card.classList.contains('sec-closed')) setOpen(card, head, true);
    });
  }

  let busy = false;
  const obs = new MutationObserver(() => {
    if (busy) return;
    busy = true;
    try { pass(); } finally { obs.takeRecords(); busy = false; }
  });
  const start = () => {
    pass();
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'data-sec', 'data-sec-title', 'data-sec-open'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  // a script that scrolls to or focuses a field inside a folded section (an edit that fills the form) opens that section
  const reveal = (el) => {
    const card = el.closest && el.closest('.sec-closed');
    if (card && card.previousElementSibling && card.previousElementSibling._card === card) toggle(card.previousElementSibling);
  };
  const scroll = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (...args) { reveal(this); return scroll.apply(this, args); };
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (...args) { reveal(this); return focus.apply(this, args); };
})();
