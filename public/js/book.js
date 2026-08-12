/* Guest booking wizard — company-scoped, no sign-in required */
let META = null, COURTS = [], COMPANY = null;
const SLUG = decodeURIComponent((location.pathname.match(/^\/book\/([^/]+)/) || [])[1] || new URLSearchParams(location.search).get('company') || 'snowbear');
const CAPI = '/api/company/' + encodeURIComponent(SLUG);
const STEPS = ['Court', 'Date', 'Time', 'Duration', 'Your Info', 'Summary', 'Payment'];
let wiz = {};

function todayISO() {
  const t = new Date();
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}
function fmtHr(h) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:00 ${ampm}`;
}

(async () => {
  try {
    COMPANY = await API.get(CAPI);
    if (COMPANY.logo) setBrandLogo(COMPANY.logo);
    document.querySelectorAll('.company-name').forEach(el => el.textContent = COMPANY.name);
    document.querySelectorAll('.brand-home').forEach(el => el.href = '/c/' + SLUG);
    if (!COMPANY.active) {
      document.getElementById('wizardWrap').innerHTML =
        `<div class="card-pc p-5 text-center"><span class="icon-circle ic-blue mx-auto mb-3" style="width:72px;height:72px;font-size:1.8rem"><i class="bi bi-pause-circle"></i></span>
         <h3 class="fw-bold">Temporarily Unavailable</h3><p class="text-secondary">${esc(COMPANY.message || 'This facility is temporarily unavailable.')}</p>
         <a href="/c/${SLUG}" class="btn btn-pc">Back to ${esc(COMPANY.name)}</a></div>`;
      hideLoader(); return;
    }
    META = await API.get(CAPI + '/meta');
    COURTS = await API.get(CAPI + '/courts');
    wiz = { courtId: null, date: null, startHour: null, duration: 1, name: '', mobile: '', email: '', step: 1 };
    const params = new URLSearchParams(location.search);
    if (params.get('court')) wiz.courtId = Number(params.get('court'));
    if (location.hash === '#find') showFind(); else renderStep(1);
  } catch (e) { console.error(e); toast('Could not load this facility.', 'error'); }
  hideLoader();
})();

function showFind() {
  document.getElementById('wizardWrap').classList.add('d-none');
  document.getElementById('findWrap').classList.remove('d-none');
}
function showWizard() {
  document.getElementById('findWrap').classList.add('d-none');
  document.getElementById('wizardWrap').classList.remove('d-none');
  history.replaceState(null, '', '/book/' + SLUG);
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
    <button class="btn btn-pc" id="nextBtn" ${nextOk ? '' : 'disabled'} onclick="renderStep(${step + 1})">${step === 6 ? 'Proceed to Payment' : 'Next'} <i class="bi bi-arrow-right ms-1"></i></button>
  </div>`;
}

async function renderStep(step) {
  wiz.step = step;
  stepBar(step);
  const body = document.getElementById('wizardBody');

  if (step === 1) {
    body.innerHTML = `<h5 class="fw-bold mb-3">Step 1 · Select a Court</h5><div class="row g-3 justify-content-center">
      ${COURTS.map(c => `<div class="col-md-6 col-lg-5">
        <div class="card-pc hoverable overflow-hidden pointer ${wiz.courtId === c.id ? 'border-success border-2' : ''}" onclick="wiz.courtId=${c.id};renderStep(1)">
          ${courtImg(c, true)}
          <div class="p-3">
            <div class="d-flex justify-content-between"><strong>${esc(c.name)}</strong>
              ${wiz.courtId === c.id ? '<i class="bi bi-check-circle-fill text-success"></i>' : ''}</div>
            <small class="text-secondary">${esc(c.type)} · ${esc(c.surface)} · ${peso(c.pricing.weekday)}/hr flat</small>
          </div></div></div>`).join('')}
    </div>${navBtns(1, !!wiz.courtId)}`;
  }

  else if (step === 2) {
    const max = new Date(); max.setDate(max.getDate() + 30);
    body.innerHTML = `<h5 class="fw-bold mb-3">Step 2 · Choose a Date</h5>
      <p class="text-secondary small">Book up to 30 days in advance. Past dates are disabled.</p>
      <input type="date" class="form-control form-control-lg" style="max-width:280px" id="wizDate"
        min="${todayISO()}" max="${max.toISOString().slice(0, 10)}" value="${wiz.date || ''}"
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
    const slots = await API.get(CAPI+`/courts/${wiz.courtId}/availability?date=${wiz.date}`);
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
    body.innerHTML = `<h5 class="fw-bold mb-3">Step 5 · Your Details</h5>
      <p class="text-secondary small">We'll send your booking confirmation and reference number here. No account is created.</p>
      <div class="row g-3" style="max-width:640px">
        <div class="col-12"><label class="form-label small">Full Name *</label>
          <input class="form-control" id="gName" value="${esc(wiz.name)}" placeholder="Juan Dela Cruz"></div>
        <div class="col-md-6"><label class="form-label small">Mobile Number *</label>
          <input class="form-control" id="gMobile" value="${esc(wiz.mobile)}" placeholder="09XXXXXXXXX">
          <div class="form-text">Used to find or cancel your booking later</div></div>
        <div class="col-md-6"><label class="form-label small">Email Address *</label>
          <input class="form-control" id="gEmail" value="${esc(wiz.email)}" placeholder="you@email.com"></div>
      </div>
      <div class="alert alert-danger d-none mt-3 py-2 small" id="gErr" style="max-width:640px"></div>
      <div class="d-flex justify-content-between mt-4">
        <button class="btn btn-outline-secondary rounded-3" onclick="saveGuest();renderStep(4)"><i class="bi bi-arrow-left me-1"></i>Back</button>
        <button class="btn btn-pc" onclick="validateGuestStep()">Next <i class="bi bi-arrow-right ms-1"></i></button>
      </div>`;
  }

  else if (step === 6) {
    body.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-success"></div></div>';
    const q = await API.post(CAPI+'/quote', wiz);
    const court = COURTS.find(c => c.id === wiz.courtId);
    body.innerHTML = `<h5 class="fw-bold mb-3">Step 6 · Booking Summary</h5>
      <div class="row g-4"><div class="col-lg-7">
        <table class="table table-pc align-middle">
          <tr><td class="text-secondary">Customer</td><td class="fw-semibold">${esc(wiz.name)}</td></tr>
          <tr><td class="text-secondary">Contact</td><td>${esc(wiz.mobile)} · ${esc(wiz.email)}</td></tr>
          <tr><td class="text-secondary">Court</td><td class="fw-semibold">${esc(court.name)} (${esc(court.type)})</td></tr>
          <tr><td class="text-secondary">Date</td><td class="fw-semibold">${wiz.date}</td></tr>
          <tr><td class="text-secondary">Time</td><td class="fw-semibold">${fmtHr(wiz.startHour)} – ${fmtHr(wiz.startHour + wiz.duration)} (${wiz.duration} hr${wiz.duration > 1 ? 's' : ''})</td></tr>
        </table>
      </div><div class="col-lg-5">
        <div class="card-pc p-4" style="background:var(--pc-bg)">
          <div class="d-flex justify-content-between py-1"><span>Court (${wiz.duration} hr × ₱250)</span><span>${peso(q.courtCost)}</span></div>
          <hr class="my-2">
          <div class="d-flex justify-content-between py-1"><span>Subtotal</span><span>${peso(q.subtotal)}</span></div>
          <div class="d-flex justify-content-between py-1"><span>VAT 12%</span><span>${peso(q.vat)}</span></div>
          <hr class="my-2">
          <div class="d-flex justify-content-between fs-5 fw-bold"><span>Grand Total</span><span class="text-success">${peso(q.total)}</span></div>
        </div>
      </div></div>${navBtns(6, true)}`;
  }

  else if (step === 7) {
    body.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-success"></div><p class="mt-2 text-secondary">Creating your booking…</p></div>';
    try {
      const res = await API.post(CAPI+'/bookings', wiz);
      wiz.booking = res.booking;
      renderPayment();
    } catch (ex) {
      toast(ex.message, 'error');
      renderStep(3);
    }
  }
}

function saveGuest() {
  wiz.name = document.getElementById('gName')?.value.trim() ?? wiz.name;
  wiz.mobile = document.getElementById('gMobile')?.value.trim() ?? wiz.mobile;
  wiz.email = document.getElementById('gEmail')?.value.trim() ?? wiz.email;
}
function validateGuestStep() {
  saveGuest();
  const err = document.getElementById('gErr');
  let msg = null;
  if (!wiz.name) msg = 'Please enter your full name.';
  else if (!/^(09|\+639)\d{9}$/.test(wiz.mobile.replace(/[\s-]/g, ''))) msg = 'Enter a valid Philippine mobile number (09XXXXXXXXX).';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wiz.email)) msg = 'Enter a valid email address.';
  if (msg) {
    err.textContent = msg;
    err.classList.remove('d-none');
    return;
  }
  renderStep(7);
}
/* ---------- payment ---------- */
let payMethod = null;
function renderPayment() {
  const b = wiz.booking;
  stepBar(7);
  document.getElementById('wizardBody').innerHTML = `
    <div class="alert alert-success"><i class="bi bi-check-circle me-2"></i>Booking <strong>${b.ref}</strong> created! Complete payment to confirm your slot.</div>
    <h5 class="fw-bold mb-3">Step 7 · Payment — ${peso(b.total)}</h5>
    <div class="row g-3 mb-3" id="payMethods">
      ${['GCash', 'BDO Pay', 'Maya'].map(m => `
        <div class="col-4 col-md-2"><div class="card-pc hoverable p-3 text-center pointer pay-opt" data-method="${m}" onclick="selectPay('${m}')">
          <i class="bi ${{ 'GCash': 'bi-phone', 'BDO Pay': 'bi-bank', 'Maya': 'bi-phone-fill' }[m]} fs-3 text-success"></i>
          <div class="small fw-semibold mt-1">${m}</div>
        </div></div>`).join('')}
    </div>
    <div id="payDetail" class="d-none">
      <div class="card-pc p-4" style="max-width:560px">
        <div id="payInstructions" class="small text-secondary mb-3"></div>
        <label class="form-label small fw-semibold">Upload Proof of Payment (JPG, PNG or PDF, max 5 MB)</label>
        <input type="file" class="form-control mb-2" id="proofFile" accept=".jpg,.jpeg,.png,.pdf">
        <input class="form-control mb-3" id="payRef" placeholder="Payment reference number (optional)">
        <button class="btn btn-pc w-100" onclick="submitPayment()" id="payBtn"><i class="bi bi-lock me-2"></i>Submit Payment</button>
      </div>
    </div>`;
}
function selectPay(m) {
  payMethod = m;
  document.querySelectorAll('.pay-opt').forEach(el => el.classList.toggle('border-success', el.dataset.method === m));
  document.getElementById('payDetail').classList.remove('d-none');
  const p = (COMPANY && COMPANY.payment) || {};
  const acct = p.accountName || COMPANY.name;
  const amt = peso(wiz.booking.total);
  const instr = {
    'GCash': `Send <strong>${amt}</strong> to GCash <strong>${esc(p.gcash || '')}</strong> (${esc(acct)}), then upload a screenshot of the receipt.`,
    'BDO Pay': `Send <strong>${amt}</strong> via BDO Pay to <strong>${esc(p.bdo || '')}</strong> (${esc(acct)}), then upload the transfer confirmation.`,
    'Maya': `Send <strong>${amt}</strong> to Maya <strong>${esc(p.maya || '')}</strong> (${esc(acct)}), then upload a screenshot of the receipt.`
  };
  document.getElementById('payInstructions').innerHTML = instr[m];
}
async function submitPayment() {
  if (!payMethod) return toast('Select a payment method', 'warning');
  const file = document.getElementById('proofFile')?.files[0];
  if (!file) return toast('Please upload your proof of payment', 'warning');
  const fd = new FormData();
  fd.append('bookingRef', wiz.booking.ref);
  fd.append('mobile', wiz.mobile);
  fd.append('method', payMethod);
  fd.append('reference', document.getElementById('payRef')?.value || '');
  fd.append('proof', file);
  const btn = document.getElementById('payBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting…';
  try {
    await API.post(CAPI+'/payments', fd);
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
    <h4 class="fw-bold">Booking Received! 🏓</h4>
    <p class="text-secondary small mb-2">Save your booking reference number:</p>
    <div class="fs-4 fw-bold text-success mb-3">${b.ref}</div>
    <div class="d-flex justify-content-center mb-3"><div id="qrBox" class="p-2 bg-white rounded-3"></div></div>
    <div class="text-start small card-pc p-3 mb-3" style="background:var(--pc-bg)">
      <div><strong>${esc(court.name)}</strong> · ${b.date} · ${b.startLabel}–${b.endLabel}</div>
      <div>Total: <strong>${peso(b.total)}</strong> · Payment: awaiting verification</div>
      <div class="mt-1"><i class="bi bi-geo-alt me-1"></i>${esc(COMPANY.address || '')} ·
        <a href="https://maps.google.com/?q=${encodeURIComponent(COMPANY.address || COMPANY.name)}" target="_blank" rel="noopener">Google Maps</a></div>
      <div class="text-secondary mt-1">A confirmation email was sent to ${esc(wiz.email)}. Our staff will verify your payment shortly.
        Use "Find My Booking" with your reference and mobile number to track your booking anytime.</div>
    </div>
    <div class="d-flex gap-2 justify-content-center">
      <button class="btn btn-pc" data-bs-dismiss="modal" onclick="location.href='index.html'">Done</button>
      <button class="btn btn-outline-secondary rounded-3" data-bs-dismiss="modal" onclick="showFind();document.getElementById('findRef').value='${b.ref}'">Track Booking</button>
    </div>`;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('confirmModal')).show();
  new QRCode(document.getElementById('qrBox'), { text: b.ref, width: 128, height: 128 });
}

/* ---------- find my booking ---------- */
async function findBooking() {
  const ref = document.getElementById('findRef').value.trim();
  const mobile = document.getElementById('findMobile').value.trim();
  const box = document.getElementById('findResult');
  if (!ref || !mobile) return toast('Enter both your booking reference and mobile number', 'warning');
  box.innerHTML = '<div class="text-center py-3"><div class="spinner-border text-success"></div></div>';
  try {
    const r = await API.get(CAPI + `/lookup?ref=${encodeURIComponent(ref)}&mobile=${encodeURIComponent(mobile)}`);
    const b = r.booking;
    box.innerHTML = `<div class="card-pc p-4">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h5 class="fw-bold mb-0">${esc(b.ref)}</h5>
        <span class="badge-status st-${b.status}">${b.status}</span>
      </div>
      <table class="table table-sm small mb-3">
        <tr><td class="text-secondary">Court</td><td>${esc(r.court)}</td></tr>
        <tr><td class="text-secondary">Schedule</td><td>${b.date} · ${b.startLabel}–${b.endLabel}</td></tr>
        <tr><td class="text-secondary">Total</td><td class="fw-bold text-success">${peso(b.total)}</td></tr>
        <tr><td class="text-secondary">Payment</td><td><span class="badge-status st-${b.paymentStatus}">${b.paymentStatus}</span>
          ${r.receiptNo ? ' · Official Receipt <strong>' + r.receiptNo + '</strong>' : ''}</td></tr>
        <tr><td class="text-secondary">Venue</td><td>${esc(r.venue)}</td></tr>
      </table>
      <div class="d-flex gap-2">
        <button class="btn btn-outline-secondary rounded-3 btn-sm" onclick="window.print()"><i class="bi bi-printer me-1"></i>Print</button>
      </div>
    </div>`;
  } catch (ex) {
    box.innerHTML = `<div class="alert alert-danger">${esc(ex.message)}</div>`;
  }
}
