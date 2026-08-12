/* Shared helpers: API, auth, toasts, theming, court images */
const API = {
  companyId: null, // super-admin impersonation target
  token() { return localStorage.getItem('pc_token') || sessionStorage.getItem('pc_token'); },
  user() {
    try { return JSON.parse(localStorage.getItem('pc_user') || sessionStorage.getItem('pc_user')); }
    catch { return null; }
  },
  setSession(token, user, remember, subscription, company) {
    const store = remember ? localStorage : sessionStorage;
    store.setItem('pc_token', token);
    store.setItem('pc_user', JSON.stringify(user));
    if (subscription) store.setItem('pc_sub', JSON.stringify(subscription));
    if (company) store.setItem('pc_company', JSON.stringify(company));
  },
  subscription() {
    try { return JSON.parse(localStorage.getItem('pc_sub') || sessionStorage.getItem('pc_sub')); }
    catch { return null; }
  },
  company() {
    try { return JSON.parse(localStorage.getItem('pc_company') || sessionStorage.getItem('pc_company')); }
    catch { return null; }
  },
  logout() {
    ['pc_token', 'pc_user', 'pc_sub', 'pc_company'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); });
    location.href = '/login.html';
  },
  async req(path, opts = {}) {
    const headers = opts.headers || {};
    if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const t = this.token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    if (this.companyId) headers['x-company-id'] = this.companyId;
    const res = await fetch(path, { ...opts, headers });
    let data = {};
    try { data = await res.json(); } catch { }
    if (res.status === 401 && t) { this.logout(); return; }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
  get(p) { return this.req(p); },
  post(p, body) { return this.req(p, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }); },
  put(p, body) { return this.req(p, { method: 'PUT', body: JSON.stringify(body) }); },
  del(p) { return this.req(p, { method: 'DELETE' }); }
};

function toast(msg, type = 'success') {
  let holder = document.getElementById('toastHolder');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'toastHolder';
    holder.className = 'toast-container position-fixed top-0 end-0 p-3';
    holder.style.zIndex = 4000;
    document.body.appendChild(holder);
  }
  const el = document.createElement('div');
  const bg = { success: 'bg-success', error: 'bg-danger', info: 'bg-primary', warning: 'bg-warning text-dark' }[type] || 'bg-dark';
  el.className = `toast align-items-center text-white ${bg} border-0 show mb-2`;
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" onclick="this.closest('.toast').remove()"></button></div>`;
  holder.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function confirmDialog(title, body) {
  return new Promise(resolve => {
    let modal = document.getElementById('pcConfirmModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'pcConfirmModal';
      modal.className = 'modal fade';
      modal.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content card-pc">
        <div class="modal-header border-0"><h5 class="modal-title" id="pcConfirmTitle"></h5>
        <button class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body" id="pcConfirmBody"></div>
        <div class="modal-footer border-0">
          <button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
          <button class="btn btn-pc" id="pcConfirmYes">Confirm</button>
        </div></div></div>`;
      document.body.appendChild(modal);
    }
    modal.querySelector('#pcConfirmTitle').textContent = title;
    modal.querySelector('#pcConfirmBody').textContent = body;
    const bs = bootstrap.Modal.getOrCreateInstance(modal);
    const yes = modal.querySelector('#pcConfirmYes');
    const onYes = () => { cleanup(); bs.hide(); resolve(true); };
    const onHide = () => { cleanup(); resolve(false); };
    function cleanup() {
      yes.removeEventListener('click', onYes);
      modal.removeEventListener('hidden.bs.modal', onHide);
    }
    yes.addEventListener('click', onYes);
    modal.addEventListener('hidden.bs.modal', onHide);
    bs.show();
  });
}

/* dark mode */
function initTheme() {
  const saved = localStorage.getItem('pc_theme') || 'light';
  document.documentElement.setAttribute('data-bs-theme', saved);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-bs-theme', cur);
  localStorage.setItem('pc_theme', cur);
  document.querySelectorAll('.theme-icon').forEach(i => i.className = 'theme-icon bi ' + (cur === 'dark' ? 'bi-sun' : 'bi-moon-stars'));
}
initTheme();

/* SVG court image generator — no external photos needed */
function courtSVG(variant, label, wide) {
  const palettes = {
    court1: ['#1d4ed8', '#16a34a', '#2563eb'],
    court2: ['#0f766e', '#16a34a', '#0d9488'],
    court3: ['#15803d', '#22c55e', '#166534'],
    court4: ['#1e40af', '#3b82f6', '#1e3a8a']
  };
  const [bg, kitchen, court] = palettes[variant] || palettes.court1;
  const w = wide ? 640 : 400, h = wide ? 300 : 240;
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" class="court-img" role="img" aria-label="${label}">
    <rect width="${w}" height="${h}" fill="${bg}"/>
    <rect x="${w * .1}" y="${h * .12}" width="${w * .8}" height="${h * .76}" rx="6" fill="${court}" stroke="#fff" stroke-width="3"/>
    <rect x="${w * .38}" y="${h * .12}" width="${w * .24}" height="${h * .76}" fill="${kitchen}" stroke="#fff" stroke-width="2"/>
    <line x1="${w / 2}" y1="${h * .08}" x2="${w / 2}" y2="${h * .92}" stroke="#f8fafc" stroke-width="5" stroke-dasharray="6 4"/>
    <line x1="${w * .1}" y1="${h / 2}" x2="${w * .38}" y2="${h / 2}" stroke="#fff" stroke-width="2"/>
    <line x1="${w * .62}" y1="${h / 2}" x2="${w * .9}" y2="${h / 2}" stroke="#fff" stroke-width="2"/>
    <circle cx="${w * .78}" cy="${h * .3}" r="10" fill="#bef264" stroke="#84cc16" stroke-width="2"/>
    <text x="${w / 2}" y="${h - 10}" text-anchor="middle" fill="#e2e8f0" font-size="14" font-weight="700" font-family="Segoe UI">${label}</text>
  </svg>`;
}

/* Brand logo. Uses window.PC_LOGO (company logo) if set, else a bear badge. */
function brandLogo(size) {
  size = size || 40;
  if (window.PC_LOGO) {
    return `<img src="${assetUrl(window.PC_LOGO)}" alt="logo" width="${size}" height="${size}"
      style="object-fit:contain;border-radius:10px"
      onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'">` +
      `<span class="brand-badge" style="display:none;width:${size}px;height:${size}px">🐻</span>`;
  }
  return `<span class="brand-badge" style="width:${size}px;height:${size}px">🐻</span>`;
}
function fillBrandLogos() { document.querySelectorAll('.brand-logo-slot').forEach(el => { el.innerHTML = brandLogo(Number(el.dataset.size)); }); }
function setBrandLogo(url) { window.PC_LOGO = url || null; fillBrandLogos(); }
/* Normalize an asset URL so it works on /c/:slug pages (absolute from root) */
function assetUrl(u) {
  if (!u) return u;
  if (/^(https?:)?\/\//.test(u) || u.startsWith('/')) return u;
  return '/' + u;
}
/* Court image — uploaded photo if the admin set one, otherwise the drawn SVG */
function courtImg(c, wide) {
  if (c.photo) {
    return `<img src="${esc(assetUrl(c.photo))}" alt="${esc(c.name)}" class="court-img"
      style="height:${wide ? 300 : 240}px;object-fit:cover">`;
  }
  return courtSVG(c.image, c.name + ' · ' + c.type, wide);
}
document.addEventListener('DOMContentLoaded', fillBrandLogos);

function peso(n) { return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 }); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function hideLoader() {
  const l = document.getElementById('pcLoader');
  if (l) setTimeout(() => l.classList.add('hide'), 350);
}
window.addEventListener('load', hideLoader);
