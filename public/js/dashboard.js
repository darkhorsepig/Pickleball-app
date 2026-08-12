/* User dashboard SPA logic */
if (!API.token()) location.href = 'login.html';
const me = API.user() || {};
let META = null, COURTS = [];

/* ---------- view routing ---------- */
const VIEW_TITLES = { home: 'Dashboard', book: 'Book a Court', courts: 'Court Schedule', bookings: 'My Bookings', payments: 'Payment History', notifications: 'Notifications', profile: 'My Profile' };
function showView(name) {
  document.querySelectorAll('[data-viewpane]').forEach(s => s.classList.toggle('d-none', s.dataset.viewpane !== name));
  document.querySelectorAll('#sideNav .nav-link[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === name));
  document.getElementById('pageTitle').textContent = VIEW_TITLES[name] || 'Dashboard';
  if (name === 'courts') loadSchedule();
  if (name === 'bookings') loadBookings();
  if (name === 'payments') loadPayments();
  if (name === 'notifications') loadNotifs();
  if (name === 'profile') fillProfile();
  if (name === 'book') initWizard();
  if (name === 'home') loadHome();
  const off = document.getElementById('mobileNav');
  if (off) bootstrap.Offcanvas.getInstance(off)?.hide();
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-view]');
  if (a) { e.preventDefault(); location.hash = a.dataset.view; }
});
window.addEventListener('hashchange', () => showView(location.hash.replace('#', '').split('?')[0] || 'home'));

/* ---------- boot ---------- */
(async () => {
  try {
    META = await API.get('/api/meta');
    COURTS = await API.get('/api/courts');
    // clone sidebar into mobile offcanvas
    document.getElementById('mobileNavBody').innerHTML = document.getElementById('sideNav').outerHTML;
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good Morning' : h < 18 ? 'Good Afternoon' : 'Good Evening';
    document.getElementById('greeting').textContent = `${greet}, ${me.firstName}! 🏓`;
    document.getElementById('topUserName').textContent = me.firstName;
    document.getElementById('avatarBadge').textContent = (me.firstName[0] + (me.lastName ? me.lastName[0] : '')).toUpperCase();
    renderMemberPlans();
    showView(location.hash.replace('#', '').split('?')[0] || 'home');
    refreshBadge();
  } catch (e) { console.error(e); }
  hideLoader();
})();

async function refreshBadge() {
  try {
    const n = await API.get('/api/notifications');
    const unread = n.filter(x => !x.read).length;
    const b = document.getElementById('notifBadge');
    b.classList.toggle('d-none', !unread);
    b.textContent = unread;
  } catch { }
}

/* ---------- HOME ---------- */
async function loadHome() {
  const rows = await API.get('/api/bookings/mine');
  const upcoming = rows.filter(b => ['Pending', 'Approved'].includes(b.status) && b.date >= todayISO()).sort((a, b) => a.date.localeCompare(b.date))[0];
  document.getElementById('statUpcoming').textContent = upcoming ? `${upcoming.court} · ${upcoming.date} ${upcoming.startLabel}` : 'None yet';
  document.getElementById('statTotal').textContent = rows.length;
  document.getElementById('statPending').textContent = rows.filter(b => b.paymentStatus === 'Pending' && b.status !== 'Cancelled').length;
  document.getElementById('statMember').textContent = me.membership || 'None';
  document.getElementById('homeBookings').innerHTML = rows.length ? `
    <table class="table table-pc align-middle mb-0"><thead><tr><th>Ref</th><th>Court</th><th>Date</th><th>Status</th></tr></thead>
    <tbody>${rows.slice(0, 5).map(b => `<tr><td class="small fw-semibold">${esc(b.ref)}</td><td>${esc(b.court)}</td>
      <td class="small">${b.date}<br>${b.startLabel}</td><td><span class="badge-status st-${b.status}">${b.status}</span></td></tr>`).join('')}</tbody></table>`
    : '<p class="text-secondary mb-0">No bookings yet — book your first court!</p>';
}
function todayISO() {
  const t = new Date();
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}

/* ---------- SCHEDULE ---------- */
async function loadSchedule() {
  const dateEl = document.getElementById('schedDate');
  if (!dateEl.value) dateEl.value = todayISO();
  dateEl.min = todayISO();
  dateEl.onchange = loadSchedule;
  const holder = document.getElementById('courtList');
  holder.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-success"></div></div>';
  const cards = await Promise.all(COURTS.map(async c => {
    const slots = await API.get(`/api/courts/${c.id}/availability?date=${dateEl.value}`);
    const freeCount = slots.filter(s => s.status === 'available').length;
    return `<div class="col-lg-6"><div class="card-pc overflow-hidden h-100">
      <div class="row g-0">
        <div class="col-4">${courtSVG(c.image, c.name)}</div>
        <div class="col-8 p-3">
          <div class="d-flex justify-content-between">
            <h5 class="fw-bold mb-0">${esc(c.name)}</h5>
            <span class="badge ${c.status === 'Available' ? 'bg-success' : 'bg-secondary'} rounded-pill">${esc(c.status)}</span></div>
          <div class="small text-secondary mb-1">${esc(c.type)} · ${esc(c.surface)} · Capacity: ${c.capacity} players</div>
          <div class="small mb-2"><span class="fw-bold text-success">${peso(c.pricing.weekday)}</span>/hr weekday · <span class="fw-bold">${peso(c.pricing.weekend)}</span>/hr weekend</div>
          <div class="small mb-2 text-secondary">${freeCount} slot${freeCount === 1 ? '' : 's'} free on ${dateEl.value}</div>
          <button class="btn btn-pc btn-sm" onclick="startBooking(${c.id})">Book Now</button>
        </div>
      </div>
      <div class="p-3 pt-0"><div class="row g-1">
        ${slots.map(s => `<div class="col-2"><div class="slot-btn slot-${s.status}" title="${s.label}: ${s.status}">${s.label.replace(':00 ', '')}</div></div>`).join('')}
      </div></div>
    </div></div>`;
  }));
  holder.innerHTML = cards.join('');
}
function startBooking(courtId) {
  wiz.courtId = courtId;
  location.hash = 'book';
  setTimeout(() => { renderStep(2); }, 50);
}

/* ---------- BOOKING WIZARD ---------- */
const STEPS = ['Court', 'Date', 'Time', 'Duration', 'Players', 'Equipment', 'Services', 'Promo', 'Summary', 'Payment'];
let wiz = {};
function initWizard() {
  wiz = { courtId: wiz.courtId || null, date: null, startHour: null, duration: 1, players: 2, equipment: [], services: [], promo: '', step: 1 };
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  if (params.get('court')) wiz.courtId = Number(params.get('court'));
  renderStep(1);
}
function stepBar(cur) {
  document.getElementById('stepBar').innerHTML = STEPS.map((s, i) => `
    <div class="text-center flex-shrink-0" style="min-width:64px">
      <div class="step-dot mx-auto ${i + 1 === cur ? 'active' : i + 1 < cur ? 'done' : ''}">${i + 1 < cur ? '<i class="bi bi-check"></i>' : i + 1}</div>
      <div class="small mt-1 ${i + 1 === cur ? 'fw-bold' : 'text-secondary'}" style="font-size:.7rem">${s}</div>
    </div>`).join('');
}
function navBtns(step, nextOk) {
  return `<div class="d-flex justify-content-between mt-4">
    <button class="btn btn-outline-secondary rounded-3" ${step === 1 ? 'disabled' : ''} onclick="renderStep(${step - 1})"><i class="bi bi-arrow-left me-1"></i>Back</button>
    <button class="btn btn-pc" id="nextBtn" ${nextOk ? '' : 'disabled'} onclick="renderStep(${step + 1})">${step === 9 ? 'Proceed to Payment' : 'Next'} <i class="bi bi-arrow-right ms-1"></i></button>
  </div>`;
}
async function renderStep(step) {
  wiz.step = step;
  stepBar(step);
  const body = document.getElementById('wizardBody');

  if (step === 1) {
    body.innerHTML = `<h5 class="fw-bold mb-3">Step 1 · Select a Court</h5><div class="row g-3">
      ${COURTS.map(c => `<div class="col-md-6 col-xl-3">
        <div class="card-pc hoverable overflow-hidden pointer ${wiz.courtId === c.id ? 'border-success border-2' : ''}" onclick="wiz.courtId=${c.id};renderStep(1)">
          ${courtSVG(c.image, c.name)}
          <div class="p-3">
            <div class="d-flex justify-content-between"><strong>${esc(c.name)}</strong>
              ${wiz.courtId === c.id ? '<i class="bi bi-check-circle-fill text-success"></i>' : ''}</div>
            <small class="text-secondary">${esc(c.type)} · ${c.capacity} players · from ${peso(c.pricing.offpeak)}/hr</small>
          </div></div></div>`).join('')}
    </div>${navBtns(1, !!wiz.courtId)}`;
  }

  else if (step === 2) {
    const max = new Date(); max.setDate(max.getDate() + 30);
    const maxStr = max.toISOString().slice(0, 10);
    body.innerHTML = `<h5 class="fw-bold mb-3">Step 2 · Choose a Date</h5>
      <p class="text-secondary small">Book up to 30 days in advance. Past dates are disabled.</p>
      <input type="date" class="form-control form-control-lg" style="max-width:280px" id="wizDate"
        min="${todayISO()}" max="${maxStr}" value="${wiz.date || ''}"
        onchange="wiz.date=this.value;wiz.startHour=null;document.getElementById('nextBtn').disabled=!this.value">
      ${navBtns(2, !!wiz.date)}`;
  }

  else if (step === 3) {
    body.innerHTML = `<h5 class="fw-bold mb-3">Step 3 · Choose a Start Time</h5>
      <div class="d-flex gap-3 small mb-3 flex-wrap">
        <span><span class="badge" style="background:var(--pc-green)"> </span> Available</span>
        <span><span class="badge" style="background:#dc2626"> </span> Reserved</span>
        <span><span class="badge" style="background:#f59e0b"> </span> Pending</span>
        <span><span class="badge bg-secondary"> </span> Unavailable</span>
      </div>
      <div class="row g-2" id="slotGrid"><div class="text-center py-4"><div class="spinner-border text-success"></div></div></div>
      ${navBtns(3, wiz.startHour != null)}`;
    const slots = await API.get(`/api/courts/${wiz.courtId}/availability?date=${wiz.date}`);
    document.getElementById('slotGrid').innerHTML = slots.map(s => `
      <div class="col-4 col-md-3 col-lg-2">
        <button class="slot-btn slot-${s.status} ${wiz.startHour === s.hour ? 'selected' : ''}"
          ${s.status !== 'available' ? 'disabled' : ''}
          onclick="wiz.startHour=${s.hour};renderStep(3)">${s.label}</button>
      </div>`).join('');
  }

  else if (step === 4) {
    const endOk = d => wiz.startHour + d <= META.hours.close;
    body.innerHTML = `<h5 class="fw-bold mb-3">Step 4 · Select Duration</h5>
      <div class="row g-3" style="max-width:640px">
        ${[1, 2, 3, 4].map(d => `<div class="col-6 col-md-3">
          <div class="card-pc hoverable p-3 text-center pointer ${wiz.duration === d ? 'border-success border-2' : ''} ${endOk(d) ? '' : 'opacity-50'}"
            ${endOk(d) ? `onclick="wiz.duration=${d};renderStep(4)"` : ''}>
            <div class="fs-4 fw-bold">${d}</div><small class="text-secondary">Hour${d > 1 ? 's' : ''}</small>
          </div></div>`).join('')}
      </div>
      <div class="alert alert-success mt-3 py-2" style="max-width:640px">
        <i class="bi bi-clock me-1"></i>${fmtHr(wiz.startHour)} → <strong>${fmtHr(wiz.startHour + wiz.duration)}</strong> (end time is calculated automatically)
      </div>${navBtns(4, endOk(wiz.duration))}`;
  }

  else if (step === 5) {
    body.innerHTML = `<h5 class="fw-bold mb-3">Step 5 · Number of Players</h5>
      <p class="text-secondary small">Minimum 2, maximum 8 players.</p>
      <div class="d-flex align-items-center gap-3">
        <button class="btn btn-outline-secondary rounded-circle" style="width:46px;height:46px" onclick="wiz.players=Math.max(2,wiz.players-1);renderStep(5)">−</button>
        <span class="fs-1 fw-bold" style="min-width:60px;text-align:center">${wiz.players}</span>
        <button class="btn btn-pc rounded-circle" style="width:46px;height:46px" onclick="wiz.players=Math.min(8,wiz.players+1);renderStep(5)">+</button>
        <span class="text-secondary">players</span>
      </div>${navBtns(5, true)}`;
  }

  else if (step === 6) {
    body.innerHTML = `<h5 class="fw-bold mb-3">Step 6 · Equipment Rental <span class="badge bg-secondary">Optional</span></h5>
      <div class="row g-3">${META.equipment.map(eq => `
        <div class="col-md-6 col-lg-4"><label class="card-pc p-3 d-flex gap-3 align-items-center pointer ${wiz.equipment.includes(eq.key) ? 'border-success border-2' : ''}">
          <input class="form-check-input mt-0" type="checkbox" ${wiz.equipment.includes(eq.key) ? 'checked' : ''} ${eq.stock < 1 ? 'disabled' : ''}
            onchange="toggleArr(wiz.equipment,'${eq.key}');renderStep(6)">
          <span class="flex-grow-1"><strong>${esc(eq.name)}</strong><br>
            <small class="text-secondary">${eq.stock > 0 ? eq.stock + ' in stock' : 'Out of stock'}</small></span>
          <span class="fw-bold text-success">${peso(eq.price)}</span>
        </label></div>`).join('')}
      </div>${navBtns(6, true)}`;
  }

  else if (step === 7) {
    body.innerHTML = `<h5 class="fw-bold mb-3">Step 7 · Additional Services <span class="badge bg-secondary">Optional</span></h5>
      <div class="row g-3">${META.services.map(sv => `
        <div class="col-md-6 col-lg-4"><label class="card-pc p-3 d-flex gap-3 align-items-center pointer ${wiz.services.includes(sv.key) ? 'border-primary border-2' : ''}">
          <input class="form-check-input mt-0" type="checkbox" ${wiz.services.includes(sv.key) ? 'checked' : ''}
            onchange="toggleArr(wiz.services,'${sv.key}');renderStep(7)">
          <span class="flex-grow-1"><strong>${esc(sv.name)}</strong></span>
          <span class="fw-bold text-primary">${peso(sv.price)}</span>
        </label></div>`).join('')}
      </div>${navBtns(7, true)}`;
  }

  else if (step === 8) {
    body.innerHTML = `<h5 class="fw-bold mb-3">Step 8 · Promo Code <span class="badge bg-secondary">Optional</span></h5>
      <div class="input-group" style="max-width:420px">
        <input class="form-control" id="promoInput" placeholder="e.g. WELCOME10" value="${esc(wiz.promo)}">
        <button class="btn btn-pc" onclick="applyPromo()">Apply</button>
      </div>
      <div id="promoMsg" class="mt-2 small"></div>
      ${navBtns(8, true)}`;
  }

  else if (step === 9) {
    body.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-success"></div></div>';
    const q = await API.post('/api/bookings/quote', wiz);
    const court = COURTS.find(c => c.id === wiz.courtId);
    body.innerHTML = `<h5 class="fw-bold mb-3">Step 9 · Booking Summary</h5>
      <div class="row g-4"><div class="col-lg-7">
        <table class="table table-pc align-middle">
          <tr><td class="text-secondary">Customer</td><td class="fw-semibold">${esc(me.firstName)} ${esc(me.lastName)}</td></tr>
          <tr><td class="text-secondary">Court</td><td class="fw-semibold">${esc(court.name)} (${esc(court.type)})</td></tr>
          <tr><td class="text-secondary">Date</td><td class="fw-semibold">${wiz.date}</td></tr>
          <tr><td class="text-secondary">Time</td><td class="fw-semibold">${fmtHr(wiz.startHour)} – ${fmtHr(wiz.startHour + wiz.duration)} (${wiz.duration} hr${wiz.duration > 1 ? 's' : ''})</td></tr>
          <tr><td class="text-secondary">Players</td><td class="fw-semibold">${wiz.players}</td></tr>
          <tr><td class="text-secondary">Equipment</td><td>${q.eqItems.length ? q.eqItems.map(e => esc(e.name)).join(', ') : '<span class="text-secondary">None</span>'}</td></tr>
          <tr><td class="text-secondary">Services</td><td>${q.svcItems.length ? q.svcItems.map(s => esc(s.name)).join(', ') : '<span class="text-secondary">None</span>'}</td></tr>
        </table>
      </div><div class="col-lg-5">
        <div class="card-pc p-4" style="background:var(--pc-bg)">
          <div class="d-flex justify-content-between py-1"><span>Court (${wiz.duration} hr)</span><span>${peso(q.courtCost)}</span></div>
          <div class="d-flex justify-content-between py-1"><span>Equipment</span><span>${peso(q.equipCost)}</span></div>
          <div class="d-flex justify-content-between py-1"><span>Services</span><span>${peso(q.svcCost)}</span></div>
          <hr class="my-2">
          <div class="d-flex justify-content-between py-1"><span>Subtotal</span><span>${peso(q.subtotal)}</span></div>
          <div class="d-flex justify-content-between py-1 text-success"><span>Discount ${q.promo ? '(' + q.promo + ')' : ''}${me.membership ? ' + ' + me.membership : ''}</span><span>−${peso(q.discount)}</span></div>
          <div class="d-flex justify-content-between py-1"><span>VAT 12%</span><span>${peso(q.vat)}</span></div>
          <hr class="my-2">
          <div class="d-flex justify-content-between fs-5 fw-bold"><span>Grand Total</span><span class="text-success">${peso(q.total)}</span></div>
        </div>
      </div></div>${navBtns(9, true)}`;
  }

  else if (step === 10) {
    // create the booking, then show payment options
    body.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-success"></div><p class="mt-2 text-secondary">Creating your booking…</p></div>';
    try {
      const res = await API.post('/api/bookings', wiz);
      wiz.booking = res.booking;
      renderPayment();
    } catch (ex) {
      toast(ex.message, 'error');
      renderStep(3);
    }
  }
}
function renderPayment() {
  const b = wiz.booking;
  stepBar(10);
  document.getElementById('wizardBody').innerHTML = `
    <div class="alert alert-success"><i class="bi bi-check-circle me-2"></i>Booking <strong>${b.ref}</strong> created! Complete payment to confirm your slot.</div>
    <h5 class="fw-bold mb-3">Step 10 · Payment — ${peso(b.total)}</h5>
    <div class="row g-3 mb-3" id="payMethods">
      ${['GCash', 'Maya', 'Bank Transfer', 'Credit Card', 'Cash at Venue'].map(m => `
        <div class="col-6 col-md"><div class="card-pc hoverable p-3 text-center pointer pay-opt" data-method="${m}" onclick="selectPay('${m}')">
          <i class="bi ${{ 'GCash': 'bi-phone', 'Maya': 'bi-phone-fill', 'Bank Transfer': 'bi-bank', 'Credit Card': 'bi-credit-card', 'Cash at Venue': 'bi-cash-coin' }[m]} fs-3 text-success"></i>
          <div class="small fw-semibold mt-1">${m}</div>
        </div></div>`).join('')}
    </div>
    <div id="payDetail" class="d-none">
      <div class="card-pc p-4" style="max-width:560px">
        <div id="payInstructions" class="small text-secondary mb-3"></div>
        <div id="proofBox">
          <label class="form-label small fw-semibold">Upload Proof of Payment (JPG, PNG or PDF, max 5 MB)</label>
          <input type="file" class="form-control mb-2" id="proofFile" accept=".jpg,.jpeg,.png,.pdf">
          <input class="form-control mb-3" id="payRef" placeholder="Payment reference number (optional)">
        </div>
        <button class="btn btn-pc w-100" onclick="submitPayment()" id="payBtn"><i class="bi bi-lock me-2"></i>Submit Payment</button>
      </div>
    </div>`;
}
let payMethod = null;
function selectPay(m) {
  payMethod = m;
  document.querySelectorAll('.pay-opt').forEach(el => el.classList.toggle('border-success', el.dataset.method === m));
  document.getElementById('payDetail').classList.remove('d-none');
  const instr = {
    'GCash': 'Send <strong>' + peso(wiz.booking.total) + '</strong> to GCash <strong>0917 000 0000</strong> (PickleCourt Inc.), then upload a screenshot of the receipt.',
    'Maya': 'Send <strong>' + peso(wiz.booking.total) + '</strong> to Maya <strong>0917 000 0000</strong>, then upload a screenshot of the receipt.',
    'Bank Transfer': 'Transfer to <strong>BDO 0012-3456-7890</strong> (PickleCourt Inc.), then upload the transfer confirmation.',
    'Credit Card': 'Pay via our card terminal link sent to your email, then upload the payment confirmation.',
    'Cash at Venue': 'Pay at the front desk at least <strong>15 minutes before</strong> your slot. Your booking stays <em>Pending</em> until paid.'
  };
  document.getElementById('payInstructions').innerHTML = instr[m];
  document.getElementById('proofBox').style.display = m === 'Cash at Venue' ? 'none' : 'block';
}
async function submitPayment() {
  if (!payMethod) return toast('Select a payment method', 'warning');
  const fd = new FormData();
  fd.append('bookingId', wiz.booking.id);
  fd.append('method', payMethod);
  fd.append('reference', document.getElementById('payRef')?.value || '');
  const file = document.getElementById('proofFile')?.files[0];
  if (payMethod !== 'Cash at Venue' && !file) return toast('Please upload your proof of payment', 'warning');
  if (file) fd.append('proof', file);
  const btn = document.getElementById('payBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting…';
  try {
    await API.post('/api/payments', fd);
    showConfirmation(wiz.booking);
  } catch (ex) {
    toast(ex.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-lock me-2"></i>Submit Payment';
  }
}
function showConfirmation(b) {
  const court = COURTS.find(c => c.id === b.courtId);
  document.getElementById('confirmBody').innerHTML = `
    <span class="icon-circle ic-green mx-auto mb-3" style="width:72px;height:72px;font-size:1.8rem"><i class="bi bi-check-lg"></i></span>
    <h4 class="fw-bold">Booking Confirmed!</h4>
    <p class="text-secondary small mb-2">Your booking reference number is</p>
    <div class="fs-4 fw-bold text-success mb-3">${b.ref}</div>
    <div class="d-flex justify-content-center mb-3"><div id="qrBox" class="p-2 bg-white rounded-3"></div></div>
    <div class="text-start small card-pc p-3 mb-3" style="background:var(--pc-bg)">
      <div><strong>${esc(court.name)}</strong> · ${b.date} · ${b.startLabel}–${b.endLabel}</div>
      <div>Players: ${b.players} · Total: <strong>${peso(b.total)}</strong> · Payment: ${b.paymentStatus}</div>
      <div class="mt-1"><i class="bi bi-geo-alt me-1"></i>88 Pickle Ave, Diliman, Quezon City ·
        <a href="https://maps.google.com/?q=Quezon+City+Circle" target="_blank" rel="noopener">Google Maps</a></div>
      <div class="text-secondary mt-1">Free cancellation up to 24 hours before your slot. A confirmation email has been sent.</div>
    </div>
    <div class="d-flex gap-2 justify-content-center">
      <button class="btn btn-pc" data-bs-dismiss="modal" onclick="location.hash='bookings'">My Bookings</button>
      <button class="btn btn-outline-secondary rounded-3" data-bs-dismiss="modal" onclick="location.hash='home'">Dashboard</button>
    </div>`;
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('confirmModal'));
  modal.show();
  new QRCode(document.getElementById('qrBox'), { text: b.ref, width: 128, height: 128 });
}

function toggleArr(arr, key) {
  const i = arr.indexOf(key);
  i >= 0 ? arr.splice(i, 1) : arr.push(key);
}
function fmtHr(h) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:00 ${ampm}`;
}
async function applyPromo() {
  const code = document.getElementById('promoInput').value.trim();
  const msg = document.getElementById('promoMsg');
  if (!code) { wiz.promo = ''; msg.innerHTML = ''; return; }
  try {
    const p = await API.get('/api/promos/validate?code=' + encodeURIComponent(code));
    wiz.promo = p.code;
    wiz.promoCode = p.code;
    msg.innerHTML = `<span class="text-success"><i class="bi bi-check-circle me-1"></i><strong>${p.code}</strong> applied — ${p.type === 'percent' ? p.value + '% off' : peso(p.value) + ' off'}!</span>`;
  } catch (ex) {
    wiz.promo = ''; wiz.promoCode = '';
    msg.innerHTML = `<span class="text-danger"><i class="bi bi-x-circle me-1"></i>${ex.message}</span>`;
  }
}

/* ---------- MY BOOKINGS ---------- */
async function loadBookings() {
  const rows = await API.get('/api/bookings/mine');
  document.getElementById('bookingRows').innerHTML = rows.length ? rows.map(b => `
    <tr>
      <td class="small fw-semibold">${esc(b.ref)}</td>
      <td>${esc(b.court)}</td>
      <td class="small">${b.date}</td>
      <td class="small">${b.startLabel}–${b.endLabel}</td>
      <td class="fw-semibold">${peso(b.total)}</td>
      <td><span class="badge-status st-${b.status}">${b.status}</span></td>
      <td><span class="badge-status st-${b.paymentStatus}">${b.paymentStatus}</span></td>
      <td class="text-nowrap">
        ${['Pending', 'Approved'].includes(b.status) ? `
          <button class="btn btn-sm btn-outline-primary rounded-3" title="Reschedule" onclick="openReschedule(${b.id})"><i class="bi bi-arrow-repeat"></i></button>
          <button class="btn btn-sm btn-outline-danger rounded-3" title="Cancel" onclick="cancelBooking(${b.id},'${esc(b.ref)}')"><i class="bi bi-x-lg"></i></button>` : ''}
        <button class="btn btn-sm btn-outline-success rounded-3" title="Receipt / Invoice" onclick="openReceipt(${b.id})"><i class="bi bi-receipt"></i></button>
      </td>
    </tr>`).join('') : '<tr><td colspan="8" class="text-center text-secondary py-4">No bookings yet.</td></tr>';
}
async function cancelBooking(id, ref) {
  if (!await confirmDialog('Cancel Booking', `Cancel booking ${ref}? Free cancellation applies up to 24 hours before your slot.`)) return;
  try {
    await API.post(`/api/bookings/${id}/cancel`, {});
    toast('Booking cancelled');
    loadBookings();
  } catch (ex) { toast(ex.message, 'error'); }
}
async function openReschedule(id) {
  document.getElementById('resBookingId').value = id;
  const d = document.getElementById('resDate');
  d.min = todayISO();
  d.value = '';
  document.getElementById('resSlots').innerHTML = '<p class="small text-secondary">Pick a date to see available times.</p>';
  const bk = (await API.get('/api/bookings/mine')).find(b => b.id === id);
  d.onchange = async () => {
    const slots = await API.get(`/api/courts/${bk.courtId}/availability?date=${d.value}`);
    document.getElementById('resSlots').innerHTML = slots.map(s => `
      <div class="col-3"><button class="slot-btn slot-${s.status}" ${s.status !== 'available' ? 'disabled' : ''}
        onclick="this.closest('.row').querySelectorAll('.slot-btn').forEach(b=>b.classList.remove('selected'));this.classList.add('selected');window._resHour=${s.hour}">${s.label}</button></div>`).join('');
  };
  bootstrap.Modal.getOrCreateInstance(document.getElementById('reschedModal')).show();
}
async function submitReschedule() {
  const id = document.getElementById('resBookingId').value;
  const date = document.getElementById('resDate').value;
  if (!date || window._resHour == null) return toast('Pick a date and time', 'warning');
  try {
    await API.post(`/api/bookings/${id}/reschedule`, { date, startHour: window._resHour });
    bootstrap.Modal.getInstance(document.getElementById('reschedModal')).hide();
    toast('Booking rescheduled!');
    loadBookings();
  } catch (ex) { toast(ex.message, 'error'); }
}
async function openReceipt(id) {
  const r = await API.get(`/api/bookings/${id}/receipt`);
  const b = r.booking;
  document.getElementById('receiptBody').innerHTML = `
    <div class="text-center mb-3">
      <span class="brand-badge mx-auto mb-2"><i class="bi bi-circle-fill" style="font-size:.7rem"></i></span>
      <h5 class="fw-bold mb-0">PickleCourt ${r.receiptNo ? 'Official Receipt' : 'Booking Invoice'}</h5>
      <small class="text-secondary">${r.venue}</small>
      ${r.receiptNo ? `<div class="fw-bold text-success mt-1">${r.receiptNo}</div>` : '<div class="badge bg-warning text-dark mt-1">Payment not yet verified</div>'}
    </div>
    <table class="table table-sm small">
      <tr><td class="text-secondary">Booking Ref</td><td class="fw-semibold">${b.ref}</td></tr>
      <tr><td class="text-secondary">Customer</td><td>${esc(r.customer)}</td></tr>
      <tr><td class="text-secondary">Court</td><td>${esc(r.court)}</td></tr>
      <tr><td class="text-secondary">Schedule</td><td>${b.date} · ${b.startLabel}–${b.endLabel}</td></tr>
      <tr><td class="text-secondary">Subtotal</td><td>${peso(b.subtotal)}</td></tr>
      <tr><td class="text-secondary">Discount</td><td>−${peso(b.discount)}</td></tr>
      <tr><td class="text-secondary">VAT 12%</td><td>${peso(b.vat)}</td></tr>
      <tr><td class="fw-bold">TOTAL</td><td class="fw-bold text-success">${peso(b.total)}</td></tr>
      <tr><td class="text-secondary">Payment</td><td>${r.payment ? esc(r.payment.method) + ' · ' + r.payment.status : b.paymentStatus}</td></tr>
    </table>
    <div class="d-flex gap-2">
      <button class="btn btn-pc flex-grow-1" onclick="window.print()"><i class="bi bi-download me-1"></i>Print / Save PDF</button>
      <button class="btn btn-outline-secondary rounded-3" data-bs-dismiss="modal">Close</button>
    </div>`;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('receiptModal')).show();
}

/* ---------- PAYMENTS ---------- */
async function loadPayments() {
  const rows = await API.get('/api/payments/mine');
  document.getElementById('paymentRows').innerHTML = rows.length ? rows.map(p => `
    <tr><td>${p.id}</td><td class="small fw-semibold">${esc(p.bookingRef || '')}</td><td>${esc(p.method)}</td>
    <td class="fw-semibold">${peso(p.amount)}</td>
    <td><span class="badge-status st-${p.status}">${p.status}</span></td>
    <td class="small">${p.createdAt.slice(0, 10)}</td>
    <td>${p.proofFile ? `<a href="${p.proofFile}" target="_blank" class="btn btn-sm btn-outline-secondary rounded-3"><i class="bi bi-image"></i></a>` : '—'}</td></tr>`).join('')
    : '<tr><td colspan="7" class="text-center text-secondary py-4">No payments yet.</td></tr>';
}

/* ---------- NOTIFICATIONS ---------- */
async function loadNotifs() {
  const rows = await API.get('/api/notifications');
  const icons = { booking: 'bi-calendar-check', payment: 'bi-credit-card', system: 'bi-megaphone' };
  document.getElementById('notifList').innerHTML = rows.length ? rows.map(n => `
    <div class="card-pc p-3 d-flex flex-row gap-3 align-items-start ${n.read ? 'opacity-75' : ''}">
      <span class="icon-circle ${n.type === 'payment' ? 'ic-blue' : 'ic-green'}" style="width:42px;height:42px;font-size:1rem">
        <i class="bi ${icons[n.type] || 'bi-bell'}"></i></span>
      <div class="flex-grow-1">
        <div class="fw-bold">${esc(n.title)} ${n.read ? '' : '<span class="badge bg-success ms-1">New</span>'}</div>
        <div class="small text-secondary">${esc(n.message)}</div>
        <div class="small text-secondary opacity-75">${new Date(n.at).toLocaleString()}</div>
      </div>
    </div>`).join('') : '<div class="card-pc p-4 text-center text-secondary">No notifications yet.</div>';
}
async function markAllRead() {
  await API.post('/api/notifications/read', {});
  loadNotifs(); refreshBadge();
}

/* ---------- PROFILE ---------- */
async function fillProfile() {
  const u = await API.get('/api/profile');
  Object.assign(me, u);
  document.getElementById('profileName').textContent = `${u.firstName} ${u.lastName}`;
  document.getElementById('profileEmail').textContent = u.email;
  document.getElementById('profileAvatar').textContent = (u.firstName[0] + (u.lastName ? u.lastName[0] : '')).toUpperCase();
  document.getElementById('profileMember').textContent = u.membership ? u.membership + ' Member' : 'No membership';
  const f = document.getElementById('profileForm');
  ['firstName', 'middleName', 'lastName', 'mobile', 'address'].forEach(k => f[k].value = u[k] || '');
  f.emName.value = u.emergency?.name || '';
  f.emRel.value = u.emergency?.relationship || '';
  f.emContact.value = u.emergency?.contact || '';
  f.notifEmail.checked = !!u.notifySettings?.email;
  f.notifRem.checked = !!u.notifySettings?.reminders;
}
document.getElementById('profileForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await API.put('/api/profile', {
      firstName: f.firstName.value, middleName: f.middleName.value, lastName: f.lastName.value,
      mobile: f.mobile.value, address: f.address.value,
      emergency: { name: f.emName.value, relationship: f.emRel.value, contact: f.emContact.value },
      notifySettings: { email: f.notifEmail.checked, sms: false, reminders: f.notifRem.checked }
    });
    toast('Profile updated!');
    fillProfile();
  } catch (ex) { toast(ex.message, 'error'); }
});
document.getElementById('pwdForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await API.post('/api/profile/password', { current: e.target.current.value, password: e.target.password.value });
    toast('Password changed!');
    e.target.reset();
  } catch (ex) { toast(ex.message, 'error'); }
});
async function deleteAccount() {
  if (!await confirmDialog('Delete Account', 'This deactivates your account and logs you out. Bookings history is retained for records. Continue?')) return;
  await API.del('/api/profile');
  API.logout();
}

/* ---------- MEMBERSHIP ---------- */
function renderMemberPlans() {
  const colors = { Silver: 'secondary', Gold: 'warning', Platinum: 'primary' };
  document.getElementById('memberPlans').innerHTML = META.memberships.map(m => `
    <div class="col-md-4"><div class="card-pc p-4 h-100 text-center hoverable">
      <span class="badge bg-${colors[m.name]} rounded-pill mb-2 mx-auto">${m.name}</span>
      <div class="fs-3 fw-bold">${peso(m.price)}<small class="fs-6 text-secondary">/yr</small></div>
      <ul class="list-unstyled small text-start my-3">${m.benefits.map(b => `<li class="py-1"><i class="bi bi-check-circle text-success me-1"></i>${b}</li>`).join('')}</ul>
      <button class="btn btn-pc mt-auto" onclick="joinPlan('${m.name}')">Choose ${m.name}</button>
    </div></div>`).join('');
}
async function joinPlan(name) {
  try {
    await API.post('/api/membership', { plan: name });
    me.membership = name;
    toast(`Welcome to ${name} membership! 🎉`);
    bootstrap.Modal.getInstance(document.getElementById('memberModal'))?.hide();
    loadHome();
  } catch (ex) { toast(ex.message, 'error'); }
}
