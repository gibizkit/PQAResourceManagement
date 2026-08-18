/**
 * signoffReviewModal.js — Signoff Review modal (threaded comments, `signoff_comment` table)
 *
 * Extracted from gantt.html so Project Gantt AND Dashboard open the exact same modal/flow
 * for "Review Signoff" (magnifier icon) instead of two divergent implementations.
 *
 * ES module — self-registers at load time:
 *   window.openSignoffReviewModal(projectKey, projectName)
 *   window.closeSignoffReviewModal()
 *   window.saveSignoffReviewModal(projectKey)   (used by the inline "บันทึก" button)
 *
 * Injects its own modal DOM (once) into <body> the first time it's called, styled with
 * theme.css classes (.overlay/.modal/.field/.btn/...) plus a small scoped <style> block
 * for the sr-modal-/srm- prefixed bits theme.css doesn't cover (all colors via CSS variables).
 *
 * Extra behavior (on top of the original thread view):
 *  - A read-only "project summary" card (App / UAT Lead / Signoff Date / Target Go-Live / Note)
 *    fetched from v_project_wide, rendered above the root card/thread.
 *  - The Signoff URL shown in that card is editable inline by any logged-in user.
 *  - Any comment/reply authored by the current user gets an inline ✏️ edit control.
 *  - Screenshot attachments (paste Ctrl+V) — 2026-08-17. Paste-to-attach only works inside
 *    the existing edit boxes (comment/reply edit, root add/edit); this modal has no "new
 *    top-level comment" composer (never did), so that stays out of scope here — see
 *    signoff-review.html for the full composer + reply flow. Every comment/reply/root card
 *    (view AND edit mode) renders any attached images as thumbnails with a lightbox; see
 *    common.js "SIGNOFF ATTACHMENTS" section for the shared upload/render/lightbox logic.
 *
 * Usage:
 *   <script type="module" src="./signoffReviewModal.js"></script>
 *   ...
 *   <button onclick="window.openSignoffReviewModal(pk, projectName)">🔎</button>
 *
 * Depends on: ./common.js (supabase, $, toast, esc, dDisp, getSession)
 */

import {
  supabase, $, toast, esc, dDisp, getSession,
  createAttachComposer, uploadSignoffAttachments, fetchSignoffAttachments,
  attachmentThumbsHTML, hydrateAttachmentThumbs, deleteSignoffAttachment
} from './common.js';

/* ============ HELPERS ============ */
function shortEmail(email) { return email ? String(email).split('@')[0] : 'ไม่ทราบ'; }
function commentTimeShort(ts) {
  if (!ts) return '';
  const d = new Date(ts); if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** best-effort cache of project_key -> project name, so the modal title survives reloads */
const _projectNameByKey = {};

/* ============ MODULE STATE (persists across re-renders of the same open modal) ============ */
// app_code -> app_name (loaded once, lazily) — for the "แอป (App)" row in the summary card
const _lookup = { app: null, meLoaded: false, me: '' };
// last successful loadSignoffReviewModal() result — re-render from this without refetching
// whenever we just need to toggle an inline edit box open/closed.
let _lastLoad = null; // { pk, rootRow, topLevel, byParent, projRow }
let _urlEditing = false;       // Signoff URL inline edit box open?
let _editingCommentId = null;  // id of the comment/reply currently in edit mode (or null)
// root Signoff Review card: edit box is CLOSED by default and only opens via the ✏️ button
// (shown to the card's own author) or the "เพิ่ม Signoff Review" button when no root exists.
let _rootEditing = false;
// ตัวควบคุมรูปที่แนบไว้รอส่ง (screenshot paste-to-attach) — มีได้แค่ 1 ช่องเปิดพร้อมกันเสมออยู่แล้ว
// (root edit กับ comment edit เปิดพร้อมกันไม่ได้ในโมดัลนี้) ผูกใหม่ทุกครั้งที่ renderSignoffReviewModal() รัน
let _rootAttach = null, _commentAttach = null;

async function ensureLookups() {
  const tasks = [];
  if (_lookup.app === null) {
    tasks.push(supabase.from('app').select('app_code,app_name').then(({ data, error }) => {
      if (error) { console.warn('signoffReviewModal: load app map failed', error); _lookup.app = {}; return; }
      const map = {};
      (data || []).forEach(a => { map[a.app_code] = a.app_name; });
      _lookup.app = map;
    }));
  }
  if (!_lookup.meLoaded) {
    tasks.push(getSession().then(session => {
      _lookup.me = session ? session.user.email : '';
      _lookup.meLoaded = true;
    }));
  }
  if (tasks.length) await Promise.all(tasks);
}

/** same rule as signoff-review.html's appNameOf(): app_name lookup, fallback to raw code/other_app */
function appNameOf(projRow) {
  if (!projRow) return '';
  return (_lookup.app && _lookup.app[projRow.app]) || projRow.app || projRow.other_app || '— ไม่มี App —';
}

/* ============ MODAL DOM (lazy, injected once) ============ */
function ensureModal() {
  if ($('signoffReviewOverlay')) return;

  const style = document.createElement('style');
  style.textContent = `
    #signoffReviewOverlay .modal { width:820px; }
    #signoffReviewOverlay .modal-body { max-height:78vh; overflow:auto; }
    .sr-modal-card { background:var(--dk-surface); border:1px solid var(--dk-border); border-radius:10px; padding:12px 14px; margin-bottom:10px; }
    .sr-modal-card-head { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
    .sr-modal-card-head .sr-modal-card-meta { margin-bottom:0; flex:1; min-width:0; }
    .sr-modal-card-meta { font-size:11px; color:var(--dk-text3); margin-bottom:6px; }
    .sr-modal-card-body { font-size:13.5px; color:var(--dk-text); line-height:1.55; white-space:pre-wrap; }
    .sr-modal-thread-title { font-weight:700; font-size:13px; color:var(--dk-text); margin:14px 0 6px; }
    .sr-modal-comment { padding:8px 0; border-top:1px solid var(--dk-border); }
    .sr-modal-comment:first-child { border-top:none; }
    .sr-modal-comment-top { font-size:12px; color:var(--dk-text2); }
    .sr-modal-comment-text { font-size:13px; color:var(--dk-text); margin-top:3px; white-space:pre-wrap; }
    .sr-modal-reply { margin:6px 0 0 16px; padding:6px 10px; background:var(--dk-surface); border-radius:8px; font-size:12.5px; color:var(--dk-text); }

    /* ---- project summary card (Feature 1) ---- */
    .srm-sum-card { background:var(--dk-card); border:1px solid var(--dk-border); border-radius:12px; padding:14px 16px; margin-bottom:14px; }
    .srm-sum-head { display:flex; align-items:center; gap:10px; }
    .srm-sum-title { font-weight:800; font-size:16px; color:var(--dk-text); flex:1; min-width:0; }
    .srm-sum-pin { font-size:10px; font-weight:800; color:var(--dk-accent); background:var(--dk-accent-d); padding:2px 9px; border-radius:20px; white-space:nowrap; }
    .srm-sum-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px 20px; margin-top:12px; }
    .srm-sum-label { display:block; font-size:11px; font-weight:700; color:var(--dk-text3); }
    .srm-sum-val { font-size:13.5px; color:var(--dk-text); font-weight:600; }
    .srm-sum-divider { height:1px; background:var(--dk-border); margin:12px 0 10px; }
    .srm-sum-notehead { font-size:13px; font-weight:800; color:var(--dk-text); margin-bottom:4px; }
    .srm-sum-note { font-size:13.5px; color:var(--dk-text); line-height:1.55; white-space:pre-wrap; }

    /* ---- Signoff URL row (Feature 2) ---- */
    .srm-sum-urlrow { margin-top:10px; }
    .srm-sum-urlview { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .srm-doc-btn { border:1px solid var(--dk-border-s); background:var(--dk-card); border-radius:9px; padding:6px 11px; font-size:12px; font-weight:600; color:var(--dk-text2); text-decoration:none; white-space:nowrap; }
    .srm-doc-btn:hover { background:var(--dk-hover); text-decoration:none; }
    .srm-icon-btn { border:1px solid var(--dk-border-s); background:var(--dk-card); border-radius:8px; width:26px; height:26px; font-size:12px; color:var(--dk-text2); line-height:1; cursor:pointer; }
    .srm-icon-btn:hover { background:var(--dk-hover); }
    .srm-sum-urledit { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:4px; }
    .srm-sum-urledit input { flex:1; min-width:180px; padding:7px 10px; border-radius:8px; border:1px solid var(--dk-border-s); font-size:13px; color:var(--dk-text); background:var(--dk-card); }
    .srm-sum-urledit input:focus { outline:none; border-color:var(--dk-accent); }

    /* ---- inline comment edit (Feature 3) ---- */
    .sr-modal-comment-edit-btn, .sr-modal-reply-edit-btn { border:none; background:none; color:var(--dk-text2); font-size:11.5px; font-weight:600; cursor:pointer; padding:1px 3px; margin-left:6px; }
    .sr-modal-comment-edit-btn:hover, .sr-modal-reply-edit-btn:hover { text-decoration:underline; color:var(--dk-accent); }
    .sr-modal-edit-box textarea { width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--dk-border-s); font-size:13px; color:var(--dk-text); font-family:inherit; margin-top:4px; }
    .sr-modal-edit-box textarea:focus { outline:none; border-color:var(--dk-accent); }
    .sr-modal-edit-actions { display:flex; gap:8px; align-items:center; margin-top:6px; }
  `;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div id="signoffReviewOverlay" class="overlay hidden">
      <div class="modal">
        <div class="modal-head">
          <h3 id="signoffReviewTitle">Signoff Review</h3>
          <button class="x" onclick="closeSignoffReviewModal()">×</button>
        </div>
        <div class="modal-body" id="signoffReviewBody">
          <div class="loading">กำลังโหลด...</div>
        </div>
        <div class="modal-foot">
          <a class="btn" id="signoffReviewFullLink" href="signoff-review.html" target="_blank" rel="noopener">เปิดหน้าเต็ม ↗</a>
          <span class="spacer" style="flex:1"></span>
          <button class="btn" onclick="closeSignoffReviewModal()">ปิด</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap.firstElementChild);

  // ESC: if a comment/URL edit box is open, cancel *that* first; otherwise close the modal.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const ov = $('signoffReviewOverlay');
    if (!ov || ov.classList.contains('hidden')) return;
    if (_editingCommentId != null) { if (_commentAttach) _commentAttach.clear(); _editingCommentId = null; renderSignoffReviewModal(); return; }
    if (_urlEditing) { _urlEditing = false; renderSignoffReviewModal(); return; }
    if (_rootEditing) { if (_rootAttach) _rootAttach.clear(); _rootEditing = false; renderSignoffReviewModal(); return; }
    window.closeSignoffReviewModal();
  });

  // click outside the modal card (on the overlay backdrop) -> close immediately
  $('signoffReviewOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'signoffReviewOverlay') window.closeSignoffReviewModal();
  });

  // delegated click handler for the Signoff URL edit control + per-comment edit controls
  // (delegated because signoffReviewBody's innerHTML is fully replaced on every render)
  $('signoffReviewBody').addEventListener('click', onSignoffReviewBodyClick);
}

/* ============ PUBLIC ENTRY POINT ============ */
window.openSignoffReviewModal = async function (pk, projectName) {
  if (!pk) return;
  ensureModal();
  if (projectName) _projectNameByKey[pk] = projectName;
  _urlEditing = false;
  _editingCommentId = null;
  _rootEditing = false;
  _rootAttach = null;
  _commentAttach = null;
  _lastLoad = null;
  $('signoffReviewFullLink').href = 'signoff-review.html?project=' + encodeURIComponent(pk);
  $('signoffReviewOverlay').classList.remove('hidden');
  await loadSignoffReviewModal(pk);
};
window.closeSignoffReviewModal = function () {
  const ov = $('signoffReviewOverlay');
  if (ov) ov.classList.add('hidden');
  if (_rootAttach) _rootAttach.clear();
  if (_commentAttach) _commentAttach.clear();
  _urlEditing = false;
  _editingCommentId = null;
  _rootEditing = false;
};

/* ============ LOAD ============ */
async function loadSignoffReviewModal(pk) {
  $('signoffReviewBody').innerHTML = '<div class="loading">กำลังโหลด...</div>';
  try {
    await ensureLookups();

    const [rootRes, cmtRes, projRes] = await Promise.all([
      supabase.from('signoff_comment')
        .select('id,body,author_email,created_at,edited_at')
        .eq('project_key', pk).eq('is_root', true).is('deleted_at', null).maybeSingle(),
      supabase.from('signoff_comment')
        .select('id,parent_id,is_root,author_email,body,created_at,edited_at')
        .eq('project_key', pk).is('deleted_at', null).eq('is_root', false)
        .order('created_at', { ascending: true }),
      // Feature 1: project facts for the summary card. Failure here degrades gracefully
      // (see buildSummaryCardHTML) — it must not block the thread from loading.
      supabase.from('v_project_wide')
        .select('project_key,project_name,app,other_app,uat_lead,status,signoff_date,deploy_date,signoff_url,project_note')
        .eq('project_key', pk).maybeSingle(),
    ]);

    if (rootRes.error) throw rootRes.error;
    if (cmtRes.error) throw cmtRes.error;
    if (projRes.error) console.warn('loadSignoffReviewModal: project row load failed', projRes.error);

    const rootRow = rootRes.data;
    const projRow = projRes.error ? null : projRes.data;
    if (projRow && projRow.project_name) _projectNameByKey[pk] = projRow.project_name;

    const topLevel = [], byParent = {};
    (cmtRes.data || []).forEach(c => {
      if (c.parent_id == null) topLevel.push(c);
      else (byParent[c.parent_id] ||= []).push(c);
    });

    // รูปที่แนบไว้ (screenshot) ของทุกคอมเมนต์ในเธรดนี้ รวม root ด้วย
    const attIds = (cmtRes.data || []).map(c => c.id);
    if (rootRow) attIds.push(rootRow.id);
    const attachmentsByComment = await fetchSignoffAttachments(attIds);

    _lastLoad = { pk, rootRow, topLevel, byParent, projRow, attachmentsByComment };
    renderSignoffReviewModal();
  } catch (err) {
    console.warn('loadSignoffReviewModal error', err);
    $('signoffReviewBody').innerHTML = `<div class="loading" style="color:var(--danger)">โหลดไม่สำเร็จ: ${esc(err.message || String(err))}</div>`;
  }
}

/* ============ RENDER — project summary card (Feature 1 + 2) ============ */
function buildSummaryCardHTML(pk, projectName, projRow) {
  if (!projRow) {
    return `
      <div class="srm-sum-card">
        <div class="srm-sum-head">
          <div class="srm-sum-title">${esc(projectName)}</div>
          <span class="srm-sum-pin">📌 SIGNOFF REVIEW</span>
        </div>
        <div class="muted" style="padding:10px 0 2px">โหลดข้อมูลโปรเจกต์ไม่สำเร็จ</div>
      </div>`;
  }

  let appDisp = appNameOf(projRow);
  if (projRow.other_app) appDisp += ` / ${projRow.other_app}`;
  const leadDisp = projRow.uat_lead || '—';
  const signoffDisp = projRow.signoff_date ? dDisp(projRow.signoff_date) : '—';
  const goLiveDisp = projRow.deploy_date ? dDisp(projRow.deploy_date) : '—';
  const noteRaw = projRow.project_note || '';

  return `
    <div class="srm-sum-card">
      <div class="srm-sum-head">
        <div class="srm-sum-title">${esc(projectName)}</div>
        <span class="srm-sum-pin">📌 SIGNOFF REVIEW</span>
      </div>
      <div class="srm-sum-grid">
        <div><span class="srm-sum-label">แอป (App)</span><span class="srm-sum-val">${esc(appDisp)}</span></div>
        <div><span class="srm-sum-label">UAT Lead</span><span class="srm-sum-val">${esc(leadDisp)}</span></div>
        <div><span class="srm-sum-label">Signoff Date</span><span class="srm-sum-val">${esc(signoffDisp)}</span></div>
        <div><span class="srm-sum-label">Target Go-Live</span><span class="srm-sum-val">${esc(goLiveDisp)}</span></div>
      </div>
      <div class="srm-sum-urlrow">${buildUrlRowHTML(pk, projRow.signoff_url)}</div>
      <div class="srm-sum-divider"></div>
      <div class="srm-sum-notehead">Note</div>
      <div class="srm-sum-note">${noteRaw ? esc(noteRaw) : '<span class="muted">— ไม่มีรายละเอียด —</span>'}</div>
    </div>`;
}

function buildUrlRowHTML(pk, url) {
  if (_urlEditing) {
    return `
      <div class="srm-sum-urledit">
        <input type="text" id="signoffReviewUrlInput" placeholder="https://..." value="${esc(url || '')}">
        <button class="btn sm accent" data-action="url-save" data-pk="${esc(pk)}">บันทึก</button>
        <button class="btn sm" data-action="url-cancel">ยกเลิก</button>
      </div>
      <div class="form-err" id="signoffReviewUrlErr"></div>`;
  }
  const linkHtml = url
    ? `<a class="srm-doc-btn" href="${esc(url)}" target="_blank" rel="noopener">📄 เอกสาร Signoff</a>`
    : `<span class="muted">— ไม่มีเอกสาร Signoff —</span>`;
  return `
    <div class="srm-sum-urlview">
      ${linkHtml}
      <button class="srm-icon-btn" data-action="url-edit" data-pk="${esc(pk)}" title="แก้ไข Signoff URL">✏️</button>
    </div>`;
}

/* ============ RENDER — thread comments (Feature 3) ============ */
function commentHeaderHTML(c) {
  const mine = _lookup.me && c.author_email === _lookup.me;
  const edited = c.edited_at ? ' (แก้ไขแล้ว)' : '';
  const editBtn = mine
    ? `<button class="sr-modal-comment-edit-btn" data-action="comment-edit" data-cid="${c.id}">✏️ แก้ไข</button>`
    : '';
  return `<b>${esc(shortEmail(c.author_email))}</b> <span class="muted">${esc(commentTimeShort(c.created_at))}${edited}</span>${editBtn}`;
}
/** รูปที่แนบไว้แล้วของคอมเมนต์ id หนึ่ง — จาก _lastLoad.attachmentsByComment ที่โหลดมาพร้อมเธรด */
function attsFor(id) {
  return (_lastLoad && _lastLoad.attachmentsByComment[id]) || [];
}
function commentEditBoxHTML(c) {
  return `
    <div class="sr-modal-edit-box">
      <textarea class="sr-modal-comment-edit-text" rows="3">${esc(c.body || '')}</textarea>
      ${attachmentThumbsHTML(attsFor(c.id), _lookup.me)}
      <div class="att-chip-row" id="srmCommentAttRow"></div>
      <div class="form-err sr-modal-comment-edit-err"></div>
      <div class="sr-modal-edit-actions">
        <button class="btn sm accent" data-action="comment-save" data-cid="${c.id}">บันทึก</button>
        <button class="btn sm" data-action="comment-cancel">ยกเลิก</button>
      </div>
    </div>`;
}
function buildCommentGroupHTML(c, byParent) {
  const replies = byParent[c.id] || [];
  const editing = _editingCommentId === c.id;
  const body = editing
    ? `<div class="sr-modal-comment-top"><b>${esc(shortEmail(c.author_email))}</b></div>${commentEditBoxHTML(c)}`
    : `<div class="sr-modal-comment-top">${commentHeaderHTML(c)}</div><div class="sr-modal-comment-text">${esc(c.body)}</div>${attachmentThumbsHTML(attsFor(c.id), _lookup.me)}`;
  return `
    <div class="sr-modal-comment" data-cid="${c.id}">
      ${body}
      ${replies.map(r => buildReplyGroupHTML(r)).join('')}
    </div>`;
}
function buildReplyGroupHTML(r) {
  const editing = _editingCommentId === r.id;
  const body = editing
    ? `<b>${esc(shortEmail(r.author_email))}</b>${commentEditBoxHTML(r)}`
    : `${commentHeaderHTML(r)}<div>${esc(r.body)}</div>${attachmentThumbsHTML(attsFor(r.id), _lookup.me)}`;
  return `<div class="sr-modal-reply" data-cid="${r.id}">${body}</div>`;
}

/* ============ RENDER — full body ============ */
function renderSignoffReviewModal() {
  if (!_lastLoad) return;
  const { pk, rootRow, topLevel, byParent, projRow } = _lastLoad;
  const projectName = (projRow && projRow.project_name) || _projectNameByKey[pk] || pk;
  $('signoffReviewTitle').textContent = 'Signoff Review — ' + projectName;

  const summaryHtml = buildSummaryCardHTML(pk, projectName, projRow);

  const rootHtml = buildRootCardHTML(pk, rootRow);

  const threadHtml = topLevel.length
    ? topLevel.map(c => buildCommentGroupHTML(c, byParent)).join('')
    : `<div class="muted" style="padding:8px 0">ยังไม่มีความคิดเห็น</div>`;

  $('signoffReviewBody').innerHTML = `
    ${summaryHtml}
    ${rootHtml}
    <div class="sr-modal-thread-title">ความคิดเห็นในห้อง (${topLevel.length + (rootRow ? 1 : 0)})</div>
    ${threadHtml}
  `;

  // โหลดรูปย่อของทุกคอมเมนต์ที่เพิ่ง render + ผูก paste-to-attach ใหม่ให้ช่องแก้ไขที่เปิดอยู่ (ถ้ามี)
  hydrateAttachmentThumbs($('signoffReviewBody'));
  _rootAttach = _rootEditing ? createAttachComposer($('srmRootAttRow'), $('signoffReviewText')) : null;
  _commentAttach = _editingCommentId != null
    ? createAttachComposer($('srmCommentAttRow'), document.querySelector('.sr-modal-comment-edit-text'))
    : null;
}

/**
 * Root "Signoff Review" card.
 * - view mode (default): read-only body + ✏️ button, shown ONLY to the card's own author
 *   (same rule as comments/replies: author_email === current session email).
 * - edit mode: textarea + บันทึก/ยกเลิก — opened by ✏️, or by "เพิ่ม Signoff Review"
 *   when the project has no root card yet (anyone logged in may create the first one;
 *   the RPC fn_upsert_signoff_review still enforces can_write()).
 */
function buildRootCardHTML(pk, rootRow) {
  if (_rootEditing) {
    return `
      <div class="field" style="margin-top:6px">
        <label>${rootRow ? 'แก้ไข Signoff Review' : 'เพิ่ม Signoff Review'}</label>
        <textarea id="signoffReviewText" rows="6">${esc(rootRow ? (rootRow.body || '') : '')}</textarea>
      </div>
      ${rootRow ? attachmentThumbsHTML(attsFor(rootRow.id), _lookup.me) : ''}
      <div class="att-chip-row" id="srmRootAttRow"></div>
      <div class="sr-modal-edit-actions" style="margin-bottom:6px">
        <div class="form-err" id="signoffReviewErr" style="margin-right:auto"></div>
        <button class="btn accent sm" data-action="root-save" data-pk="${esc(pk)}">บันทึก</button>
        <button class="btn sm" data-action="root-cancel">ยกเลิก</button>
      </div>`;
  }

  if (!rootRow) {
    return `
      <div class="muted" style="margin-bottom:6px">ยังไม่มี Signoff Review สำหรับโปรเจกต์นี้</div>
      <div style="margin-bottom:10px">
        <button class="btn sm accent" data-action="root-add">＋ เพิ่ม Signoff Review</button>
      </div>`;
  }

  const mine = _lookup.me && rootRow.author_email === _lookup.me;
  const editBtn = mine
    ? `<button class="srm-icon-btn" data-action="root-edit" title="แก้ไข Signoff Review">✏️</button>`
    : '';
  return `
    <div class="sr-modal-card">
      <div class="sr-modal-card-head">
        <div class="sr-modal-card-meta">โดย ${esc(shortEmail(rootRow.author_email))} · ${rootRow.created_at ? dDisp(rootRow.created_at.slice(0, 10)) : ''}${rootRow.edited_at ? ' (แก้ไขแล้ว)' : ''}</div>
        ${editBtn}
      </div>
      <div class="sr-modal-card-body">${esc(rootRow.body || '')}</div>
      ${attachmentThumbsHTML(attsFor(rootRow.id), _lookup.me)}
    </div>`;
}

/* ============ ACTIONS — Signoff URL edit / comment edit (delegated clicks) ============ */
async function onSignoffReviewBodyClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'url-edit') { _urlEditing = true; renderSignoffReviewModal(); return; }
  if (action === 'url-cancel') { _urlEditing = false; renderSignoffReviewModal(); return; }
  if (action === 'url-save') { await saveSignoffUrl(btn.dataset.pk); return; }

  if (action === 'root-edit' || action === 'root-add') { if (_rootAttach) _rootAttach.clear(); _rootEditing = true; renderSignoffReviewModal(); return; }
  if (action === 'root-cancel') { if (_rootAttach) _rootAttach.clear(); _rootEditing = false; renderSignoffReviewModal(); return; }
  if (action === 'root-save') { await window.saveSignoffReviewModal(btn.dataset.pk); return; }

  if (action === 'comment-edit') { if (_commentAttach) _commentAttach.clear(); _editingCommentId = Number(btn.dataset.cid); renderSignoffReviewModal(); return; }
  if (action === 'comment-cancel') { if (_commentAttach) _commentAttach.clear(); _editingCommentId = null; renderSignoffReviewModal(); return; }
  if (action === 'comment-save') { await saveCommentEdit(Number(btn.dataset.cid)); return; }

  if (action === 'att-delete') { await onAttachmentDelete(btn); return; }
}

/** ลบรูปที่แนบไว้แล้ว (ทั้งตอนดูปกติและตอนเปิดกล่องแก้ไข) — ลบทันที ไม่ต้องกด "บันทึก" */
async function onAttachmentDelete(btn) {
  const { error } = await deleteSignoffAttachment({ id: Number(btn.dataset.attId), storage_path: btn.dataset.attPath });
  if (error) { toast('ลบรูปไม่สำเร็จ: ' + (error.message || ''), true); return; }
  toast('ลบรูปแล้ว ✓');
  const pk = _lastLoad ? _lastLoad.pk : null;
  if (pk) await loadSignoffReviewModal(pk);
}

async function saveSignoffUrl(pk) {
  const input = $('signoffReviewUrlInput');
  const errEl = $('signoffReviewUrlErr');
  if (errEl) errEl.textContent = '';
  const v = input ? input.value.trim() : '';
  if (v && !/^https?:\/\//i.test(v)) {
    if (errEl) errEl.textContent = 'URL ต้องขึ้นต้นด้วย http:// หรือ https://';
    return;
  }
  try {
    const { data, error } = await supabase.from('project')
      .update({ signoff_url: v || null }).eq('project_key', pk).select();
    if (error) throw error;
    // RLS-blocked writes come back with 0 rows and no error — treat that as a failure.
    if (!data || !data.length) {
      if (errEl) errEl.textContent = 'บันทึกไม่สำเร็จ — บัญชีนี้ไม่มีสิทธิ์แก้ไข Signoff URL';
      return;
    }
    toast('บันทึก Signoff URL แล้ว ✓');
    _urlEditing = false;
    await loadSignoffReviewModal(pk);
  } catch (err) {
    if (errEl) errEl.textContent = 'บันทึกไม่สำเร็จ: ' + (err.message || String(err));
  }
}

async function saveCommentEdit(id) {
  const ta = document.querySelector('.sr-modal-comment-edit-text');
  const errEl = document.querySelector('.sr-modal-comment-edit-err');
  if (errEl) errEl.textContent = '';
  const v = ta ? ta.value.trim() : '';
  if (!v) { if (errEl) errEl.textContent = 'กรุณากรอกข้อความ'; return; }
  try {
    const { data, error } = await supabase.from('signoff_comment')
      .update({ body: v, edited_at: new Date().toISOString() })
      .eq('id', id).select();
    if (error) throw error;
    // RLS (signoff_comment_update: own rows only) silently returns 0 rows on block.
    if (!data || !data.length) {
      if (errEl) errEl.textContent = 'บันทึกไม่สำเร็จ — แก้ไขได้เฉพาะความคิดเห็นของตัวเอง';
      return;
    }
    const blobs = _commentAttach ? _commentAttach.getBlobs() : [];
    if (blobs.length) {
      const pkForUpload = _lastLoad ? _lastLoad.pk : null;
      const { failCount } = await uploadSignoffAttachments(pkForUpload, id, _lookup.me, blobs);
      if (failCount) toast(`บันทึกข้อความแล้ว แต่แนบรูปเพิ่มไม่สำเร็จ ${failCount} รูป`, true);
    }
    if (_commentAttach) _commentAttach.clear();
    toast('บันทึกความคิดเห็นแล้ว ✓');
    _editingCommentId = null;
    const pk = _lastLoad ? _lastLoad.pk : null;
    if (pk) await loadSignoffReviewModal(pk);
  } catch (err) {
    if (errEl) errEl.textContent = 'บันทึกไม่สำเร็จ: ' + (err.message || String(err));
  }
}

/* ============ SAVE (root Signoff Review — unchanged mechanism) ============ */
window.saveSignoffReviewModal = async function (pk) {
  const ta = $('signoffReviewText');
  const err = $('signoffReviewErr'); if (err) err.textContent = '';
  const body = ta ? ta.value.trim() : '';
  if (!body) { if (err) err.textContent = 'กรุณากรอกข้อความ Signoff Review'; return; }
  try {
    const { error } = await supabase.rpc('fn_upsert_signoff_review', { p_project_key: pk, p_body: body });
    if (error) throw error;

    const blobs = _rootAttach ? _rootAttach.getBlobs() : [];
    if (blobs.length) {
      // RPC ไม่คืน id ของแถว root กลับมา — select หา id จริงอีกทีก่อนผูกรูป (ปลอดภัยกว่าเดา)
      const { data: rootRow, error: selErr } = await supabase.from('signoff_comment')
        .select('id').eq('project_key', pk).eq('is_root', true).is('deleted_at', null).maybeSingle();
      if (selErr || !rootRow) {
        console.warn('saveSignoffReviewModal: could not resolve root id for attachments', selErr);
        toast('บันทึกข้อความแล้ว แต่แนบรูปไม่สำเร็จ (หา id ไม่เจอ)', true);
      } else {
        const { failCount } = await uploadSignoffAttachments(pk, rootRow.id, _lookup.me, blobs);
        if (failCount) toast(`บันทึกข้อความแล้ว แต่แนบรูปไม่สำเร็จ ${failCount} รูป`, true);
      }
    }
    if (_rootAttach) _rootAttach.clear();

    toast('บันทึก Signoff Review แล้ว ✓');
    _rootEditing = false;   // กลับไปโหมดอ่านอย่างเดียว (ช่องแก้ไม่ค้างเปิด)
    await loadSignoffReviewModal(pk);
  } catch (e) {
    if (err) err.textContent = 'บันทึกไม่สำเร็จ: ' + (e.message || String(e));
  }
};
