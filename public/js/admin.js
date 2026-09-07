const root = document.getElementById('admin-root');

function renderLoggedOut() {
  root.innerHTML = `
    <p style="color:var(--gray);margin-top:0">
      Admin can add/rename/delete players and correct a match after it's finished.
    </p>
    <form id="login-form">
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
    try {
      await api('/admin/login', { method: 'POST', body: { password } });
      toast('Logged in as admin');
      renderLoggedIn();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

function renderLoggedIn() {
  root.innerHTML = `
    <p style="margin-top:0">✅ You're logged in as admin on this device.</p>
    <p style="color:var(--gray);font-size:13px">
      You'll now see Add / Edit / Delete on the <a href="/players" style="text-decoration:underline">Players</a> page,
      can correct the score or location of a finished match, can
      <a href="/badges-admin" style="text-decoration:underline">manage badges</a>,
      and can view the <a href="/login-history" style="text-decoration:underline">login history</a>.
    </p>
    <button type="button" class="btn btn-outline" id="backup-now-btn">📦 Back up now</button>
    <button type="button" class="btn btn-outline" id="logout-btn" style="margin-top:10px">Log out</button>
  `;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/admin/logout', { method: 'POST' });
    toast('Logged out');
    renderLoggedOut();
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
}

(async () => {
  const admin = await checkAdmin();
  if (admin) renderLoggedIn();
  else renderLoggedOut();
})();
