const root = document.getElementById('login-history-root');

function renderLoggedOut() {
  root.innerHTML = `
    <div class="card">
      <p style="margin-top:0">
        Login history requires an admin login.
        <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.
      </p>
    </div>
  `;
}

function rowHtml(e) {
  const who = e.playerSlug
    ? playerNameLink({ id: e.playerId, slug: e.playerSlug, name: e.playerName })
    : escapeHtml(e.playerName);
  return `
    <div class="login-history-row">
      <div>${who}</div>
      <div class="login-history-when">${fmtDateLong(e.createdAt)}</div>
    </div>
  `;
}

async function renderAdmin() {
  try {
    const events = await api('/admin/login-events');
    root.innerHTML = events.length
      ? `
        <div class="card" style="padding:0">
          <div class="login-history-row login-history-header">
            <div>Player</div>
            <div class="login-history-when">Logged in</div>
          </div>
          ${events.map(rowHtml).join('')}
        </div>
      `
      : `<div class="card"><p style="margin:0;color:var(--gray)">No logins recorded yet.</p></div>`;
  } catch (err) {
    root.innerHTML = `<div class="card"><p style="margin:0;color:var(--danger)">Could not load login history: ${escapeHtml(err.message)}</p></div>`;
  }
}

(async () => {
  const isAdminUser = await checkAdmin();
  if (isAdminUser) renderAdmin();
  else renderLoggedOut();
})();
