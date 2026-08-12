/**
 * Snow Bear CourtOS — multi-tenant court-booking SaaS.
 * Express API + static frontend. Each company (tenant) has isolated data,
 * its own branded landing page (slug), settings, and subscription.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const DB = require('./server/db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const VAT_RATE = 0.12;
const PEAK_HOURS = [17, 18, 19, 20];

app.use(express.json({ limit: '2mb' }));

const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const IMG_DIR = path.join(__dirname, 'public', 'img');
if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, UPLOAD_DIR),
    filename: (_, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = ['.jpg', '.jpeg', '.png', '.pdf'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Only JPG, PNG or PDF files are accepted'), ok);
  }
});
app.use('/uploads', express.static(UPLOAD_DIR));

const outbox = [];
function sendEmail(to, subject, body) {
  outbox.push({ to, subject, body, at: new Date().toISOString() });
  console.log(`\n[EMAIL to ${to}] ${subject}\n${body}\n`);
}

/* ---------------- helpers ---------------- */
const publicUser = u => { const { passwordHash, ...rest } = u; return rest; };
const findUser = idOrFn => {
  const users = DB.get().users;
  return typeof idOrFn === 'function' ? users.find(idOrFn) : users.find(u => u.id === idOrFn);
};
const companyById = id => DB.get().companies.find(c => c.id === Number(id));
const companyBySlug = slug => DB.get().companies.find(c => c.slug.toLowerCase() === String(slug || '').toLowerCase());

function todayStr() {
  const t = new Date();
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}
function fmtHour(h) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:00 ${ampm}`;
}
function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.getDay() === 0 || d.getDay() === 6;
}
function openHour(cid) { return companyById(cid)?.settings?.hours?.open ?? 6; }
function closeHour(cid) { return companyById(cid)?.settings?.hours?.close ?? 22; }

function subStatus(company) {
  if (!company) return { plan: null, status: 'None', active: false, startDate: null, endDate: null };
  const s = company.subscription || {};
  let status = s.status || 'None';
  if (status === 'Active' && s.endDate && s.endDate < todayStr()) status = 'Expired';
  const active = company.active !== false && status === 'Active';
  return { plan: s.plan || null, status, active, startDate: s.startDate || null, endDate: s.endDate || null };
}
const companyActive = company => subStatus(company).active;

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    const u = findUser(req.user.id);
    if (!u || !u.active) return res.status(401).json({ error: 'Account inactive' });
    req.account = u;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}
function staffOnly(req, res, next) {
  if (![0, 1, 2, 3, 4].includes(req.account.roleId)) return res.status(403).json({ error: 'Staff access required' });
  next();
}
function adminOnly(req, res, next) {
  if (![0, 1].includes(req.account.roleId)) return res.status(403).json({ error: 'Administrator access required' });
  next();
}
function superOnly(req, res, next) {
  if (req.account.roleId !== 0) return res.status(403).json({ error: 'Super Admin access required' });
  next();
}
// Resolve which company the request acts on. Regular admins/staff are locked to
// their own company; the Super Admin may target any via ?companyId / header.
function cidOf(req) {
  if (req.account.roleId === 0) {
    const q = Number(req.query.companyId || req.body?.companyId || req.headers['x-company-id']);
    return q || null;
  }
  return req.account.companyId;
}
function withCompany(req, res, next) {
  const cid = cidOf(req);
  if (!cid || !companyById(cid)) return res.status(400).json({ error: 'Company context required' });
  req.cid = cid;
  next();
}
// Premium/booking features require an active subscription (super admin bypasses)
function requireSub(req, res, next) {
  if (req.account.roleId === 0) return next();
  const c = companyById(req.cid);
  if (!companyActive(c)) {
    const s = subStatus(c);
    return res.status(402).json({ error: `This feature is locked — your subscription is ${s.status.toLowerCase()}. Please renew.`, subscription: s });
  }
  next();
}

/* ---------------- pricing / availability (company-scoped) ---------------- */
function courtRate(court, dateStr, hour) {
  if (PEAK_HOURS.includes(hour)) return court.pricing.peak;
  return isWeekend(dateStr) ? court.pricing.weekend : court.pricing.weekday;
}
function activeBookings(cid, courtId, dateStr) {
  return DB.get().bookings.filter(b =>
    b.companyId === cid && b.courtId === courtId && b.date === dateStr &&
    !['Cancelled', 'Rejected'].includes(b.status));
}
function slotStatusMap(cid, courtId, dateStr) {
  const map = {};
  const oh = openHour(cid), ch = closeHour(cid);
  for (let h = oh; h < ch; h++) map[h] = 'available';
  const d = DB.get();
  const court = d.courts.find(c => c.id === courtId && c.companyId === cid);
  const maint = d.courtMaintenance.find(m => m.companyId === cid && m.courtId === courtId && m.date === dateStr);
  if ((court && court.status !== 'Available') || maint) {
    for (const h in map) map[h] = 'unavailable';
    return map;
  }
  activeBookings(cid, courtId, dateStr).forEach(b => {
    for (let h = b.startHour; h < b.startHour + b.duration; h++)
      if (map[h] !== undefined) map[h] = b.status === 'Pending' ? 'pending' : 'reserved';
  });
  d.openPlay.filter(s => s.companyId === cid && s.active && s.courtId === courtId && s.date === dateStr).forEach(s => {
    for (let h = s.startHour; h < s.endHour; h++) if (map[h] !== undefined) map[h] = 'reserved';
  });
  const now = new Date();
  if (dateStr === todayStr()) for (let h = oh; h <= now.getHours(); h++) if (map[h] === 'available') map[h] = 'unavailable';
  return map;
}
function computeTotals({ cid, court, date, startHour, duration, equipmentKeys, serviceKeys }) {
  const d = DB.get();
  let courtCost = 0;
  for (let h = startHour; h < startHour + duration; h++) courtCost += courtRate(court, date, h);
  const eqItems = (equipmentKeys || []).map(k => d.equipment.find(e => e.companyId === cid && e.key === k)).filter(Boolean);
  const svcItems = (serviceKeys || []).map(k => d.services.find(s => s.key === k)).filter(Boolean);
  const equipCost = eqItems.reduce((s, e) => s + e.price, 0);
  const svcCost = svcItems.reduce((s, e) => s + e.price, 0);
  const subtotal = courtCost + equipCost + svcCost;
  const vat = subtotal * VAT_RATE;
  const total = subtotal + vat;
  const r = n => Math.round(n * 100) / 100;
  return { courtCost: r(courtCost), equipCost: r(equipCost), svcCost: r(svcCost), subtotal: r(subtotal), vat: r(vat), total: r(total), eqItems, svcItems };
}

/* ---------------- AUTH ---------------- */
app.post('/api/auth/login', (req, res) => {
  const { identifier, password, remember } = req.body || {};
  if (!identifier || !password) return res.status(400).json({ error: 'Email/username and password are required' });
  const u = findUser(x => x.email === identifier.toLowerCase() || x.username.toLowerCase() === identifier.toLowerCase());
  if (!u || !bcrypt.compareSync(password, u.passwordHash)) return res.status(401).json({ error: 'Invalid credentials' });
  if (!u.active) return res.status(403).json({ error: 'Account is deactivated' });
  const company = u.companyId ? companyById(u.companyId) : null;
  const token = jwt.sign({ id: u.id, roleId: u.roleId, companyId: u.companyId || null }, JWT_SECRET, { expiresIn: remember ? '30d' : '2h' });
  DB.audit(u.id, 'LOGIN', `Logged in as ${u.username}`, u.companyId);
  res.json({
    ok: true, token, user: publicUser(u),
    role: DB.get().roles.find(r => r.id === u.roleId).name,
    company: company ? { id: company.id, slug: company.slug, name: company.name } : null,
    subscription: company ? subStatus(company) : { status: 'Unlimited', active: true }
  });
});
app.post('/api/auth/forgot', (req, res) => {
  const u = findUser(x => x.email === String(req.body.email || '').toLowerCase());
  if (u) {
    const token = crypto.randomBytes(24).toString('hex');
    resetTokens.set(token, { id: u.id, exp: Date.now() + 30 * 60 * 1000 });
    sendEmail(u.email, 'Reset your CourtOS password', `Reset link (valid 30 min): /reset.html?token=${token}`);
    return res.json({ ok: true, message: 'Password reset email sent', devResetLink: `/reset.html?token=${token}` });
  }
  res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
});
const resetTokens = new Map();
app.post('/api/auth/reset', (req, res) => {
  const { token, password } = req.body || {};
  const entry = resetTokens.get(token);
  if (!entry || entry.exp < Date.now()) return res.status(400).json({ error: 'Invalid or expired reset token' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const u = findUser(entry.id);
  u.passwordHash = bcrypt.hashSync(password, 10);
  resetTokens.delete(token);
  DB.save();
  res.json({ ok: true, message: 'Password updated. You can now log in.' });
});

/* ---------------- PLATFORM (public) ---------------- */
app.get('/api/platform', (req, res) => {
  const d = DB.get();
  res.json({
    ...d.platform,
    companies: d.companies.map(c => ({ slug: c.slug, name: c.name, active: companyActive(c) }))
  });
});

/* ---------------- COMPANY PUBLIC (per slug) ---------------- */
function publicCompany(c) {
  const s = c.settings;
  const active = companyActive(c);
  return {
    slug: c.slug, name: c.name, logo: c.logo || '',
    active,
    message: active ? null : 'This facility is temporarily unavailable.',
    venueName: s.venueName, address: s.address, tagline: s.tagline,
    hours: s.hours, contact: s.contact, payment: s.payment,
    hoursLabel: `${s.hours.openLabel} – ${s.hours.closeLabel}`
  };
}
function loadCompany(req, res, next) {
  const c = companyBySlug(req.params.slug);
  if (!c) return res.status(404).json({ error: 'Company not found' });
  req.company = c;
  next();
}
app.get('/api/company/:slug', loadCompany, (req, res) => res.json(publicCompany(req.company)));
app.get('/api/company/:slug/courts', loadCompany, (req, res) => {
  res.json(DB.get().courts.filter(c => c.companyId === req.company.id));
});
app.get('/api/company/:slug/meta', loadCompany, (req, res) => {
  const cid = req.company.id;
  res.json({
    equipment: DB.get().equipment.filter(e => e.companyId === cid).map(({ id, name, key, price, stock }) => ({ id, name, key, price, stock })),
    hours: { open: openHour(cid), close: closeHour(cid) },
    vat: VAT_RATE
  });
});
app.get('/api/company/:slug/highlights', loadCompany, (req, res) => {
  res.json(DB.get().highlights.filter(h => h.companyId === req.company.id && h.active).sort((a, b) => b.id - a.id));
});
app.get('/api/company/:slug/openplay', loadCompany, (req, res) => {
  const cid = req.company.id, d = DB.get();
  res.json(d.openPlay.filter(s => s.companyId === cid && s.date >= todayStr())
    .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
    .map(s => ({ ...s, court: d.courts.find(c => c.id === s.courtId)?.name || 'All Courts' })));
});
app.get('/api/company/:slug/tournaments', loadCompany, (req, res) => {
  const cid = req.company.id, d = DB.get();
  res.json(d.tournaments.filter(t => t.companyId === cid && t.published).sort((a, b) => b.id - a.id)
    .map(t => ({ ...t, registered: d.tournamentRegs.filter(r => r.tournamentId === t.id && r.status !== 'Rejected').length })));
});
app.get('/api/company/:slug/courts/:id/availability', loadCompany, (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date is required' });
  const map = slotStatusMap(req.company.id, Number(req.params.id), date);
  res.json(Object.entries(map).map(([h, status]) => ({ hour: Number(h), label: fmtHour(Number(h)), status })));
});
app.post('/api/company/:slug/quote', loadCompany, (req, res) => {
  const cid = req.company.id;
  const court = DB.get().courts.find(c => c.id === Number(req.body.courtId) && c.companyId === cid);
  if (!court) return res.status(404).json({ error: 'Court not found' });
  res.json(computeTotals({ cid, court, date: req.body.date, startHour: Number(req.body.startHour), duration: Number(req.body.duration), equipmentKeys: req.body.equipment, serviceKeys: req.body.services }));
});

function validateGuest(b) {
  if (!b.name || !String(b.name).trim()) return 'Your name is required';
  if (!/^(09|\+639)\d{9}$/.test(String(b.mobile || '').replace(/[\s-]/g, ''))) return 'Invalid Philippine mobile number (use 09XXXXXXXXX)';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email || ''))) return 'Invalid email address';
  return null;
}
app.post('/api/company/:slug/bookings', loadCompany, (req, res) => {
  const c = req.company, cid = c.id, d = DB.get();
  if (!companyActive(c)) return res.status(403).json({ error: 'This facility is temporarily unavailable. Booking is disabled.' });
  const b = req.body || {};
  const gErr = validateGuest(b);
  if (gErr) return res.status(400).json({ error: gErr });
  const court = d.courts.find(x => x.id === Number(b.courtId) && x.companyId === cid);
  if (!court) return res.status(404).json({ error: 'Court not found' });
  const dur = Number(b.duration), start = Number(b.startHour);
  if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return res.status(400).json({ error: 'Invalid date' });
  if (b.date < todayStr()) return res.status(400).json({ error: 'Cannot book past dates' });
  const max = new Date(); max.setDate(max.getDate() + 30);
  if (new Date(b.date + 'T00:00:00') > max) return res.status(400).json({ error: 'Maximum advance booking is 30 days' });
  if (![1, 2, 3, 4].includes(dur)) return res.status(400).json({ error: 'Duration must be 1–4 hours' });
  if (start < openHour(cid) || start + dur > closeHour(cid)) return res.status(400).json({ error: 'Time is outside operating hours' });
  const map = slotStatusMap(cid, court.id, b.date);
  for (let h = start; h < start + dur; h++) if (map[h] !== 'available') return res.status(409).json({ error: `Slot ${fmtHour(h)} is no longer available` });
  const eqKeys = b.equipment || [];
  for (const k of eqKeys) { const e = d.equipment.find(e => e.companyId === cid && e.key === k); if (!e || e.stock < 1) return res.status(409).json({ error: `${e ? e.name : k} is out of stock` }); }
  eqKeys.forEach(k => { d.equipment.find(e => e.companyId === cid && e.key === k).stock -= 1; });
  const totals = computeTotals({ cid, court, date: b.date, startHour: start, duration: dur, equipmentKeys: eqKeys, serviceKeys: b.services });
  const booking = {
    id: DB.nextId('bookings'), ref: DB.nextBookingRef(), companyId: cid,
    userId: null, guest: { name: String(b.name).trim(), mobile: String(b.mobile).replace(/[\s-]/g, ''), email: String(b.email).trim().toLowerCase() },
    courtId: court.id, date: b.date, startHour: start, duration: dur,
    startLabel: fmtHour(start), endLabel: fmtHour(start + dur), players: Number(b.players) || 4,
    equipment: totals.eqItems.map(e => ({ key: e.key, name: e.name, price: e.price })),
    services: totals.svcItems.map(s => ({ key: s.key, name: s.name, price: s.price })),
    subtotal: totals.subtotal, discount: 0, vat: totals.vat, total: totals.total,
    status: 'Pending', paymentStatus: 'Pending', createdAt: new Date().toISOString()
  };
  d.bookings.push(booking);
  DB.save();
  DB.audit(null, 'BOOKING_CREATE', `${booking.ref} — ${booking.guest.name} ${court.name} ${b.date} ${booking.startLabel}`, cid);
  DB.notify(c.adminUserId, 'booking', 'New Booking', `${booking.guest.name} booked ${court.name} on ${b.date} at ${booking.startLabel} (${booking.ref}).`, cid);
  sendEmail(booking.guest.email, `Booking ${booking.ref} received — ${c.name}`,
    `Hi ${booking.guest.name}, your booking for ${court.name} on ${b.date} ${booking.startLabel}–${booking.endLabel} (₱${booking.total.toFixed(2)}) is pending payment at ${c.settings.venueName}, ${c.settings.address}.`);
  res.json({ ok: true, booking });
});
app.post('/api/company/:slug/payments', loadCompany, upload.single('proof'), (req, res) => {
  const cid = req.company.id, d = DB.get();
  const b = d.bookings.find(x => x.companyId === cid && x.ref === String(req.body.bookingRef || '').trim());
  if (!b || !b.guest) return res.status(404).json({ error: 'Booking not found' });
  if (b.guest.mobile !== String(req.body.mobile || '').replace(/[\s-]/g, '')) return res.status(403).json({ error: 'Mobile number does not match this booking' });
  const method = req.body.method;
  if (!['GCash', 'BDO Pay', 'Maya'].includes(method)) return res.status(400).json({ error: 'Invalid payment method' });
  if (!req.file) return res.status(400).json({ error: 'Proof of payment is required' });
  const payment = {
    id: DB.nextId('payments'), companyId: cid, bookingId: b.id, userId: null, guestName: b.guest.name,
    method, amount: b.total, proofFile: '/uploads/' + req.file.filename, reference: req.body.reference || '',
    status: 'Pending', createdAt: new Date().toISOString()
  };
  d.payments.push(payment);
  b.paymentStatus = 'Pending';
  DB.save();
  DB.audit(null, 'PAYMENT_SUBMIT', `${b.ref} via ${method} ₱${b.total}`, cid);
  DB.notify(req.company.adminUserId, 'payment', 'Payment Uploaded', `${b.guest.name} submitted ${method} payment for ${b.ref} — please verify.`, cid);
  res.json({ ok: true, payment });
});
app.get('/api/company/:slug/lookup', loadCompany, (req, res) => {
  const cid = req.company.id, d = DB.get();
  const ref = String(req.query.ref || '').trim().toUpperCase();
  const mobile = String(req.query.mobile || '').replace(/[\s-]/g, '');
  const b = d.bookings.find(x => x.companyId === cid && x.ref === ref && x.guest && x.guest.mobile === mobile);
  if (!b) return res.status(404).json({ error: 'No booking found for that reference and mobile number' });
  const payment = d.payments.filter(p => p.bookingId === b.id).pop();
  res.json({
    booking: b, court: d.courts.find(c => c.id === b.courtId)?.name || '',
    payment: payment || null,
    receiptNo: payment && payment.status === 'Verified' ? `OR-${String(payment.id).padStart(6, '0')}` : null,
    venue: `${req.company.settings.venueName}, ${req.company.settings.address}`
  });
});
app.post('/api/company/:slug/tournaments/:id/register', loadCompany, upload.single('proof'), (req, res) => {
  const cid = req.company.id, d = DB.get();
  if (!companyActive(req.company)) return res.status(403).json({ error: 'This facility is temporarily unavailable.' });
  const t = d.tournaments.find(x => x.id === Number(req.params.id) && x.companyId === cid && x.published);
  if (!t) return res.status(404).json({ error: 'Tournament not found' });
  if (t.status !== 'Open') return res.status(400).json({ error: 'Registration for this tournament is closed' });
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Your name is required' });
  if (!/^(09|\+639)\d{9}$/.test(String(b.mobile || '').replace(/[\s-]/g, ''))) return res.status(400).json({ error: 'Invalid mobile number' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email || ''))) return res.status(400).json({ error: 'Invalid email address' });
  if (!['GCash', 'BDO Pay', 'Maya'].includes(b.method)) return res.status(400).json({ error: 'Invalid payment method' });
  if (!req.file) return res.status(400).json({ error: 'Proof of payment is required' });
  const taken = d.tournamentRegs.filter(r => r.tournamentId === t.id && r.status !== 'Rejected').length;
  if (t.capacity && taken >= t.capacity) return res.status(409).json({ error: 'This tournament is fully booked' });
  const reg = {
    id: DB.nextId('tournamentRegs'), companyId: cid, tournamentId: t.id,
    name: String(b.name).trim(), mobile: String(b.mobile).replace(/[\s-]/g, ''), email: String(b.email).trim().toLowerCase(),
    method: b.method, reference: b.reference || '', proofFile: '/uploads/' + req.file.filename,
    amount: t.fee, status: 'Pending', createdAt: new Date().toISOString()
  };
  d.tournamentRegs.push(reg);
  DB.save();
  DB.notify(req.company.adminUserId, 'payment', 'Tournament Registration', `${reg.name} registered for "${t.title}" — verify the payment.`, cid);
  sendEmail(reg.email, `Registration received — ${t.title}`, `Hi ${reg.name}, we received your registration for ${t.title} on ${t.date} (₱${t.fee}). We'll verify your ${reg.method} payment and confirm shortly.`);
  res.json({ ok: true, registration: { id: reg.id, status: reg.status } });
});

/* ================= ADMIN (company-scoped by token) ================= */
app.get('/api/admin/context', auth, staffOnly, withCompany, (req, res) => {
  const c = companyById(req.cid);
  res.json({ company: { id: c.id, slug: c.slug, name: c.name }, subscription: subStatus(c), role: req.account.roleId });
});
app.get('/api/admin/settings', auth, adminOnly, withCompany, (req, res) => {
  const c = companyById(req.cid);
  res.json({ ...c.settings, name: c.name, slug: c.slug, logo: c.logo });
});
app.put('/api/admin/settings', auth, adminOnly, withCompany, (req, res) => {
  const c = companyById(req.cid), s = c.settings, b = req.body || {};
  if (b.venueName !== undefined) s.venueName = String(b.venueName).trim();
  if (b.address !== undefined) s.address = String(b.address).trim();
  if (b.tagline !== undefined) s.tagline = String(b.tagline).trim();
  if (b.hours) {
    const o = Number(b.hours.open), cl = Number(b.hours.close);
    if (Number.isInteger(o) && Number.isInteger(cl) && o >= 0 && cl <= 24 && cl > o) {
      s.hours.open = o; s.hours.close = cl; s.hours.openLabel = fmtHour(o); s.hours.closeLabel = fmtHour(cl);
    }
    if (b.hours.holidayLabel !== undefined) s.hours.holidayLabel = String(b.hours.holidayLabel).trim();
  }
  if (b.contact) ['name', 'email', 'phone', 'messenger'].forEach(k => { if (b.contact[k] !== undefined) s.contact[k] = String(b.contact[k]).trim(); });
  if (b.payment) ['gcash', 'maya', 'bdo', 'accountName'].forEach(k => { if (b.payment[k] !== undefined) s.payment[k] = String(b.payment[k]).trim(); });
  DB.save();
  DB.audit(req.account.id, 'SETTINGS_UPDATE', 'Site settings updated', req.cid);
  res.json({ ok: true, settings: c.settings });
});

app.get('/api/admin/stats', auth, staffOnly, withCompany, (req, res) => {
  const cid = req.cid, d = DB.get();
  const today = todayStr(), month = today.slice(0, 7);
  const bookings = d.bookings.filter(b => b.companyId === cid);
  const payments = d.payments.filter(p => p.companyId === cid);
  const verified = payments.filter(p => p.status === 'Verified');
  const monthlyRevenue = verified.filter(p => p.createdAt.slice(0, 7) === month).reduce((s, p) => s + p.amount, 0);
  const revenueByDay = {}, bookingsByDay = {}, peak = {}, courtUsage = {};
  for (let i = 13; i >= 0; i--) { const k = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); revenueByDay[k] = 0; bookingsByDay[k] = 0; }
  verified.forEach(p => { const k = p.createdAt.slice(0, 10); if (k in revenueByDay) revenueByDay[k] += p.amount; });
  bookings.forEach(b => {
    if (b.createdAt.slice(0, 10) in bookingsByDay) bookingsByDay[b.createdAt.slice(0, 10)] += 1;
    if (!['Cancelled', 'Rejected'].includes(b.status)) {
      for (let h = b.startHour; h < b.startHour + b.duration; h++) peak[h] = (peak[h] || 0) + 1;
      const c = d.courts.find(c => c.id === b.courtId); if (c) courtUsage[c.name] = (courtUsage[c.name] || 0) + b.duration;
    }
  });
  const courts = d.courts.filter(c => c.companyId === cid);
  const occupiedNow = courts.filter(c => { const m = slotStatusMap(cid, c.id, today); const h = new Date().getHours(); return m[h] === 'reserved' || m[h] === 'pending'; }).length;
  res.json({
    todaysBookings: bookings.filter(b => b.date === today && !['Cancelled', 'Rejected'].includes(b.status)).length,
    monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
    activeCustomers: new Set(bookings.filter(b => b.guest).map(b => b.guest.email)).size,
    availableCourts: courts.filter(c => c.status === 'Available').length - occupiedNow,
    occupiedCourts: occupiedNow,
    pendingPayments: payments.filter(p => p.status === 'Pending').length,
    cancelledBookings: bookings.filter(b => b.status === 'Cancelled').length,
    charts: { revenueByDay, bookingsByDay, peak, courtUsage, growth: {} }
  });
});

app.get('/api/admin/bookings', auth, staffOnly, withCompany, (req, res) => {
  const cid = req.cid, d = DB.get();
  let rows = d.bookings.filter(b => b.companyId === cid).map(b => ({
    ...b, court: d.courts.find(c => c.id === b.courtId)?.name,
    customer: b.guest ? b.guest.name : 'Unknown', email: b.guest?.email, mobile: b.guest?.mobile
  }));
  const { q, date, courtId, status } = req.query;
  if (q) rows = rows.filter(r => (r.ref + r.customer + (r.email || '')).toLowerCase().includes(q.toLowerCase()));
  if (date) rows = rows.filter(r => r.date === date);
  if (courtId) rows = rows.filter(r => r.courtId === Number(courtId));
  if (status) rows = rows.filter(r => r.status === status);
  res.json(rows.sort((a, b) => b.id - a.id));
});
app.post('/api/admin/bookings/:id/:action', auth, staffOnly, withCompany, (req, res) => {
  const d = DB.get();
  const b = d.bookings.find(x => x.id === Number(req.params.id) && x.companyId === req.cid);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  const email = b.guest?.email;
  if (req.params.action === 'approve') {
    b.status = 'Approved';
    if (email) sendEmail(email, `Booking ${b.ref} approved`, `Your booking is confirmed for ${b.date} ${b.startLabel}. See you on the court!`);
  } else if (req.params.action === 'reject') {
    b.status = 'Rejected';
    (b.equipment || []).forEach(item => { const e = d.equipment.find(e => e.companyId === req.cid && e.key === item.key); if (e) e.stock += 1; });
    if (email) sendEmail(email, `Booking ${b.ref} rejected`, `Sorry, your booking was rejected. ${req.body.reason || ''}`);
  } else return res.status(400).json({ error: 'Unknown action' });
  DB.save();
  DB.audit(req.account.id, 'BOOKING_' + req.params.action.toUpperCase(), b.ref, req.cid);
  res.json({ ok: true, booking: b });
});
app.post('/api/admin/bookings/:id/cancel', auth, staffOnly, withCompany, (req, res) => {
  const d = DB.get();
  const b = d.bookings.find(x => x.id === Number(req.params.id) && x.companyId === req.cid);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (['Cancelled', 'Completed'].includes(b.status)) return res.status(400).json({ error: 'Booking cannot be cancelled' });
  b.status = 'Cancelled';
  (b.equipment || []).forEach(item => { const e = d.equipment.find(e => e.companyId === req.cid && e.key === item.key); if (e) e.stock += 1; });
  DB.save();
  DB.audit(req.account.id, 'BOOKING_CANCEL', b.ref, req.cid);
  if (b.guest) sendEmail(b.guest.email, `Booking ${b.ref} cancelled`, `Your booking ${b.ref} has been cancelled.`);
  res.json({ ok: true });
});

app.get('/api/admin/payments', auth, staffOnly, withCompany, (req, res) => {
  const cid = req.cid, d = DB.get();
  res.json(d.payments.filter(p => p.companyId === cid).map(p => {
    const b = d.bookings.find(b => b.id === p.bookingId);
    return { ...p, bookingRef: b?.ref, customer: b?.guest ? b.guest.name : (p.guestName || '') };
  }).sort((a, b) => b.id - a.id));
});
app.post('/api/admin/payments/:id/:action', auth, staffOnly, withCompany, (req, res) => {
  const d = DB.get();
  const p = d.payments.find(x => x.id === Number(req.params.id) && x.companyId === req.cid);
  if (!p) return res.status(404).json({ error: 'Payment not found' });
  const b = d.bookings.find(b => b.id === p.bookingId);
  const email = b?.guest?.email;
  if (req.params.action === 'verify') {
    p.status = 'Verified'; p.verifiedAt = new Date().toISOString();
    if (b) { b.paymentStatus = 'Paid'; if (b.status === 'Pending') b.status = 'Approved'; }
    if (email) sendEmail(email, 'Payment verified — official receipt', `OR-${String(p.id).padStart(6, '0')} for booking ${b?.ref}, ₱${p.amount.toFixed(2)}. Your court is confirmed!`);
  } else if (req.params.action === 'reject') {
    p.status = 'Rejected'; if (b) b.paymentStatus = 'Rejected';
    if (email) sendEmail(email, 'Payment rejected', `Payment for ${b?.ref} was rejected. ${req.body.reason || 'Please re-upload a valid proof.'}`);
  } else if (req.params.action === 'refund') {
    p.status = 'Refunded'; if (b) b.paymentStatus = 'Refunded';
    if (email) sendEmail(email, 'Payment refunded', `Payment for ${b?.ref} has been refunded.`);
  } else return res.status(400).json({ error: 'Unknown action' });
  DB.save();
  DB.audit(req.account.id, 'PAYMENT_' + req.params.action.toUpperCase(), `#${p.id} ${b?.ref || ''}`, req.cid);
  res.json({ ok: true, payment: p });
});

app.get('/api/admin/customers', auth, staffOnly, withCompany, (req, res) => {
  const cid = req.cid, d = DB.get();
  const guests = {};
  d.bookings.filter(b => b.companyId === cid && b.guest).forEach(b => {
    const k = b.guest.email;
    if (!guests[k]) guests[k] = { id: null, firstName: b.guest.name, lastName: '', username: 'guest', email: b.guest.email, mobile: b.guest.mobile, verified: true, blacklisted: false, bookingCount: 0, totalSpent: 0 };
    guests[k].bookingCount += 1;
    const paid = d.payments.find(p => p.bookingId === b.id && p.status === 'Verified');
    if (paid) guests[k].totalSpent = Math.round((guests[k].totalSpent + paid.amount) * 100) / 100;
  });
  res.json(Object.values(guests));
});

/* courts */
app.get('/api/admin/courts', auth, staffOnly, withCompany, (req, res) => res.json(DB.get().courts.filter(c => c.companyId === req.cid)));
app.post('/api/admin/courts', auth, adminOnly, withCompany, (req, res) => {
  const d = DB.get();
  const c = { id: DB.nextId('courts'), companyId: req.cid, image: 'court' + ((DB.nextId('courts') % 4) || 4), photo: '', status: 'Available', ...req.body };
  d.courts.push(c);
  DB.save();
  DB.audit(req.account.id, 'COURT_ADD', c.name, req.cid);
  res.json({ ok: true, court: c });
});
app.put('/api/admin/courts/:id', auth, adminOnly, withCompany, (req, res) => {
  const c = DB.get().courts.find(c => c.id === Number(req.params.id) && c.companyId === req.cid);
  if (!c) return res.status(404).json({ error: 'Court not found' });
  Object.assign(c, req.body, { id: c.id, companyId: req.cid });
  DB.save();
  DB.audit(req.account.id, 'COURT_EDIT', c.name, req.cid);
  res.json({ ok: true, court: c });
});
app.delete('/api/admin/courts/:id', auth, adminOnly, withCompany, (req, res) => {
  const d = DB.get();
  const i = d.courts.findIndex(c => c.id === Number(req.params.id) && c.companyId === req.cid);
  if (i < 0) return res.status(404).json({ error: 'Court not found' });
  const [c] = d.courts.splice(i, 1);
  DB.save();
  DB.audit(req.account.id, 'COURT_DELETE', c.name, req.cid);
  res.json({ ok: true });
});
app.post('/api/admin/courts/:id/image', auth, adminOnly, withCompany, upload.single('image'), (req, res) => {
  const c = DB.get().courts.find(c => c.id === Number(req.params.id) && c.companyId === req.cid);
  if (!c) return res.status(404).json({ error: 'Court not found' });
  if (!req.file) return res.status(400).json({ error: 'Image file is required (JPG or PNG)' });
  c.photo = '/uploads/' + req.file.filename;
  DB.save();
  DB.audit(req.account.id, 'COURT_IMAGE', c.name, req.cid);
  res.json({ ok: true, photo: c.photo });
});
// reset a court image back to the built-in default graphic
app.post('/api/admin/courts/:id/image/reset', auth, adminOnly, withCompany, (req, res) => {
  const c = DB.get().courts.find(c => c.id === Number(req.params.id) && c.companyId === req.cid);
  if (!c) return res.status(404).json({ error: 'Court not found' });
  c.photo = '';
  DB.save();
  DB.audit(req.account.id, 'COURT_IMAGE_RESET', c.name, req.cid);
  res.json({ ok: true });
});

/* company logo upload */
app.post('/api/admin/logo', auth, adminOnly, withCompany, upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Logo file is required' });
  const c = companyById(req.cid);
  c.logo = '/uploads/' + req.file.filename;
  DB.save();
  DB.audit(req.account.id, 'LOGO_UPLOAD', c.logo, req.cid);
  res.json({ ok: true, file: c.logo });
});
// reset the company logo back to the default badge
app.post('/api/admin/logo/reset', auth, adminOnly, withCompany, (req, res) => {
  const c = companyById(req.cid);
  c.logo = '';
  DB.save();
  DB.audit(req.account.id, 'LOGO_RESET', c.name, req.cid);
  res.json({ ok: true });
});

/* highlights (premium) */
app.get('/api/admin/highlights', auth, staffOnly, withCompany, (req, res) => res.json(DB.get().highlights.filter(h => h.companyId === req.cid).sort((a, b) => b.id - a.id)));
app.post('/api/admin/highlights', auth, staffOnly, withCompany, requireSub, upload.single('image'), (req, res) => {
  const d = DB.get(), b = req.body || {};
  if (!['video', 'image', 'post'].includes(b.type)) return res.status(400).json({ error: 'Type must be video, image, or post' });
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'Title is required' });
  const h = { id: DB.nextId('highlights'), companyId: req.cid, type: b.type, title: String(b.title).trim(), url: req.file ? '/uploads/' + req.file.filename : String(b.url || '').trim(), text: String(b.text || '').trim(), active: true, createdAt: new Date().toISOString() };
  if (h.type === 'video' && !h.url) return res.status(400).json({ error: 'Facebook video/reel URL is required' });
  if (h.type === 'image' && !h.url) return res.status(400).json({ error: 'Upload an image or provide an image URL' });
  d.highlights.push(h);
  DB.save();
  DB.audit(req.account.id, 'HIGHLIGHT_ADD', h.title, req.cid);
  res.json({ ok: true, highlight: h });
});
app.post('/api/admin/highlights/:id/toggle', auth, staffOnly, withCompany, requireSub, (req, res) => {
  const h = DB.get().highlights.find(x => x.id === Number(req.params.id) && x.companyId === req.cid);
  if (!h) return res.status(404).json({ error: 'Highlight not found' });
  h.active = !h.active; DB.save();
  res.json({ ok: true, active: h.active });
});
app.delete('/api/admin/highlights/:id', auth, staffOnly, withCompany, requireSub, (req, res) => {
  const d = DB.get();
  const i = d.highlights.findIndex(x => x.id === Number(req.params.id) && x.companyId === req.cid);
  if (i < 0) return res.status(404).json({ error: 'Highlight not found' });
  d.highlights.splice(i, 1); DB.save();
  res.json({ ok: true });
});

/* open play (premium) */
app.get('/api/admin/openplay', auth, staffOnly, withCompany, (req, res) => {
  const cid = req.cid, d = DB.get();
  res.json(d.openPlay.filter(s => s.companyId === cid).sort((a, b) => b.id - a.id).map(s => ({ ...s, court: d.courts.find(c => c.id === s.courtId)?.name || 'All Courts' })));
});
app.post('/api/admin/openplay', auth, staffOnly, withCompany, requireSub, (req, res) => {
  const d = DB.get(), b = req.body || {};
  const start = Number(b.startHour), end = Number(b.endHour);
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'Session title is required' });
  if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return res.status(400).json({ error: 'Valid date is required' });
  if (!(start >= openHour(req.cid) && end > start && end <= closeHour(req.cid))) return res.status(400).json({ error: 'Invalid time range' });
  const s = { id: DB.nextId('openPlay'), companyId: req.cid, title: String(b.title).trim(), courtId: Number(b.courtId) || null, date: b.date, startHour: start, endHour: end, startLabel: fmtHour(start), endLabel: fmtHour(end), fee: Number(b.fee) || 0, capacity: Number(b.capacity) || 0, note: String(b.note || '').trim(), active: true, full: false, createdAt: new Date().toISOString() };
  d.openPlay.push(s); DB.save();
  DB.audit(req.account.id, 'OPENPLAY_ADD', s.title, req.cid);
  res.json({ ok: true, session: s });
});
app.put('/api/admin/openplay/:id', auth, staffOnly, withCompany, requireSub, (req, res) => {
  const s = DB.get().openPlay.find(x => x.id === Number(req.params.id) && x.companyId === req.cid);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const b = req.body || {};
  ['title', 'date', 'note'].forEach(k => { if (b[k] !== undefined) s[k] = String(b[k]).trim(); });
  if (b.courtId !== undefined) s.courtId = Number(b.courtId) || null;
  if (b.startHour !== undefined) { s.startHour = Number(b.startHour); s.startLabel = fmtHour(s.startHour); }
  if (b.endHour !== undefined) { s.endHour = Number(b.endHour); s.endLabel = fmtHour(s.endHour); }
  if (b.fee !== undefined) s.fee = Number(b.fee) || 0;
  if (b.capacity !== undefined) s.capacity = Number(b.capacity) || 0;
  if (b.full !== undefined) s.full = !!b.full;
  if (b.active !== undefined) s.active = !!b.active;
  DB.save();
  res.json({ ok: true, session: s });
});
app.delete('/api/admin/openplay/:id', auth, staffOnly, withCompany, requireSub, (req, res) => {
  const d = DB.get();
  const i = d.openPlay.findIndex(x => x.id === Number(req.params.id) && x.companyId === req.cid);
  if (i < 0) return res.status(404).json({ error: 'Session not found' });
  d.openPlay.splice(i, 1); DB.save();
  res.json({ ok: true });
});

/* tournaments (premium) */
app.get('/api/admin/tournaments', auth, staffOnly, withCompany, (req, res) => {
  const cid = req.cid, d = DB.get();
  res.json(d.tournaments.filter(t => t.companyId === cid).sort((a, b) => b.id - a.id).map(t => ({ ...t, registered: d.tournamentRegs.filter(r => r.tournamentId === t.id && r.status !== 'Rejected').length })));
});
app.post('/api/admin/tournaments', auth, staffOnly, withCompany, requireSub, (req, res) => {
  const d = DB.get(), b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'Tournament title is required' });
  if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return res.status(400).json({ error: 'Valid date is required' });
  const t = { id: DB.nextId('tournaments'), companyId: req.cid, title: String(b.title).trim(), date: b.date, description: String(b.description || '').trim(), fee: Number(b.fee) || 0, capacity: Number(b.capacity) || 0, status: 'Open', published: b.published !== false, createdAt: new Date().toISOString() };
  d.tournaments.push(t); DB.save();
  DB.audit(req.account.id, 'TOURNAMENT_ADD', t.title, req.cid);
  res.json({ ok: true, tournament: t });
});
app.put('/api/admin/tournaments/:id', auth, staffOnly, withCompany, requireSub, (req, res) => {
  const t = DB.get().tournaments.find(x => x.id === Number(req.params.id) && x.companyId === req.cid);
  if (!t) return res.status(404).json({ error: 'Tournament not found' });
  const b = req.body || {};
  ['title', 'date', 'description'].forEach(k => { if (b[k] !== undefined) t[k] = String(b[k]).trim(); });
  if (b.fee !== undefined) t.fee = Number(b.fee) || 0;
  if (b.capacity !== undefined) t.capacity = Number(b.capacity) || 0;
  if (b.status !== undefined && ['Open', 'Closed'].includes(b.status)) t.status = b.status;
  if (b.published !== undefined) t.published = !!b.published;
  DB.save();
  res.json({ ok: true, tournament: t });
});
app.delete('/api/admin/tournaments/:id', auth, adminOnly, withCompany, requireSub, (req, res) => {
  const d = DB.get();
  const i = d.tournaments.findIndex(x => x.id === Number(req.params.id) && x.companyId === req.cid);
  if (i < 0) return res.status(404).json({ error: 'Tournament not found' });
  d.tournaments.splice(i, 1); DB.save();
  res.json({ ok: true });
});
app.get('/api/admin/tournaments/:id/registrations', auth, staffOnly, withCompany, (req, res) => {
  res.json(DB.get().tournamentRegs.filter(r => r.tournamentId === Number(req.params.id) && r.companyId === req.cid).sort((a, b) => b.id - a.id));
});
app.post('/api/admin/tournament-regs/:id/:action', auth, staffOnly, withCompany, (req, res) => {
  const d = DB.get();
  const r = d.tournamentRegs.find(x => x.id === Number(req.params.id) && x.companyId === req.cid);
  if (!r) return res.status(404).json({ error: 'Registration not found' });
  const t = d.tournaments.find(t => t.id === r.tournamentId);
  if (req.params.action === 'verify') { r.status = 'Verified'; sendEmail(r.email, `You're in — ${t?.title}`, `Hi ${r.name}, your ₱${r.amount} payment is verified. See you at ${t?.title} on ${t?.date}!`); }
  else if (req.params.action === 'reject') { r.status = 'Rejected'; sendEmail(r.email, `Payment issue — ${t?.title}`, `Hi ${r.name}, your payment could not be verified.`); }
  else return res.status(400).json({ error: 'Unknown action' });
  DB.save();
  res.json({ ok: true, registration: r });
});

/* equipment */
app.get('/api/admin/equipment', auth, staffOnly, withCompany, (req, res) => res.json(DB.get().equipment.filter(e => e.companyId === req.cid)));
app.put('/api/admin/equipment/:id', auth, adminOnly, withCompany, (req, res) => {
  const e = DB.get().equipment.find(e => e.id === Number(req.params.id) && e.companyId === req.cid);
  if (!e) return res.status(404).json({ error: 'Item not found' });
  if (req.body.stock !== undefined) e.stock = Number(req.body.stock);
  if (req.body.price !== undefined) e.price = Number(req.body.price);
  DB.save();
  res.json({ ok: true, item: e });
});

/* maintenance */
app.post('/api/admin/maintenance', auth, adminOnly, withCompany, (req, res) => {
  const d = DB.get();
  const m = { id: DB.nextId('courtMaintenance'), companyId: req.cid, courtId: Number(req.body.courtId), date: req.body.date, note: req.body.note || '' };
  d.courtMaintenance.push(m); DB.save();
  res.json({ ok: true, maintenance: m });
});
app.get('/api/admin/calendar', auth, staffOnly, withCompany, (req, res) => {
  const cid = req.cid, d = DB.get(), month = req.query.month;
  const rows = d.bookings.filter(b => b.companyId === cid && b.date.startsWith(month) && !['Cancelled', 'Rejected'].includes(b.status))
    .map(b => ({ id: b.id, ref: b.ref, date: b.date, startHour: b.startHour, duration: b.duration, status: b.status, courtId: b.courtId, court: d.courts.find(c => c.id === b.courtId)?.name, customer: b.guest ? b.guest.name : '' }));
  res.json({ bookings: rows, maintenance: d.courtMaintenance.filter(m => m.companyId === cid && m.date.startsWith(month)) });
});

/* reports (premium) */
app.get('/api/admin/reports', auth, staffOnly, withCompany, requireSub, (req, res) => {
  const cid = req.cid, d = DB.get();
  const { from, to } = req.query;
  const inRange = dt => (!from || dt >= from) && (!to || dt <= to);
  const bookings = d.bookings.filter(b => b.companyId === cid && inRange(b.date));
  const payments = d.payments.filter(p => p.companyId === cid && inRange(p.createdAt.slice(0, 10)) && p.status === 'Verified');
  const byCourtHours = {}, equipmentRentals = {};
  bookings.filter(b => !['Cancelled', 'Rejected'].includes(b.status)).forEach(b => { const c = d.courts.find(c => c.id === b.courtId); if (c) byCourtHours[c.name] = (byCourtHours[c.name] || 0) + b.duration; });
  bookings.forEach(b => (b.equipment || []).forEach(e => { equipmentRentals[e.name] = (equipmentRentals[e.name] || 0) + 1; }));
  res.json({
    totalBookings: bookings.length, cancelled: bookings.filter(b => b.status === 'Cancelled').length,
    revenue: Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100) / 100,
    courtUtilization: byCourtHours, equipmentRentals,
    customers: new Set(bookings.map(b => b.guest ? b.guest.email : b.userId)).size,
    rows: bookings.map(b => ({ ref: b.ref, date: b.date, time: b.startLabel, court: d.courts.find(c => c.id === b.courtId)?.name, customer: b.guest ? b.guest.name : '', amount: b.total, status: b.status, payment: b.paymentStatus }))
  });
});
app.get('/api/admin/audit', auth, adminOnly, withCompany, (req, res) => {
  res.json(DB.get().auditLogs.filter(l => l.companyId === req.cid).slice(-200).reverse().map(l => ({ ...l, user: (findUser(l.userId) || {}).username || 'guest' })));
});
app.get('/api/admin/outbox', auth, adminOnly, (req, res) => res.json(outbox.slice(-50).reverse()));

/* ================= SUPER ADMIN ================= */
function companyView(c) {
  const admin = findUser(c.adminUserId);
  const d = DB.get();
  return {
    id: c.id, slug: c.slug, name: c.name, logo: c.logo, active: c.active !== false,
    admin: admin ? { id: admin.id, username: admin.username, email: admin.email, mobile: admin.mobile } : null,
    subscription: subStatus(c), rawSubscription: c.subscription || null,
    bookingCount: d.bookings.filter(b => b.companyId === c.id).length,
    createdAt: c.createdAt
  };
}
app.get('/api/super/overview', auth, superOnly, (req, res) => {
  const d = DB.get();
  const views = d.companies.map(subStatus);
  const revenue = d.companies.reduce((s, c) => s + (c.subscription?.payments || []).reduce((x, p) => x + p.amount, 0), 0);
  res.json({
    totalCompanies: d.companies.length,
    activeSubs: views.filter(s => s.active).length,
    expiredSubs: views.filter(s => s.status === 'Expired').length,
    suspended: d.companies.filter(c => c.active === false).length,
    subscriptionRevenue: Math.round(revenue * 100) / 100
  });
});
app.get('/api/super/companies', auth, superOnly, (req, res) => res.json(DB.get().companies.slice().sort((a, b) => a.id - b.id).map(companyView)));
app.post('/api/super/companies', auth, superOnly, (req, res) => {
  const d = DB.get(), b = req.body || {};
  const slug = String(b.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Company name is required' });
  if (!slug) return res.status(400).json({ error: 'A URL slug is required (letters, numbers, hyphens)' });
  if (d.companies.some(c => c.slug === slug)) return res.status(409).json({ error: 'That slug is already taken' });
  if (!b.username || !String(b.username).trim()) return res.status(400).json({ error: 'Admin username is required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email || ''))) return res.status(400).json({ error: 'Valid admin email is required' });
  if (!b.password || b.password.length < 8) return res.status(400).json({ error: 'Admin password must be at least 8 characters' });
  if (d.users.some(u => u.username.toLowerCase() === b.username.toLowerCase())) return res.status(409).json({ error: 'Username already taken' });
  const plan = ['Monthly', 'Quarterly', 'Yearly', 'Lifetime'].includes(b.plan) ? b.plan : 'Monthly';
  const now = new Date().toISOString();
  const admin = {
    id: DB.nextId('users'), roleId: 1, username: String(b.username).trim(), email: String(b.email).trim().toLowerCase(),
    passwordHash: bcrypt.hashSync(b.password, 10), firstName: String(b.name).trim(), lastName: 'Admin',
    mobile: String(b.mobile || '').trim(), address: String(b.address || '').trim(),
    photo: '', verified: true, active: true, blacklisted: false, createdAt: now
  };
  admin.companyId = 0; // temp, set after company id known
  d.users.push(admin);
  const company = {
    id: DB.nextId('companies'), slug, name: String(b.name).trim(), logo: '', adminUserId: admin.id, active: true,
    subscription: { ...DB.subFor(plan), startDate: b.startDate || now.slice(0, 10), endDate: b.endDate !== undefined ? b.endDate : DB.subFor(plan).endDate },
    settings: DB.companySettings(String(b.name).trim(), { address: b.address || 'Philippines', contact: { name: b.name, email: b.email, phone: b.mobile || '', messenger: '' } }),
    createdAt: now
  };
  admin.companyId = company.id;
  d.companies.push(company);
  DB.save();
  DB.audit(req.account.id, 'COMPANY_CREATE', `${company.name} (@${admin.username}) /${company.slug} — ${plan}`, company.id);
  res.json({ ok: true, company: companyView(company) });
});
app.put('/api/super/companies/:id', auth, superOnly, (req, res) => {
  const c = companyById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Company not found' });
  const b = req.body || {};
  if (b.name !== undefined) { c.name = String(b.name).trim(); c.settings.venueName = c.name; }
  if (b.slug !== undefined) {
    const slug = String(b.slug).trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (slug && !DB.get().companies.some(x => x.slug === slug && x.id !== c.id)) c.slug = slug;
  }
  const admin = findUser(c.adminUserId);
  if (admin) {
    if (b.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) admin.email = b.email.trim().toLowerCase();
    if (b.mobile !== undefined) admin.mobile = String(b.mobile).trim();
    if (b.password && b.password.length >= 8) admin.passwordHash = bcrypt.hashSync(b.password, 10);
  }
  DB.save();
  DB.audit(req.account.id, 'COMPANY_EDIT', c.name, c.id);
  res.json({ ok: true, company: companyView(c) });
});
app.post('/api/super/companies/:id/disable', auth, superOnly, (req, res) => {
  const c = companyById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Company not found' });
  c.active = c.active === false;
  DB.save();
  DB.audit(req.account.id, 'COMPANY_' + (c.active ? 'ENABLE' : 'SUSPEND'), c.name, c.id);
  res.json({ ok: true, active: c.active });
});
app.delete('/api/super/companies/:id', auth, superOnly, (req, res) => {
  const d = DB.get(), id = Number(req.params.id);
  const i = d.companies.findIndex(c => c.id === id);
  if (i < 0) return res.status(404).json({ error: 'Company not found' });
  const [c] = d.companies.splice(i, 1);
  const ui = d.users.findIndex(u => u.id === c.adminUserId);
  if (ui >= 0) d.users.splice(ui, 1);
  DB.save();
  DB.audit(req.account.id, 'COMPANY_DELETE', c.name, null);
  res.json({ ok: true });
});
app.post('/api/super/companies/:id/subscription', auth, superOnly, (req, res) => {
  const c = companyById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Company not found' });
  const b = req.body || {}, today = todayStr();
  if (!c.subscription) c.subscription = { payments: [] };
  const s = c.subscription;
  if (!s.payments) s.payments = [];
  if (b.plan && ['Monthly', 'Quarterly', 'Yearly', 'Lifetime'].includes(b.plan)) s.plan = b.plan;
  const days = DB.PLAN_DAYS[s.plan];
  if (b.action === 'activate' || b.action === 'renew') {
    s.status = 'Active';
    s.startDate = b.startDate || s.startDate || today;
    if (days === null) s.endDate = null;
    else {
      const base = (b.action === 'renew' && s.endDate && s.endDate > today) ? s.endDate : today;
      s.endDate = b.endDate || new Date(new Date(base + 'T00:00:00').getTime() + days * 86400000).toISOString().slice(0, 10);
    }
    c.active = true;
  } else if (b.action === 'suspend') { s.status = 'Suspended'; }
  else if (b.action === 'cancel') { s.status = 'Cancelled'; }
  else if (b.action === 'setdates') { if (b.startDate) s.startDate = b.startDate; if (b.endDate !== undefined) s.endDate = b.endDate; }
  else return res.status(400).json({ error: 'Unknown subscription action' });
  DB.save();
  DB.audit(req.account.id, 'SUBSCRIPTION_' + b.action.toUpperCase(), `${c.name} → ${s.status} (${s.plan})`, c.id);
  res.json({ ok: true, company: companyView(c) });
});
app.post('/api/super/companies/:id/payment', auth, superOnly, (req, res) => {
  const c = companyById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Company not found' });
  if (!c.subscription) c.subscription = { plan: 'Monthly', status: 'Active', payments: [] };
  if (!c.subscription.payments) c.subscription.payments = [];
  const amount = Number(req.body.amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'Valid amount is required' });
  const pay = { id: (c.subscription.payments.at(-1)?.id || 0) + 1, date: req.body.date || todayStr(), amount, method: req.body.method || 'GCash', note: String(req.body.note || '').trim() };
  c.subscription.payments.push(pay);
  DB.save();
  DB.audit(req.account.id, 'SUBSCRIPTION_PAYMENT', `${c.name} +₱${amount}`, c.id);
  res.json({ ok: true, payment: pay });
});
app.get('/api/super/companies/:id/activity', auth, superOnly, (req, res) => {
  res.json(DB.get().auditLogs.filter(l => l.companyId === Number(req.params.id)).slice(-100).reverse().map(l => ({ ...l, user: (findUser(l.userId) || {}).username || 'guest' })));
});

/* error handler */
app.use('/api', (err, req, res, next) => res.status(400).json({ error: err.message || 'Request failed' }));

/* ---------------- STATIC + ROUTING ---------------- */
const PUBLIC = path.join(__dirname, 'public');
// Single-site mode: root is the Snow Bear CourtOS landing/booking pages.
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.get('/book', (req, res) => res.sendFile(path.join(PUBLIC, 'book.html')));
app.get('/c/:slug', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.get('/book/:slug', (req, res) => res.sendFile(path.join(PUBLIC, 'book.html')));
app.use(express.static(PUBLIC));

DB.init().then(() => {
  app.listen(PORT, () => {
    console.log(`Snow Bear CourtOS (multi-tenant) running at http://localhost:${PORT}`);
    console.log('Super Admin: superadmin / SnowBear@2026');
    console.log('Demo company admins: koko123 / koko123   ·   admin2 / Ace@12345');
  });
}).catch(err => { console.error('Failed to connect to Neon:', err.message); process.exit(1); });

['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => {
  DB.flush().catch(e => console.error('Final flush failed:', e.message)).finally(() => process.exit(0));
}));
