# 🐻🏓 Snow Bear CourtOS

**A multi-tenant pickleball court booking & management SaaS.**
No-sign-up online booking, online payments, open play, tournaments, and a full
owner dashboard — with a Super Admin control plane that manages multiple venues,
each on its own branded landing page and subscription.

<p>
<img alt="Node.js" src="https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white">
<img alt="PostgreSQL" src="https://img.shields.io/badge/Database-PostgreSQL%20(Neon)-4169E1?logo=postgresql&logoColor=white">
<img alt="Auth" src="https://img.shields.io/badge/Auth-JWT%20%2B%20bcrypt-orange">
<img alt="Status" src="https://img.shields.io/badge/status-active-brightgreen">
</p>

<p align="center">
  <img src="docs/poster.jpg" alt="Snow Bear CourtOS" width="380">
</p>

---

## Table of contents
- [Features](#features)
- [Screenshots](#screenshots)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Default accounts](#default-accounts)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [API overview](#api-overview)
- [Data & persistence](#data--persistence)
- [Deployment](#deployment)
- [Security notes](#-security-notes-read-before-going-public)
- [License](#license)

---

## Features

**Customer (no account required)**
- Branded per-venue landing page (`/c/<slug>`)
- Book a court in seconds — live, color-coded time slots (available / pending / reserved / unavailable)
- Online payment (**GCash / Maya / BDO Pay**) with proof-of-payment upload (JPG/PNG/PDF)
- Booking reference + QR code + confirmation email (queued to an outbox)
- **Find My Booking** — look up status / receipt and cancel by reference + mobile

**Court Admin (venue owner/staff)**
- Dashboard with revenue, court-usage, and peak-hour analytics
- Verify payments and issue official receipts
- Manage courts, court photos (with **reset-to-default**), operating hours, contact & payment settings, and a venue logo
- **Open Play** scheduling, **Tournaments** with online registration, and **Highlights**
- Equipment, maintenance, promo codes, and reports

**Super Admin (platform owner)**
- Manage all companies/venues from one control plane
- Create venues, assign admins, and control **subscription plans** (Monthly / Quarterly / Yearly / Lifetime)
- Subscription gating — premium features and public pages are disabled when a plan expires

---

## Screenshots

| Landing page | No-sign-up booking |
|:---:|:---:|
| ![Landing page](docs/home.jpg) | ![Booking flow](docs/booking.jpg) |
| **Owner dashboard & analytics** | **Payment verification & receipts** |
| ![Dashboard](docs/dashboard.jpg) | ![Payments](docs/payments.jpg) |
| **Tournaments** | **Open Play** |
| ![Tournaments](docs/tournaments.jpg) | ![Open Play](docs/openplay.jpg) |

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js + **Express** |
| Database | **PostgreSQL** (hosted on [Neon](https://neon.tech)) |
| Auth | **JWT** (`jsonwebtoken`) + password hashing (`bcryptjs`) |
| Uploads | `multer` (payment proofs, logos, court photos) |
| Frontend | Vanilla **HTML / CSS / JavaScript** (no build step) |

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Set your database connection (see Configuration below)
#    export DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"

# 3. Run
npm start
```

Then open **http://localhost:3000**.

> First run auto-seeds the roles, a Super Admin, and a demo venue (`Snow Bear CourtOS`, slug `snowbear`).

---

## Configuration

The app is configured entirely through environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string (Neon works out of the box; SSL required). |
| `PORT` | No | `3000` | HTTP port the server listens on. |
| `JWT_SECRET` | Recommended | *(dev fallback)* | Secret used to sign auth tokens. Set a strong value in production. |

Create a `.env` (and keep it out of Git) or export the variables in your shell / host dashboard.

---

## Default accounts

Seeded on first run — **change these before any real deployment.**

| Role | Username | Password | Lands on |
|------|----------|----------|----------|
| Super Admin | `superadmin` | `SnowBear@2026` | `superadmin.html` |
| Court Admin | `koko123` | `koko123` | `admin.html` |

Staff sign in at **`/login.html`**. Customers never need an account.

---

## How it works

1. **A customer** visits a venue's branded page, picks a court, date, and time slot, enters their name + mobile + email, and pays online with a proof-of-payment upload. They receive a booking reference and QR code.
2. **The court admin** verifies the payment, issues a receipt, and manages courts, schedules, open play, tournaments, and settings from the dashboard — while watching revenue and usage analytics.
3. **The super admin** onboards new venues, assigns their admin, and manages each venue's subscription. Expired subscriptions gate premium features and take the public page offline.

Multi-tenancy: every court, booking, payment, tournament, etc. carries a `companyId`, so each venue's data is fully isolated.

---

## Project structure

```
picklecourt/
├── server.js            # Express app: routing, auth, uploads, all API endpoints
├── server/
│   └── db.js            # Data layer (Neon PostgreSQL) + first-run seeding
├── schema.sql           # Relational schema reference
├── public/              # Frontend (served statically, no build step)
│   ├── index.html       # Landing page
│   ├── book.html        # Customer booking flow
│   ├── login.html / register.html / verify.html / reset.html
│   ├── admin.html       # Court Admin dashboard
│   ├── superadmin.html  # Super Admin control plane
│   ├── dashboard.html / platform.html
│   ├── css/  img/
│   └── js/              # admin.js, book.js, common.js, dashboard.js, superadmin.js
├── data/uploads/        # Uploaded payment proofs / logos / court photos
└── package.json
```

---

## API overview

All endpoints are under `/api`. High-level groups:

| Prefix | Purpose |
|--------|---------|
| `/api/auth/*` | Login, forgot/reset password |
| `/api/company/*` | Public, per-venue data (courts, slots, booking creation, lookup) |
| `/api/admin/*` | Court Admin: bookings, payments, courts, settings, logo, open play, tournaments, highlights, maintenance, stats, reports, outbox |
| `/api/super/*` | Super Admin: companies overview & management |
| `/c/:slug` | A venue's branded public landing page |
| `/book` | Customer booking page |

Admin/super routes are protected by JWT and role checks.

---

## Data & persistence

State is held in memory for fast synchronous reads and persisted to PostgreSQL as
JSONB (one row per logical table) via the data layer in `server/db.js`.
`schema.sql` documents the equivalent relational model (roles, users, courts,
bookings, booking_details, payments, equipment, memberships, promo_codes,
notifications, audit_logs, reports, court_maintenance).

---

## Deployment

Any Node host works (Render, Railway, Fly.io, a VPS, etc.):

1. Provision a PostgreSQL database (e.g. Neon) and copy its connection string.
2. Set `DATABASE_URL`, `JWT_SECRET`, and `PORT` in the host's environment.
3. Deploy the repo and run `npm install && npm start`.
4. Point your domain at the host; each venue is reachable at `/c/<slug>`.

---

## 🔒 Security notes (read before going public)

- **Rotate the database credential.** Earlier versions of `server/db.js` contained a
  hardcoded Neon connection string as a fallback. Before pushing this repo publicly,
  **remove that fallback, load the URL from `DATABASE_URL` only, and rotate the Neon
  password** (a committed secret must be treated as compromised).
- **Set a strong `JWT_SECRET`** in production — don't rely on the development fallback.
- **Change the default `superadmin` / `koko123` passwords** immediately after first run.
- Add a `.gitignore` for `node_modules/`, `.env`, and `data/uploads/`.

---

## License

Proprietary — © Engr. Jeruz Garde. All rights reserved.
Commercial licensing and custom deployments are available; **pricing is flexible and
negotiable** based on your venue and scope. Contact **jeruzgarde@gmail.com**.
