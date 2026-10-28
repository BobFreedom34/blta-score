// Backend > Communities: every community and club of the city, with the one thing an admin does to them - hide one (it disappears from every list,
// its page is "not found" and its admins cannot run it) or show it again. Nothing is approved here: an organisation is public as soon as it is made.
const root = document.getElementById('communities-admin-root');

function renderLoggedOut() {
  root.innerHTML = `
    <div class="card">
      <p style="margin:0;color:var(--gray)">
        Managing communities and clubs requires an admin login.
        <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.
      </p>
    </div>
  `;
}

const TYPE_LABEL = { CLUB: 'Club', COMMUNITY: 'Community' };
let isSuperAdmin = false;

function rowHtml(o) {
  return `
    <tr data-id="${o.id}" style="border-top:1px solid #eee">
      <td style="padding:8px 6px"><a href="/community/${encodeURIComponent(o.slug)}" target="_blank" rel="noopener" style="font-weight:700;text-decoration:underline">${escapeHtml(o.name)}</a>
        ${o.hidden ? '<span style="margin-left:6px;font-size:11px;font-weight:800;color:var(--danger)">HIDDEN</span>' : ''}
        ${o.approved ? '' : '<span style="margin-left:6px;font-size:11px;font-weight:800;color:var(--orange)">WAITING FOR APPROVAL</span>'}</td>
      <td style="padding:8px 6px">${escapeHtml(TYPE_LABEL[o.type] || o.type)}</td>
      <td style="padding:8px 6px">${escapeHtml(o.city)}</td>
      <td style="padding:8px 6px;text-align:right">${o.memberCount}</td>
      <td style="padding:8px 6px;text-align:right;white-space:nowrap">
        ${o.type === 'CLUB' && isSuperAdmin ? `<button type="button" class="btn ${o.approved ? 'btn-outline' : 'btn-primary'}" data-approve="${o.approved ? 'no' : 'yes'}">${o.approved ? 'Withdraw approval' : 'Approve'}</button>` : ''}
        <button type="button" class="btn btn-outline" data-toggle="${o.hidden ? 'show' : 'hide'}">${o.hidden ? 'Show' : 'Hide'}</button></td>
    </tr>`;
}

async function load() {
  const data = await api('/communities?includeHidden=1');
  // the clubs that wait for approval first, then the hidden ones, then the newest
  const items = data.items.slice().sort((a, b) => Number(!a.approved) - Number(!b.approved) || Number(b.hidden) - Number(a.hidden) || b.id - a.id);
  const waiting = items.filter((o) => !o.approved).length;
  root.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">Communities and clubs <span style="font-weight:400;color:var(--gray-dim);font-size:13px">${items.length}</span></h3>
      ${waiting ? `<p style="margin:0 0 10px;font-weight:700;color:var(--orange)">${waiting} club${waiting === 1 ? '' : 's'} waiting for approval${isSuperAdmin ? '' : ' (only the super admin can approve)'}</p>` : ''}
      <div id="communities-error" style="color:var(--danger);font-weight:600;margin-bottom:8px"></div>
      ${items.length ? `
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr style="text-align:left;color:var(--gray-dim);font-size:12px"><th style="padding:6px">Name</th><th style="padding:6px">Type</th><th style="padding:6px">City</th><th style="padding:6px;text-align:right">Members</th><th></th></tr></thead>
        <tbody>${items.map(rowHtml).join('')}</tbody>
      </table></div>` : '<p style="margin:0;color:var(--gray)">Nobody has created a community or a club yet.</p>'}
    </div>`;
  root.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      try {
        await api(`/communities/${id}/approval`, { method: 'PATCH', body: { approved: btn.dataset.approve === 'yes' } });
        toast(btn.dataset.approve === 'yes' ? 'Approved' : 'Approval withdrawn');
        await load();
      } catch (err) {
        document.getElementById('communities-error').textContent = err.message;
      }
    });
  });
  root.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      try {
        await api(`/communities/${id}/moderation`, { method: 'PATCH', body: { hidden: btn.dataset.toggle === 'hide' } });
        toast(btn.dataset.toggle === 'hide' ? 'Hidden' : 'Shown again');
        await load();
      } catch (err) {
        document.getElementById('communities-error').textContent = err.message;
      }
    });
  });
}

(async () => {
  const isAdminUser = await checkAdmin();
  if (!isAdminUser) return renderLoggedOut();
  try { isSuperAdmin = (await loadSession()).adminRole === 'SUPER'; } catch { isSuperAdmin = false; }
  try { await load(); } catch (err) { root.innerHTML = `<div class="card" style="color:var(--danger)">${escapeHtml(err.message)}</div>`; }
})();
