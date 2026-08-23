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
      can correct the score or location of a finished match, and can
      <a href="/badges-admin" style="text-decoration:underline">manage badges</a>.
    </p>
    <button type="button" class="btn btn-outline" id="logout-btn">Log out</button>
  `;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/admin/logout', { method: 'POST' });
    toast('Logged out');
    renderLoggedOut();
  });
}

(async () => {
  const admin = await checkAdmin();
  if (admin) renderLoggedIn();
  else renderLoggedOut();
})();
