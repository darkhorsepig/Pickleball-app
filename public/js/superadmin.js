/* Super Admin control panel — manages COMPANIES (tenants) */
if (!API.token()) location.href = 'login.html';
const me = API.user() || {};
if (me.roleId !== 0) location.href = me.roleId >= 1 && me.roleId <= 4 ? 'admin.html' : 'dashboard.html';

let COMPANIES = [];
const VIEW_TITLES = { overview: 'Platform Overview', admins: 'Companies', content: 'Manage Content' };
const stColor = { Active: 'bg-success', Expired: 'bg-warning text-dark', Suspended: 'bg-secondary', Cancelled: 'bg-danger', None: 'bg-secondary' };

function showView(name) {
  document.querySelectorAll('[data-viewpane]').forEach(s => s.classList.toggle('d-none', s.dataset.viewpane !== name));
  document.querySelectorAll('.nav-link[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === name));
  document.getElementById('pageTitle').textContent = VIEW_TITLES[name] || '';
  if (name === 'overview') loadOverview();
  if (name === 'admins') loadCompanies();
  bootstrap.Offcanvas.getInstance(document.getElementById('mobileNav'))?.hide();
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-view]');
  if (a) { e.preventDefault(); location.hash = a.dataset.view; }
});
window.addEventListener('hashchange', () => showView(location.hash.replace('#', '') || 'overview'));

(async () => {
  document.getElementById('mobileNavBody').innerHTML = document.getElementById('sideNav').outerHTML;
  document.getElementById('topUserName').textContent = me.firstName;
  document.getElementById('avatarBadge').textContent = 'SA';
  showView(location.hash.replace('#', '') || 'overview');
  hideLoader();
})();

async function loadOverview() {
  const o = await API.get('/api/super/overview');
  const cards = [
    ['Companies', o.totalCompanies, 'bi-buildings', ''],
    ['Active', o.activeSubs, 'bi-check-circle', ''],
    ['Expired', o.expiredSubs, 'bi-hourglass-bottom', 'orange'],
    ['Suspended', o.suspended, 'bi-pause-circle', 'red'],
    ['Subscription Revenue', peso(o.subscriptionRevenue), 'bi-cash-stack', 'blue']
  ];
  document.getElementById('ovCards').innerHTML = cards.map(([l, v, ic, cls]) => `
    <div class="col-6 col-md-4 col-xl"><div class="card-pc stat-card ${cls} p-3 h-100">
      <div class="d-flex justify-content-between align-items-start">
        <div><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div>
        <i class="bi ${ic} fs-4 text-secondary opacity-50"></i></div></div></div>`).join('');
}

async function loadCompanies() {
  COMPANIES = await API.get('/api/super/companies');
  document.getElementById('adminRows').innerHTML = COMPANIES.length ? COMPANIES.map(c => `
    <tr>
      <td><strong>${esc(c.name)}</strong><br><a href="/c/${esc(c.slug)}" target="_blank" rel="noopener" class="small text-success">/c/${esc(c.slug)}</a></td>
      <td class="small">${c.admin ? '@' + esc(c.admin.username) + '<br>' + esc(c.admin.email) : '—'}</td>
      <td class="small">${esc(c.subscription.plan || '—')}</td>
      <td><span class="badge ${stColor[c.subscription.status] || 'bg-secondary'} rounded-pill">${esc(c.subscription.status)}</span></td>
      <td class="small">${c.subscription.endDate || (c.subscription.plan === 'Lifetime' ? 'Never' : '—')}</td>
      <td>${c.active ? '<span class="badge bg-success rounded-pill">Enabled</span>' : '<span class="badge bg-danger rounded-pill">Suspended</span>'}</td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-pc" onclick="openSub(${c.id})" title="Manage subscription"><i class="bi bi-credit-card-2-front"></i></button>
        <a class="btn btn-sm btn-outline-success rounded-3" href="admin.html?companyId=${c.id}" target="_blank" rel="noopener" title="Open dashboard"><i class="bi bi-speedometer2"></i></a>
        <button class="btn btn-sm btn-outline-primary rounded-3" onclick="openCompanyModal(${c.id})" title="Edit"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-secondary rounded-3" onclick="toggleCompany(${c.id})" title="Suspend/Enable"><i class="bi bi-power"></i></button>
        <button class="btn btn-sm btn-outline-danger rounded-3" onclick="deleteCompany(${c.id},'${esc(c.name)}')" title="Delete"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`).join('') : '<tr><td colspan="7" class="text-center text-secondary py-4">No companies yet — create the first one!</td></tr>';
}

function openCompanyModal(id) {
  const f = document.getElementById('adminForm');
  f.reset();
  f.id.value = id || '';
  const isEdit = !!id;
  document.getElementById('adminModalTitle').textContent = isEdit ? 'Edit Company' : 'New Company';
  document.getElementById('pwHint').textContent = isEdit ? '(leave blank to keep)' : '(min 8 chars)';
  document.getElementById('planWrap').style.display = isEdit ? 'none' : 'block';
  f.password.required = !isEdit;
  f.username.disabled = isEdit;
  f.slug.disabled = false;
  if (isEdit) {
    const c = COMPANIES.find(x => x.id === id);
    f.businessName.value = c.name;
    f.slug.value = c.slug;
    f.username.value = c.admin ? c.admin.username : '';
    f.email.value = c.admin ? c.admin.email : '';
    f.mobile.value = c.admin ? c.admin.mobile : '';
  }
  bootstrap.Modal.getOrCreateInstance(document.getElementById('adminModal')).show();
}
document.getElementById('adminForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const body = {
    name: f.businessName.value, slug: f.slug.value, username: f.username.value, email: f.email.value,
    mobile: f.mobile.value, address: f.address.value, password: f.password.value, plan: f.plan.value
  };
  try {
    if (f.id.value) await API.put('/api/super/companies/' + f.id.value, body);
    else await API.post('/api/super/companies', body);
    toast('Company saved');
    bootstrap.Modal.getInstance(document.getElementById('adminModal')).hide();
    loadCompanies();
  } catch (ex) { toast(ex.message, 'error'); }
});
async function toggleCompany(id) {
  try { const r = await API.post(`/api/super/companies/${id}/disable`, {}); toast(r.active ? 'Company enabled' : 'Company suspended'); loadCompanies(); }
  catch (ex) { toast(ex.message, 'error'); }
}
async function deleteCompany(id, name) {
  if (!await confirmDialog('Delete Company', `Permanently delete "${name}" and its admin account? The public landing page will stop working.`)) return;
  try { await API.del('/api/super/companies/' + id); toast('Company deleted'); loadCompanies(); }
  catch (ex) { toast(ex.message, 'error'); }
}

/* ---- subscription manager ---- */
async function openSub(id) {
  const c = COMPANIES.find(x => x.id === id);
  document.getElementById('subAdminId').value = id;
  document.getElementById('subModalTitle').textContent = 'Subscription — ' + c.name;
  renderSubState(c);
  document.getElementById('subPlanSel').value = c.subscription.plan || 'Monthly';
  document.getElementById('subStartDate').value = c.subscription.startDate || '';
  document.getElementById('subEndDate').value = c.subscription.endDate || '';
  renderPayHistory(c);
  const acts = await API.get(`/api/super/companies/${id}/activity`);
  document.getElementById('activityList').innerHTML = acts.length ? acts.slice(0, 30).map(l =>
    `<div class="py-1 border-bottom"><span class="badge bg-light text-dark border me-1">${esc(l.action)}</span>${esc(l.details || '')}<br><span class="opacity-75">${new Date(l.at).toLocaleString()}</span></div>`).join('')
    : '<div class="text-secondary">No activity yet.</div>';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('subModal')).show();
}
function renderSubState(c) {
  const s = c.subscription;
  document.getElementById('subStatusBadge').innerHTML = `<span class="badge ${stColor[s.status] || 'bg-secondary'} rounded-pill">${esc(s.status)}</span>`;
  document.getElementById('subPlan').textContent = s.plan || '—';
  document.getElementById('subStart').textContent = s.startDate || '—';
  document.getElementById('subEnd').textContent = s.endDate || (s.plan === 'Lifetime' ? 'Never' : '—');
}
function renderPayHistory(c) {
  const pays = (c.rawSubscription && c.rawSubscription.payments) || [];
  document.getElementById('payHistory').innerHTML = pays.length ? pays.slice().reverse().map(p =>
    `<tr><td>${p.date}</td><td class="fw-semibold">${peso(p.amount)}</td><td>${esc(p.method)}</td><td class="text-secondary">${esc(p.note || '')}</td></tr>`).join('')
    : '<tr><td class="text-secondary">No payments recorded.</td></tr>';
}
async function subAction(action) {
  const id = document.getElementById('subAdminId').value;
  const body = {
    action, plan: document.getElementById('subPlanSel').value,
    startDate: document.getElementById('subStartDate').value || undefined,
    endDate: document.getElementById('subEndDate').value || undefined
  };
  try {
    const r = await API.post(`/api/super/companies/${id}/subscription`, body);
    toast('Subscription updated');
    const idx = COMPANIES.findIndex(x => x.id === Number(id));
    if (idx >= 0) COMPANIES[idx] = r.company;
    renderSubState(r.company);
    loadCompanies();
  } catch (ex) { toast(ex.message, 'error'); }
}
async function addPayment() {
  const id = document.getElementById('subAdminId').value;
  const amount = Number(document.getElementById('payAmount').value);
  if (!(amount > 0)) return toast('Enter a valid amount', 'warning');
  try {
    await API.post(`/api/super/companies/${id}/payment`, { amount, method: document.getElementById('payMethod').value, note: document.getElementById('payNote').value });
    toast('Payment recorded');
    document.getElementById('payAmount').value = '';
    document.getElementById('payNote').value = '';
    await loadCompanies();
    renderPayHistory(COMPANIES.find(x => x.id === Number(id)));
  } catch (ex) { toast(ex.message, 'error'); }
}
