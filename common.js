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
 * @param {string} email
 * @param {string} password
 * @returns {Promise<Object>} { error } on failure, { data, error } on success
 */
export async function signIn(email, password) {
  return await supabase.auth.signInWithPassword({
    email: email.trim(),
    password
  });
}

/**
 * Sign out
 * @returns {Promise<Object>} { error }
 */
export async function signOut() {
  return await supabase.auth.signOut();
}

/* ============ UI HELPERS ============ */

/**
 * Render status pill HTML
 * @param {string} status
 * @returns {string} HTML
 */
export function statusPill(status) {
  const map = {
    'Need Attention': 'st-need',
    'Ready to Start': 'st-ready',
    'In Progress': 'st-prog',
    'Completed': 'st-done'
  };
  if (!status) return '<span class="muted">—</span>';
  return `<span class="status-pill ${map[status] || ''}">${esc(status)}</span>`;
}

/**
 * Format date for display (fallback to '—' if empty)
 * @param {string} d — 'yyyy-MM-dd' or empty
 * @returns {string} 'dd/mm/yyyy' or '—'
 */
export function fmtDate(d) {
  return d ? dDisp(d) : '<span class="muted">—</span>';
}
