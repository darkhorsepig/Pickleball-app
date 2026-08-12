/* Admin portal SPA logic */
if (!API.token()) location.href = 'login.html';
const me = API.user() || {};
if (me.roleId === 5) location.href = 'dashboard.html';
let COURTS = [];
const charts = {};
const PREMIUM_VIEWS = ['content', 'openplay', 'tournaments', 'reports'];
// Super admin (role 0) bypasses subscription gating
let SUB = me.roleId === 0 ? { active: true, status: 'Unlimited' } : (API.subscription() || { active: true, status: 'Active' });

const VIEW_TITLES = { stats: 'Admin Dashboard', bookings: 'Booking Management', calendar: 'Calendar Schedule', payments: 'Payment Management', courts: 'Court Management', customers: 'Customer Management', content: 'Landing Page Highlights', openplay: 'Open Play Sessions', tournaments: 'Tournament Mode', equipment: 'Equipment Inventory', reports: 'Reports', settings: 'Settings', audit: 'Audit Logs' };
function showView(name) {
  if (PREMIUM_VIEWS.includes(name) && !SUB.active) {
    document.querySelectorAll('[data-viewpane]').forEach(s => s.classList.toggle('d-none', s.dataset.viewpane !== name));
    document.querySelectorAll('.nav-link[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === name));
    document.getElementById('pageTitle').textContent = VIEW_TITLES[name] || '';
    document.querySelector(`[data-viewpane="${name}"]`).innerHTML =
      `<div class="card-pc p-5 text-center"><span class="icon-circle ic-blue mx-auto mb-3" style="width:72px;height:72px;font-size:1.8rem"><i class="bi bi-lock"></i></span>
       <h4 class="fw-bold">Premium Feature Locked</h4>
       <p class="text-secondary">Your subscription is <strong>${esc(SUB.status)}</strong>. This feature is available on an active plan.<br>Contact Snow Bear CourtOS to renew: <strong>jeruzgarde@gmail.com</strong>.</p></div>`;
    bootstrap.Offcanvas.getInstance(document.getElementById('mobileNav'))?.hide();
    return;
  }
  document.querySelectorAll('[data-viewpane]').forEach(s => s.classList.toggle('d-none', s.dataset.viewpane !== name));
  document.querySelectorAll('.nav-link[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === name));
  document.getElementById('pageTitle').textContent = VIEW_TITLES[name] || '';
  const loaders = {
    stats: loadStats, bookings: loadAdminBookings, calendar: loadCalendar, payments: loadAdminPayments,
    courts: loadAdminCourts, customers: loadCustomers, content: loadContent, openplay: loadOpenPlay,
    tournaments: loadTournaments, equipment: loadEquipment, reports: loadReport, settings: loadSettings, audit: loadAudit
  };
  loaders[name]?.();
  bootstrap.Offcanvas.getInstance(document.getElementById('mobileNav'))?.hide();
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-view]');
  if (a) { e.preventDefault(); location.hash = a.dataset.view; }
});
window.addEventListener('hashchange', () => showView(location.hash.replace('#', '') || 'stats'));

(async () => {
  try {
    // super-admin can open any company's dashboard via ?companyId=
    const qCompany = new URLSearchParams(location.search).get('companyId');
    if (me.roleId === 0 && qCompany) API.companyId = qCompany;
    const ctx = await API.get('/api/admin/context');
    SUB = me.roleId === 0 ? { active: true, status: 'Unlimited' } : ctx.subscription;
    COURTS = await API.get('/api/admin/courts');
    document.getElementById('mobileNavBody').innerHTML = document.getElementById('sideNav').outerHTML;
    document.getElementById('topUserName').textContent = me.firstName;
    document.getElementById('avatarBadge').textContent = (me.firstName[0] + (me.lastName ? me.lastName[0] : '')).toUpperCase();
    document.getElementById('roleLabel').textContent = { 0: 'Super Admin', 1: 'Administrator', 2: 'Cashier', 3: 'Receptionist', 4: 'Coach' }[me.roleId] || '';
    document.getElementById('venueLabel').textContent = ctx.company.name;
    document.getElementById('fCourt').innerHTML = '<option value="">All courts</option>' + COURTS.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    document.getElementById('maintCourt').innerHTML = COURTS.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    renderSubBanner();
    showView(location.hash.replace('#', '') || 'stats');
  } catch (e) { console.error(e); toast(e.message, 'error'); }
  hideLoader();
})();

function renderSubBanner() {
  const b = document.getElementById('subBanner');
  if (me.roleId === 0) {
    b.className = 'alert alert-dark d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3';
    b.innerHTML = `<span><i class="bi bi-shield-lock me-2"></i>Signed in as <strong>Super Admin</strong> — full unlimited access to all features.</span>`;
    b.classList.remove('d-none');
    return;
  }
  if (!SUB || !SUB.status || SUB.status === 'Active') {
    if (SUB && SUB.endDate) {
      b.className = 'alert alert-success d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3';
      b.innerHTML = `<span><i class="bi bi-check-circle me-2"></i>Subscription <strong>Active</strong> (${esc(SUB.plan || '')}) — valid until <strong>${SUB.endDate}</strong>.</span>`;
      b.classList.remove('d-none');
    }
    document.querySelectorAll('.premium-lock').forEach(x => x.classList.add('d-none'));
    return;
  }
  // expired / suspended / cancelled
  b.className = 'alert alert-warning d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3';
  b.innerHTML = `<span><i class="bi bi-exclamation-triangle me-2"></i>Your subscription is <strong>${esc(SUB.status)}</strong>. Premium features (Highlights, Open Play, Tournaments, Reports) are locked. Renew with Snow Bear CourtOS — <strong>jeruzgarde@gmail.com</strong>.</span>`;
  b.classList.remove('d-none');
  document.querySelectorAll('.premium-lock').forEach(x => x.classList.remove('d-none'));
}

/* ---------- SETTINGS ---------- */
let SETTINGS = null;
async function loadSettings() {
  SETTINGS = await API.get('/api/admin/settings');
  const lbl = h => h === 24 ? '12:00 MN' : fmtHr(h);
  const hourOpts = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
    .map(h => `<option value="${h}">${lbl(h)}</option>`).join('');
  document.getElementById('setOpen').innerHTML = hourOpts(5, 21);
  document.getElementById('setClose').innerHTML = hourOpts(6, 24);
  document.getElementById('setOpen').value = SETTINGS.hours.open;
  document.getElementById('setClose').value = SETTINGS.hours.close;
  document.getElementById('setHoliday').value = SETTINGS.hours.holidayLabel || '';
  document.getElementById('setVenue').value = SETTINGS.venueName || '';
  document.getElementById('setAddress').value = SETTINGS.address || '';
  document.getElementById('setName').value = SETTINGS.contact.name || '';
  document.getElementById('setEmail').value = SETTINGS.contact.email || '';
  document.getElementById('setPhone').value = SETTINGS.contact.phone || '';
  document.getElementById('setMessenger').value = SETTINGS.contact.messenger || '';
  document.getElementById('setGcash').value = SETTINGS.payment.gcash || '';
  document.getElementById('setMaya').value = SETTINGS.payment.maya || '';
  document.getElementById('setBdo').value = SETTINGS.payment.bdo || '';
  document.getElementById('setAcct').value = SETTINGS.payment.accountName || '';
}
async function saveSettings() {
  const open = Number(document.getElementById('setOpen').value);
  const close = Number(document.getElementById('setClose').value);
  if (close <= open) return toast('Closing time must be after opening time', 'warning');
  try {
    await API.put('/api/admin/settings', {
      venueName: document.getElementById('setVenue').value,
      address: document.getElementById('setAddress').value,
      hours: { open, close, holidayLabel: document.getElementById('setHoliday').value },
      contact: {
        name: document.getElementById('setName').value, email: document.getElementById('setEmail').value,
        phone: document.getElementById('setPhone').value, messenger: document.getElementById('setMessenger').value
      },
      payment: {
        gcash: document.getElementById('setGcash').value, maya: document.getElementById('setMaya').value,
        bdo: document.getElementById('setBdo').value, accountName: document.getElementById('setAcct').value
      }
    });
    toast('Settings saved — landing page updated');
    const st = await API.get('/api/admin/settings');
    document.getElementById('venueLabel').textContent = st.venueName;
  } catch (ex) { toast(ex.message, 'error'); }
}

/* ---------- STATS ---------- */
async function loadStats() {
  const s = await API.get('/api/admin/stats');
  const cards = [
    ['Today\'s Bookings', s.todaysBookings, 'bi-calendar-check', ''],
    ['Monthly Revenue', peso(s.monthlyRevenue), 'bi-cash-stack', ''],
    ['Active Customers', s.activeCustomers, 'bi-people', 'blue'],
    ['Available Courts', Math.max(0, s.availableCourts), 'bi-grid', ''],
    ['Occupied Courts', s.occupiedCourts, 'bi-grid-fill', 'blue'],
    ['Pending Payments', s.pendingPayments, 'bi-hourglass-split', 'orange'],
    ['Cancelled Bookings', s.cancelledBookings, 'bi-x-circle', 'red']
  ];
  document.getElementById('statCards').innerHTML = cards.map(([label, val, ic, cls]) => `
    <div class="col-6 col-md-4 col-xl"><div class="card-pc stat-card ${cls} p-3 h-100">
      <div class="d-flex justify-content-between align-items-start">
        <div><div class="stat-label">${label}</div><div class="stat-value">${val}</div></div>
        <i class="bi ${ic} fs-4 text-secondary opacity-50"></i>
      </div></div></div>`).join('');

  const c = s.charts;
  mkChart('chRevenue', 'bar', Object.keys(c.revenueByDay).map(d => d.slice(5)), [{ label: 'Revenue (₱)', data: Object.values(c.revenueByDay), backgroundColor: '#16a34a' }]);
  mkChart('chTrend', 'line', Object.keys(c.bookingsByDay).map(d => d.slice(5)), [{ label: 'Bookings', data: Object.values(c.bookingsByDay), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.15)', fill: true, tension: .35 }]);
  const peakLabels = Object.keys(c.peak).sort((a, b) => a - b);
  mkChart('chPeak', 'bar', peakLabels.map(h => fmtHr(Number(h))), [{ label: 'Bookings', data: peakLabels.map(h => c.peak[h]), backgroundColor: '#f59e0b' }]);
  mkChart('chUsage', 'doughnut', Object.keys(c.courtUsage), [{ data: Object.values(c.courtUsage), backgroundColor: ['#16a34a', '#2563eb', '#f59e0b', '#8b5cf6', '#ef4444'] }]);
  mkChart('chGrowth', 'line', Object.keys(c.growth).sort(), [{ label: 'New customers', data: Object.keys(c.growth).sort().map(k => c.growth[k]), borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,.15)', fill: true, tension: .35 }]);
}
function mkChart(id, type, labels, datasets) {
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById(id), {
    type, data: { labels, datasets },
    options: { plugins: { legend: { display: type === 'doughnut' } }, scales: type === 'doughnut' ? {} : { y: { beginAtZero: true } } }
  });
}
function fmtHr(h) { const ap = h >= 12 ? 'PM' : 'AM'; return (h % 12 === 0 ? 12 : h % 12) + ap; }

/* ---------- BOOKINGS ---------- */
let bookingCache = [];
async function loadAdminBookings() {
  const p = new URLSearchParams();
  const q = document.getElementById('fQ').value, d = document.getElementById('fDate').value,
    c = document.getElementById('fCourt').value, st = document.getElementById('fStatus').value;
  if (q) p.set('q', q); if (d) p.set('date', d); if (c) p.set('courtId', c); if (st) p.set('status', st);
  bookingCache = await API.get('/api/admin/bookings?' + p);
  document.getElementById('adminBookingRows').innerHTML = bookingCache.length ? bookingCache.map(b => `
    <tr>
      <td class="small fw-semibold">${esc(b.ref)}</td>
      <td class="small">${esc(b.customer)}<br><span class="text-secondary">${esc(b.email || '')}</span></td>
      <td>${esc(b.court)}</td>
      <td class="small">${b.date}<br>${b.startLabel}–${b.endLabel}</td>
      <td class="fw-semibold">${peso(b.total)}</td>
      <td><span class="badge-status st-${b.status}">${b.status}</span></td>
      <td><span class="badge-status st-${b.paymentStatus}">${b.paymentStatus}</span></td>
      <td class="text-nowrap">
        ${b.status === 'Pending' ? `
          <button class="btn btn-sm btn-success rounded-3" title="Approve" onclick="bookingAction(${b.id},'approve')"><i class="bi bi-check-lg"></i></button>
          <button class="btn btn-sm btn-outline-danger rounded-3" title="Reject" onclick="bookingAction(${b.id},'reject')"><i class="bi bi-x-lg"></i></button>` : ''}
        ${['Pending', 'Approved'].includes(b.status) ? `
          <button class="btn btn-sm btn-outline-danger rounded-3" title="Cancel" onclick="adminCancel(${b.id},'${esc(b.ref)}')"><i class="bi bi-trash"></i></button>` : ''}
        <button class="btn btn-sm btn-outline-secondary rounded-3" title="Print" onclick="printBooking(${b.id})"><i class="bi bi-printer"></i></button>
      </td>
    </tr>`).join('') : '<tr><td colspan="8" class="text-center text-secondary py-4">No bookings found.</td></tr>';
}
async function bookingAction(id, action) {
  if (!await confirmDialog(action === 'approve' ? 'Approve Booking' : 'Reject Booking', `Are you sure you want to ${action} this booking?`)) return;
  try {
    await API.post(`/api/admin/bookings/${id}/${action}`, {});
    toast(`Booking ${action}d`);
    loadAdminBookings();
  } catch (ex) { toast(ex.message, 'error'); }
}
async function adminCancel(id, ref) {
  if (!await confirmDialog('Cancel Booking', `Cancel booking ${ref}? The customer will be notified.`)) return;
  try {
    await API.post(`/api/bookings/${id}/cancel`, {});
    toast('Booking cancelled');
    loadAdminBookings();
  } catch (ex) { toast(ex.message, 'error'); }
}
function printBooking(id) {
  const b = bookingCache.find(x => x.id === id);
  const w = window.open('', '_blank', 'width=480,height=640');
  w.document.write(`<html><head><title>${b.ref}</title></head><body style="font-family:Segoe UI,sans-serif;padding:24px">
    <h2 style="color:#16a34a">🏓 PickleCourt Booking</h2>
    <p><strong>Ref:</strong> ${b.ref}<br><strong>Customer:</strong> ${esc(b.customer)}<br>
    <strong>Court:</strong> ${esc(b.court)}<br><strong>Date:</strong> ${b.date} ${b.startLabel}–${b.endLabel}<br>
    <strong>Players:</strong> ${b.players}<br><strong>Total:</strong> ${peso(b.total)}<br>
    <strong>Status:</strong> ${b.status} · ${b.paymentStatus}</p>
    <script>window.print()<\/script></body></html>`);
  w.document.close();
}
function exportBookings() {
  downloadCSV('bookings.csv',
    ['Ref', 'Customer', 'Email', 'Court', 'Date', 'Start', 'End', 'Players', 'Amount', 'Status', 'Payment'],
    bookingCache.map(b => [b.ref, b.customer, b.email, b.court, b.date, b.startLabel, b.endLabel, b.players, b.total, b.status, b.paymentStatus]));
}
function downloadCSV(name, headers, rows) {
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
  toast('Exported ' + name);
}

/* ---------- CALENDAR ---------- */
async function loadCalendar() {
  const mEl = document.getElementById('calMonth');
  if (!mEl.value) mEl.value = new Date().toISOString().slice(0, 7);
  mEl.onchange = loadCalendar;
  const { bookings, maintenance } = await API.get('/api/admin/calendar?month=' + mEl.value);
  const [y, m] = mEl.value.split('-').map(Number);
  const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
  let html = '<thead><tr>' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<th class="small text-secondary">${d}</th>`).join('') + '</tr></thead><tbody><tr>';
  for (let i = 0; i < first.getDay(); i++) html += '<td class="cal-cell"></td>';
  for (let day = 1; day <= days; day++) {
    const ds = `${mEl.value}-${String(day).padStart(2, '0')}`;
    const evs = bookings.filter(b => b.date === ds);
    const maint = maintenance.filter(x => x.date === ds);
    html += `<td class="cal-cell"><div class="fw-bold small mb-1">${day}</div>
      ${maint.map(x => `<span class="cal-ev cal-Maintenance">🔧 ${esc(COURTS.find(c => c.id === x.courtId)?.name || '')}</span>`).join('')}
      ${evs.map(e => `<span class="cal-ev cal-${e.status}" title="${esc(e.ref)} · ${esc(e.customer || '')}">${fmtHr(e.startHour)} ${esc(e.court)}</span>`).join('')}</td>`;
    if ((first.getDay() + day) % 7 === 0) html += '</tr><tr>';
  }
  html += '</tr></tbody>';
  document.getElementById('calTable').innerHTML = html;
}
async function saveMaintenance() {
  const courtId = document.getElementById('maintCourt').value;
  const date = document.getElementById('maintDate').value;
  if (!date) return toast('Pick a date', 'warning');
  try {
    await API.post('/api/admin/maintenance', { courtId, date, note: document.getElementById('maintNote').value });
    toast('Maintenance scheduled — slots blocked');
    bootstrap.Modal.getInstance(document.getElementById('maintModal'))?.hide();
    loadCalendar();
  } catch (ex) { toast(ex.message, 'error'); }
}

/* ---------- PAYMENTS ---------- */
async function loadAdminPayments() {
  const rows = await API.get('/api/admin/payments');
  document.getElementById('adminPaymentRows').innerHTML = rows.length ? rows.map(p => `
    <tr><td>${p.id}</td><td class="small fw-semibold">${esc(p.bookingRef || '')}</td><td class="small">${esc(p.customer)}</td>
    <td>${esc(p.method)}</td><td class="fw-semibold">${peso(p.amount)}</td>
    <td>${p.proofFile ? `<button class="btn btn-sm btn-outline-secondary rounded-3" onclick="viewProof('${p.proofFile}')"><i class="bi bi-image"></i> View</button>` : '<span class="text-secondary small">Cash</span>'}</td>
    <td><span class="badge-status st-${p.status}">${p.status}</span></td>
    <td class="text-nowrap">
      ${p.status === 'Pending' ? `
        <button class="btn btn-sm btn-success rounded-3" onclick="payAction(${p.id},'verify')" title="Verify & issue receipt"><i class="bi bi-check-lg"></i> Verify</button>
        <button class="btn btn-sm btn-outline-danger rounded-3" onclick="payAction(${p.id},'reject')" title="Reject"><i class="bi bi-x-lg"></i></button>` : ''}
      ${p.status === 'Verified' ? `<button class="btn btn-sm btn-outline-primary rounded-3" onclick="payAction(${p.id},'refund')">Refund</button>` : ''}
    </td></tr>`).join('') : '<tr><td colspan="8" class="text-center text-secondary py-4">No payments yet.</td></tr>';
}
function viewProof(url) {
  document.getElementById('proofBody').innerHTML = url.endsWith('.pdf')
    ? `<iframe src="${url}" style="width:100%;height:70vh;border:0"></iframe>`
    : `<img src="${url}" class="img-fluid rounded-3" alt="Proof of payment">`;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('proofModal')).show();
}
async function payAction(id, action) {
  const labels = { verify: 'Verify this payment and issue an official receipt?', reject: 'Reject this payment?', refund: 'Mark this payment as refunded?' };
  if (!await confirmDialog('Payment ' + action, labels[action])) return;
  try {
    await API.post(`/api/admin/payments/${id}/${action}`, {});
    toast('Payment ' + (action === 'verify' ? 'verified — receipt issued' : action + 'ed'));
    loadAdminPayments();
  } catch (ex) { toast(ex.message, 'error'); }
}

/* ---------- COURTS ---------- */
async function loadAdminCourts() {
  COURTS = await API.get('/api/admin/courts');
  document.getElementById('adminCourtCards').innerHTML = COURTS.map(c => `
    <div class="col-md-6 col-xl-4"><div class="card-pc overflow-hidden h-100">
      ${courtImg(c)}
      <div class="p-3">
        <div class="d-flex justify-content-between align-items-center">
          <h5 class="fw-bold mb-0">${esc(c.name)}</h5>
          <span class="badge ${c.status === 'Available' ? 'bg-success' : c.status === 'Maintenance' ? 'bg-secondary' : 'bg-danger'} rounded-pill">${esc(c.status)}</span></div>
        <div class="small text-secondary mb-2">${esc(c.type)} · ${esc(c.surface)} · ${c.capacity} players</div>
        <div class="small mb-2">Rate: ${peso(c.pricing.weekday)}/hr</div>
        <div class="input-group input-group-sm mb-2">
          <input type="file" class="form-control" id="courtImg-${c.id}" accept=".jpg,.jpeg,.png">
          <button class="btn btn-outline-success" onclick="uploadCourtImage(${c.id})" title="Upload court photo"><i class="bi bi-upload"></i></button>
          <button class="btn btn-outline-secondary" onclick="resetCourtImage(${c.id})" title="Reset to default image" ${c.photo ? '' : 'disabled'}><i class="bi bi-arrow-counterclockwise"></i> Reset</button>
        </div>
        <div class="d-flex gap-1">
          <button class="btn btn-sm btn-outline-primary rounded-3 flex-grow-1" onclick="openCourtModal(${c.id})"><i class="bi bi-pencil"></i> Edit</button>
          <button class="btn btn-sm btn-outline-danger rounded-3" onclick="deleteCourt(${c.id},'${esc(c.name)}')"><i class="bi bi-trash"></i></button>
        </div>
      </div>
    </div></div>`).join('');
}
function openCourtModal(id) {
  const f = document.getElementById('courtForm');
  f.reset();
  f.id.value = id || '';
  document.getElementById('courtModalTitle').textContent = id ? 'Edit Court' : 'Add Court';
  if (id) {
    const c = COURTS.find(c => c.id === id);
    f.name.value = c.name; f.type.value = c.type; f.status.value = c.status;
    f.surface.value = c.surface; f.capacity.value = c.capacity; f.size.value = c.size;
    f.lighting.checked = c.lighting; f.airconditioned.checked = c.airconditioned;
    f.pWeekday.value = c.pricing.weekday; f.pWeekend.value = c.pricing.weekend;
    f.pHoliday.value = c.pricing.holiday; f.pPeak.value = c.pricing.peak; f.pOffpeak.value = c.pricing.offpeak;
  }
  bootstrap.Modal.getOrCreateInstance(document.getElementById('courtModal')).show();
}
document.getElementById('courtForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const body = {
    name: f.name.value, type: f.type.value, status: f.status.value, surface: f.surface.value,
    capacity: Number(f.capacity.value), size: f.size.value,
    lighting: f.lighting.checked, airconditioned: f.airconditioned.checked,
    pricing: {
      weekday: Number(f.pWeekday.value), weekend: Number(f.pWeekend.value),
      holiday: Number(f.pHoliday.value), peak: Number(f.pPeak.value), offpeak: Number(f.pOffpeak.value)
    }
  };
  try {
    if (f.id.value) await API.put('/api/admin/courts/' + f.id.value, body);
    else await API.post('/api/admin/courts', body);
    toast('Court saved');
    bootstrap.Modal.getInstance(document.getElementById('courtModal'))?.hide();
    loadAdminCourts();
  } catch (ex) { toast(ex.message, 'error'); }
});
async function uploadCourtImage(id) {
  const file = document.getElementById('courtImg-' + id).files[0];
  if (!file) return toast('Choose a JPG or PNG photo first', 'warning');
  const fd = new FormData();
  fd.append('image', file);
  try {
    await API.post(`/api/admin/courts/${id}/image`, fd);
    toast('Court photo updated');
    loadAdminCourts();
  } catch (ex) { toast(ex.message, 'error'); }
}
async function resetCourtImage(id) {
  if (!await confirmDialog('Reset Court Image', 'Remove the uploaded photo and go back to the default court graphic?')) return;
  try {
    await API.post(`/api/admin/courts/${id}/image/reset`, {});
    toast('Court image reset to default');
    loadAdminCourts();
  } catch (ex) { toast(ex.message, 'error'); }
}
async function deleteCourt(id, name) {
  if (!await confirmDialog('Delete Court', `Delete ${name}? Existing bookings are kept for records.`)) return;
  try {
    await API.del('/api/admin/courts/' + id);
    toast('Court deleted');
    loadAdminCourts();
  } catch (ex) { toast(ex.message, 'error'); }
}

/* ---------- CUSTOMERS ---------- */
async function loadCustomers() {
  const rows = await API.get('/api/admin/customers');
  document.getElementById('customerRows').innerHTML = rows.length ? rows.map(u => `
    <tr>
      <td><strong>${esc(u.firstName)} ${esc(u.lastName)}</strong><br><span class="small text-secondary">@${esc(u.username)}</span></td>
      <td class="small">${esc(u.email)}<br>${esc(u.mobile)}</td>
      <td>${u.bookingCount}</td>
      <td class="fw-semibold">${peso(u.totalSpent)}</td>
      <td>${u.membership ? `<span class="badge bg-warning text-dark rounded-pill">${esc(u.membership)}</span>` : '<span class="text-secondary small">None</span>'}</td>
      <td>${u.blacklisted ? '<span class="badge bg-danger rounded-pill">Blacklisted</span>' : u.username === 'guest' ? '<span class="badge bg-info rounded-pill">Walk-in Guest</span>' : u.verified ? '<span class="badge bg-success rounded-pill">Verified</span>' : '<span class="badge bg-secondary rounded-pill">Unverified</span>'}</td>
      <td>${u.id ? `<button class="btn btn-sm ${u.blacklisted ? 'btn-outline-success' : 'btn-outline-danger'} rounded-3" onclick="toggleBlacklist(${u.id})">
        ${u.blacklisted ? 'Unblacklist' : 'Blacklist'}</button>` : '—'}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="text-center text-secondary py-4">No customers yet.</td></tr>';
}
async function toggleBlacklist(id) {
  if (!await confirmDialog('Blacklist', 'Toggle blacklist status for this customer?')) return;
  try { await API.post(`/api/admin/customers/${id}/blacklist`, {}); toast('Updated'); loadCustomers(); }
  catch (ex) { toast(ex.message, 'error'); }
}

/* ---------- SITE CONTENT: HIGHLIGHTS + LOGO ---------- */
function hlTypeChanged() {
  const t = document.getElementById('hlType').value;
  document.getElementById('hlUrl').classList.toggle('d-none', t === 'post');
  document.getElementById('hlUrl').placeholder = t === 'video' ? 'Facebook reel/video URL' : 'Image URL (or upload below)';
  document.getElementById('hlImage').classList.toggle('d-none', t !== 'image');
  document.getElementById('hlText').classList.toggle('d-none', t !== 'post');
}
async function loadContent() {
  const rows = await API.get('/api/admin/highlights');
  const icons = { video: 'bi-camera-video', image: 'bi-image', post: 'bi-megaphone' };
  document.getElementById('hlRows').innerHTML = rows.length ? rows.map(h => `
    <tr>
      <td><i class="bi ${icons[h.type]} me-1"></i>${esc(h.type)}</td>
      <td class="fw-semibold">${esc(h.title)}</td>
      <td class="small text-secondary" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.url || h.text || '')}</td>
      <td><span class="badge ${h.active ? 'bg-success' : 'bg-secondary'} rounded-pill">${h.active ? 'Live' : 'Hidden'}</span></td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-outline-secondary rounded-3" onclick="toggleHighlight(${h.id})">${h.active ? 'Hide' : 'Show'}</button>
        <button class="btn btn-sm btn-outline-danger rounded-3" onclick="deleteHighlight(${h.id},'${esc(h.title)}')"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`).join('') : '<tr><td colspan="5" class="text-center text-secondary py-4">No highlights yet.</td></tr>';
}
document.getElementById('hlForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const fd = new FormData();
  ['type', 'title', 'url', 'text'].forEach(k => fd.append(k, f[k].value));
  if (f.image.files[0]) fd.append('image', f.image.files[0]);
  try {
    await API.post('/api/admin/highlights', fd);
    toast('Highlight published to the landing page');
    f.reset();
    hlTypeChanged();
    loadContent();
  } catch (ex) { toast(ex.message, 'error'); }
});
async function toggleHighlight(id) {
  await API.post(`/api/admin/highlights/${id}/toggle`, {});
  loadContent();
}
async function deleteHighlight(id, title) {
  if (!await confirmDialog('Delete Highlight', `Remove "${title}" from the landing page permanently?`)) return;
  await API.del('/api/admin/highlights/' + id);
  toast('Highlight deleted');
  loadContent();
}
async function uploadLogo() {
  const file = document.getElementById('logoFile').files[0];
  if (!file) return toast('Choose a JPG or PNG logo file first', 'warning');
  const fd = new FormData();
  fd.append('logo', file);
  try {
    await API.post('/api/admin/logo', fd);
    toast('Logo uploaded! Refresh any page to see it.');
    setTimeout(() => location.reload(), 1200);
  } catch (ex) { toast(ex.message, 'error'); }
}
async function resetLogo() {
  if (!await confirmDialog('Reset Logo', 'Remove the uploaded logo and go back to the default bear badge?')) return;
  try {
    await API.post('/api/admin/logo/reset', {});
    toast('Logo reset to default');
    setTimeout(() => location.reload(), 900);
  } catch (ex) { toast(ex.message, 'error'); }
}

/* ---------- OPEN PLAY ---------- */
function hourOptions(sel, from, to, label) {
  sel.innerHTML = `<option value="">${label}</option>` +
    Array.from({ length: to - from + 1 }, (_, i) => from + i)
      .map(h => `<option value="${h}">${fmtHr(h)}</option>`).join('');
}
async function loadOpenPlay() {
  document.getElementById('opCourt').innerHTML = '<option value="">All courts (no slot block)</option>' +
    COURTS.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  hourOptions(document.getElementById('opStart'), 6, 21, 'Start time…');
  hourOptions(document.getElementById('opEnd'), 7, 22, 'End time…');
  const rows = await API.get('/api/admin/openplay');
  document.getElementById('opRows').innerHTML = rows.length ? rows.map(s => `
    <tr>
      <td class="fw-semibold">${esc(s.title)}${s.note ? `<br><small class="text-secondary">${esc(s.note)}</small>` : ''}</td>
      <td class="small">${s.date}<br>${s.startLabel}–${s.endLabel}</td>
      <td class="small">${esc(s.court)}</td>
      <td class="small">${s.fee ? peso(s.fee) : 'Free'}${s.capacity ? ' / ' + s.capacity + ' players' : ''}</td>
      <td>${!s.active ? '<span class="badge bg-secondary rounded-pill">Disabled</span>'
        : s.full ? '<span class="badge bg-danger rounded-pill">Fully Booked</span>'
        : '<span class="badge bg-success rounded-pill">Open</span>'}</td>
      <td class="text-nowrap">
        <button class="btn btn-sm ${s.full ? 'btn-outline-success' : 'btn-outline-danger'} rounded-3" title="Toggle fully booked"
          onclick="updateOpenPlay(${s.id},{full:${!s.full}})">${s.full ? 'Reopen' : 'Mark Full'}</button>
        <button class="btn btn-sm btn-outline-secondary rounded-3" title="Enable/disable"
          onclick="updateOpenPlay(${s.id},{active:${!s.active}})">${s.active ? 'Disable' : 'Enable'}</button>
        <button class="btn btn-sm btn-outline-danger rounded-3" onclick="deleteOpenPlay(${s.id},'${esc(s.title)}')"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`).join('') : '<tr><td colspan="6" class="text-center text-secondary py-4">No sessions yet.</td></tr>';
}
document.getElementById('opForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await API.post('/api/admin/openplay', {
      title: f.title.value, courtId: f.courtId.value, date: f.date.value,
      startHour: f.startHour.value, endHour: f.endHour.value,
      fee: f.fee.value, capacity: f.capacity.value, note: f.note.value
    });
    toast('Open play session created');
    f.reset();
    loadOpenPlay();
  } catch (ex) { toast(ex.message, 'error'); }
});
async function updateOpenPlay(id, patch) {
  try {
    await API.put('/api/admin/openplay/' + id, patch);
    toast('Session updated');
    loadOpenPlay();
  } catch (ex) { toast(ex.message, 'error'); }
}
async function deleteOpenPlay(id, title) {
  if (!await confirmDialog('Delete Session', `Delete "${title}"?`)) return;
  await API.del('/api/admin/openplay/' + id);
  toast('Session deleted');
  loadOpenPlay();
}

/* ---------- TOURNAMENTS ---------- */
async function loadTournaments() {
  const rows = await API.get('/api/admin/tournaments');
  document.getElementById('tRows').innerHTML = rows.length ? rows.map(t => `
    <tr>
      <td class="fw-semibold">${esc(t.title)}</td>
      <td class="small">${t.date}</td>
      <td>${peso(t.fee)}</td>
      <td class="small">${t.registered}${t.capacity ? '/' + t.capacity : ''}</td>
      <td><span class="badge ${t.status === 'Open' && t.published ? 'bg-success' : 'bg-secondary'} rounded-pill">${t.published ? t.status : 'Unpublished'}</span></td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-outline-primary rounded-3" onclick="viewRegs(${t.id},'${esc(t.title)}')"><i class="bi bi-people"></i> Regs</button>
        <button class="btn btn-sm btn-outline-secondary rounded-3" onclick="updateTournament(${t.id},{status:'${t.status === 'Open' ? 'Closed' : 'Open'}'})">${t.status === 'Open' ? 'Close' : 'Reopen'}</button>
        <button class="btn btn-sm btn-outline-secondary rounded-3" onclick="updateTournament(${t.id},{published:${!t.published}})">${t.published ? 'Unpublish' : 'Publish'}</button>
        <button class="btn btn-sm btn-outline-danger rounded-3" onclick="deleteTournament(${t.id},'${esc(t.title)}')"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`).join('') : '<tr><td colspan="6" class="text-center text-secondary py-4">No tournaments yet.</td></tr>';
}
document.getElementById('tForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await API.post('/api/admin/tournaments', {
      title: f.title.value, date: f.date.value, description: f.description.value,
      fee: f.fee.value, capacity: f.capacity.value
    });
    toast('Tournament published to the landing page');
    f.reset();
    loadTournaments();
  } catch (ex) { toast(ex.message, 'error'); }
});
async function updateTournament(id, patch) {
  try {
    await API.put('/api/admin/tournaments/' + id, patch);
    toast('Tournament updated');
    loadTournaments();
  } catch (ex) { toast(ex.message, 'error'); }
}
async function deleteTournament(id, title) {
  if (!await confirmDialog('Delete Tournament', `Delete "${title}" and hide it from the landing page?`)) return;
  await API.del('/api/admin/tournaments/' + id);
  toast('Tournament deleted');
  loadTournaments();
  document.getElementById('tregPanel').classList.add('d-none');
}
async function viewRegs(id, title) {
  const rows = await API.get(`/api/admin/tournaments/${id}/registrations`);
  document.getElementById('tregPanel').classList.remove('d-none');
  document.getElementById('tregPanelTitle').textContent = `Registrations — ${title}`;
  document.getElementById('tregRows').innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td class="fw-semibold">${esc(r.name)}</td>
      <td class="small">${esc(r.mobile)}<br>${esc(r.email)}</td>
      <td class="small">${esc(r.method)} · ${peso(r.amount)}${r.reference ? '<br>Ref: ' + esc(r.reference) : ''}</td>
      <td>${r.proofFile ? `<button class="btn btn-sm btn-outline-secondary rounded-3" onclick="viewProof('${r.proofFile}')"><i class="bi bi-image"></i></button>` : '—'}</td>
      <td><span class="badge-status st-${r.status}">${r.status}</span></td>
      <td class="text-nowrap">
        ${r.status === 'Pending' ? `
          <button class="btn btn-sm btn-success rounded-3" onclick="regAction(${r.id},'verify',${id},'${esc(title)}')"><i class="bi bi-check-lg"></i></button>
          <button class="btn btn-sm btn-outline-danger rounded-3" onclick="regAction(${r.id},'reject',${id},'${esc(title)}')"><i class="bi bi-x-lg"></i></button>` : ''}
      </td>
    </tr>`).join('') : '<tr><td colspan="6" class="text-center text-secondary py-3">No registrations yet.</td></tr>';
}
async function regAction(id, action, tid, title) {
  try {
    await API.post(`/api/admin/tournament-regs/${id}/${action}`, {});
    toast('Registration ' + (action === 'verify' ? 'verified — player confirmed' : 'rejected'));
    viewRegs(tid, title);
    loadTournaments();
  } catch (ex) { toast(ex.message, 'error'); }
}

/* ---------- EQUIPMENT ---------- */
async function loadEquipment() {
  const rows = await API.get('/api/admin/equipment');
  document.getElementById('equipCards').innerHTML = rows.map(e => `
    <div class="col-md-6 col-xl-4"><div class="card-pc p-4">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="fw-bold mb-0">${esc(e.name)}</h6>
        <span class="badge ${e.stock > 5 ? 'bg-success' : e.stock > 0 ? 'bg-warning text-dark' : 'bg-danger'} rounded-pill">${e.stock} left</span></div>
      <div class="row g-2">
        <div class="col-6"><label class="form-label small">Stock</label>
          <input type="number" class="form-control form-control-sm" value="${e.stock}" id="eq-stock-${e.id}" min="0"></div>
        <div class="col-6"><label class="form-label small">Price (₱)</label>
          <input type="number" class="form-control form-control-sm" value="${e.price}" id="eq-price-${e.id}" min="0"></div>
      </div>
      <button class="btn btn-pc btn-sm w-100 mt-3" onclick="saveEquip(${e.id})">Update</button>
    </div></div>`).join('');
}
async function saveEquip(id) {
  try {
    await API.put('/api/admin/equipment/' + id, {
      stock: Number(document.getElementById('eq-stock-' + id).value),
      price: Number(document.getElementById('eq-price-' + id).value)
    });
    toast('Inventory updated');
    loadEquipment();
  } catch (ex) { toast(ex.message, 'error'); }
}

/* ---------- REPORTS ---------- */
let reportCache = null;
function quickRange(days) {
  const to = new Date(), from = new Date();
  from.setDate(from.getDate() - days);
  document.getElementById('repFrom').value = from.toISOString().slice(0, 10);
  document.getElementById('repTo').value = to.toISOString().slice(0, 10);
  loadReport();
}
async function loadReport() {
  const from = document.getElementById('repFrom').value, to = document.getElementById('repTo').value;
  const p = new URLSearchParams();
  if (from) p.set('from', from); if (to) p.set('to', to);
  reportCache = await API.get('/api/admin/reports?' + p);
  const r = reportCache;
  document.getElementById('reportBody').innerHTML = `
    <div class="row g-3 mb-3">
      <div class="col-6 col-md-3"><div class="card-pc stat-card p-3"><div class="stat-label">Bookings</div><div class="stat-value">${r.totalBookings}</div></div></div>
      <div class="col-6 col-md-3"><div class="card-pc stat-card p-3"><div class="stat-label">Revenue</div><div class="stat-value fs-5">${peso(r.revenue)}</div></div></div>
      <div class="col-6 col-md-3"><div class="card-pc stat-card blue p-3"><div class="stat-label">Customers</div><div class="stat-value">${r.customers}</div></div></div>
      <div class="col-6 col-md-3"><div class="card-pc stat-card red p-3"><div class="stat-label">Cancelled</div><div class="stat-value">${r.cancelled}</div></div></div>
    </div>
    <div class="row g-3 mb-3">
      <div class="col-md-6"><div class="card-pc p-4"><h6 class="fw-bold mb-2">Court Utilization (hours)</h6>
        ${Object.entries(r.courtUtilization).map(([k, v]) => `<div class="d-flex justify-content-between small py-1 border-bottom"><span>${esc(k)}</span><strong>${v} hrs</strong></div>`).join('') || '<span class="text-secondary small">No data</span>'}</div></div>
      <div class="col-md-6"><div class="card-pc p-4"><h6 class="fw-bold mb-2">Equipment Rentals</h6>
        ${Object.entries(r.equipmentRentals).map(([k, v]) => `<div class="d-flex justify-content-between small py-1 border-bottom"><span>${esc(k)}</span><strong>${v}×</strong></div>`).join('') || '<span class="text-secondary small">No data</span>'}</div></div>
    </div>
    <div class="card-pc p-3"><div class="table-responsive">
      <table class="table table-pc table-sm align-middle">
        <thead><tr><th>Ref</th><th>Date</th><th>Time</th><th>Court</th><th>Customer</th><th>Amount</th><th>Status</th><th>Payment</th></tr></thead>
        <tbody>${r.rows.map(x => `<tr><td class="small">${esc(x.ref)}</td><td class="small">${x.date}</td><td class="small">${x.time}</td>
          <td>${esc(x.court || '')}</td><td class="small">${esc(x.customer)}</td><td>${peso(x.amount)}</td>
          <td><span class="badge-status st-${x.status}">${x.status}</span></td>
          <td><span class="badge-status st-${x.payment}">${x.payment}</span></td></tr>`).join('') || '<tr><td colspan="8" class="text-center text-secondary py-3">No rows in range.</td></tr>'}</tbody>
      </table>
    </div></div>`;
}
function exportReport() {
  if (!reportCache) return toast('Generate a report first', 'warning');
  downloadCSV('report.csv',
    ['Ref', 'Date', 'Time', 'Court', 'Customer', 'Amount', 'Status', 'Payment'],
    reportCache.rows.map(x => [x.ref, x.date, x.time, x.court, x.customer, x.amount, x.status, x.payment]));
}

/* ---------- AUDIT ---------- */
async function loadAudit() {
  const rows = await API.get('/api/admin/audit');
  document.getElementById('auditRows').innerHTML = rows.length ? rows.map(l => `
    <tr><td class="small text-secondary">${new Date(l.at).toLocaleString()}</td>
    <td class="small fw-semibold">${esc(l.user)}</td>
    <td><span class="badge bg-light text-dark border">${esc(l.action)}</span></td>
    <td class="small">${esc(l.details)}</td></tr>`).join('') : '<tr><td colspan="4" class="text-center text-secondary py-4">No logs yet.</td></tr>';
}
