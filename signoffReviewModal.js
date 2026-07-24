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
 * for the .sr-modal-* bits theme.css doesn't cover (all colors via CSS variables).
 *
 * Usage:
 *   <script type="module" src="./signoffReviewModal.js"></script>
 *   ...
 *   <button onclick="window.openSignoffReviewModal(pk, projectName)">🔎</button>
 *
 * Depends on: ./common.js (supabase, $, toast, esc, dDisp)
 */

import { supabase, $, toast, esc, dDisp } from './common.js';

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

/* ============ MODAL DOM (lazy, injected once) ============ */
function ensureModal() {
  if ($('signoffReviewOverlay')) return;

  const style = document.createElement('style');
  style.textContent = `
    #signoffReviewOverlay .modal { width:720px; }
    .sr-modal-card { background:var(--dk-surface); border:1px solid var(--dk-border); border-radius:10px; padding:12px 14px; margin-bottom:10px; }
    .sr-modal-card-meta { font-size:11px; color:var(--dk-text3); margin-bottom:6px; }
    .sr-modal-card-body { font-size:13.5px; color:var(--dk-text); line-height:1.55; white-space:pre-wrap; }
    .sr-modal-thread-title { font-weight:700; font-size:13px; color:var(--dk-text); margin:14px 0 6px; }
    .sr-modal-comment { padding:8px 0; border-top:1px solid var(--dk-border); }
    .sr-modal-comment:first-child { border-top:none; }
    .sr-modal-comment-top { font-size:12px; color:var(--dk-text2); }
    .sr-modal-comment-text { font-size:13px; color:var(--dk-text); margin-top:3px; white-space:pre-wrap; }
    .sr-modal-reply { margin:6px 0 0 16px; padding:6px 10px; background:var(--dk-surface); border-radius:8px; font-size:12.5px; color:var(--dk-text); }
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

  // ESC closes this modal — self-contained so any host page gets the behavior for free.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const ov = $('signoffReviewOverlay');
    if (ov && !ov.classList.contains('hidden')) window.closeSignoffReviewModal();
  });

  // click outside the modal card (on the overlay backdrop) -> close immediately
  $('signoffReviewOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'signoffReviewOverlay') window.closeSignoffReviewModal();
  });
}

/* ============ PUBLIC ENTRY POINT ============ */
window.openSignoffReviewModal = async function (pk, projectName) {
  if (!pk) return;
  ensureModal();
  if (projectName) _projectNameByKey[pk] = projectName;
  $('signoffReviewFullLink').href = 'signoff-review.html?project=' + encodeURIComponent(pk);
  $('signoffReviewOverlay').classList.remove('hidden');
  await loadSignoffReviewModal(pk);
};
window.closeSignoffReviewModal = function () {
  const ov = $('signoffReviewOverlay');
  if (ov) ov.classList.add('hidden');
};

/* ============ LOAD ============ */
async function loadSignoffReviewModal(pk) {
  $('signoffReviewBody').innerHTML = '<div class="loading">กำลังโหลด...</div>';
  try {
    const { data: rootRow, error: rootErr } = await supabase.from('signoff_comment')
      .select('id,body,author_email,created_at,edited_at')
      .eq('project_key', pk).eq('is_root', true).is('deleted_at', null).maybeSingle();
    if (rootErr) throw rootErr;

    const { data: cmtRows, error: cmtErr } = await supabase.from('signoff_comment')
      .select('id,parent_id,is_root,author_email,body,created_at')
      .eq('project_key', pk).is('deleted_at', null).eq('is_root', false)
      .order('created_at', { ascending: true });
    if (cmtErr) throw cmtErr;

    const topLevel = [], byParent = {};
    (cmtRows || []).forEach(c => {
      if (c.parent_id == null) topLevel.push(c);
      else (byParent[c.parent_id] ||= []).push(c);
    });

    renderSignoffReviewModal(pk, rootRow, topLevel, byParent);
  } catch (err) {
    console.warn('loadSignoffReviewModal error', err);
    $('signoffReviewBody').innerHTML = `<div class="loading" style="color:var(--danger)">โหลดไม่สำเร็จ: ${esc(err.message || String(err))}</div>`;
  }
}

/* ============ RENDER ============ */
function renderSignoffReviewModal(pk, rootRow, topLevel, byParent) {
  const projectName = _projectNameByKey[pk] || pk;
  $('signoffReviewTitle').textContent = 'Signoff Review — ' + projectName;

  const cardHtml = rootRow
    ? `<div class="sr-modal-card">
        <div class="sr-modal-card-meta">โดย ${esc(shortEmail(rootRow.author_email))} · ${rootRow.created_at ? dDisp(rootRow.created_at.slice(0, 10)) : ''}${rootRow.edited_at ? ' (แก้ไขแล้ว)' : ''}</div>
        <div class="sr-modal-card-body">${esc(rootRow.body || '')}</div>
      </div>`
    : `<div class="muted" style="margin-bottom:10px">ยังไม่มี Signoff Review สำหรับโปรเจกต์นี้ — เพิ่มได้ด้านล่าง</div>`;

  const threadHtml = topLevel.length
    ? topLevel.map(c => `
        <div class="sr-modal-comment">
          <div class="sr-modal-comment-top"><b>${esc(shortEmail(c.author_email))}</b> <span class="muted">${esc(commentTimeShort(c.created_at))}</span></div>
          <div class="sr-modal-comment-text">${esc(c.body)}</div>
          ${(byParent[c.id] || []).map(r => `
            <div class="sr-modal-reply">
              <b>${esc(shortEmail(r.author_email))}</b> <span class="muted">${esc(commentTimeShort(r.created_at))}</span>
              <div>${esc(r.body)}</div>
            </div>`).join('')}
        </div>`).join('')
    : `<div class="muted" style="padding:8px 0">ยังไม่มีความคิดเห็น</div>`;

  $('signoffReviewBody').innerHTML = `
    ${cardHtml}
    <div class="field" style="margin-top:6px">
      <label>${rootRow ? 'แก้ไข Signoff Review' : 'เพิ่ม Signoff Review'}</label>
      <textarea id="signoffReviewText" rows="4">${esc(rootRow ? (rootRow.body || '') : '')}</textarea>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <div class="form-err" id="signoffReviewErr" style="margin-right:auto"></div>
      <button class="btn accent sm" onclick="saveSignoffReviewModal('${esc(pk)}')">บันทึก</button>
    </div>
    <div class="sr-modal-thread-title">ความคิดเห็นในห้อง (${topLevel.length + (rootRow ? 1 : 0)})</div>
    ${threadHtml}
  `;
}

/* ============ SAVE ============ */
window.saveSignoffReviewModal = async function (pk) {
  const ta = $('signoffReviewText');
  const err = $('signoffReviewErr'); if (err) err.textContent = '';
  const body = ta ? ta.value.trim() : '';
  if (!body) { if (err) err.textContent = 'กรุณากรอกข้อความ Signoff Review'; return; }
  try {
    const { error } = await supabase.rpc('fn_upsert_signoff_review', { p_project_key: pk, p_body: body });
    if (error) throw error;
    toast('บันทึก Signoff Review แล้ว ✓');
    await loadSignoffReviewModal(pk);
  } catch (e) {
    if (err) err.textContent = 'บันทึกไม่สำเร็จ: ' + (e.message || String(e));
  }
};
