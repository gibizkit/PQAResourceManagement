/**
 * common.js — Shared utilities & API client for PQA Resource Management
 *
 * Usage: import { supabase, $, toast, ... } from './common.js';
 *
 * Note: toast() requires a #toast div element in the DOM
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/* ============ SUPABASE CLIENT ============ */
const SUPABASE_URL = 'https://nbjetmnqvvvqtmpuxsrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5iamV0bW5xdnZ2cXRtcHV4c3JuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NzM5ODQsImV4cCI6MjEwMDI0OTk4NH0.5_new20_Vh37uRVLO_dBFmb9m05M_k5pzdvclOV4AjU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'pqa' }
});

/* ============ LOGIN LOG ============ */
export const APP_VERSION = '1.0.0';
const LOGIN_LOGGED_KEY = 'pqa.login_logged.v1';

/**
 * บันทึกการล็อกอินลง pqa.login_log — best-effort, ไม่ block การเข้าแอป
 *
 * ⚠️ เดิมเคยผูกกับ supabase.auth.onAuthStateChange(event === 'SIGNED_IN') ที่ module-level
 * แต่ SIGNED_IN ยิงซ้ำได้หลายรอบต่อการโหลดหน้าเดียว (คอมเมนต์เก่าใน dashboard.html ก็เคย
 * เตือนเรื่องนี้ไว้แล้ว) + ตัวกันซ้ำเดิม (_loginLogged) เป็นแค่ตัวแปรใน memory ที่รีเซ็ตทุกครั้ง
 * ที่โหลดหน้าใหม่ (แอปนี้เป็น multi-page ไม่ใช่ SPA) → ผลคือบันทึกซ้ำเป็นสิบๆ แถวต่อ session จริง
 *
 * ตอนนี้เปลี่ยนมาเรียก logLogin() ตรงๆ จากจุดเดียว คือหลัง signIn() (ด้านล่าง) สำเร็จเท่านั้น
 * — ไม่ผูกกับ onAuthStateChange อีกต่อไป จึงไม่มีทางถูกยิงซ้ำจาก session-restore/token-refresh/
 * cross-tab broadcast กันซ้ำอีกชั้นด้วย sessionStorage (อยู่ข้ามหน้าในแท็บเดียวกัน จนกว่าจะ
 * SIGNED_OUT หรือปิดแท็บ) เผื่อกรณี submit form ซ้ำเร็วๆ
 */
function logLogin(session) {
  if (!session?.user) return;
  try {
    if (sessionStorage.getItem(LOGIN_LOGGED_KEY) === '1') return;
    sessionStorage.setItem(LOGIN_LOGGED_KEY, '1');
  } catch { /* storage ปิด/เต็ม — ยอมเสี่ยงบันทึกซ้ำได้ ดีกว่าบล็อกทั้งฟีเจอร์ */ }
  supabase.from('login_log').insert({
    user_id: session.user.id,
    username: session.user.email,
    auth_type: 'password',
    app_version: APP_VERSION
  }).then(({ error }) => {
    if (error) console.warn('login_log insert failed:', error.message);
  });
}

/* ============ DOM HELPERS ============ */

/**
 * Get element by ID
 */
export const $ = id => document.getElementById(id);

/**
 * Show toast notification at bottom of screen
 * @param {string} msg — message text
 * @param {boolean} isErr — if true, show as error (red background)
 *
 * Requires: <div class="toast" id="toast"></div> in DOM
 */
export function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  setTimeout(() => t.className = 'toast', 2600);
}

/**
 * HTML escape string to prevent XSS
 */
export function esc(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[c]));
}

/* ============ DATE HELPERS ============ */

/**
 * Convert Date object to 'yyyy-MM-dd' string (local time)
 * @param {Date} d
 * @returns {string} 'yyyy-MM-dd'
 */
export function d2s(d) {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Convert 'yyyy-MM-dd' to 'dd/mm/yyyy' (display format)
 * @param {string} s — 'yyyy-MM-dd'
 * @returns {string} 'dd/mm/yyyy'
 */
export function dDisp(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Convert 'yyyy-MM-dd' to 'dd/mm' (short display format)
 * @param {string} s — 'yyyy-MM-dd'
 * @returns {string} 'dd/mm'
 */
export function dDispShort(s) {
  if (!s) return '';
  const [, m, d] = s.split('-');
  return `${d}/${m}`;
}

/**
 * Parse date input (either 'dd/mm/yyyy' or 'yyyy-MM-dd') to 'yyyy-MM-dd'
 * @param {string} s — date string in 'dd/mm/yyyy' or 'yyyy-MM-dd' format
 * @returns {string|null} 'yyyy-MM-dd' or null if invalid
 */
export function parseInputDate(s) {
  if (!s) return null;
  s = s.trim();

  // Try 'yyyy-MM-dd' format
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }

  // Try 'dd/mm/yyyy' format
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/');
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * Calculate MD (Man-Day) value from leave type
 * @param {string} leaveType — 'FullDay', 'Morning', 'Afternoon'
 * @returns {number} 1 for FullDay, 0.5 for Morning/Afternoon, 0 otherwise
 */
export function leaveMD(leaveType) {
  if (leaveType === 'FullDay') return 1;
  if (leaveType === 'Morning' || leaveType === 'Afternoon') return 0.5;
  return 0;
}

/**
 * Leave type abbreviations
 */
export const LEAVE_ABBR = {
  FullDay: 'LF',
  Morning: 'LM',
  Afternoon: 'LA'
};

/**
 * Check if a date is weekend or holiday
 * @param {Date} d — Date object
 * @param {Object} holidays — map { 'yyyy-MM-dd': description }
 * @returns {boolean} true if Sat/Sun or in holidays map
 */
export function isWknd(d, holidays = {}) {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return true;  // Sunday or Saturday
  const dateStr = d2s(d);
  return dateStr in holidays;
}

/**
 * Load holidays from database
 * @returns {Object} map { 'yyyy-MM-dd': description } or empty on error
 */
export async function loadHolidays() {
  const { data, error } = await supabase
    .from('holiday')
    .select('holiday_date,description');

  if (error) {
    console.warn('loadHolidays error:', error);
    return {};
  }

  const map = {};
  (data || []).forEach(row => {
    const dateStr = row.holiday_date; // expected to be 'yyyy-MM-dd' from DB
    const desc = row.description || 'Holiday';
    map[dateStr] = desc;
  });

  return map;
}

/* ============ AUTH HELPERS ============ */

/**
 * Get current auth session
 * @returns {Promise<Object|null>} session object or null
 */
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Get user profile from app_user table
 * @param {Object} session — auth session
 * @returns {Promise<Object>} { displayName, role } with fallbacks
 */
export async function getProfile(session) {
  if (!session) return { displayName: '', role: '' };

  const { data: u } = await supabase
    .from('app_user')
    .select('display_name,app_role')
    .eq('email', session.user.email)
    .maybeSingle();

  if (u) {
    return {
      displayName: u.display_name,
      role: u.app_role
    };
  }

  return {
    displayName: session.user.email,
    role: ''
  };
}

/**
 * Listen to auth state changes
 * @param {Function} callback — called with (session) when auth state changes
 * @returns {Object} subscription object with .unsubscribe() method
 */
export function onAuth(callback) {
  return supabase.auth.onAuthStateChange((_evt, session) => {
    callback(session);
  });
}

/**
 * Sign in with email & password
 * เรียก logLogin() ครั้งเดียวตรงนี้เมื่อสำเร็จเท่านั้น — ทุกหน้าต้องเรียก signIn() ตัวนี้
 * แทนการเรียก supabase.auth.signInWithPassword() ตรงๆ ไม่งั้น login_log จะไม่ถูกบันทึก
 * @param {string} email
 * @param {string} password
 * @returns {Promise<Object>} { error } on failure, { data, error } on success
 */
export async function signIn(email, password) {
  const result = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password
  });
  if (!result.error && result.data?.session) logLogin(result.data.session);
  return result;
}

/**
 * Sign out
 * @returns {Promise<Object>} { error }
 */
export async function signOut() {
  return await supabase.auth.signOut();
}

/* ============ FILTER PREFS (จำ filter ตอนสลับหน้า) ============ */
/*
 * เก็บใน sessionStorage → สลับหน้า (Project ↔ Outsource ↔ Calendar ...) แล้ว filter ยังอยู่
 * แต่ปิดแท็บ/เปิดแท็บใหม่ = กลับเป็นค่า default ตามปกติ
 * ล้างอัตโนมัติตอน logout (กันคนถัดไปที่ล็อกอินบนเครื่องเดียวกันเห็น filter ของคนก่อน)
 *
 * โครงข้อมูล: { [page]: { key: value, ... } }  — page = 'gantt'|'outsource'|'calendar'|'dashboard'|'signoff'
 * ทุกฟังก์ชัน fail-safe: storage ถูกปิด/เต็ม/JSON พัง ต้องไม่ทำให้หน้าเว็บล้ม
 */
const PREFS_KEY = 'pqa.filters.v1';
const PREFS_OWNER_KEY = 'pqa.filters.owner';   // อีเมลเจ้าของ filter ที่จำไว้ (กันข้ามคน)

function readAllPrefs() {
  try {
    const o = JSON.parse(sessionStorage.getItem(PREFS_KEY) || '{}');
    return (o && typeof o === 'object') ? o : {};
  } catch { return {}; }
}

/**
 * อ่าน prefs ของหน้าหนึ่ง
 * @param {string} page
 * @returns {Object} object เปล่าถ้ายังไม่เคยบันทึก (ไม่คืน null เพื่อให้ destructure ได้เลย)
 */
export function loadPrefs(page) {
  const o = readAllPrefs()[page];
  return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
}

/**
 * บันทึก prefs แบบ merge (เขียนทับเฉพาะ key ที่ส่งมา)
 * ⚠️ Set ต้องแปลงเป็น array ก่อนส่ง (JSON.stringify(Set) = {})
 */
export function savePrefs(page, patch) {
  try {
    const all = readAllPrefs();
    all[page] = { ...(all[page] || {}), ...(patch || {}) };
    sessionStorage.setItem(PREFS_KEY, JSON.stringify(all));
  } catch { /* storage เต็ม/ถูกปิด — ข้ามไป ไม่ต้องทำให้หน้าเว็บพัง */ }
}

/** ล้าง filter ที่จำไว้ทั้งหมด (เรียกตอน logout / เปลี่ยน user) — เคลียร์ role cache คู่กันด้วย */
export function clearPrefs() {
  try {
    sessionStorage.removeItem(PREFS_KEY);
    sessionStorage.removeItem(PREFS_OWNER_KEY);
    sessionStorage.removeItem(ROLE_CACHE_KEY);
  } catch { /* ignore */ }
}

/**
 * ผูก filter ที่จำไว้กับ user ที่ล็อกอินอยู่ — **เปลี่ยน login = ล้าง filter กลับเป็น default**
 * ทุกหน้าต้องเรียกใน showApp() **ก่อน** restore prefs (ต้องเป็น sync ไม่ใช่รอ auth event
 * เพราะแต่ละหน้าบูตจาก getSession() ขนานกับ onAuthStateChange ลำดับไม่แน่นอน)
 * @param {string} email อีเมลของ session ปัจจุบัน
 */
export function setPrefsOwner(email) {
  const e = String(email || '');
  try {
    const cur = sessionStorage.getItem(PREFS_OWNER_KEY);
    if (cur !== null && cur !== e) clearPrefs();   // คนละคนกับที่บันทึกไว้ → ทิ้ง filter ของคนก่อน
    sessionStorage.setItem(PREFS_OWNER_KEY, e);
  } catch { /* ignore */ }
}

/** array จาก prefs → Set (filter หลายตัวเก็บเป็น Set ในหน้าเว็บ) */
export function prefSet(v) {
  return new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
}

// logout จากหน้าไหนก็ได้ → ล้างทิ้ง (ทุกหน้า import common.js อยู่แล้ว จึงติดครบทุกหน้า)
// เคลียร์ login-log guard ด้วย ไม่งั้น login รอบถัดไปในแท็บเดียวกันจะไม่ถูกบันทึก
supabase.auth.onAuthStateChange((evt) => {
  if (evt === 'SIGNED_OUT') {
    clearPrefs();
    try { sessionStorage.removeItem(LOGIN_LOGGED_KEY); } catch { /* ignore */ }
  }
});

/* ============ ROLE CACHE (กันเมนู Admin กระพริบตอนสลับหน้า) ============ */
/*
 * แอปนี้เป็น multi-page — ทุกครั้งคลิกเมนู = full page reload ใหม่หมด ต้อง query role จาก DB
 * (getProfile()) ใหม่ทุกครั้งแบบ async ก่อนจะรู้ว่าจะโชว์เมนู Admin หรือไม่ → ระหว่างรอ query
 * เมนู Admin จะซ่อนไว้ก่อนเสมอ (ค่าเริ่มต้น) แล้วค่อยโผล่ทีหลังถ้าเป็น admin จริง = กระพริบ
 * (แว้บหาย-แว้บโผล่) ทุกครั้งที่สลับหน้า
 *
 * แก้ด้วยการแคช role ไว้ใน sessionStorage หลัง query DB สำเร็จ แล้วรอบถัดไป paint เมนูแบบ
 * optimistic (sync, ทันทีตอนหน้าโหลด) จาก cache ก่อน query DB จริงจะเสร็จ — ผิดพลาดได้ไม่เกิน
 * 1 เฟรมถ้า role เปลี่ยนไปจริงๆ ระหว่างนั้น (เคสหายาก) เพราะพอ query จริงเสร็จจะ paint ทับอีกที
 */
const ROLE_CACHE_KEY = 'pqa.role.cache.v1';

/**
 * อ่าน role ที่แคชไว้จากการโหลดหน้าก่อนหน้า — ใช้ paint เมนู Admin แบบ optimistic (sync)
 * ทันทีตอนหน้าเว็บเพิ่งโหลด ก่อนที่จะ query DB จริงเสร็จ (กันเมนูกระพริบตอนสลับหน้า)
 * คืนค่าเฉพาะเมื่อ email ตรงกับที่แคชไว้ (กันเห็น role ของ session/คนก่อนหน้า)
 * @param {string} email
 * @returns {string} role หรือ '' ถ้าไม่มี cache/email ไม่ตรง
 */
export function getCachedRole(email) {
  try {
    const o = JSON.parse(sessionStorage.getItem(ROLE_CACHE_KEY) || 'null');
    return (o && o.email === email && typeof o.role === 'string') ? o.role : '';
  } catch { return ''; }
}

/** บันทึก role หลัง query DB จริงเสร็จ (getProfile()) — เรียกคู่กันเสมอ */
export function setCachedRole(email, role) {
  try {
    sessionStorage.setItem(ROLE_CACHE_KEY, JSON.stringify({ email, role: role || '' }));
  } catch { /* storage เต็ม/ถูกปิด — ข้ามไป */ }
}

/**
 * โชว์/ซ่อนลิงก์ Admin ใน topbar ตาม role — ใช้แทนการเขียน
 * `document.getElementById('navAdmin').style.display = ...` ตรงๆ กระจายอยู่หลายหน้า
 * (ทุกหน้าที่มีลิงก์ Admin ต้องเรียกตัวนี้ ไม่ใช่ set style เอง กันหน้าใหม่ๆ ลืมเงื่อนไข role)
 * @param {string} role
 */
export function paintNavAdmin(role) {
  const el = document.getElementById('navAdmin');
  if (el) el.style.display = (role === 'admin') ? '' : 'none';
}

/* ============ UI HELPERS ============ */

/* ============ PROJECT STATUS (pqa.project_status) ============ */
/*
 * status เคยเป็น enum + สี hardcode เป็น class ใน theme.css
 * ตอนนี้เป็นตาราง master — ทั้งรายการและสีมาจาก DB ทุกหน้าจึงตรงกันเสมอ
 * โหลดครั้งเดียวเก็บใน cache เพราะ statusPill() ถูกเรียกใน loop ตอน render (sync)
 */

let STATUS_CACHE = [];   // [{ status_code, sort_order, pill_bg, pill_fg, is_active }]

// สีสำรอง เผื่อ patch ยังไม่ได้รันบน DB / โหลดไม่ทัน — จะได้ไม่โล้นทั้งหน้า
const LEGACY_STATUS_CLASS = {
  'Need Attention': 'st-need',
  'Ready to Start': 'st-ready',
  'In Progress': 'st-prog',
  'Completed': 'st-done'
};

// กัน CSS injection: ยอมเฉพาะ hex สี (#abc / #aabbcc)
function safeColor(c) {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(c || '')) ? c : null;
}

/**
 * โหลดสถานะโปรเจกต์จาก master (เรียกครั้งเดียวตอน init ของแต่ละหน้า)
 * @param {Object} [opt]
 * @param {boolean} [opt.includeInactive=false] — เอาสถานะที่ปิดใช้งานมาด้วย (หน้า Admin)
 * @returns {Promise<Array>} รายการสถานะเรียงตาม sort_order
 */
export async function loadProjectStatuses({ includeInactive = false } = {}) {
  let q = supabase.from('project_status')
    .select('status_code,sort_order,pill_bg,pill_fg,is_active')
    .order('sort_order', { ascending: true });
  if (!includeInactive) q = q.eq('is_active', true);

  const { data, error } = await q;
  if (error) {
    console.warn('loadProjectStatuses:', error.message);
    return STATUS_CACHE;
  }

  // เก็บทุกแถวที่เคยเห็นไว้ใน cache (รวมตัวที่ปิดใช้งาน) — โปรเจกต์เก่าที่ยังใช้
  // สถานะนั้นอยู่จะได้ยังมีสี ไม่กลายเป็น pill เทาเฉยๆ
  const byCode = new Map(STATUS_CACHE.map(s => [s.status_code, s]));
  for (const s of data || []) byCode.set(s.status_code, s);
  STATUS_CACHE = [...byCode.values()].sort(
    (a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999)
  );

  return data || [];
}

/**
 * รายการสถานะที่โหลดไว้แล้ว (เฉพาะที่ active)
 * @returns {Array}
 */
export function projectStatuses() {
  return STATUS_CACHE.filter(s => s.is_active !== false);
}

/**
 * <option> ของสถานะ สำหรับ dropdown — ต้องเรียก loadProjectStatuses() ก่อน
 * @param {string} [selected] — ค่าที่เลือกอยู่ (ถ้าไม่มีในลิสต์จะถูกเติมท้ายให้ ไม่หาย)
 * @param {string} [placeholder] — ข้อความตัวเลือกว่าง
 * @returns {string} HTML
 */
export function statusOptionsHTML(selected = '', placeholder = '— ทั้งหมด —') {
  const list = projectStatuses();
  const codes = list.map(s => s.status_code);
  // สถานะที่ถูกปิดใช้งานไปแล้วแต่โปรเจกต์นี้ยังใช้อยู่ — ต้องโชว์ ไม่งั้นเซฟทับแล้วหาย
  if (selected && !codes.includes(selected)) codes.push(selected);

  return `<option value="">${esc(placeholder)}</option>` +
    codes.map(c =>
      `<option value="${esc(c)}"${c === selected ? ' selected' : ''}>${esc(c)}</option>`
    ).join('');
}

/**
 * Render status pill HTML (สีมาจาก master — fallback เป็น class เดิมถ้ายังไม่ได้โหลด)
 * @param {string} status
 * @returns {string} HTML
 */
export function statusPill(status) {
  if (!status) return '<span class="muted">—</span>';

  const s  = STATUS_CACHE.find(x => x.status_code === status);
  const bg = safeColor(s && s.pill_bg);
  const fg = safeColor(s && s.pill_fg);
  if (bg && fg) {
    return `<span class="status-pill" style="background:${bg};color:${fg}">${esc(status)}</span>`;
  }
  return `<span class="status-pill ${LEGACY_STATUS_CLASS[status] || ''}">${esc(status)}</span>`;
}

// สีจุดสำรอง (ใช้สีตัวอักษรของ pill เดิม) เผื่อ master ยังโหลดไม่เสร็จ/ยังไม่ได้รัน patch
const LEGACY_STATUS_DOT = {
  'Need Attention': '#c0392b',
  'Ready to Start': '#2563A6',
  'In Progress': '#a15c12',
  'Completed': '#2e7d32'
};

/**
 * Render status เป็นวงกลมเล็กๆ (hover แล้วขึ้น tooltip เป็นข้อความสถานะ)
 * ใช้ในคอลัมน์แคบๆ ที่ไม่มีที่พอสำหรับ pill เต็มๆ เช่น Gantt
 * @param {string} status
 * @returns {string} HTML
 */
export function statusDot(status) {
  if (!status) return '<span class="status-dot status-dot-none" title="— ไม่ระบุสถานะ —"></span>';

  const s  = STATUS_CACHE.find(x => x.status_code === status);
  const bg = safeColor(s && s.pill_bg) || LEGACY_STATUS_DOT[status] || '#9a8f80';
  return `<span class="status-dot" style="background:${bg}"`
       + ` title="${esc(status)}" aria-label="${esc(status)}"></span>`;
}

/**
 * Format date for display (fallback to '—' if empty)
 * @param {string} d — 'yyyy-MM-dd' or empty
 * @returns {string} 'dd/mm/yyyy' or '—'
 */
export function fmtDate(d) {
  return d ? dDisp(d) : '<span class="muted">—</span>';
}

/* ============ RESOURCE / NAME DISPLAY ============ */

/**
 * Format a resource/OS name as "nickname : full name".
 * Handles either part being missing gracefully.
 * @param {string} nickname — e.g. 'มะเหมี่ยว'
 * @param {string} fullName — e.g. 'Pattaraphan Satim'
 * @returns {string} 'มะเหมี่ยว : Pattaraphan Satim' (or whichever part exists)
 */
export function resName(nickname, fullName) {
  const nn = (nickname == null ? '' : String(nickname)).trim();
  const fn = (fullName == null ? '' : String(fullName)).trim();
  if (nn && fn) return `${nn} : ${fn}`;
  return nn || fn || '';
}

/* ============ PROJECT LEAD (pqa.project_lead) ============ */

/**
 * โหลด pqa_lead ที่ยัง active ทั้งหมด (เรียงตามชื่อ) — ใช้เติม dropdown Lead
 * @returns {Promise<Array>} [{ emp_id, short_name, nickname }]
 */
export async function loadPqaLeadOptions() {
  const { data, error } = await supabase.from('pqa_lead')
    .select('emp_id,short_name,nickname')
    .eq('is_active', true);
  if (error) { console.warn('loadPqaLeadOptions error:', error); return []; }
  return (data || []).sort((a, b) =>
    String(a.short_name || '').localeCompare(String(b.short_name || '')));
}

/**
 * ป้ายชื่อ Lead สำหรับ dropdown — 'ชื่อเล่น : ชื่อเต็ม' (§4.4)
 * @param {Object} l — row ของ pqa_lead
 */
export function leadLabel(l) {
  if (!l) return '';
  return resName(l.nickname, l.short_name) || l.emp_id;
}

/**
 * สร้าง <option> ทั้งชุดสำหรับ dropdown Lead
 * @param {Array} leads — จาก loadPqaLeadOptions()
 * @param {string} selected — emp_id ที่เลือกอยู่
 * @param {string} placeholder — ข้อความ option ว่าง
 * @returns {string} HTML
 */
export function leadOptionsHTML(leads, selected = '', placeholder = '— เลือก Lead —') {
  const list = leads || [];
  let html = `<option value="">${esc(placeholder)}</option>` +
    list.map(l =>
      `<option value="${esc(l.emp_id)}"${l.emp_id === selected ? ' selected' : ''}>${esc(leadLabel(l))}</option>`
    ).join('');
  // lead เดิมที่ถูกปิดใช้งานไปแล้ว: ยังต้องโชว์ไว้ ไม่งั้นเซฟทับแล้วหายเงียบๆ
  if (selected && !list.some(l => l.emp_id === selected)) {
    html += `<option value="${esc(selected)}" selected>${esc(selected)} (inactive)</option>`;
  }
  return html;
}

/**
 * โหลด lead ของโปรเจกต์หนึ่ง
 * @param {string} projectKey
 * @returns {Promise<{main: string|null, subs: string[], executors: string[]}>}
 */
export async function loadProjectLeads(projectKey) {
  const { data, error } = await supabase.from('project_lead')
    .select('pqa_emp_id,is_main,is_executor').eq('project_key', projectKey);
  if (error) { console.warn('loadProjectLeads error:', error); return { main: null, subs: [], executors: [] }; }
  const rows = data || [];
  const main = rows.find(r => r.is_main);
  return {
    main: main ? main.pqa_emp_id : null,
    subs: rows.filter(r => !r.is_main && !r.is_executor).map(r => r.pqa_emp_id),
    executors: rows.filter(r => r.is_executor).map(r => r.pqa_emp_id)
  };
}

/**
 * เขียน lead ของโปรเจกต์ (replace ทั้งชุด) — main lead ได้คนเดียว (unique index
 * project_lead_one_main_uk บังคับอยู่แล้ว), sub lead กี่คนก็ได้, และ Internal Executor
 * (บทบาทที่ 3 — is_main=false, is_executor=true) กี่คนก็ได้เช่นกัน
 *
 * หมายเหตุ: RLS ที่บล็อกจะไม่คืน error แต่ไม่มีแถวถูกเขียน (ดู memory
 * "RLS silent no-op writes") จึงเช็คจำนวนแถวที่คืนกลับด้วยเสมอ
 *
 * @param {string} projectKey
 * @param {string|null} mainEmpId
 * @param {string[]} subEmpIds
 * @param {string[]} executorEmpIds
 * @returns {Promise<{error: {message:string}|null}>}
 */
export async function saveProjectLeads(projectKey, mainEmpId, subEmpIds = [], executorEmpIds = []) {
  const rows = [];
  const seen = new Set();
  if (mainEmpId) {
    rows.push({ project_key: projectKey, pqa_emp_id: mainEmpId, is_main: true, is_executor: false });
    seen.add(mainEmpId);
  }
  for (const id of (subEmpIds || [])) {
    if (!id || seen.has(id)) continue;   // กันซ้ำกับ main และซ้ำกันเอง
    seen.add(id);
    rows.push({ project_key: projectKey, pqa_emp_id: id, is_main: false, is_executor: false });
  }
  for (const id of (executorEmpIds || [])) {
    if (!id || seen.has(id)) continue;   // กันซ้ำกับ main/sub และซ้ำกันเอง
    seen.add(id);
    rows.push({ project_key: projectKey, pqa_emp_id: id, is_main: false, is_executor: true });
  }

  const del = await supabase.from('project_lead').delete().eq('project_key', projectKey);
  if (del.error) return { error: del.error };

  if (!rows.length) {
    // ไม่มี lead ใหม่ → ยืนยันว่าลบของเดิมได้จริง (RLS บล็อก = เงียบ ไม่ error)
    const chk = await supabase.from('project_lead').select('pqa_emp_id').eq('project_key', projectKey);
    if (!chk.error && chk.data && chk.data.length) {
      return { error: { message: 'ลบ Lead เดิมไม่สำเร็จ — บัญชีนี้ไม่มีสิทธิ์เขียน project_lead' } };
    }
    return { error: null };
  }

  const ins = await supabase.from('project_lead').insert(rows).select('pqa_emp_id');
  if (ins.error) return { error: ins.error };
  if (!ins.data || !ins.data.length) {
    return { error: { message: 'บันทึก Lead ไม่สำเร็จ — บัญชีนี้ไม่มีสิทธิ์เขียน project_lead' } };
  }
  return { error: null };
}

/**
 * เช็คว่า Main Lead / Sub Lead / Internal Executor ที่เลือกไว้ในฟอร์ม Project มีคนซ้ำกันไหม
 * (คนคนเดียวรับได้แค่บทบาทเดียวต่อโปรเจกต์ — ตาราง project_lead มี PK เป็น
 * (project_key, pqa_emp_id) อยู่แล้ว) เรียกก่อนกด Save ในทั้ง gantt.html และ admin.html
 * @param {{main:string|null, subs:string[], executors:string[]}} picked
 * @returns {boolean} true = มีคนซ้ำกันอย่างน้อยหนึ่งคน (ต้องกันไม่ให้เซฟ)
 */
export function leadPickerHasDuplicates(picked){
  const all = [picked.main, ...(picked.subs || []), ...(picked.executors || [])].filter(Boolean);
  return new Set(all).size !== all.length;
}

/* ============ LEAD SEARCH INPUT (พิมพ์ค้นหา เลือกได้ทีละ 1 คน) ============
 * แทนที่ <select> เดิมของ Main Lead / Sub Lead / Internal Executor (2026-08-13 ตามที่ขอ)
 * ใช้ร่วมกันทั้ง gantt.html + admin.html (mirror pattern เดิม — ดู memory
 * "pqa-gantt-admin-parallel-logic") — ทุกช่องยังเลือกได้ทีละ 1 คนเหมือนเดิม
 * (Sub Lead / Executor ยังเพิ่มได้หลายแถว แค่ต่อแถวเป็น 1:1 เหมือนก่อนแก้)
 *
 * markup ที่คาดหวัง: <div class="lead-search-wrap"><input class="lead-search"></div>
 * (แพนเนลแนะนำ position:absolute อิง .lead-search-wrap — ถ้าลืมห่อ wrap จะ fallback ไป
 * parentElement ตรงๆ ไม่พังแต่ตำแหน่งอาจเพี้ยน)
 *
 * state เก็บที่ input.dataset.empId เอง ไม่มี hidden input แยก:
 * - คลิกเลือกจาก list แล้ว = emp_id ของคนนั้น
 * - พิมพ์เองแล้วยังไม่คลิกเลือก (หรือลบพิมพ์ใหม่หลังเคยเลือกไว้) = '' เสมอ — กันเซฟชื่อมั่วๆ
 *   ที่ไม่ตรงใครใน list เงียบๆ (ต้องคลิกเลือกจาก list จริงเท่านั้น)
 * - ลบช่องว่างเปล่า = '' (ไม่เลือกใครเลย ใช้ได้กับ Sub Lead/Executor ที่เป็น optional)
 */

/**
 * ผูก behavior พิมพ์ค้นหาให้ input ตัวหนึ่ง — เรียกครั้งเดียวตอนสร้าง input (ทั้ง Main Lead
 * ตัวเดียว และแต่ละแถวของ Sub Lead/Executor)
 * @param {HTMLInputElement} inputEl
 * @param {Array} leads — จาก loadPqaLeadOptions() (active เท่านั้น)
 * @param {string|null} selectedEmpId — emp_id ที่เคยเลือกไว้ (ถ้ามี)
 */
export function initLeadSearch(inputEl, leads, selectedEmpId) {
  if (!inputEl) return;
  const list = leads || [];
  inputEl.classList.add('lead-search');
  inputEl.autocomplete = 'off';
  inputEl.placeholder = inputEl.placeholder || 'พิมพ์ชื่อ Lead...';

  const found = selectedEmpId ? list.find(l => l.emp_id === selectedEmpId) : null;
  if (selectedEmpId && !found) {
    // lead เดิมถูกปิดใช้งานไปแล้ว — โชว์ค้างไว้เหมือน leadOptionsHTML (กันหายเงียบๆ ตอนเซฟทับ)
    inputEl.value = `${selectedEmpId} (inactive)`;
    inputEl.dataset.empId = selectedEmpId;
  } else if (found) {
    inputEl.value = leadLabel(found);
    inputEl.dataset.empId = found.emp_id;
  } else {
    inputEl.value = '';
    inputEl.dataset.empId = '';
  }
  inputEl.classList.remove('invalid');

  let panel = null;
  const closePanel = () => { if (panel) { panel.remove(); panel = null; } };
  const openPanel = (matches) => {
    closePanel();
    panel = document.createElement('div');
    panel.className = 'lead-search-panel';
    if (!matches.length) {
      panel.innerHTML = `<div class="lead-search-empty">ไม่พบชื่อ</div>`;
    } else {
      matches.slice(0, 8).forEach(l => {
        const opt = document.createElement('div');
        opt.className = 'lead-search-opt';
        opt.textContent = leadLabel(l);
        // mousedown (ไม่ใช่ click) เพราะ blur ของ input ยิงก่อน click เสมอ — ไม่งั้นแพนเนลจะ
        // ปิดไปก่อนที่ click จะทันจับ
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          inputEl.value = leadLabel(l);
          inputEl.dataset.empId = l.emp_id;
          inputEl.classList.remove('invalid');
          closePanel();
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        });
        panel.appendChild(opt);
      });
    }
    const wrap = inputEl.closest('.lead-search-wrap') || inputEl.parentElement;
    if (wrap && !wrap.style.position) wrap.style.position = 'relative';
    wrap.appendChild(panel);
  };
  const runSearch = () => {
    const q = inputEl.value.trim().toLowerCase();
    if (!q) { closePanel(); return; }
    // ต้องเทียบกับ leadLabel(l) (รูปแบบเต็ม "nickname : short_name") ด้วย ไม่ใช่แค่ short_name/
    // nickname/emp_id แยกชิ้น — ไม่งั้น focus ช่องที่มีค่าอยู่แล้ว (เช่นตอนเปิด Edit Project) จะ
    // runSearch() ด้วย q = label เต็มที่ไม่ตรงกับฟิลด์ไหนเดี่ยวๆ เลยสักฟิลด์ (มี " : " คั่นกลาง)
    // ขึ้น "ไม่พบชื่อ" ทั้งที่ค่าที่กรอกอยู่ตรงกับ lead คนนั้นเป๊ะ (บั๊กที่เจอ 2026-08-13)
    const matches = list.filter(l =>
      String(l.short_name || '').toLowerCase().includes(q) ||
      String(l.nickname || '').toLowerCase().includes(q) ||
      String(l.emp_id || '').toLowerCase().includes(q) ||
      leadLabel(l).toLowerCase().includes(q));
    openPanel(matches);
  };

  inputEl.addEventListener('input', () => {
    inputEl.dataset.empId = ''; // พิมพ์ใหม่ = ยกเลิกค่าที่เคยเลือกไว้จนกว่าจะคลิกเลือกใหม่จริง
    inputEl.classList.remove('invalid');
    runSearch();
  });
  inputEl.addEventListener('focus', runSearch);
  inputEl.addEventListener('blur', () => {
    setTimeout(() => {
      closePanel();
      if (inputEl.value.trim() && !inputEl.dataset.empId) inputEl.classList.add('invalid');
      else inputEl.classList.remove('invalid');
    }, 150); // delay ให้ mousedown ของ .lead-search-opt ทำงานก่อน blur ปิดแพนเนล
  });
}

/**
 * ค่า emp_id ที่ถูกเลือกจริงจาก lead-search input — คืน '' ถ้าพิมพ์ค้างไว้แต่ไม่เคยคลิกเลือก
 * (ใช้แทนการอ่าน .value ตรงๆ แบบ <select> เดิมทุกจุด)
 * @param {HTMLInputElement} inputEl
 * @returns {string}
 */
export function getLeadSearchValue(inputEl) {
  return (inputEl && inputEl.dataset.empId) || '';
}

/**
 * true ถ้ามีช่อง .lead-search ตัวไหนใน container พิมพ์ข้อความค้างไว้แต่ไม่ตรงใครใน list เลย
 * (ยังไม่ได้คลิกเลือก) — เรียกก่อนเซฟเพื่อ block พร้อม error message กันข้อมูลเพี้ยนแบบเงียบๆ
 * @param {HTMLElement} containerEl — modal หรือ form ทั้งก้อนที่ครอบทุกช่อง lead-search
 * @returns {boolean}
 */
export function leadSearchHasUnresolvedText(containerEl) {
  if (!containerEl) return false;
  return [...containerEl.querySelectorAll('.lead-search')]
    .some(inp => inp.value.trim() && !inp.dataset.empId);
}

/* ============ MONTH LABEL (Mmm-yyyy) ============ */

/** English 3-letter month abbreviations (index 0 = Jan) */
export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format a month as 'Mmm-yyyy' (e.g. 'Jul-2026').
 * Accepts a Date, or a string 'yyyy-MM' / 'yyyy-MM-dd'.
 * @param {Date|string} d
 * @returns {string} 'Mmm-yyyy' or '' if unparseable
 */
export function monthLabel(d) {
  let y, m;
  if (d instanceof Date) {
    y = d.getFullYear();
    m = d.getMonth();
  } else if (typeof d === 'string' && d) {
    const p = d.split('-');
    y = parseInt(p[0], 10);
    m = parseInt(p[1], 10) - 1;
  } else {
    return '';
  }
  if (isNaN(y) || isNaN(m) || m < 0 || m > 11) return '';
  return `${MONTH_ABBR[m]}-${y}`;
}

/* ============ DEFAULT FILTER END (last day of month, +3 months ahead) ============ */

/**
 * Default End date for range filters = last day of the month that is
 * 3 months ahead of the base month.
 * Example: base 24 Jul 2026 → 31 Oct 2026.
 * Formula: new Date(year, month + 3 + 1, 0) → day 0 of the following month.
 * @param {Date} [base=new Date()]
 * @returns {Date}
 */
export function defaultFilterEnd(base = new Date()) {
  return new Date(base.getFullYear(), base.getMonth() + 3 + 1, 0);
}

/**
 * Same as defaultFilterEnd() but returns a 'yyyy-MM-dd' string.
 * @param {Date} [base=new Date()]
 * @returns {string} 'yyyy-MM-dd'
 */
export function defaultFilterEndStr(base = new Date()) {
  return d2s(defaultFilterEnd(base));
}

/* ============ SIGNOFF ATTACHMENTS (screenshot paste-to-attach) ============
 * ใช้ร่วมกันทั้ง signoff-review.html (หน้าเต็ม) และ signoffReviewModal.js (Gantt/Dashboard)
 * เพิ่ม 2026-08-17 — ดูสเปกเต็มใน signoff-screenshot-attachment-spec.md
 *
 * ต้องรัน sql/patch_2026-08-17_signoff_attachment.sql บน Supabase ก่อนใช้งานได้จริง
 * (สร้างตาราง pqa.signoff_attachment + Storage bucket 'signoff-attachments' แบบ private)
 */

const ATT_BUCKET = 'signoff-attachments';
const ATT_MAX_WIDTH = 1600;
const ATT_JPEG_QUALITY = 0.82;
const ATT_MAX_RAW_BYTES = 15 * 1024 * 1024; // 15MB safety cap ก่อนบีบอัด (กันเบราว์เซอร์ค้าง)

/**
 * ย่อ/บีบอัดรูปที่วางจาก clipboard ก่อนอัปโหลด — screenshot ดิบมักเป็น PNG 2-5MB
 * บีบแล้วเหลือ ~150-400KB (กว้างไม่เกิน 1600px, JPEG quality .82)
 * @param {Blob} blob
 * @returns {Promise<Blob>} JPEG blob
 */
export function compressImageBlob(blob, { maxWidth = ATT_MAX_WIDTH, quality = ATT_JPEG_QUALITY } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxWidth / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(out => out ? resolve(out) : reject(new Error('บีบอัดรูปไม่สำเร็จ')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านไฟล์รูปไม่สำเร็จ')); };
    img.src = url;
  });
}

/** ดึงไฟล์รูปจาก ClipboardEvent.clipboardData (เฉพาะ image/*) */
function extractPastedImages(clipboardData) {
  if (!clipboardData || !clipboardData.items) return [];
  const out = [];
  for (const item of clipboardData.items) {
    if (item.kind === 'file' && item.type && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

/**
 * ผูก paste-to-attach ให้ input/textarea ตัวหนึ่ง — วางรูปจาก clipboard แล้วบีบอัดอัตโนมัติ
 * ก่อนส่งเข้า onAdd() ทีละรูป ไม่ใช่รูป = ปล่อย paste ปกติ (ข้อความ/HTML) ไม่ preventDefault
 * @param {HTMLElement} el
 * @param {Object} opt
 * @param {Function} opt.getCount — คืนจำนวนรูปที่แนบอยู่ตอนนี้ (เช็ค cap ก่อนรับรูปใหม่)
 * @param {Function} opt.onAdd — (compressedBlob) => void
 * @param {number} [opt.maxImages=4]
 */
export function wireImagePaste(el, { getCount, onAdd, maxImages = 4 }) {
  if (!el) return;
  el.addEventListener('paste', async (e) => {
    const files = extractPastedImages(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) {
      if ((getCount ? getCount() : 0) >= maxImages) {
        toast(`แนบได้สูงสุด ${maxImages} รูปต่อข้อความ`, true);
        break;
      }
      if (f.size > ATT_MAX_RAW_BYTES) {
        toast('ไฟล์รูปใหญ่เกินไป (เกิน 15MB) — ข้ามรูปนี้', true);
        continue;
      }
      try {
        const compressed = await compressImageBlob(f);
        onAdd(compressed);
      } catch (err) {
        console.warn('compressImageBlob failed', err);
        toast('แนบรูปไม่สำเร็จ', true);
      }
    }
  });
}

/**
 * สร้างตัวควบคุม "รูปที่แนบไว้รอส่ง" ให้ 1 ช่องพิมพ์ (composer/reply/edit) — ผูก paste-to-attach
 * + render chip แบบ DOM ตรงๆ (ไม่ผ่าน innerHTML re-render ทั้งก้อน กันข้อความที่พิมพ์ค้างไว้หาย)
 *
 * เรียกใหม่ทุกครั้งที่ช่องพิมพ์นั้นถูกสร้างขึ้นมาใหม่ (เปิด reply/edit ใหม่ หรือ re-render ทั้งห้อง)
 * — pending list จะรีเซ็ตตามไปด้วย พฤติกรรมเดียวกับ draft ข้อความที่หายตอน re-render อยู่แล้วในโค้ดเดิม
 * (ไม่ใช่ข้อจำกัดใหม่ที่เพิ่มมา)
 * @param {HTMLElement} rowEl — container ว่างๆ สำหรับใส่ chip (ต้องมีอยู่ใน DOM แล้ว)
 * @param {HTMLElement} inputEl — textarea/input ที่จะดัก paste
 * @param {number} [maxImages=4]
 * @returns {{getBlobs:Function, clear:Function}}
 */
export function createAttachComposer(rowEl, inputEl, maxImages = 4) {
  const pending = []; // [{ blob, url }]
  function renderChip(entry) {
    if (!rowEl) return;
    const chip = document.createElement('span');
    chip.className = 'att-chip';
    chip.innerHTML = `<img src="${entry.url}" alt=""><button type="button" class="att-chip-x" title="เอาออก">×</button>`;
    chip.querySelector('.att-chip-x').addEventListener('click', () => {
      const i = pending.indexOf(entry);
      if (i > -1) pending.splice(i, 1);
      URL.revokeObjectURL(entry.url);
      chip.remove();
    });
    rowEl.appendChild(chip);
  }
  wireImagePaste(inputEl, {
    getCount: () => pending.length,
    maxImages,
    onAdd: (blob) => {
      const entry = { blob, url: URL.createObjectURL(blob) };
      pending.push(entry);
      renderChip(entry);
    }
  });
  return {
    getBlobs: () => pending.map(p => p.blob),
    clear: () => {
      pending.forEach(p => URL.revokeObjectURL(p.url));
      pending.length = 0;
      if (rowEl) rowEl.innerHTML = '';
    }
  };
}

/**
 * อัปโหลดรูปที่แนบไว้ทั้งหมดของคอมเมนต์หนึ่ง (เรียกหลัง insert คอมเมนต์แล้วเท่านั้น เพราะ path
 * ต้องมี comment_id) — อัปโหลดไม่สำเร็จบางรูปไม่ทำให้ข้อความหาย (คอมเมนต์ insert ไปแล้วก่อนหน้านี้)
 * @returns {Promise<{okCount:number, failCount:number}>}
 */
export async function uploadSignoffAttachments(projectKey, commentId, authorEmail, blobs) {
  let okCount = 0, failCount = 0;
  for (let i = 0; i < blobs.length; i++) {
    const blob = blobs[i];
    const path = `${projectKey}/${commentId}/${i + 1}-${Date.now()}.jpg`;
    try {
      const up = await supabase.storage.from(ATT_BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const ins = await supabase.from('signoff_attachment').insert({
        comment_id: commentId, storage_path: path, mime_type: 'image/jpeg',
        file_size: blob.size, author_email: authorEmail
      }).select();
      if (ins.error || !ins.data || !ins.data.length) throw (ins.error || new Error('insert blocked (RLS)'));
      okCount++;
    } catch (err) {
      console.warn('uploadSignoffAttachments: image failed', err);
      failCount++;
    }
  }
  return { okCount, failCount };
}

/**
 * โหลด attachment ของหลายคอมเมนต์พร้อมกัน (เรียกตอนโหลดห้อง/เธรด)
 * @param {Array<number>} commentIds
 * @returns {Promise<Object>} map commentId -> [{id, storage_path, mime_type, author_email}]
 */
export async function fetchSignoffAttachments(commentIds) {
  const ids = (commentIds || []).filter(x => x != null);
  if (!ids.length) return {};
  const { data, error } = await supabase.from('signoff_attachment')
    .select('id,comment_id,storage_path,mime_type,author_email')
    .in('comment_id', ids);
  if (error) { console.warn('fetchSignoffAttachments error', error); return {}; }
  const map = {};
  (data || []).forEach(a => { (map[a.comment_id] = map[a.comment_id] || []).push(a); });
  return map;
}

/** ลบ attachment ทีเดียว (ลบแถว DB + ลองลบไฟล์จริงใน Storage แบบ best-effort) */
export async function deleteSignoffAttachment(row) {
  const { data, error } = await supabase.from('signoff_attachment').delete().eq('id', row.id).select();
  if (error) return { error };
  // RLS delete_attachment อนุญาตเฉพาะรูปของตัวเอง — โดนบล็อกจะได้ 0 แถวกลับมาแบบเงียบๆ (ดู memory "RLS silent no-op writes")
  if (!data || !data.length) return { error: { message: 'ลบไม่สำเร็จ — ลบได้เฉพาะรูปของตัวเอง' } };
  supabase.storage.from(ATT_BUCKET).remove([row.storage_path]).then(({ error: e }) => {
    if (e) console.warn('storage remove (best-effort) failed', e);
  });
  return { error: null };
}

// cache: storage_path -> Promise<objectURL> กันโหลดรูปซ้ำทุกครั้งที่ re-render thread
const _attUrlCache = new Map();
function getSignoffAttachmentUrl(path) {
  if (!_attUrlCache.has(path)) {
    _attUrlCache.set(path, supabase.storage.from(ATT_BUCKET).download(path).then(({ data, error }) => {
      if (error || !data) throw error || new Error('download failed');
      return URL.createObjectURL(data);
    }).catch(err => {
      console.warn('getSignoffAttachmentUrl failed', path, err);
      _attUrlCache.delete(path);
      return null;
    }));
  }
  return _attUrlCache.get(path);
}

/**
 * HTML แถวรูปย่อใต้คอมเมนต์หนึ่ง (ยังไม่มี src จริง — ต้องเรียก hydrateAttachmentThumbs()
 * หลัง insert เข้า DOM แล้วเสมอ)
 * @param {Array} list — จาก fetchSignoffAttachments()
 * @param {string} meEmail — อีเมล session ปัจจุบัน (โชว์ปุ่ม × เฉพาะรูปของตัวเอง)
 */
export function attachmentThumbsHTML(list, meEmail) {
  if (!list || !list.length) return '';
  return `<div class="att-thumb-row">${list.map(a => {
    const removable = meEmail && a.author_email === meEmail;
    return `
    <span class="att-thumb-wrap">
      <img class="att-thumb" data-path="${esc(a.storage_path)}" alt="แนบรูป">
      ${removable ? `<button type="button" class="att-thumb-del" data-action="att-delete" data-att-id="${a.id}" data-att-path="${esc(a.storage_path)}" title="ลบรูปนี้">×</button>` : ''}
    </span>`;
  }).join('')}</div>`;
}

/** โหลดรูปจริงให้ <img class="att-thumb" data-path=...> ทุกตัวที่ยังไม่มี src ภายใน container — เรียกทันทีหลัง set innerHTML */
export function hydrateAttachmentThumbs(containerEl) {
  if (!containerEl) return;
  containerEl.querySelectorAll('img.att-thumb:not([src])').forEach(img => {
    const path = img.dataset.path;
    if (!path) return;
    getSignoffAttachmentUrl(path).then(url => { if (url) img.src = url; });
  });
}

/* ---- lightbox (inject ครั้งเดียว, ใช้ร่วมกันทุกหน้าที่ import common.js) ---- */
let _lightboxEl = null;
function ensureLightbox() {
  if (_lightboxEl) return _lightboxEl;
  const el = document.createElement('div');
  el.className = 'att-lightbox hidden';
  el.innerHTML = `<button type="button" class="att-lightbox-x" aria-label="ปิด">×</button><img alt="">`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.classList.contains('att-lightbox-x')) closeLightbox();
  });
  _lightboxEl = el;
  return el;
}
function openLightbox(url) {
  if (!url) return;
  const el = ensureLightbox();
  el.querySelector('img').src = url;
  el.classList.remove('hidden');
}
function closeLightbox() {
  if (_lightboxEl) _lightboxEl.classList.add('hidden');
}
// เปิด lightbox ทุกที่ที่คลิกรูป .att-thumb ที่โหลดเสร็จแล้ว (ไม่ต้องผูกทีละหน้า)
document.addEventListener('click', (e) => {
  const thumb = e.target.closest('img.att-thumb');
  if (thumb && thumb.getAttribute('src')) openLightbox(thumb.src);
});
// ESC ปิด lightbox ก่อนเสมอ (capture phase กัน handler ESC อื่นของแต่ละหน้าทำงานซ้อนในคลิกเดียวกัน)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _lightboxEl && !_lightboxEl.classList.contains('hidden')) {
    closeLightbox();
    e.stopImmediatePropagation();
  }
}, true);

/* ============ ATTACHMENT DISPLAY SIZE (S/M/L, 2026-08-23) ============
 * ผู้ใช้ขอให้รูปที่แนบใน Signoff Review โชว์ใหญ่ขึ้น (เดิม thumbnail 120×90 ครอปเล็กมาก) พร้อมปุ่ม
 * เลือกขนาดความกว้าง S/M/L — ทำเป็น preference เดียวใช้ร่วมทั้งหน้า (ไม่ใช่ต่อรูป/ต่อคอมเมนต์)
 * เก็บใน localStorage คีย์เดียว 'pqa.attSize' ใช้ร่วมทั้ง signoff-review.html + signoffReviewModal.js
 * กลไก: ปรับ CSS custom property --att-w ที่ documentElement แล้ว .att-thumb (theme.css) อ่านค่านี้
 * ผ่าน width:var(--att-w,...) — เปลี่ยนขนาดรูปทุกรูปบนหน้าทันทีโดยไม่ต้อง re-render thread ใหม่
 */
const ATT_SIZE_PX = { S: 140, M: 260, L: 420 };
const ATT_SIZE_KEY = 'pqa.attSize';

/** อ่านค่าที่เลือกไว้ล่าสุด (fail-safe: storage พังก็ยัง fallback เป็น 'M' ไม่ทำหน้าเว็บล้ม) */
export function getAttSizePref() {
  let v;
  try { v = localStorage.getItem(ATT_SIZE_KEY); } catch { v = null; }
  return (v === 'S' || v === 'M' || v === 'L') ? v : 'M';
}
/** บันทึกขนาดที่เลือก + ปรับรูปบนหน้าให้ตรงทันที */
export function setAttSizePref(v) {
  if (v !== 'S' && v !== 'M' && v !== 'L') return;
  try { localStorage.setItem(ATT_SIZE_KEY, v); } catch { /* storage ปิด/เต็ม — ไม่ทำหน้าเว็บล้ม */ }
  applyAttSizeCss();
}
/** ตั้ง --att-w ที่ documentElement ตาม pref ปัจจุบัน — เรียกครั้งเดียวตอนโหลดโมดูล (กันรูปกระพริบ
 *  ขนาดผิดก่อน JS ทำงาน) และทุกครั้งที่ setAttSizePref() ถูกเรียก */
export function applyAttSizeCss() {
  document.documentElement.style.setProperty('--att-w', ATT_SIZE_PX[getAttSizePref()] + 'px');
}
applyAttSizeCss();

/** ปุ่ม S/M/L — วางไว้ตรงไหนก็ได้ในหน้า (เช่น หัวห้อง Signoff Review / หัว modal)
 *  คลิกจัดการโดย document-level delegation ด้านล่าง ไม่ต้องผูก listener เพิ่มเอง */
export function attSizeControlHTML() {
  const cur = getAttSizePref();
  return `<div class="att-size-ctrl" title="ขนาดรูปที่แนบ">${['S', 'M', 'L'].map(s =>
    `<button type="button" class="att-size-btn${s === cur ? ' active' : ''}" data-size="${s}">${s}</button>`
  ).join('')}</div>`;
}
// คลิกปุ่ม S/M/L ที่ไหนบนหน้าก็ได้ (document-level เหมือน lightbox ด้านบน — ใช้ร่วมทุกหน้า/ทุก modal
// โดยไม่ต้องเพิ่ม case ในตัว delegated click handler เฉพาะของแต่ละหน้า)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.att-size-btn');
  if (!btn) return;
  setAttSizePref(btn.dataset.size);
  // ปุ่มขนาดอาจมีมากกว่า 1 ชุดพร้อมกันบนหน้าเดียว (เช่น เผื่ออนาคต) — sync active state ให้ตรงกันหมด
  document.querySelectorAll('.att-size-btn').forEach(b => b.classList.toggle('active', b.dataset.size === btn.dataset.size));
});

/* ============ @MENTION AUTOCOMPLETE (Signoff Review tag, 2026-08-18) ============
 * ใช้ทั้งใน signoff-review.html (คอมเมนต์หลัก/reply/แก้ไข) และ signoffReviewModal.js
 * เก็บ tag เป็นข้อความ literal "@email" ตรงๆ ใน body ของ signoff_comment (ไม่ใช่ rich-text/
 * markup แยก) — ตัดสินใจแบบนี้เพราะกิ๊บระบุ "tag ด้วย email address" ชัดเจน และอีเมลไม่ซ้ำกัน
 * ระหว่างคน 100% (ต่างจาก display_name ที่อาจซ้ำ) ตอนส่งคอมเมนต์ให้เรียก getMentionedEmails()
 * สแกนหา "@" + อีเมลจริงของ user ที่ active อยู่ใน body แล้ว insert เป็นแถว pqa.signoff_mention
 * (ดู sql/patch_2026-08-18_signoff_mention.sql) — ไม่ผูกกับตอนเลือกจาก autocomplete โดยตรง
 * เพราะถ้าผู้ใช้ลบข้อความ "@email" ทิ้งก่อนส่ง ก็ไม่ควรนับเป็นการแท็กอีกต่อไป
 */

/** โหลดรายชื่อคนที่แท็กได้ — ต้องเป็น app_user ที่ active เท่านั้น (ต้องมีบัญชีถึงจะมีกระดิ่งให้เห็น noti) */
export async function loadTaggableUsers() {
  const { data, error } = await supabase.from('app_user')
    .select('email,display_name').eq('is_active', true);
  if (error) { console.warn('loadTaggableUsers error', error); return []; }
  return data || [];
}

/**
 * ผูก @ autocomplete ให้ input/textarea ตัวหนึ่ง — พิมพ์ "@" ที่ต้นคำ (หลังช่องว่าง/ต้นข้อความ
 * เท่านั้น กันชนกับอีเมลที่พิมพ์ปกติกลางประโยค) แล้วพิมพ์ต่อ ระบบกรองจาก taggableUsers
 * (email/display_name) คลิกเลือกแล้ว insert "@email " ที่ตำแหน่งเคอร์เซอร์ทันที (เก็บเป็นอีเมล
 * ตรงๆ ไม่ใช่ label ชื่อ — อ่าน comment ที่คอมเมนต์ dropdown ด้านบน)
 *
 * panel เป็น position:fixed อิงตำแหน่งกล่อง input/textarea เอง (ไม่ใช่ตำแหน่ง caret จริง —
 * เพียงพอสำหรับ use case นี้ ไม่ทำ mirror-div คำนวณตำแหน่ง caret ที่ซับซ้อนเกินจำเป็น) เรียกซ้ำ
 * ได้ปลอดภัยทุกครั้งที่ element ใหม่ถูกสร้าง (เช่นหลัง re-render ทั้งก้อนของ signoff-review.html)
 * เพราะ listener ผูกกับ element instance ใหม่ทุกครั้งอยู่แล้ว ไม่มีของเก่าค้าง
 * @param {HTMLInputElement|HTMLTextAreaElement} el
 * @param {{email:string,display_name:string}[]} taggableUsers
 */
export function initMentionAutocomplete(el, taggableUsers) {
  if (!el) return;
  const users = taggableUsers || [];
  let panel = null, wordStart = -1;
  const closePanel = () => { if (panel) { panel.remove(); panel = null; } };
  const openPanel = (matches) => {
    closePanel();
    panel = document.createElement('div');
    panel.className = 'mention-panel';
    if (!matches.length) {
      panel.innerHTML = `<div class="mention-empty">ไม่พบชื่อ</div>`;
    } else {
      matches.slice(0, 8).forEach(u => {
        const opt = document.createElement('div');
        opt.className = 'mention-opt';
        opt.innerHTML = `${esc(u.display_name || u.email)}<span class="em">${esc(u.email)}</span>`;
        // mousedown (ไม่ใช่ click) เพราะ blur ของ input/textarea ยิงก่อน click เสมอ — แพทเทิร์น
        // เดียวกับ initLeadSearch() ด้านบน
        opt.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          const val = el.value;
          const cursor = el.selectionStart;
          const before = val.slice(0, wordStart);
          const after = val.slice(cursor);
          const insert = '@' + u.email + ' ';
          el.value = before + insert + after;
          const newPos = (before + insert).length;
          el.focus();
          el.setSelectionRange(newPos, newPos);
          closePanel();
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        panel.appendChild(opt);
      });
    }
    const rect = el.getBoundingClientRect();
    panel.style.left = rect.left + 'px';
    panel.style.top = (rect.bottom + 4) + 'px';
    panel.style.minWidth = Math.max(220, rect.width) + 'px';
    document.body.appendChild(panel);
  };
  const checkTrigger = () => {
    const cursor = el.selectionStart;
    const val = el.value.slice(0, cursor);
    const at = val.lastIndexOf('@');
    if (at === -1) { closePanel(); return; }
    const beforeAt = val.slice(0, at);
    const query = val.slice(at + 1, cursor);
    if (/\s/.test(query)) { closePanel(); return; } // เคาะ space แล้ว = คำนี้จบแล้ว ไม่ใช่ query ต่อ
    if (beforeAt && !/\s$/.test(beforeAt)) { closePanel(); return; } // "@" ต้องอยู่ต้นคำเท่านั้น
    wordStart = at;
    const q = query.toLowerCase();
    const matches = !q ? users.slice(0, 8) : users.filter(u =>
      String(u.email || '').toLowerCase().includes(q) ||
      String(u.display_name || '').toLowerCase().includes(q));
    openPanel(matches);
  };
  el.addEventListener('input', checkTrigger);
  el.addEventListener('click', checkTrigger);
  el.addEventListener('blur', () => setTimeout(closePanel, 150));
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
}

/**
 * สแกน body หา "@email" ของ user ที่ active จริงเท่านั้น (เทียบ exact กับ taggableUsers ไม่ใช่
 * regex เดารูปแบบอีเมลเอง) กันแท็กมั่วๆ/false-positive กับอีเมลที่ไม่มีบัญชีในระบบ ตัดชื่อผู้เขียน
 * เองออกเสมอ (แท็กตัวเองไม่ต้องเด้ง noti หาตัวเอง)
 * @param {string} body
 * @param {{email:string}[]} taggableUsers
 * @param {string} authorEmail
 * @returns {string[]} อีเมลที่ควร insert เป็น signoff_mention (ไม่ซ้ำกัน)
 */
export function getMentionedEmails(body, taggableUsers, authorEmail) {
  const text = String(body || '').toLowerCase();
  const out = new Set();
  (taggableUsers || []).forEach(u => {
    const email = String(u.email || '');
    if (!email) return;
    if (email.toLowerCase() === String(authorEmail || '').toLowerCase()) return;
    if (text.includes('@' + email.toLowerCase())) out.add(email);
  });
  return [...out];
}

/* ============ NOTIFICATION BELL (Signoff Review @mention, 2026-08-18) ============
 * markup ที่คาดหวังใน topbar ทุกหน้า (ก่อน span#who) — ก๊อปเหมือนกันทุกหน้า (topbar เองก็
 * duplicate อยู่แล้วทุกหน้า ดู memory "pqa-gantt-admin-parallel-logic"):
 *   <div class="noti-bell">
 *     <button class="noti-bell-btn" id="notiBellBtn" type="button" aria-label="การแจ้งเตือน">
 *       🔔<span class="noti-dot" id="notiDot" style="display:none"></span>
 *     </button>
 *     <div class="noti-panel" id="notiPanel" style="display:none">
 *       <div class="noti-panel-head">การแจ้งเตือน</div>
 *       <div class="noti-panel-list" id="notiList"></div>
 *     </div>
 *   </div>
 * เรียก initNotificationBell() ครั้งเดียวหลังล็อกอินสำเร็จ (ตอน showApp()/wireStaticControls()
 * ของแต่ละหน้า) — เช็ค unread ทันที + poll ทุก 60 วิ (ตามที่กิ๊บยืนยัน — หยุด poll เมื่อ tab ไม่
 * active ผ่าน document.hidden กันยิง query เปล่าตอนไม่มีใครดู + เช็คซ้ำทันทีตอนสลับกลับมา active
 * ไม่ต้องรอครบ 1 นาที) ปิด panel เองเมื่อคลิกนอกกล่อง
 *
 * mark-as-read: กระดิ่งนี้ "อ่านอย่างเดียว" ไม่ยิง update ตรงๆ — กด noti row แล้ว navigate ไป
 * signoff-review.html?project=..&comment=.. ตัว loadRoom() ปลายทางเป็นคนมาร์ค read_at ให้เอง
 * (ครอบคลุมทั้งเข้าห้องผ่านกระดิ่ง และเข้าห้องผ่าน rail list ปกติ — เปิดห้องแล้ว mention ทุกอัน
 * ของฉันในห้องนั้นถือว่า "เห็นแล้ว" เหมือนกันหมด ไม่ต้องแยกเคส)
 */
let _notiPollTimer = null;
let _notiMe = null;

async function notiCheckUnread() {
  if (!_notiMe) return;
  const dot = $('notiDot');
  if (!dot) return;
  const { count, error } = await supabase.from('signoff_mention')
    .select('id', { count: 'exact', head: true })
    .eq('mentioned_email', _notiMe).is('read_at', null);
  if (error) { console.warn('notiCheckUnread error', error); return; }
  dot.style.display = (count && count > 0) ? '' : 'none';
}

function notiSnippet(text) {
  const s = String(text || '');
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
}

function notiTimeLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p2 = n => String(n).padStart(2, '0');
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

async function notiLoadList() {
  const list = $('notiList');
  if (!list || !_notiMe) return;
  list.innerHTML = '<div class="noti-empty">กำลังโหลด...</div>';
  const { data: mentions, error } = await supabase.from('signoff_mention')
    .select('id,comment_id,project_key,author_email,created_at,read_at')
    .eq('mentioned_email', _notiMe)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) { console.warn('notiLoadList error', error); list.innerHTML = '<div class="noti-empty">โหลดไม่สำเร็จ</div>'; return; }
  if (!mentions || !mentions.length) { list.innerHTML = '<div class="noti-empty">ยังไม่มีการแจ้งเตือน</div>'; return; }

  // fetch แยก 3 ก้อนแล้ว join เอง (ไม่ใช้ PostgREST embed syntax — โค้ดฐานนี้ไม่เคยใช้ pattern
  // นั้นที่ไหนเลย ทำแบบเดียวกับที่อื่นๆ ทั้งหมดในระบบเพื่อความชัวร์)
  const commentIds = [...new Set(mentions.map(m => m.comment_id))];
  const projectKeys = [...new Set(mentions.map(m => m.project_key))];
  const [cmtRes, projRes, userRes] = await Promise.all([
    supabase.from('signoff_comment').select('id,body,deleted_at').in('id', commentIds),
    supabase.from('project').select('project_key,project_name').in('project_key', projectKeys),
    supabase.from('app_user').select('email,display_name'),
  ]);
  const cmtMap = {}; (cmtRes.data || []).forEach(c => { cmtMap[c.id] = c; });
  const projMap = {}; (projRes.data || []).forEach(p => { projMap[p.project_key] = p; });
  const userMap = {}; (userRes.data || []).forEach(u => { userMap[u.email] = u.display_name; });
  const nameOf = e => userMap[e] || String(e || '').split('@')[0];

  list.innerHTML = mentions.map(m => {
    const cmt = cmtMap[m.comment_id];
    const proj = projMap[m.project_key];
    const bodyTxt = cmt ? (cmt.deleted_at ? '(ความคิดเห็นถูกลบแล้ว)' : notiSnippet(cmt.body)) : '(ไม่พบข้อความ)';
    const unread = !m.read_at;
    return `
      <button class="noti-row ${unread ? 'unread' : ''}" data-pk="${esc(m.project_key)}" data-cid="${m.comment_id}">
        <span class="noti-row-mark">${unread ? '<span class="noti-row-dot"></span>' : '✓'}</span>
        <span class="noti-row-body">
          <span class="noti-row-title">${esc(nameOf(m.author_email))} แท็กคุณใน ${esc(proj ? proj.project_name : m.project_key)}</span>
          <span class="noti-row-snippet">${esc(bodyTxt)}</span>
          <span class="noti-row-time">${esc(notiTimeLabel(m.created_at))}</span>
        </span>
      </button>`;
  }).join('');
}

/**
 * เริ่มระบบกระดิ่ง — เรียกครั้งเดียวหลังล็อกอินสำเร็จ ข้ามเงียบๆ ถ้าหน้านั้นไม่มี markup กระดิ่ง
 * (กันพังถ้าลืมใส่ topbar ในหน้าใดหน้าหนึ่ง)
 *
 * กัน re-init ซ้ำเองด้วย _notiInitedEl (เทียบ element instance ไม่ใช่แค่ boolean) — บางหน้า
 * (เช่น gantt.html) เรียก showApp() ได้มากกว่า 1 ครั้งต่อการโหลดหน้าเดียว เพราะ
 * supabase.auth.onAuthStateChange ยิง SIGNED_IN ซ้ำได้ (เจอบั๊กแบบเดียวกันมาแล้วกับ login_log
 * — ดู logLogin() ด้านบน) ถ้าไม่กันไว้ listener ของกระดิ่งจะถูกผูกซ้ำ กดหนึ่งครั้งพาไปหลายที่/
 * mark-read ซ้ำๆ ได้ เทียบกับ element เดิม (ไม่ใช่ true/false เฉยๆ) เผื่อกรณี DOM ถูกสร้างใหม่
 * จริงๆ (ไม่น่าเกิดกับ topbar แต่กันไว้ก่อน)
 */
let _notiInitedEl = null;
export function initNotificationBell() {
  const btn = $('notiBellBtn'), panel = $('notiPanel');
  if (!btn || !panel) return;
  if (_notiInitedEl === btn) return;
  _notiInitedEl = btn;

  supabase.auth.getSession().then(({ data }) => {
    _notiMe = data?.session?.user?.email || null;
    if (_notiMe) notiCheckUnread();
  });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = panel.style.display === 'none';
    panel.style.display = willOpen ? '' : 'none';
    if (willOpen) notiLoadList();
  });
  document.addEventListener('click', (e) => {
    if (panel.style.display !== 'none' && !panel.contains(e.target) && e.target !== btn) {
      panel.style.display = 'none';
    }
  });
  panel.addEventListener('click', (e) => {
    const row = e.target.closest('.noti-row');
    if (!row) return;
    const pk = row.dataset.pk, cid = row.dataset.cid;
    location.href = `signoff-review.html?project=${encodeURIComponent(pk)}&comment=${encodeURIComponent(cid)}`;
  });

  if (_notiPollTimer) clearInterval(_notiPollTimer);
  _notiPollTimer = setInterval(() => { if (!document.hidden) notiCheckUnread(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) notiCheckUnread(); });
}
