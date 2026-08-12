/**
 * Data layer backed by Neon PostgreSQL — MULTI-TENANT.
 *
 * State is held in memory for fast synchronous reads and persisted to the
 * `picklecourt_state` Postgres table (one JSONB row per logical table).
 *
 * Multi-tenancy: every court/booking/payment/highlight/openPlay/tournament/
 * equipment/maintenance row carries a `companyId`. Each company has one admin
 * account and its own branded landing page (slug), settings, and subscription.
 * A single Super Admin (role 0) manages all companies.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_slJpgWnMf16j@ep-red-grass-azhh9ezm-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 30000
});

const TABLES = [
  'users', 'roles', 'companies', 'courts', 'bookings', 'bookingDetails', 'payments',
  'equipment', 'equipmentRental', 'services', 'memberships', 'promoCodes',
  'notifications', 'auditLogs', 'reports', 'courtMaintenance',
  'highlights', 'openPlay', 'tournaments', 'tournamentRegs'
];

let db = null;
let saveTimer = null;
let persistChain = Promise.resolve();

const PLAN_DAYS = { Monthly: 30, Quarterly: 90, Yearly: 365, Lifetime: null };

function companySettings(name, opts = {}) {
  return {
    venueName: name,
    address: opts.address || 'Maasin City, Southern Leyte',
    tagline: opts.tagline || 'Book a court in seconds — pay online, no sign-up needed.',
    hours: { open: 6, close: 22, openLabel: '6:00 AM', closeLabel: '10:00 PM', holidayLabel: '7:00 AM – 9:00 PM' },
    contact: opts.contact || { name: '', email: '', phone: '', messenger: '' },
    payment: opts.payment || { gcash: '0917 000 0000', maya: '0917 000 0000', bdo: '0012-3456-7890', accountName: name }
  };
}

function subFor(plan, active = true) {
  const now = new Date();
  const days = PLAN_DAYS[plan];
  return {
    plan, status: active ? 'Active' : 'Expired',
    startDate: now.toISOString().slice(0, 10),
    endDate: days === null ? null : new Date(Date.now() + days * 86400000).toISOString().slice(0, 10),
    payments: []
  };
}

function courtsFor(cid, startId, img1, img2) {
  return [
    {
      id: startId, companyId: cid, name: 'Court 1', type: 'Indoor', surface: 'Cushioned Acrylic',
      lighting: true, airconditioned: false, capacity: 4, size: '44 ft x 20 ft',
      status: 'Available', image: img1, photo: '',
      pricing: { weekday: 250, weekend: 250, holiday: 250, peak: 250, offpeak: 250 },
      description: 'Indoor court with tournament-grade cushioned surface.'
    },
    {
      id: startId + 1, companyId: cid, name: 'Court 2', type: 'Indoor', surface: 'Cushioned Acrylic',
      lighting: true, airconditioned: false, capacity: 4, size: '44 ft x 20 ft',
      status: 'Available', image: img2, photo: '',
      pricing: { weekday: 250, weekend: 250, holiday: 250, peak: 250, offpeak: 250 },
      description: 'Indoor court with tournament-grade cushioned surface.'
    }
  ];
}

function equipmentFor(cid, startId) {
  return [
    { id: startId, companyId: cid, name: 'Paddle Rental', key: 'paddle', price: 50, stock: 40, unit: 'pc' },
    { id: startId + 1, companyId: cid, name: 'Ball Rental', key: 'ball', price: 20, stock: 100, unit: 'set' },
    { id: startId + 2, companyId: cid, name: 'Net Rental', key: 'net', price: 100, stock: 10, unit: 'set' },
    { id: startId + 3, companyId: cid, name: 'Shoes Rental', key: 'shoes', price: 80, stock: 25, unit: 'pair' },
    { id: startId + 4, companyId: cid, name: 'Locker Rental', key: 'locker', price: 30, stock: 30, unit: 'unit' }
  ];
}

function highlightsFor(cid, startId, now) {
  return [
    { id: startId, companyId: cid, type: 'video', title: 'Game day reel', url: 'https://www.facebook.com/reel/1921670375165225/', text: '', active: true, createdAt: now },
    { id: startId + 1, companyId: cid, type: 'image', title: 'Our court', url: 'img/highlight1.jpg', text: '', active: true, createdAt: now }
  ];
}

function seed() {
  const now = new Date().toISOString();
  const data = {};
  TABLES.forEach(t => (data[t] = []));
  data._counters = { booking: 0 };

  data.platform = {
    appName: 'Snow Bear CourtOS',
    owner: { name: 'Engr. Jeruz Garde', email: 'jeruzgarde@gmail.com', phone: '09614170201', messenger: 'Jeruz Garde' }
  };

  data.roles = [
    { id: 0, name: 'Super Admin', permissions: ['**'] },
    { id: 1, name: 'Administrator', permissions: ['*'] },
    { id: 2, name: 'Cashier', permissions: ['payments.view', 'payments.verify', 'bookings.view'] },
    { id: 3, name: 'Receptionist', permissions: ['bookings.view', 'bookings.approve', 'customers.view'] },
    { id: 4, name: 'Coach', permissions: ['bookings.view', 'schedule.view'] },
    { id: 5, name: 'Customer', permissions: ['self'] }
  ];

  data.users = [
    {
      id: 100, roleId: 0, companyId: null, username: 'superadmin', email: 'jeruzgarde@gmail.com',
      passwordHash: bcrypt.hashSync('SnowBear@2026', 10),
      firstName: 'Engr. Jeruz', middleName: '', lastName: 'Garde',
      mobile: '09614170201', address: 'Maasin City, Southern Leyte',
      photo: '', verified: true, active: true, blacklisted: false, createdAt: now
    },
    {
      id: 1, roleId: 1, companyId: 1, username: 'koko123', email: 'admin@snowbearcourtos.ph',
      passwordHash: bcrypt.hashSync('koko123', 10),
      firstName: 'Snow Bear CourtOS', middleName: '', lastName: 'Admin',
      mobile: '09614170201', address: 'Maasin City, Southern Leyte',
      photo: '', verified: true, active: true, blacklisted: false, createdAt: now
    }
  ];

  data.companies = [
    {
      id: 1, slug: 'snowbear', name: 'Snow Bear CourtOS', logo: '',
      adminUserId: 1, active: true,
      subscription: subFor('Monthly'),
      settings: companySettings('Snow Bear CourtOS', {
        address: 'Maasin City, Southern Leyte',
        tagline: 'Book a court in seconds — pay online, no sign-up needed. 🐻🏓',
        contact: { name: 'Engr. Jeruz Garde', email: 'jeruzgarde@gmail.com', phone: '09614170201', messenger: 'Jeruz Garde' }
      }),
      createdAt: now
    }
  ];

  data.courts = courtsFor(1, 1, 'court1', 'court2');
  data.equipment = equipmentFor(1, 1);
  data.highlights = highlightsFor(1, 1, now);

  // legacy/global reference lists (not tenant-scoped, unused by current UI)
  data.services = [
    { id: 1, name: 'Coach', key: 'coach', price: 500 },
    { id: 2, name: 'Water Bottles', key: 'water', price: 60 }
  ];
  data.memberships = [];
  data.promoCodes = [];

  return data;
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS picklecourt_state (
      name TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  const { rows } = await pool.query('SELECT name, data FROM picklecourt_state');
  if (rows.length === 0) {
    db = seed();
    normalize();
    await persistNow();
    console.log('Seeded fresh multi-tenant database into Neon PostgreSQL');
  } else {
    db = {};
    rows.forEach(r => { db[r.name] = r.data; });
    normalize();
    console.log(`Loaded ${rows.length} tables from Neon PostgreSQL`);
  }
  return db;
}

function normalize() {
  TABLES.forEach(t => { if (!Array.isArray(db[t])) db[t] = db[t] || []; });
  if (!db._counters) db._counters = { booking: 0 };
  if (!db.platform) db.platform = {
    appName: 'Snow Bear CourtOS',
    owner: { name: 'Engr. Jeruz Garde', email: 'jeruzgarde@gmail.com', phone: '09614170201', messenger: 'Jeruz Garde' }
  };
  if (!db.roles.some(r => r.id === 0)) db.roles.unshift({ id: 0, name: 'Super Admin', permissions: ['**'] });
  if (!db.users.some(u => u.roleId === 0)) {
    db.users.push({
      id: 100, roleId: 0, companyId: null, username: 'superadmin', email: 'jeruzgarde@gmail.com',
      passwordHash: bcrypt.hashSync('SnowBear@2026', 10),
      firstName: 'Engr. Jeruz', middleName: '', lastName: 'Garde',
      mobile: '09614170201', address: 'Maasin City', photo: '', verified: true, active: true, blacklisted: false,
      createdAt: new Date().toISOString()
    });
  }
}

async function persistNow() {
  const names = Object.keys(db);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const name of names) {
      await client.query(
        `INSERT INTO picklecourt_state (name, data, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [name, JSON.stringify(db[name])]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => { });
    throw e;
  } finally {
    client.release();
  }
}

function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistChain = persistChain.then(() => persistNow()).catch(err => console.error('DB persist failed:', err.message));
  }, 300);
}

async function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  await persistChain;
  await persistNow();
}

function get() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function nextId(table) {
  const rows = get()[table];
  return rows.length ? Math.max(...rows.map(r => r.id)) + 1 : 1;
}

function nextBookingRef() {
  const d = get();
  d._counters.booking += 1;
  const seq = String(d._counters.booking).padStart(6, '0');
  const t = new Date();
  const ymd = t.getFullYear().toString() + String(t.getMonth() + 1).padStart(2, '0') + String(t.getDate()).padStart(2, '0');
  save();
  return `PB-${ymd}-${seq}`;
}

function audit(userId, action, details, companyId) {
  const d = get();
  d.auditLogs.push({
    id: nextId('auditLogs'), userId, companyId: companyId ?? null,
    action, details: details || '', at: new Date().toISOString()
  });
  save();
}

function notify(userId, type, title, message, companyId) {
  const d = get();
  d.notifications.push({
    id: nextId('notifications'), userId, companyId: companyId ?? null,
    type, title, message, read: false, at: new Date().toISOString()
  });
  save();
}

module.exports = { init, get, save, flush, nextId, nextBookingRef, audit, notify, pool, PLAN_DAYS, companySettings, subFor };
