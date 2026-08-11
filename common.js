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
  const fg = safeColor(s && s.pill_fg) || LEGACY_STATUS_DOT[status] || '#9a8f80';
  return `<span class="status-dot" style="background:${fg}"`
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
 * @returns {Promise<{main: string|null, subs: string[]}>}
 */
export async function loadProjectLeads(projectKey) {
  const { data, error } = await supabase.from('project_lead')
    .select('pqa_emp_id,is_main').eq('project_key', projectKey);
  if (error) { console.warn('loadProjectLeads error:', error); return { main: null, subs: [] }; }
  const rows = data || [];
  const main = rows.find(r => r.is_main);
  return {
    main: main ? main.pqa_emp_id : null,
    subs: rows.filter(r => !r.is_main).map(r => r.pqa_emp_id)
  };
}

/**
 * เขียน lead ของโปรเจกต์ (replace ทั้งชุด) — main lead ได้คนเดียว (unique index
 * project_lead_one_main_uk บังคับอยู่แล้ว), sub lead กี่คนก็ได้
 *
 * หมายเหตุ: RLS ที่บล็อกจะไม่คืน error แต่ไม่มีแถวถูกเขียน (ดู memory
 * "RLS silent no-op writes") จึงเช็คจำนวนแถวที่คืนกลับด้วยเสมอ
 *
 * @param {string} projectKey
 * @param {string|null} mainEmpId
 * @param {string[]} subEmpIds
 * @returns {Promise<{error: {message:string}|null}>}
 */
export async function saveProjectLeads(projectKey, mainEmpId, subEmpIds = []) {
  const rows = [];
  const seen = new Set();
  if (mainEmpId) {
    rows.push({ project_key: projectKey, pqa_emp_id: mainEmpId, is_main: true });
    seen.add(mainEmpId);
  }
  for (const id of (subEmpIds || [])) {
    if (!id || seen.has(id)) continue;   // กันซ้ำกับ main และซ้ำกันเอง
    seen.add(id);
    rows.push({ project_key: projectKey, pqa_emp_id: id, is_main: false });
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
