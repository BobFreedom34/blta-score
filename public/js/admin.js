const root = document.getElementById('admin-root');

function renderLoggedOut() {
  root.innerHTML = `
    <p style="color:var(--gray);margin-top:0">
      Admin can add/rename/delete players and correct a match after it's finished.
    </p>
    <form id="login-form">
      <div class="field">
        <label for="email">Email <span style="font-weight:400;color:var(--gray-dim)">(admins of a city; leave empty if you are the super admin)</span></label>
        <input type="email" id="email" autocomplete="username" placeholder="name@example.com">
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input type="password" id="password" required autofocus>
      </div>
      <button type="submit" class="btn btn-primary btn-block">Log in</button>
      <div id="login-error" style="color:var(--danger);font-weight:600;margin-top:10px"></div>
    </form>
  `;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';
    const password = document.getElementById('password').value;
    const email = document.getElementById('email').value.trim();
    try {
      await api('/admin/login', { method: 'POST', body: { password, email } });
      toast('Logged in as admin');
      location.reload();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

// The admin of a city: what he runs, in a few lines (the tabs above are his whole backend)
function renderCityAdmin(info) {
  document.querySelectorAll('.admin-tabs').forEach((el) => { el.style.display = ''; });
  root.style.maxWidth = '640px';
  root.innerHTML = `
    <h2 style="margin:0 0 4px">${escapeHtml(info.acting.name)}</h2>
    <p style="margin:0 0 14px;color:var(--gray)">You are logged in as <strong>${escapeHtml(info.name || '')}</strong> (${escapeHtml(info.email || '')}), the admin of this city.</p>
    <p style="font-size:14px;margin:0 0 6px"><strong>You can manage, for ${escapeHtml(info.acting.name)}:</strong></p>
    <ul style="font-size:14px;color:var(--gray);line-height:1.7;margin:0 0 14px;padding-left:20px">
      <li><a href="/seasons-admin" style="color:var(--orange)">Seasons</a> and <a href="/tournaments-admin" style="color:var(--orange)">tournaments</a>, the groups, the draw and the schedule</li>
      <li><a href="/players" style="color:var(--orange)">Players</a> and the registrations</li>
      <li><a href="/venues-admin" style="color:var(--orange)">Venues</a> (courts)</li>
      <li><a href="/bracket-admin" style="color:var(--orange)">Brackets</a> and results, <a href="/winners-admin" style="color:var(--orange)">winners</a></li>
      <li>The look of the home page: <a href="/carousel-admin" style="color:var(--orange)">pictures</a> and the <a href="/header-admin" style="color:var(--orange)">menu</a></li>
    </ul>
    <p style="font-size:13px;color:var(--gray-dim);margin:0 0 16px">Everything you create belongs to ${escapeHtml(info.acting.name)} only, and you cannot see or change another city. The cities themselves, the admins and the settings of the whole site are kept by the super admin.</p>
    <button type="button" class="btn btn-outline" id="logout-btn">Log out</button>
  `;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/admin/logout', { method: 'POST' });
    location.reload();
  });
}

async function renderLoggedIn() {
  let info = null;
  try { info = await api('/admin/session'); } catch { /* the page below still works */ }
  if (info && info.role === 'CITY') return renderCityAdmin(info);
  // common.js's own admin-tabs reveal (see near the bottom of that file)
  // only runs once, at page load — which already happened before this
  // login (there's no page reload in between, just this AJAX call), so it
  // saw isAdminUser as false and left .admin-tabs hidden. Reached again
  // here every time this page transitions into the logged-in view,
  // including right after a fresh login, not just on a page load that was
  // already authenticated.
  document.querySelectorAll('.admin-tabs').forEach((el) => { el.style.display = ''; });
  root.innerHTML = `
    <p style="margin-top:0">✅ You're logged in as the <strong>super admin</strong> on this device.</p>
    <div style="border:1px solid var(--gray-light, #ddd);border-radius:10px;padding:12px 14px;margin:0 0 16px;font-size:13px;line-height:1.6">
      <strong>Managing the cities</strong>
      <ol style="margin:6px 0 0;padding-left:20px;color:var(--gray)">
        <li><a href="/leagues-admin" style="color:var(--orange)">Cities</a>: add a city, set its address, status (hidden, coming soon, in preparation, active) and its pin on the map.</li>
        <li><a href="/admins-admin" style="color:var(--orange)">Admins</a>: give a person an email and a password; they run only the city you choose.</li>
        <li>The bar above the tabs <em>Working on</em>: pick the city whose seasons, players, venues and pictures you want to see or fill in yourself.</li>
        <li>SEO, rules, reservations, badges, blog and backups stay with you for the whole site.</li>
      </ol>
    </div>
    <p style="color:var(--gray);font-size:13px">
      You'll now see Add / Edit / Delete on the Players page, and can correct the score or location of a
      finished match — the rest of the backend (Menu, Badges, Login History) is in the tabs above.
    </p>
    <button type="button" class="btn btn-outline" id="backup-now-btn">📦 Back up now</button>
    <button type="button" class="btn btn-outline" id="courtiq-backfill-btn">🎾 Run CourtIQ backfill</button>
    <button type="button" class="btn btn-outline" id="logout-btn" style="margin-top:10px">Log out</button>

    <hr style="margin:20px 0;border:none;border-top:1px solid var(--gray-light)">
    <h3 style="margin-top:0">Referee code</h3>
    <p style="color:var(--gray);font-size:13px">
      A shared 5-digit code — anyone who enters it on a match page's "Referee" button can start and
      run that match's live score, without a player or admin account of their own. Handy for someone
      officiating who isn't in the BLTA system. Set (or replace) it here; there's no way to look up an
      existing one once set, only rotate it.
    </p>
    <p id="referee-code-status" style="font-weight:700"></p>
    <form id="referee-code-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start">
      <input type="text" inputmode="numeric" maxlength="5" id="referee-code-input" placeholder="12345" style="width:120px">
      <button type="submit" class="btn btn-primary">Set code</button>
      <button type="button" class="btn btn-outline" id="referee-code-clear-btn">Turn off</button>
    </form>
    <div id="referee-code-error" style="color:var(--danger);font-weight:600;margin-top:8px"></div>
  `;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/admin/logout', { method: 'POST' });
    toast('Logged out');
    location.reload();
  });
  // Manual trigger for the daily Google Drive backup (see src/backup.js) —
  // mainly for right after setting it up, or whenever you just want to be
  // sure a fresh copy exists without waiting for the next scheduled run.
  document.getElementById('backup-now-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Backing up…';
    const mb = (n) => (n / (1024 * 1024)).toFixed(1);
    try {
      const result = await api('/admin/backup-now', { method: 'POST' });
      toast(`Backup done — ${mb(result.bytes)} MB database${result.files ? ` + ${mb(result.files.bytes)} MB files` : ''}`);
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  // Rebuilds CourtIQ (see src/courtIQBackfill.js) from every finished match,
  // from scratch — safe to click again any time, e.g. after correcting an
  // old match's score or after a rating constant is tuned.
  document.getElementById('courtiq-backfill-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Running…';
    try {
      const result = await api('/admin/courtiq/backfill', { method: 'POST' });
      const topLine = result.top.length
        ? ` — top: ${result.top.map((p) => `${p.name} (${p.band}${p.provisional ? '?' : ''})`).join(', ')}`
        : '';
      toast(`CourtIQ rebuilt — ${result.ratedPlayers} players from ${result.ratedMatches} matches in ${result.seconds}s${topLine}`);
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  const statusEl = document.getElementById('referee-code-status');
  async function refreshRefereeStatus() {
    try {
      const { isSet } = await api('/referee/admin/status');
      statusEl.textContent = isSet ? '🟢 A referee code is set.' : '⚪ No referee code set — the Referee button on match pages won’t work until you set one.';
    } catch (err) {
      statusEl.textContent = '';
    }
  }
  refreshRefereeStatus();

  document.getElementById('referee-code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('referee-code-error');
    errorEl.textContent = '';
    const input = document.getElementById('referee-code-input');
    const code = input.value.trim();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await api('/referee/admin/code', { method: 'PUT', body: { code } });
      input.value = '';
      toast('Referee code set');
      refreshRefereeStatus();
    } catch (err) {
      errorEl.textContent = err.message;
    }
    submitBtn.disabled = false;
  });

  document.getElementById('referee-code-clear-btn').addEventListener('click', async (e) => {
    if (!confirm('Turn off referee login? The Referee button on match pages will stop working until a new code is set.')) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api('/referee/admin/code', { method: 'DELETE' });
      toast('Referee code cleared');
      refreshRefereeStatus();
    } catch (err) {
      toast(err.message);
    }
    btn.disabled = false;
  });
}

(async () => {
  const admin = await checkAdmin();
  if (admin) renderLoggedIn();
  else renderLoggedOut();
})();
