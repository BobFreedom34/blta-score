// Public playoff-bracket display — dark/orange theme matching the rest of
// the app (see .card-dark and friends in style.css). No live-update
// requirement for v1: this renders once on load; a match finishing
// elsewhere needs a page refresh to show here, same as any other static
// read of GET /api/matches. Also loaded, unchanged, by embed-bracket.html
// — the "Embed this bracket" button simply isn't present in that page's
// markup, so the wiring below is naturally a no-op there.
const bracketId = window.location.pathname.split('/').filter(Boolean).pop();

function render(data) {
  if (!document.title.includes(data.name)) document.title = `${data.name} — BLTA`; // the server already put the title from Backend > SEO
  const titleEl = document.getElementById('bracket-title');
  titleEl.textContent = data.name;
  // the season and category the bracket belongs to, under the title
  const about = [data.season ? data.season.name : '', data.category ? categoryLabel(data.category) : ''].filter(Boolean).join(' · ');
  if (about) {
    const sub = document.createElement('span');
    sub.className = 'bracket-title-sub';
    sub.textContent = about;
    titleEl.appendChild(sub);
  }

  document.getElementById('bracket-root').innerHTML = bracketBoardHtml(data);
}

async function load() {
  try {
    const data = await api(`/brackets/${bracketId}`);
    render(data);
  } catch (err) {
    document.getElementById('bracket-title').textContent = 'Bracket not found';
    document.getElementById('bracket-root').innerHTML = `<p style="color:var(--danger)">${escapeHtml(err.message)}</p>`;
  }
}

// "Embed this bracket" — same modal/pattern as rankings.js's own
// embed-rankings-btn. Only present on the real page's markup, not
// embed-bracket.html itself (which also loads this same file).
const embedBracketBtn = document.getElementById('embed-bracket-btn');
if (embedBracketBtn) {
  embedBracketBtn.addEventListener('click', () => {
    const src = `${window.location.origin}/embed/bracket/${bracketId}`;
    const code = `<iframe src="${src}" width="100%" height="600" frameborder="0" style="border:0;width:100%"></iframe>`;
    document.getElementById('embed-code').textContent = code;
    document.getElementById('copy-embed-btn').onclick = () => {
      copyToClipboard(code).then(() => toast(t('embed.copied')));
    };
    document.getElementById('embed-modal').style.display = 'flex';
  });
}

load();
