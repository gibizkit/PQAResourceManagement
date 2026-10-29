/**
 * asset.js — ส่วนกลางของ PQA Asset Mgmt (Supabase) ใช้ร่วมกันทุกหน้า
 *
 *   boot(page, start)   login + ตรวจสิทธิ์ + topbar แล้วเรียก start(mainEl)
 *   api                 เรียก Supabase (schema asset) — โหมด ?mock ใช้ dev/mock.js แทน
 *   store / loadStore   ข้อมูลที่หน้าใช้ร่วมกัน (เครื่อง / คน / รุ่น / lookup)
 *   createDrawer()      แผงรายละเอียดเครื่อง + ส่งต่อ / คืน / สถานะ / แก้ไข
 *   deviceDialog()      ลงทะเบียน / แก้ไขเครื่อง
 *
 * ไม่ import ../common.js ของ RM (มีโค้ด signoff / แจ้งเตือน / login_log ของ RM ผูกอยู่)
 * แต่สร้าง client ของ Supabase project เดียวกัน → session ใช้ร่วมกับ RM เมื่ออยู่ origin เดียวกัน
 */

const SUPABASE_URL = 'https://nbjetmnqvvvqtmpuxsrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5iamV0bW5xdnZ2cXRtcHV4c3JuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NzM5ODQsImV4cCI6MjEwMDI0OTk4NH0.5_new20_Vh37uRVLO_dBFmb9m05M_k5pzdvclOV4AjU';
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export const APP_VERSION = '2.0';
export const MOCK = new URLSearchParams(location.search).has('mock');
const RM_HOME = '../gantt.html';
// ล็อกอินด้วยรหัสทางอีเมล — ปิดไว้จนกว่าจะตั้ง SMTP ใน Supabase (Auth → SMTP Settings)
// อีเมลของ Supabase เองจำกัดจำนวนต่อชั่วโมงและส่งได้แค่บางที่อยู่ RM ก็ยังไม่ได้ตั้ง SMTP (SETUP.md)
// เปิดแล้วต้องแก้ template Magic Link ให้มี {{ .Token }} ด้วย
const EMAIL_OTP = false;
const LONG_HELD_DAYS = 180;          // ถือนานเกินนี้ = ไฮไลต์ (Dashboard / ตาราง)

const PAGES = [
  { id: 'devices',   href: 'devices.html',   label: 'อุปกรณ์ทีม' },
  { id: 'mobile',    href: 'mobile.html',    label: 'Mobile' },
  { id: 'dashboard', href: 'dashboard.html', label: 'Dashboard' },
  { id: 'admin',     href: 'admin.html',     label: 'Admin', admin: true },
];

export let api = null;
export let me = null;
let sb = null;

/* =====================================================================
   HELPERS
   ===================================================================== */
export const $ = id => document.getElementById(id);

export function esc(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 'yyyy-MM-dd' → 'dd/mm/yyyy' */
export function dDisp(s) {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** วันนี้ตามเวลาไทย (ตรงกับ asset.fn_today() ฝั่ง DB) */
export function todayISO() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 'dd/mm/yyyy' หรือ 'yyyy-mm-dd' → 'yyyy-mm-dd' / null ถ้าไม่ใช่วันที่จริง */
export function parseDateInput(s) {
  const t = String(s || '').trim();
  let y, m, d;
  let mt = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mt) [, y, m, d] = mt;
  else if ((mt = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [, d, m, y] = mt;
  else return null;
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return null;
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(fromISO, toISO = todayISO()) {
  if (!fromISO) return null;
  return Math.round((Date.parse(toISO) - Date.parse(String(fromISO).slice(0, 10))) / 86400000);
}

export function toast(msg, isErr) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.className = 'toast'; }, 2800);
}

export function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || String(e || 'เกิดข้อผิดพลาด');
  // error ที่มาจาก constraint ตรงๆ (insert/update ตาราง ไม่ผ่าน RPC) → แปลเป็นภาษาไทย
  if (/device_model_uk/.test(m)) return 'มียี่ห้อ + รุ่นนี้อยู่แล้ว';
  if (/asset_type_pkey|platform_pkey/.test(m)) return 'รหัสนี้มีอยู่แล้ว';
  if (/row-level security|permission denied/i.test(m)) return 'ไม่มีสิทธิ์ทำรายการนี้';
  return m;
}

/** ลิงก์ภายในแอป — โหมด mock ต้องติด ?mock ไปด้วย */
export function link(href) {
  return MOCK ? `${href}${href.includes('?') ? '&' : '?'}mock` : href;
}

/** จำค่า filter ต่อหน้าใน sessionStorage (ปิดแท็บ = กลับ default) — พังเงียบๆ ถ้า storage ปิด */
export function prefs(page) {
  const key = `pqa.asset.prefs.${page}`;
  let cur = {};
  try { cur = JSON.parse(sessionStorage.getItem(key) || '{}') || {}; } catch { cur = {}; }
  return {
    get: (k, dflt) => (k in cur ? cur[k] : dflt),
    set: (k, v) => { cur[k] = v; try { sessionStorage.setItem(key, JSON.stringify(cur)); } catch { /* ignore */ } },
  };
}

export const OWNERSHIP_LABEL = { team: 'ทีม PQA', personal: 'Personal', outsource: 'Outsource' };
export const STATUS_LABEL = { active: 'ใช้งาน', repair: 'ส่งซ่อม', lost: 'หาย', retired: 'ปลดระวาง' };

export function ownershipPill(o) { return `<span class="pill p-${esc(o)}">${esc(OWNERSHIP_LABEL[o] || o)}</span>`; }
export function statusPill(s) { return s === 'active' ? '' : `<span class="pill p-${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`; }
export function personTypePill(t) {
  return t === 'outsource' ? '<span class="pill p-outsource">Outsource</span>' : '<span class="pill p-personal">PQA</span>';
}
export function modelText(d) { return [d.brand, d.model_name].filter(Boolean).join(' '); }
export function deviceTitle(d) { return [d.internal_id || d.asset_tag, modelText(d)].filter(Boolean).join(' · '); }

export function heldText(d) {
  const n = d.held_days ?? daysBetween(d.holder_since);
  if (n == null) return '';
  return `<span class="${n > LONG_HELD_DAYS ? 'days-warn' : ''}">${n} วัน</span>`;
}

export function holderHTML(d) {
  if (d.holder_resource_id) {
    return `<div class="holder"><b>${esc(d.holder_name)}</b><small>ตั้งแต่ ${dDisp(d.holder_since)} · ${heldText(d)}</small></div>`;
  }
  if (d.status === 'active') return '<span class="pill p-free">ว่าง</span>';
  return statusPill(d.status);
}

/* =====================================================================
   API — Supabase จริง (schema asset)
   ===================================================================== */
function createApi(client) {
  const a = client.schema('asset');
  const ok = ({ data, error }) => { if (error) throw error; return data; };
  async function all(build, pageSize = 1000) {
    let rows = [], from = 0;
    for (;;) {
      const data = ok(await build(from, from + pageSize - 1));
      rows = rows.concat(data || []);
      if (!data || data.length < pageSize) return rows;
      from += pageSize;
    }
  }
  return {
    me: async () => ok(await a.rpc('fn_me')),
    devices: () => all((f, t) => a.from('v_device').select('*').order('device_id').range(f, t)),
    history: async id => ok(await a.from('v_device_history').select('*').eq('device_id', id).order('start_date', { ascending: false })),
    osLog: async id => ok(await a.from('device_os_log').select('*').eq('device_id', id).order('changed_at', { ascending: false })),
    people: () => all((f, t) => a.from('v_person').select('*').eq('is_active', true).order('display_name').range(f, t)),
    models: () => all((f, t) => a.from('v_model_usage').select('*').order('brand').order('model_name').range(f, t)),
    types: async () => ok(await a.from('asset_type').select('*').order('sort_order')),
    platforms: async () => ok(await a.from('platform').select('*').order('sort_order')),
    osCoverage: async () => ok(await a.from('v_os_coverage').select('*')),
    saveDevice: async p => ok(await a.rpc('fn_save_device', { p })),
    assign: async (id, rid, date, note) => ok(await a.rpc('fn_assign_device',
      { p_device_id: id, p_resource_id: rid, p_date: date, p_note: note || null })),
    setStatus: async (id, status, date) => ok(await a.rpc('fn_set_device_status',
      { p_device_id: id, p_status: status, p_date: date })),
    addModel: async m => ok(await a.from('device_model').insert(m).select().single()),
    updateModel: async (id, patch) => {
      const rows = ok(await a.from('device_model').update(patch).eq('model_id', id).select());
      if (!rows.length) throw new Error('ไม่มีสิทธิ์แก้รุ่นนี้ (เฉพาะ admin)');
      return rows[0];
    },
    saveLookup: async (table, key, row, isNew) => {
      const q = isNew ? a.from(table).insert(row) : a.from(table).update(row).eq(key, row[key]);
      const rows = ok(await q.select());
      if (!rows.length) throw new Error('ไม่มีสิทธิ์แก้ไข (เฉพาะ admin)');
      return rows[0];
    },
    logLogin: async type => {
      try { await a.rpc('fn_log_login', { p_app_version: APP_VERSION, p_auth_type: type }); } catch { /* best-effort */ }
    },
    signOut: () => client.auth.signOut(),
  };
}

/* =====================================================================
   STORE — ข้อมูลที่ใช้ร่วมกันในหน้า
   ===================================================================== */
export const store = { devices: [], people: [], models: [], types: [], platforms: [] };

export async function loadStore(parts = ['devices', 'people', 'models', 'types', 'platforms']) {
  const res = await Promise.all(parts.map(p => api[p]()));
  parts.forEach((p, i) => { store[p] = res[i] || []; });
  return store;
}
export function deviceById(id) { return store.devices.find(d => String(d.device_id) === String(id)); }

/* =====================================================================
   BOOT / LOGIN / TOPBAR
   ===================================================================== */
export async function boot(page, start) {
  document.body.insertAdjacentHTML('afterbegin', `
    ${MOCK ? '<div class="mock-banner">โหมดทดลอง (mock) — ข้อมูลตัวอย่างในเครื่องนี้เท่านั้น ไม่ได้เชื่อม Supabase</div>' : ''}
    <div id="loginPage" class="hidden"></div>
    <div id="noAccess" class="hidden"></div>
    <div id="app" class="hidden">
      <div class="topbar" id="topbar"></div>
      <div class="main" id="main"></div>
    </div>
    <div class="toast" id="toast"></div>`);

  const go = async () => {
    try {
      me = await api.me();
    } catch (e) {
      return showNoAccess(`โหลดข้อมูลผู้ใช้ไม่ได้: ${errMsg(e)}`);
    }
    if (!me || !me.asset_role) return showNoAccess();
    const pg = PAGES.find(p => p.id === page);
    if (pg?.admin && me.asset_role !== 'admin') return showNoAccess('หน้านี้สำหรับ admin ของ Resource Mgmt เท่านั้น');
    renderTopbar(page);
    $('loginPage').classList.add('hidden');
    $('app').classList.remove('hidden');
    try {
      await start($('main'));
    } catch (e) {
      console.error(e);
      $('main').innerHTML = `<div class="empty">โหลดหน้าไม่สำเร็จ: ${esc(errMsg(e))}</div>`;
    }
  };

  if (MOCK) {
    try {
      const { createMockApi } = await import('./dev/mock.js');
      api = createMockApi();
    } catch {
      // dev/ ไม่ได้ deploy ขึ้นเว็บจริง
      return showNoAccess('โหมดทดลอง (?mock) ใช้ได้เฉพาะตอนพัฒนาในเครื่อง — เปิดลิงก์โดยไม่ใส่ ?mock');
    }
    return go();
  }

  let createClient;
  try {
    ({ createClient } = await import(SUPABASE_JS));
  } catch (e) {
    return showNoAccess('โหลดไลบรารี Supabase ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรช');
  }
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: 'asset' } });
  api = createApi(sb);
  sb.auth.onAuthStateChange(evt => { if (evt === 'SIGNED_OUT') location.reload(); });
  const { data } = await sb.auth.getSession();
  if (data.session) return go();
  showLogin(go);
}

function renderTopbar(page) {
  const nav = PAGES.filter(p => !p.admin || me.asset_role === 'admin')
    .map(p => `<a href="${link(p.href)}" class="${p.id === page ? 'active' : ''}">${p.label}</a>`).join('');
  $('topbar').innerHTML = `
    <span class="brand">PQA Asset Mgmt<small>v${APP_VERSION}</small></span>
    <nav class="nav">${nav}</nav>
    <span class="spacer"></span>
    <a class="switch-app" href="${RM_HOME}">↗ Resource Mgmt</a>
    <span class="who"><b>${esc(me.display_name || me.email)}</b> · ${esc(me.asset_role)}</span>
    <button class="btn sm" id="logoutBtn" type="button">ออกจากระบบ</button>`;
  $('logoutBtn').onclick = async () => {
    try { sessionStorage.clear(); } catch { /* ignore */ }
    if (MOCK) { location.href = link('mobile.html'); return; }
    await api.signOut();
    location.reload();
  };
}

function showNoAccess(msg) {
  $('app').classList.add('hidden');
  $('loginPage').classList.add('hidden');
  const el = $('noAccess');
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="noaccess">
      <h2>เข้าใช้ PQA Asset Mgmt ไม่ได้</h2>
      <p class="muted">${esc(msg || 'บัญชีนี้ยังไม่อยู่ในรายชื่อผู้ใช้ของ Resource Mgmt หรือถูกปิดใช้งานอยู่ — ให้ admin ของ Resource Mgmt เพิ่ม / เปิดบัญชีที่หน้า Admin ของ RM')}</p>
      <div class="btn-row" style="justify-content:center">
        <a class="btn" href="${RM_HOME}">ไป Resource Mgmt</a>
        ${MOCK ? '' : '<button class="btn" id="naLogout" type="button">ออกจากระบบ</button>'}
      </div>
    </div>`;
  const b = $('naLogout');
  if (b) b.onclick = async () => { await api.signOut(); location.reload(); };
}

function showLogin(onDone) {
  const el = $('loginPage');
  el.classList.remove('hidden');
  let mode = EMAIL_OTP ? 'otp' : 'pw';
  let otpEmail = '';
  const render = () => {
    el.innerHTML = `
      <div class="login-card">
        <h1>PQA Asset Mgmt</h1>
        <p class="sub">ทะเบียนเครื่องและมือถือของทีม PQA</p>
        ${EMAIL_OTP ? `<div class="login-tabs" role="tablist">
          <button type="button" data-mode="otp" class="${mode === 'otp' ? 'on' : ''}">รหัสทางอีเมล</button>
          <button type="button" data-mode="pw" class="${mode === 'pw' ? 'on' : ''}">รหัสผ่าน</button>
        </div>` : '<p class="hint">ใช้อีเมลและรหัสผ่านเดียวกับ Resource Mgmt</p>'}
        <form id="loginForm" autocomplete="on" novalidate>
          ${mode === 'pw' ? `
            <label for="lgEmail">อีเมล</label>
            <input id="lgEmail" type="email" required autocomplete="email" placeholder="you@infinitaskt.com">
            <label for="lgPw">รหัสผ่าน</label>
            <input id="lgPw" type="password" required autocomplete="current-password">
            <button class="btn-primary" type="submit" id="lgBtn">เข้าสู่ระบบ</button>`
          : !otpEmail ? `
            <label for="lgEmail">อีเมล</label>
            <input id="lgEmail" type="email" required autocomplete="email" placeholder="you@infinitaskt.com">
            <p class="hint">ระบบจะส่งรหัส 6 หลักไปที่อีเมลนี้ (ใช้บัญชีเดียวกับ Resource Mgmt)</p>
            <button class="btn-primary" type="submit" id="lgBtn">ส่งรหัส</button>`
          : `
            <label for="lgCode">รหัส 6 หลักที่ส่งไปที่ ${esc(otpEmail)}</label>
            <input id="lgCode" class="otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>
            <button class="btn-primary" type="submit" id="lgBtn">ยืนยัน</button>
            <button class="link-btn" type="button" id="lgBack">เปลี่ยนอีเมล / ขอรหัสใหม่</button>`}
          <div class="login-err" id="lgErr" role="alert"></div>
        </form>
      </div>`;
    el.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; otpEmail = ''; render(); });
    const back = $('lgBack');
    if (back) back.onclick = () => { otpEmail = ''; render(); };
    const code = $('lgCode');
    if (code) { code.oninput = () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); }; code.focus(); }
    else $('lgEmail')?.focus();
    $('loginForm').onsubmit = async ev => {
      ev.preventDefault();
      const btn = $('lgBtn'), err = $('lgErr');
      err.textContent = '';
      btn.disabled = true;
      try {
        if (mode === 'pw') {
          const { error } = await sb.auth.signInWithPassword({ email: $('lgEmail').value.trim(), password: $('lgPw').value });
          if (error) throw new Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
          await api.logLogin('PASSWORD');
          return onDone();
        }
        if (!otpEmail) {
          const email = $('lgEmail').value.trim().toLowerCase();
          if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('กรอกอีเมลให้ถูกต้อง');
          const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
          // ไม่บอกว่าอีเมลมีในระบบหรือไม่ (กัน enumeration แบบ requestOtp เดิม) ยกเว้นโดน rate limit
          if (error && /rate|seconds/i.test(error.message)) throw new Error('ขอรหัสถี่เกินไป รอสักครู่แล้วลองใหม่');
          otpEmail = email;
          return render();
        }
        const token = $('lgCode').value.trim();
        if (token.length !== 6) throw new Error('กรอกรหัส 6 หลัก');
        const { error } = await sb.auth.verifyOtp({ email: otpEmail, token, type: 'email' });
        if (error) throw new Error('รหัสไม่ถูกต้องหรือหมดอายุ');
        await api.logLogin('OTP');
        onDone();
      } catch (e) {
        err.textContent = errMsg(e);
      } finally {
        if (document.body.contains(btn)) btn.disabled = false;
      }
    };
  };
  render();
}

/* =====================================================================
   DIALOG / CONFIRM
   ===================================================================== */
let openLayers = 0;
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  const top = [...document.querySelectorAll('[data-layer]')].pop();
  if (top && top._escClose) { ev.preventDefault(); top._escClose(); }
});

/** กล่องยืนยัน (แทน confirm()) → Promise<boolean> */
export function confirmBox(msg, { okText = 'ยืนยัน', danger = false, title = 'ยืนยัน' } = {}) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.dataset.layer = '1';
    ov.style.zIndex = 80 + (++openLayers);
    ov.innerHTML = `
      <div class="modal modal-sm" role="alertdialog" aria-modal="true">
        <div class="modal-head"><h3>${esc(title)}</h3></div>
        <div class="modal-body"><p style="margin:0">${msg}</p></div>
        <div class="modal-foot">
          <button class="btn" type="button" data-a="no">ยกเลิก</button>
          <button class="btn ${danger ? 'danger' : 'accent'}" type="button" data-a="yes">${esc(okText)}</button>
        </div>
      </div>`;
    const done = v => { ov.remove(); openLayers--; resolve(v); };
    ov._escClose = () => done(false);
    ov.addEventListener('click', ev => {
      if (ev.target === ov) return done(false);
      const a = ev.target.closest('[data-a]')?.dataset.a;
      if (a) done(a === 'yes');
    });
    document.body.appendChild(ov);
    ov.querySelector('[data-a="yes"]').focus();
  });
}

/**
 * dialog ฟอร์ม — onOk(root) คืน false = ยังไม่ปิด / throw = แสดง error ใน dialog
 * ปิดตอนมีข้อมูลที่แก้แล้วยังไม่บันทึก → ถามยืนยันก่อน (เหมือน _modalDirty ของแอปเดิม)
 */
export function openDialog({ title, body, okText = 'บันทึก', okClass = 'accent', size = 'modal-sm', onOk, onMount, guardDirty = true }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.dataset.layer = '1';
  ov.style.zIndex = 60 + (++openLayers);
  ov.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="x" type="button" data-a="close" aria-label="ปิด">×</button></div>
      <form class="dlg-form" novalidate>
        <div class="modal-body"><div class="form-err hidden" data-err role="alert"></div>${body}</div>
        <div class="modal-foot">
          <button class="btn" type="button" data-a="close">ยกเลิก</button>
          ${onOk ? `<button class="btn ${okClass}" type="submit" data-a="ok">${esc(okText)}</button>` : ''}
        </div>
      </form>
    </div>`;
  let dirty = false, closed = false;
  const root = ov.querySelector('.modal');
  const errEl = ov.querySelector('[data-err]');
  const api_ = {
    root,
    setErr(msg) { errEl.textContent = msg || ''; errEl.classList.toggle('hidden', !msg); if (msg) errEl.scrollIntoView({ block: 'nearest' }); },
    close() { if (closed) return; closed = true; ov.remove(); openLayers--; },
    markDirty() { dirty = true; },
  };
  const tryClose = async () => {
    if (guardDirty && dirty && !(await confirmBox('ข้อมูลที่แก้ไว้ยังไม่ถูกบันทึก ยืนยันการปิดหรือไม่?', { okText: 'ปิดโดยไม่บันทึก', danger: true }))) return;
    api_.close();
  };
  ov._escClose = tryClose;
  ov.addEventListener('input', () => { dirty = true; });
  ov.addEventListener('change', () => { dirty = true; });
  ov.addEventListener('click', ev => { if (ev.target.closest('[data-a="close"]')) tryClose(); });
  ov.addEventListener('mousedown', ev => { if (ev.target === ov) ov._downOnOverlay = true; });
  ov.addEventListener('mouseup', ev => { if (ev.target === ov && ov._downOnOverlay) tryClose(); ov._downOnOverlay = false; });
  ov.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!onOk) return;
    const btn = ov.querySelector('[data-a="ok"]');
    btn.disabled = true;
    api_.setErr('');
    try {
      const r = await onOk(root, api_);
      if (r !== false) api_.close();
    } catch (e) {
      api_.setErr(errMsg(e));
    } finally {
      btn.disabled = false;
    }
  });
  document.body.appendChild(ov);
  if (onMount) onMount(root, api_);
  const first = root.querySelector('.modal-body input:not([disabled]):not([type=hidden]), .modal-body select:not([disabled]), .modal-body textarea');
  if (first) first.focus();
  return api_;
}

/* =====================================================================
   FORM PRIMITIVES
   ===================================================================== */

/** ช่องวันที่ dd/mm/yyyy + ปุ่มปฏิทิน (ห้ามใช้ input type=date ตรงๆ ตามกติกาเดิมของแอป) */
export function dateFieldHTML(id, iso, { max = todayISO() } = {}) {
  return `<span class="date-wrap">
    <input type="text" id="${id}" value="${iso ? dDisp(iso) : ''}" placeholder="dd/mm/yyyy" inputmode="numeric" autocomplete="off">
    <button type="button" class="cal-btn" data-cal="${id}" aria-label="เลือกวันที่">📅</button>
    <input type="date" tabindex="-1" aria-hidden="true" data-native="${id}" ${max ? `max="${max}"` : ''}>
  </span>`;
}
export function wireDateFields(root) {
  root.querySelectorAll('[data-cal]').forEach(btn => {
    const input = root.querySelector('#' + btn.dataset.cal);
    const native = root.querySelector(`[data-native="${btn.dataset.cal}"]`);
    btn.onclick = () => {
      native.value = parseDateInput(input.value) || '';
      try { native.showPicker(); } catch { native.focus(); }
    };
    native.onchange = () => {
      input.value = dDisp(native.value);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
  });
}
export function readDate(root, id, label, { required = false } = {}) {
  const raw = root.querySelector('#' + id).value.trim();
  if (!raw) { if (required) throw new Error(`กรอก${label}`); return null; }
  const iso = parseDateInput(raw);
  if (!iso) throw new Error(`${label} ไม่ถูกต้อง (ใช้ dd/mm/yyyy)`);
  return iso;
}

/**
 * ตัวเลือกคน (PQA Lead + Outsource จาก v_person) — พิมพ์ค้นหาชื่อเล่น / ชื่อเต็ม / Emp ID
 * แทนการพิมพ์ Emp ID แล้วกด Verify แบบเดิม
 */
export function personPicker(el, { people, value = null, types = null, exclude = [], placeholder = 'พิมพ์ชื่อเล่น ชื่อ หรือ Emp ID', onChange } = {}) {
  let picked = value;
  const pool = () => people.filter(p => (!types || types.includes(p.resource_type)) && !exclude.includes(p.resource_id));
  const render = () => {
    const p = people.find(x => x.resource_id === picked);
    if (p) {
      el.innerHTML = `<div class="picked"><span><b>${esc(p.display_name)}</b> ${personTypePill(p.resource_type)}
        ${p.pqa_emp_id ? `<small class="muted">${esc(p.pqa_emp_id)}</small>` : ''}</span>
        <button type="button" class="link" data-clear>เปลี่ยน</button></div>`;
      el.querySelector('[data-clear]').onclick = () => { picked = null; render(); onChange?.(null); el.querySelector('input')?.focus(); };
      return;
    }
    el.innerHTML = `<input type="text" placeholder="${esc(placeholder)}" aria-label="${esc(el.dataset.label || 'เลือกคน')}" autocomplete="off" role="combobox" aria-expanded="false">
      <div class="picker-list hidden" role="listbox"></div>`;
    const input = el.querySelector('input'), list = el.querySelector('.picker-list');
    let hi = 0, items = [];
    const show = () => {
      const q = input.value.trim().toLowerCase();
      items = pool().filter(p => !q || [p.display_name, p.nickname, p.full_name_en, p.pqa_emp_id, p.company]
        .some(v => String(v || '').toLowerCase().includes(q))).slice(0, 30);
      hi = 0;
      list.innerHTML = items.length
        ? items.map((p, i) => `<div class="picker-opt ${i === hi ? 'hi' : ''}" data-i="${i}" role="option">
            <span>${esc(p.display_name)} ${p.pqa_emp_id ? `<small>${esc(p.pqa_emp_id)}</small>` : ''}</span>${personTypePill(p.resource_type)}</div>`).join('')
        : '<div class="picker-empty">ไม่พบรายชื่อ (ต้องมีใน Resource Mgmt และยัง active)</div>';
      list.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
    };
    const choose = i => { if (!items[i]) return; picked = items[i].resource_id; render(); onChange?.(picked); el.dispatchEvent(new Event('input', { bubbles: true })); };
    input.onfocus = show;
    input.oninput = show;
    input.onkeydown = ev => {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        hi = Math.max(0, Math.min(items.length - 1, hi + (ev.key === 'ArrowDown' ? 1 : -1)));
        list.querySelectorAll('.picker-opt').forEach((o, i) => o.classList.toggle('hi', i === hi));
      } else if (ev.key === 'Enter') { ev.preventDefault(); choose(hi); }
    };
    list.onmousedown = ev => { const o = ev.target.closest('[data-i]'); if (o) { ev.preventDefault(); choose(+o.dataset.i); } };
    input.onblur = () => setTimeout(() => { list.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); }, 120);
  };
  render();
  return { get: () => picked, set: v => { picked = v; render(); } };
}

/**
 * ตัวเลือกรุ่น (device_model) — ค้นหา Brand / Model / เพิ่มรุ่นใหม่ได้ (member เพิ่มได้, แก้ได้เฉพาะ admin)
 */
export function modelPicker(el, { typeCodes = null, value = null, onChange } = {}) {
  let picked = value;
  const pool = () => store.models.filter(m => m.is_active !== false && (!typeCodes || typeCodes.includes(m.type_code)));
  const render = () => {
    const m = store.models.find(x => x.model_id === picked);
    if (m) {
      el.innerHTML = `<div class="picked"><span><b>${esc(m.brand)} ${esc(m.model_name)}</b>
        <small class="muted">${esc(m.platform_name || m.type_name || '')}</small></span>
        <button type="button" class="link" data-clear>เปลี่ยน</button></div>`;
      el.querySelector('[data-clear]').onclick = () => { picked = null; render(); onChange?.(null); el.querySelector('input')?.focus(); };
      return;
    }
    el.innerHTML = `<input type="text" placeholder="พิมพ์ยี่ห้อหรือรุ่น เช่น iPhone 13" aria-label="เลือกรุ่นเครื่อง" autocomplete="off">
      <div class="picker-list hidden"></div><div data-new></div>`;
    const input = el.querySelector('input'), list = el.querySelector('.picker-list');
    let items = [];
    const show = () => {
      const q = input.value.trim().toLowerCase();
      items = pool().filter(m => !q || `${m.brand} ${m.model_name}`.toLowerCase().includes(q)).slice(0, 30);
      list.innerHTML = items.map((m, i) => `<div class="picker-opt" data-i="${i}"><span>${esc(m.brand)} ${esc(m.model_name)}</span>
          <small>${esc(m.platform_name || m.type_name || '')}</small></div>`).join('')
        + `<div class="picker-opt picker-add" data-new-opt>+ เพิ่มรุ่นใหม่${q ? ` "${esc(input.value.trim())}"` : ''}</div>`;
      list.classList.remove('hidden');
    };
    input.onfocus = show;
    input.oninput = show;
    input.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); if (items[0]) choose(0); } };
    const choose = i => { picked = items[i].model_id; render(); onChange?.(picked); el.dispatchEvent(new Event('input', { bubbles: true })); };
    list.onmousedown = ev => {
      const o = ev.target.closest('[data-i]');
      if (o) { ev.preventDefault(); return choose(+o.dataset.i); }
      if (ev.target.closest('[data-new-opt]')) { ev.preventDefault(); list.classList.add('hidden'); newForm(input.value.trim()); }
    };
    input.onblur = () => setTimeout(() => list.classList.add('hidden'), 120);

    const newForm = guess => {
      const types = store.types.filter(t => t.is_active !== false && (!typeCodes || typeCodes.includes(t.type_code)));
      const [b, ...rest] = guess.split(/\s+/);
      const box = el.querySelector('[data-new]');
      box.innerHTML = `<div class="inline-box">
        <div class="grid2">
          <div class="field"><label>ยี่ห้อ<span class="req">*</span></label><input data-f="brand" value="${esc(rest.length ? b : '')}" placeholder="Apple"></div>
          <div class="field"><label>ชื่อรุ่น<span class="req">*</span></label><input data-f="model" value="${esc(rest.length ? rest.join(' ') : guess)}" placeholder="iPhone 13"></div>
        </div>
        <div class="grid2">
          <div class="field" ${types.length === 1 ? 'hidden' : ''}><label>ประเภท</label>
            <select data-f="type">${types.map(t => `<option value="${esc(t.type_code)}">${esc(t.type_name)}</option>`).join('')}</select></div>
          <div class="field" data-plat><label>Platform<span class="req">*</span></label>
            <select data-f="plat"><option value="">— เลือก —</option>${store.platforms.filter(p => p.is_active !== false)
              .map(p => `<option value="${esc(p.platform_code)}">${esc(p.platform_name)}</option>`).join('')}</select></div>
        </div>
        <div class="btn-row"><button type="button" class="btn sm accent" data-save>เพิ่มรุ่นนี้</button>
          <button type="button" class="btn sm" data-cancel>ยกเลิก</button><span class="muted" data-msg></span></div>
      </div>`;
      const f = k => box.querySelector(`[data-f="${k}"]`);
      const syncPlat = () => {
        const t = store.types.find(x => x.type_code === f('type').value);
        box.querySelector('[data-plat]').hidden = !t?.is_mobile;
      };
      f('type').onchange = syncPlat;
      syncPlat();
      box.querySelector('[data-cancel]').onclick = () => { box.innerHTML = ''; };
      box.querySelector('[data-save]').onclick = async () => {
        const t = store.types.find(x => x.type_code === f('type').value);
        const row = { type_code: f('type').value, brand: f('brand').value.trim().replace(/\s+/g, ' '),
                      model_name: f('model').value.trim().replace(/\s+/g, ' '),
                      platform_code: t?.is_mobile ? (f('plat').value || null) : null };
        const msg = box.querySelector('[data-msg]');
        if (!row.brand || !row.model_name) { msg.textContent = 'กรอกยี่ห้อและชื่อรุ่น'; return; }
        if (t?.is_mobile && !row.platform_code) { msg.textContent = 'เลือก Platform'; return; }
        const dup = store.models.find(m => m.brand.toLowerCase() === row.brand.toLowerCase() && m.model_name.toLowerCase() === row.model_name.toLowerCase());
        if (dup) { picked = dup.model_id; render(); onChange?.(picked); return; }
        try {
          const m = await api.addModel(row);
          const pl = store.platforms.find(p => p.platform_code === m.platform_code);
          store.models.push({ ...m, type_name: t?.type_name, platform_name: pl?.platform_name, device_count: 0, active_count: 0 });
          picked = m.model_id; render(); onChange?.(picked);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          toast(`เพิ่มรุ่น ${row.brand} ${row.model_name} แล้ว`);
        } catch (e) { msg.textContent = errMsg(e); }
      };
    };
  };
  render();
  return { get: () => picked, set: v => { picked = v; render(); } };
}

/** chip ที่กดแล้วเปิดรายการ checkbox (multi-select) */
export function multiChip(el, { label, options, selected = [], onChange }) {
  let sel = new Set(selected);
  const paint = () => {
    const n = sel.size;
    el.classList.toggle('on', n > 0);
    el.innerHTML = `${esc(label)}${n ? `: ${esc(n <= 2 ? [...sel].map(v => options.find(o => o.value === v)?.label ?? v).join(', ') : n + ' ค่า')}` : ''}<span class="caret">▾</span>`;
  };
  el.type = 'button';
  el.onclick = ev => {
    if (ev.target.closest('.chip-pop')) return;
    document.querySelectorAll('.chip-pop').forEach(p => p.remove());
    const pop = document.createElement('div');
    pop.className = 'chip-pop';
    pop.innerHTML = (options.length ? options.map(o => `<label><input type="checkbox" value="${esc(o.value)}" ${sel.has(o.value) ? 'checked' : ''}>
        ${esc(o.label)} ${o.count != null ? `<span class="muted">(${o.count})</span>` : ''}</label>`).join('') : '<div class="muted">ไม่มีตัวเลือก</div>')
      + '<div class="pop-foot"><button type="button" class="link" data-clr>ล้าง</button><button type="button" class="link" data-done>เสร็จ</button></div>';
    el.appendChild(pop);
    pop.onchange = () => { sel = new Set([...pop.querySelectorAll('input:checked')].map(i => i.value)); paint(); el.appendChild(pop); onChange([...sel]); };
    pop.querySelector('[data-clr]').onclick = () => { sel.clear(); pop.querySelectorAll('input').forEach(i => { i.checked = false; }); paint(); el.appendChild(pop); onChange([]); };
    pop.querySelector('[data-done]').onclick = () => pop.remove();
  };
  paint();
  return { set(v) { sel = new Set(v); paint(); }, get: () => [...sel] };
}
document.addEventListener('click', ev => {
  if (!ev.target.closest('.chip')) document.querySelectorAll('.chip-pop').forEach(p => p.remove());
});

/* =====================================================================
   DRAWER — รายละเอียดเครื่อง
   ===================================================================== */
/**
 * @param host       element ที่ใส่ drawer
 * @param layoutEl   element ที่ toggle class with-drawer
 * @param onChanged  เรียกหลังบันทึก (หน้าเป็นคน reload store + render ตาราง แล้วเรียก drawer.refresh())
 * @param canAssign  (device) => boolean — แสดงส่วนผู้ถือ / ปุ่มส่งต่อไหม
 */
export function createDrawer(host, { layoutEl, onChanged, canAssign = () => true, onClose }) {
  let cur = null, tab = 'info';
  const close = () => { cur = null; host.innerHTML = ''; host.hidden = true; layoutEl.classList.remove('with-drawer'); onClose?.(); };
  host.dataset.layer = '';
  host._escClose = close;

  const changed = async (msg) => { toast(msg); await onChanged(); };

  function infoHTML(d) {
    const team = d.ownership === 'team';
    let holder = '';
    if (canAssign(d)) {
      const ownerWord = team ? 'ผู้ถือปัจจุบัน' : 'เจ้าของเครื่อง';
      if (d.holder_resource_id) {
        holder = `<div class="holder-card">
          <span class="lbl">${ownerWord}</span>
          <span class="nm">${esc(d.holder_name)}</span>
          <span class="muted">${d.holder_type === 'outsource' ? 'Outsource' : 'PQA'}${d.holder_company ? ' · ' + esc(d.holder_company) : ''} · ตั้งแต่ ${dDisp(d.holder_since)} (${heldText(d)})</span>
          ${d.holder_note ? `<span>${esc(d.holder_note)}</span>` : ''}
          ${d.status === 'active' ? `<div class="row"><button type="button" class="btn sm accent" data-act="assign">${team ? 'ส่งต่อเครื่อง' : 'เปลี่ยนเจ้าของ'}</button>
            ${team ? '<button type="button" class="btn sm" data-act="return">คืนเข้าคลัง</button>' : ''}</div>` : ''}
        </div>`;
      } else if (d.status === 'active') {
        holder = `<div class="holder-card free"><span class="lbl">ว่าง</span><span>เครื่องอยู่ในคลัง พร้อมให้ยืม</span>
          <div class="row"><button type="button" class="btn sm accent" data-act="assign">ให้ยืม / ส่งต่อ</button></div></div>`;
      }
    }
    const st = d.status !== 'active'
      ? `<div class="holder-card" style="border-color:var(--as-bad);background:var(--as-bad-d)"><span class="lbl" style="color:var(--as-bad)">${esc(STATUS_LABEL[d.status])}</span>
          <span>${d.status === 'retired' ? `ปลดระวางเมื่อ ${dDisp(d.retired_date)}` : d.status === 'repair' ? 'อยู่ระหว่างส่งซ่อม ส่งต่อให้คนอื่นไม่ได้จนกว่าจะกลับมาใช้งาน' : 'แจ้งหายแล้ว'}</span></div>` : '';
    const rows = [
      ['ประเภท', `${esc(d.type_name)} ${ownershipPill(d.ownership)}`],
      ['รุ่น', esc(modelText(d))],
      d.is_mobile ? ['Platform', esc(d.platform_name || '-')] : null,
      ['OS Version', esc(d.os_version || '-')],
      team ? ['Internal ID', `<span class="iid">${esc(d.internal_id || '-')}</span>`] : null,
      team ? ['Asset Tag', `<span class="iid">${esc(d.asset_tag || '-')}</span>${d.asset_year ? ` <span class="muted">ปี ${esc(d.asset_year)}</span>` : ''}`] : null,
      ['Serial Number', `<span class="iid">${esc(d.serial_number || '-')}</span>`],
      team ? ['รับเข้าทีม', `${esc(d.received_by_name || '-')}${d.received_date ? ` · ${dDisp(d.received_date)}` : ''}`] : null,
      ['Note', esc(d.note || '-')],
    ].filter(Boolean);
    const actions = {
      active: [['repair', 'ส่งซ่อม'], ['lost', 'แจ้งหาย'], ['retired', 'ปลดระวาง']],
      repair: [['active', 'กลับมาใช้งาน'], ['lost', 'แจ้งหาย'], ['retired', 'ปลดระวาง']],
      lost: [['active', 'เจอแล้ว กลับมาใช้งาน'], ['retired', 'ปลดระวาง']],
      retired: [['active', 'กลับมาใช้งาน']],
    }[d.status] || [];
    return `${st}${holder}
      <dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <div class="btn-row"><button type="button" class="btn sm" data-act="edit">แก้ไขข้อมูล</button></div>
      <div class="danger-zone"><span class="sub-title">สถานะเครื่อง</span>
        <div class="btn-row">${actions.map(([s, l]) => `<button type="button" class="btn sm ${s === 'lost' || s === 'retired' ? 'danger' : ''}" data-status="${s}">${l}</button>`).join('')}</div></div>`;
  }

  async function historyHTML(d) {
    const rows = await api.history(d.device_id);
    if (!rows.length) return '<div class="muted">ยังไม่มีประวัติผู้ถือ</div>';
    return `<div class="tl">${rows.map(h => `<div class="tl-i ${h.is_current ? 'now' : ''}"><span class="tl-dot"></span><div>
      <b>${esc(h.holder_name)}</b> ${personTypePill(h.holder_type)}
      <small>${dDisp(h.start_date)} – ${h.end_date ? dDisp(h.end_date) : 'ปัจจุบัน'} · ${h.held_days} วัน</small>
      ${h.note ? `<small>${esc(h.note)}</small>` : ''}</div></div>`).join('')}</div>
      <p class="muted" style="font-size:12px;margin:0">ประวัติเริ่มนับตั้งแต่ย้ายขึ้นระบบใหม่</p>`;
  }

  async function osHTML(d) {
    const rows = await api.osLog(d.device_id);
    if (!rows.length) return '<div class="muted">ยังไม่มีประวัติ OS</div>';
    return `<div class="tl">${rows.map((r, i) => `<div class="tl-i ${i === 0 ? 'now' : ''}"><span class="tl-dot"></span><div>
      <b>${esc(r.os_version)}</b><small>${dDisp(String(r.changed_at).slice(0, 10))}</small></div></div>`).join('')}</div>`;
  }

  async function render() {
    if (!cur) return;
    const d = cur;
    host.hidden = false;
    layoutEl.classList.add('with-drawer');
    host.innerHTML = `<aside class="drawer" aria-label="รายละเอียดเครื่อง">
      <div class="drawer-head"><span class="t">${esc(deviceTitle(d))}</span>
        <span class="s">${esc([d.type_name, d.platform_name, d.os_version].filter(Boolean).join(' · '))} ${statusPill(d.status)}</span>
        <button type="button" class="x" data-close aria-label="ปิด">×</button></div>
      <div class="tabs" role="tablist">
        <button type="button" data-tab="info" class="${tab === 'info' ? 'on' : ''}">ภาพรวม</button>
        <button type="button" data-tab="hist" class="${tab === 'hist' ? 'on' : ''}">${d.ownership === 'team' ? 'ประวัติผู้ถือ' : 'ประวัติเจ้าของ'}</button>
        ${d.is_mobile ? `<button type="button" data-tab="os" class="${tab === 'os' ? 'on' : ''}">ประวัติ OS</button>` : ''}
      </div>
      <div class="drawer-body">${tab === 'info' ? infoHTML(d) : '<div class="muted">กำลังโหลด…</div>'}</div>
    </aside>`;
    host.querySelector('[data-close]').onclick = close;
    host.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
    const body = host.querySelector('.drawer-body');
    if (tab !== 'info') {
      try { body.innerHTML = tab === 'hist' ? await historyHTML(d) : await osHTML(d); }
      catch (e) { body.innerHTML = `<div class="muted">โหลดไม่สำเร็จ: ${esc(errMsg(e))}</div>`; }
      return;
    }
    body.querySelector('[data-act="assign"]')?.addEventListener('click', () => assignDialog(d, changed));
    body.querySelector('[data-act="return"]')?.addEventListener('click', () => returnDialog(d, changed));
    body.querySelector('[data-act="edit"]').addEventListener('click', () => deviceDialog(d, { onSaved: changed }));
    body.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => statusDialog(d, b.dataset.status, changed)));
  }

  return {
    open(d) { if (!cur || cur.device_id !== d.device_id) tab = 'info'; cur = d; render(); },
    close,
    current: () => cur,
    refresh() { if (!cur) return; const d = deviceById(cur.device_id); if (!d) return close(); cur = d; render(); },
  };
}

/* =====================================================================
   DIALOGS — ส่งต่อ / คืน / สถานะ / ลงทะเบียน-แก้ไข
   ===================================================================== */
export function assignDialog(d, onDone) {
  const team = d.ownership === 'team';
  const types = d.ownership === 'personal' ? ['insource'] : d.ownership === 'outsource' ? ['outsource'] : null;
  let picker;
  const title = team ? (d.holder_resource_id ? `ส่งต่อ ${deviceTitle(d)}` : `ให้ยืม ${deviceTitle(d)}`) : `เปลี่ยนเจ้าของ ${modelText(d)}`;
  openDialog({
    title,
    okText: team ? 'ยืนยันส่งต่อ' : 'ยืนยัน',
    body: `
      <div class="field"><label>${team ? 'ผู้ถือคนใหม่' : 'เจ้าของคนใหม่'}<span class="req">*</span></label><div class="picker" data-person></div></div>
      <div class="field"><label for="asDate">วันที่${team ? 'ส่งต่อ' : 'เปลี่ยน'}<span class="req">*</span></label>${dateFieldHTML('asDate', todayISO())}</div>
      <div class="field"><label for="asNote">Note</label><input id="asNote" placeholder="เช่น ใช้เทส UAT PaoTang"></div>
      <div class="preview" data-preview></div>`,
    onMount(root) {
      wireDateFields(root);
      const prev = root.querySelector('[data-preview]');
      const upd = () => {
        const p = store.people.find(x => x.resource_id === picker?.get());
        const date = parseDateInput(root.querySelector('#asDate').value);
        const lines = [];
        if (d.holder_resource_id) lines.push(`• ปิดช่วงของ <b>${esc(d.holder_name)}</b> วันที่ ${date ? dDisp(date) : '-'}${date ? ` (ถือ ${daysBetween(d.holder_since, date)} วัน)` : ''}`);
        if (p) lines.push(`• เริ่มช่วงใหม่ของ <b>${esc(p.display_name)}</b> วันที่ ${date ? dDisp(date) : '-'}`);
        prev.innerHTML = lines.map(l => `<div>${l}</div>`).join('') || 'เลือกผู้ถือคนใหม่';
      };
      picker = personPicker(root.querySelector('[data-person]'), { people: store.people, types, exclude: [d.holder_resource_id], onChange: upd });
      root.querySelector('#asDate').addEventListener('input', upd);
      root.querySelector('#asDate').addEventListener('change', upd);
      upd();
    },
    async onOk(root) {
      const rid = picker.get();
      if (!rid) throw new Error(team ? 'เลือกผู้ถือคนใหม่' : 'เลือกเจ้าของคนใหม่');
      const date = readDate(root, 'asDate', 'วันที่', { required: true });
      await api.assign(d.device_id, rid, date, root.querySelector('#asNote').value.trim());
      await onDone('บันทึกการส่งต่อแล้ว');
    },
  });
}

export function returnDialog(d, onDone) {
  openDialog({
    title: `คืน ${deviceTitle(d)} เข้าคลัง`,
    okText: 'ยืนยันคืนเข้าคลัง',
    guardDirty: false,
    body: `<div class="field"><label for="rtDate">วันที่คืน<span class="req">*</span></label>${dateFieldHTML('rtDate', todayISO())}</div>
      <div class="preview">ปิดช่วงถือครองของ <b>${esc(d.holder_name)}</b> เครื่องจะกลับเป็น "ว่าง" ในคลัง</div>`,
    onMount: root => wireDateFields(root),
    async onOk(root) {
      await api.assign(d.device_id, null, readDate(root, 'rtDate', 'วันที่คืน', { required: true }), null);
      await onDone('คืนเครื่องเข้าคลังแล้ว');
    },
  });
}

export function statusDialog(d, status, onDone) {
  const closes = (status === 'lost' || status === 'retired') && d.holder_resource_id;
  const needsDate = status === 'lost' || status === 'retired';
  openDialog({
    title: `${STATUS_LABEL[status]}: ${deviceTitle(d)}`,
    okText: { active: 'กลับมาใช้งาน', repair: 'ยืนยันส่งซ่อม', lost: 'ยืนยันแจ้งหาย', retired: 'ยืนยันปลดระวาง' }[status],
    okClass: needsDate ? 'danger' : 'accent',
    guardDirty: false,
    body: `${needsDate ? `<div class="field"><label for="stDate">วันที่<span class="req">*</span></label>${dateFieldHTML('stDate', todayISO())}</div>` : ''}
      <div class="preview">${{
        active: 'เครื่องจะกลับมาอยู่ในสถานะใช้งาน ให้ยืม / ส่งต่อได้ตามปกติ',
        repair: 'ผู้ถือคงเดิม แต่ส่งต่อให้คนอื่นไม่ได้จนกว่าจะกลับมาใช้งาน',
        lost: 'เครื่องจะไม่แสดงในรายการปกติ',
        retired: 'เครื่องจะไม่แสดงในรายการปกติ (ดูได้จากตัวกรอง "รวมที่ปิดใช้งาน")',
      }[status]}${closes ? `<br>ช่วงถือครองของ <b>${esc(d.holder_name)}</b> จะถูกปิดให้อัตโนมัติ` : ''}</div>`,
    onMount: root => wireDateFields(root),
    async onOk(root) {
      const date = needsDate ? readDate(root, 'stDate', 'วันที่', { required: true }) : todayISO();
      await api.setStatus(d.device_id, status, date);
      await onDone(`เปลี่ยนสถานะเป็น "${STATUS_LABEL[status]}" แล้ว`);
    },
  });
}

/**
 * ลงทะเบียน / แก้ไขเครื่อง
 * @param d          null = เพิ่มใหม่
 * @param kind       ตอนเพิ่ม: 'team' (หน้าอุปกรณ์ทีม) | 'byod' (มือถือ personal / outsource หน้า Mobile)
 */
export function deviceDialog(d, { kind = d ? (d.ownership === 'team' ? 'team' : 'byod') : 'team', onSaved, presetType } = {}) {
  const isNew = !d;
  const team = kind === 'team';
  let ownership = d?.ownership || (team ? 'team' : 'personal');
  let typeCode = d?.type_code || presetType || (team ? (store.types[0]?.type_code) : 'MOBILE');
  let mp, recvPicker, ownerPicker;
  const isMobileType = tc => !!store.types.find(t => t.type_code === tc)?.is_mobile;
  const mobileTypes = store.types.filter(t => t.is_mobile).map(t => t.type_code);
  const recvPerson = d?.received_by_emp_id ? store.people.find(p => p.pqa_emp_id === d.received_by_emp_id) : null;

  const title = isNew ? (team ? 'เพิ่มเครื่องทีม' : 'ลงทะเบียนมือถือ Personal / Outsource') : `แก้ไข ${deviceTitle(d)}`;
  const body = `
    ${!team ? `<div class="field"><label>ประเภทการถือครอง</label>
      <div class="seg" data-own>${['personal', 'outsource'].map(o => `<button type="button" data-v="${o}" class="${ownership === o ? 'on' : ''}">${OWNERSHIP_LABEL[o]}</button>`).join('')}</div>
      ${isNew ? '' : '<div class="help">เปลี่ยนเจ้าของใช้ปุ่ม "เปลี่ยนเจ้าของ" ในหน้ารายละเอียด</div>'}</div>` : ''}
    ${team ? `<div class="field"><label for="dvType">ประเภท<span class="req">*</span></label>
      <select id="dvType" ${isNew ? '' : 'disabled'}>${store.types.filter(t => t.is_active !== false || t.type_code === typeCode)
        .map(t => `<option value="${esc(t.type_code)}" ${t.type_code === typeCode ? 'selected' : ''}>${esc(t.type_name)}</option>`).join('')}</select>
      ${isNew ? '' : '<div class="help">เปลี่ยนประเภทไม่ได้ ถ้าลงผิดให้ปลดระวางแล้วลงใหม่</div>'}</div>` : ''}
    <div class="field"><label>รุ่น<span class="req">*</span></label><div class="picker" data-model></div></div>
    ${team ? `<div class="grid2">
        <div class="field"><label for="dvIid">Internal ID</label><input id="dvIid" value="${esc(d?.internal_id || '')}" placeholder="PQA18"></div>
        <div class="field"><label for="dvTag">Asset Tag<span class="req" data-req-tag>*</span></label><input id="dvTag" value="${esc(d?.asset_tag || '')}" placeholder="N1M810-2407-0018">
          <div class="help" data-year></div></div>
      </div>` : ''}
    <div class="grid2">
      <div class="field"><label for="dvSn">Serial Number${team ? '<span class="req">*</span>' : ''}</label><input id="dvSn" value="${esc(d?.serial_number || '')}"></div>
      <div class="field" data-os-field><label for="dvOs">OS Version<span class="req" data-req-os>*</span></label><input id="dvOs" value="${esc(d?.os_version || '')}" placeholder="17.5.1"></div>
    </div>
    ${team ? `<div class="field"><label>รับเข้าทีมโดย<span class="req">*</span></label><div class="picker" data-recv></div></div>
      <div class="field"><label for="dvRecvDate">วันที่รับเข้าทีม<span class="req">*</span></label>${dateFieldHTML('dvRecvDate', d?.received_date || '')}</div>` : ''}
    ${!team && isNew ? `<div class="field"><label>เจ้าของเครื่อง<span class="req">*</span></label><div class="picker" data-owner></div></div>
      <div class="field"><label for="dvSince">ลงทะเบียนตั้งแต่</label>${dateFieldHTML('dvSince', todayISO())}</div>` : ''}
    <div class="field"><label for="dvNote">Note</label><textarea id="dvNote" rows="2">${esc(d?.note || '')}</textarea></div>`;

  openDialog({
    title, body, size: '',
    okText: isNew ? (team ? 'เพิ่มเครื่อง' : 'ลงทะเบียน') : 'บันทึก',
    onMount(root) {
      wireDateFields(root);
      const syncType = () => {
        const mob = isMobileType(typeCode);
        const tReq = store.types.find(t => t.type_code === typeCode)?.requires_asset_tag;
        const reqTag = root.querySelector('[data-req-tag]');
        if (reqTag) reqTag.hidden = !tReq;
        root.querySelector('[data-req-os]').hidden = !(team && mob);
        root.querySelector('[data-os-field]').hidden = team && !mob && !d?.os_version;
      };
      const mountModel = () => {
        mp = modelPicker(root.querySelector('[data-model]'), { typeCodes: team ? [typeCode] : mobileTypes, value: d?.model_id || null });
      };
      mountModel();
      syncType();
      const typeSel = root.querySelector('#dvType');
      if (typeSel) typeSel.onchange = () => { typeCode = typeSel.value; mountModel(); syncType(); };
      const own = root.querySelector('[data-own]');
      if (own) own.onclick = ev => {
        const b = ev.target.closest('[data-v]'); if (!b) return;
        ownership = b.dataset.v;
        own.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        if (ownerPicker) ownerPicker = personPicker(root.querySelector('[data-owner]'), { people: store.people, types: [ownership === 'personal' ? 'insource' : 'outsource'] });
      };
      if (root.querySelector('[data-recv]')) recvPicker = personPicker(root.querySelector('[data-recv]'), { people: store.people, types: ['insource'], value: recvPerson?.resource_id || null });
      if (root.querySelector('[data-owner]')) ownerPicker = personPicker(root.querySelector('[data-owner]'), { people: store.people, types: ['insource'] });
      const tag = root.querySelector('#dvTag'), yr = root.querySelector('[data-year]');
      if (tag) { const y = () => { const m = tag.value.match(/-(\d{2})\d{2}-/); yr.textContent = m ? `Asset Year: ${m[1]}` : ''; }; tag.oninput = y; y(); }
      if (!isNew && d.received_by_emp_id && !recvPerson && recvPicker) {
        root.querySelector('[data-recv]').insertAdjacentHTML('afterend', `<div class="help">ผู้รับเดิม ${esc(d.received_by_name || d.received_by_emp_id)} ไม่อยู่ในรายชื่อ active แล้ว — ไม่ต้องเลือกใหม่ถ้าไม่ได้แก้</div>`);
      }
    },
    async onOk(root) {
      const v = id => root.querySelector('#' + id)?.value.trim() ?? '';
      const model_id = mp.get();
      if (!model_id) throw new Error('เลือกรุ่นเครื่อง');
      const p = { ownership, model_id, serial_number: v('dvSn'), os_version: v('dvOs'), note: v('dvNote') };
      if (!isNew) p.device_id = d.device_id;
      if (team) {
        Object.assign(p, { internal_id: v('dvIid'), asset_tag: v('dvTag'), received_date: readDate(root, 'dvRecvDate', 'วันที่รับเข้าทีม', { required: true }) });
        const rp = store.people.find(x => x.resource_id === recvPicker.get());
        if (rp) p.received_by_emp_id = rp.pqa_emp_id;
        else if (isNew || !d.received_by_emp_id) throw new Error('เลือกผู้รับเข้าทีม');
        if (!p.serial_number) throw new Error('กรอก Serial Number');
      } else if (isNew) {
        p.holder_resource_id = ownerPicker.get();
        if (!p.holder_resource_id) throw new Error('เลือกเจ้าของเครื่อง');
        p.holder_since = readDate(root, 'dvSince', 'วันที่ลงทะเบียน') || todayISO();
      }
      await api.saveDevice(p);
      await onSaved(isNew ? 'เพิ่มเครื่องแล้ว' : 'บันทึกแล้ว');
    },
  });
}

/* =====================================================================
   ตาราง — ตัวช่วยเรียง
   ===================================================================== */
export function sorter(getters) {
  return (key, dir) => (a, b) => {
    const g = getters[key] || (x => x[key]);
    let x = g(a), y = g(b);
    if (x == null || x === '') return 1;
    if (y == null || y === '') return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y), 'th', { numeric: true, sensitivity: 'base' }) * dir;
  };
}
