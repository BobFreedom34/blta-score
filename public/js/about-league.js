// The page "Info o lige": the text of the "O nás – info o lige" window as a page. The server writes it into the HTML (src/aboutPage.js, so a crawler reads it
// too); this file only draws it when the server did not (the page file opened by its file name) and keeps the page in step with the language. The text
// itself is built by aboutPageHtml in js/about.js, the same file the window uses.
(async function aboutLeaguePage() {
  const root = document.getElementById('about-league-root');
  if (!root) return;
  if (!document.querySelector('.ssr-intro')) {
    const intro = document.createElement('div');
    intro.className = 'ssr-intro';
    const h1 = document.createElement('h1');
    h1.textContent = document.title.split(' - ')[0];
    intro.appendChild(h1);
    root.before(intro);
  }
  if (root.children.length) return; // written by the server
  const data = await aboutTexts();
  root.innerHTML = aboutPageHtml(data);
})();
