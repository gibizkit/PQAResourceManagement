/**
 * signoff.js — Review Signoff modal (Phase 2.3, port of GAS rev 19–26)
 *
 * ES module — self-registers `window.openSignoffReview(projectKey, projectName, signoffDate)`
 * at module load time. Injects its own modal DOM (once) into <body> the first time it's
 * called, styled with theme.css classes (.overlay/.modal/.field/.btn/...) plus a small
 * scoped <style> block for the few bits theme.css doesn't cover (pre-wrap description,
 * "(แก้ไข)" tag, modal width).
 *
 * Usage (from gantt.html):
 *   <script type="module" src="./signoff.js"></script>
 *   ...
 *   <button onclick="if (window.openSignoffReview) openSignoffReview(pk, projName, signoffDate)">🔎</button>
 *
 * Depends on: ./common.js (supabase, $, toast, esc, dDisp)
 */

import { supabase, $, toast, esc, dDisp } from './common.js';

/* ============ STATE ============ */
const _sr = {
  projectKey: null,
  projectName: null,
  signoffDate: null,
  rows: [],                 // signoff rows for current project (is_active=true)
  editingId: null,          // signoff_id being edited, null = "add new" mode
  userMap: {},               // user_id -> display_name (best-effort, RLS may limit to self)
  leadMap: {},               // emp_id  -> name_en
  currentUser: null,         // { user_id, display_name, pqa_emp_id } of logged-in user
};

/* ============ DATE HELPER ============ */
/**
 * 'yyyy-MM-ddTHH:mm:ss...' (timestamptz from Postgres) -> 'dd/MM/yyyy HH:mm:ss'
 * Uses the browser's local time (app is used internally, browsers are set to
 * Asia/Bangkok in practice — same assumption the rest of the webapp makes).
 */
function _fmtDT(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ============ MODAL DOM (lazy, injected once) ============ */
function ensureModal() {
  if ($('srOverlay')) return;

  const style = document.createElement('style');
  style.textContent = `
    #srOverlay .modal { width: 760px; }
    #srTableWrap { max-height: 360px; overflow: auto; }
    .sr-desc { white-space: pre-wrap; word-break: break-word; max-width: 320px; }
    .sr-updated-tag { font-size: 11px; color: var(--dk-text3); font-weight: 500; }
    #srFormArea textarea { min-height: 110px; resize: vertical; }
    #srFormFoot { display: flex; align-items: center; gap: 10px; justify-content: flex-end; margin-top: 10px; }
  `;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div id="srOverlay" class="overlay hidden">
      <div class="modal">
        <div class="modal-head">
          <h3 id="srTitle">Review Signoff</h3>
          <button class="x" type="button" id="srXBtn">×</button>
        </div>
        <div class="modal-body">
          <div id="srTableWrap" class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Created/Updated</th>
                  <th>Author Name</th>
                  <th>Description</th>
                  <th class="center">Action</th>
                </tr>
              </thead>
              <tbody id="srRows"><tr><td colspan="4" class="loading">กำลังโหลด...</td></tr></tbody>
            </table>
          </div>
          <div style="margin-top:14px">
            <button class="btn accent sm" type="button" id="srAddBtn">➕ Add new comment</button>
          </div>
          <div id="srFormArea" class="hidden" style="margin-top:12px">
            <div class="field">
              <label>Description</label>
              <textarea id="srDesc" rows="5" placeholder="พิมพ์ข้อความ Review..."></textarea>
            </div>
            <div id="srFormFoot">
              <div class="form-err" id="srFormErr"></div>
              <button class="btn" type="button" id="srCancelBtn">ยกเลิก</button>
              <button class="btn accent" type="button" id="srSaveBtn">บันทึก</button>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn" type="button" id="srCloseBtn">Close</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap.firstElementChild);

  $('srXBtn').addEventListener('click', closeSignoffModal);
  $('srCloseBtn').addEventListener('click', closeSignoffModal);
  $('srAddBtn').addEventListener('click', () => window.srStartAdd());
  $('srCancelBtn').addEventListener('click', () => window.srCancelAdd());
  $('srSaveBtn').addEventListener('click', () => window.srSave());

  // click outside the modal card (on the overlay backdrop itself) -> close immediately
  $('srOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'srOverlay') closeSignoffModal();
  });

  // ESC -> close immediately, no dirty-check warning (matches old rev 19b behavior:
  // mSignoffReview is a "display-ish" modal that always closes clean, even mid-typing)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const ov = $('srOverlay');
      if (ov && !ov.classList.contains('hidden')) closeSignoffModal();
    }
  });
}

function closeSignoffModal() {
  const ov = $('srOverlay');
  if (!ov) return;
  ov.classList.add('hidden');
  window.srCancelAdd();
}

/* ============ PUBLIC ENTRY POINT ============ */
window.openSignoffReview = async function (projectKey, projectName, signoffDate) {
  ensureModal();
  _sr.projectKey = projectKey;
  _sr.projectName = projectName;
  _sr.signoffDate = signoffDate;
  _sr.editingId = null;

  $('srTitle').textContent =
    `Review Signoff : ${projectName || ''} | ${signoffDate ? dDisp(signoffDate) : '-'}`;

  window.srCancelAdd();
  $('srOverlay').classList.remove('hidden');
  await srLoad();
};

/* ============ CURRENT USER META (for author_emp_id on insert) ============ */
async function _getCurrentUserMeta() {
  if (_sr.currentUser) return _sr.currentUser;
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData && sessionData.session;
  if (!session) return null;

  const { data: u } = await supabase.from('app_user')
    .select('user_id,display_name,pqa_emp_id')
    .eq('user_id', session.user.id)
    .maybeSingle();

  _sr.currentUser = u || { user_id: session.user.id, display_name: session.user.email, pqa_emp_id: null };
  return _sr.currentUser;
}

/* ============ LOAD ============ */
async function srLoad() {
  $('srRows').innerHTML = '<tr><td colspan="4" class="loading">กำลังโหลด...</td></tr>';

  const [histRes, usersRes, leadsRes] = await Promise.all([
    supabase.from('signoff')
      .select('signoff_id,project_key,author_emp_id,description,is_active,created_by,created_at,updated_by,updated_at')
      .eq('project_key', _sr.projectKey)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    // best-effort: RLS (app_user_read_self) means non-admin callers may only see
    // their own row here — that's expected, see fallback via pqa_lead below.
    supabase.from('app_user').select('user_id,display_name'),
    supabase.from('pqa_lead').select('emp_id,name_en'),
  ]);

  if (histRes.error) {
    $('srRows').innerHTML =
      `<tr><td colspan="4" class="loading" style="color:var(--danger)">โหลดไม่สำเร็จ: ${esc(histRes.error.message)}</td></tr>`;
    return;
  }

  _sr.userMap = {};
  (usersRes.data || []).forEach(u => { _sr.userMap[u.user_id] = u.display_name; });

  _sr.leadMap = {};
  (leadsRes.data || []).forEach(l => { _sr.leadMap[l.emp_id] = l.name_en; });

  _sr.rows = histRes.data || [];
  srRenderTable();
}

/* ============ RENDER ============ */
function _resolveAuthorName(row, actorUid) {
  if (actorUid && _sr.userMap[actorUid]) return _sr.userMap[actorUid];
  if (row.author_emp_id && _sr.leadMap[row.author_emp_id]) return _sr.leadMap[row.author_emp_id];
  return '-';
}

function srRenderTable() {
  if (!_sr.rows.length) {
    $('srRows').innerHTML = '<tr><td colspan="4" class="loading">ยังไม่มี Comment</td></tr>';
    return;
  }

  $('srRows').innerHTML = _sr.rows.map(r => {
    const wasUpdated = !!(r.updated_at && r.created_at && new Date(r.updated_at) > new Date(r.created_at));
    const dateVal = wasUpdated ? r.updated_at : r.created_at;
    const actorUid = wasUpdated ? r.updated_by : r.created_by;
    const authorName = _resolveAuthorName(r, actorUid);

    return `<tr>
      <td>${esc(_fmtDT(dateVal))}${wasUpdated ? ' <span class="sr-updated-tag">(แก้ไข)</span>' : ''}</td>
      <td>${esc(authorName)}</td>
      <td class="sr-desc">${esc(r.description || '')}</td>
      <td class="center">
        <button class="btn sm" onclick="srEditInline('${esc(r.signoff_id)}')">✏️</button>
        <button class="btn sm danger" onclick="srDelete('${esc(r.signoff_id)}')">🗑️</button>
      </td>
    </tr>`;
  }).join('');
}

/* ============ ADD / EDIT / CANCEL ============ */
window.srStartAdd = function () {
  _sr.editingId = null;
  $('srDesc').value = '';
  $('srFormErr').textContent = '';
  $('srFormArea').classList.remove('hidden');
  $('srAddBtn').classList.add('hidden');
  $('srDesc').focus();
};

window.srEditInline = function (signoffId) {
  const row = _sr.rows.find(r => r.signoff_id === signoffId);
  if (!row) return;
  _sr.editingId = signoffId;
  $('srDesc').value = row.description || '';
  $('srFormErr').textContent = '';
  $('srFormArea').classList.remove('hidden');
  $('srAddBtn').classList.add('hidden');
  $('srDesc').focus();
};

window.srCancelAdd = function () {
  _sr.editingId = null;
  const desc = $('srDesc');
  if (desc) desc.value = '';
  const err = $('srFormErr');
  if (err) err.textContent = '';
  const area = $('srFormArea');
  if (area) area.classList.add('hidden');
  const addBtn = $('srAddBtn');
  if (addBtn) addBtn.classList.remove('hidden');
};

/* ============ SAVE / DELETE ============ */
function _srSetSaving(isSaving) {
  const saveBtn = $('srSaveBtn');
  const cancelBtn = $('srCancelBtn');
  if (saveBtn) {
    saveBtn.disabled = isSaving;
    saveBtn.textContent = isSaving ? 'Saving...' : 'บันทึก';
  }
  if (cancelBtn) cancelBtn.disabled = isSaving;
}

/**
 * Fire-and-forget notification — a failed send must NEVER block/undo the save.
 */
function _notifySignoffMail(projectKey) {
  supabase.functions.invoke('send-signoff-mail', { body: { project_key: projectKey } })
    .catch(e => console.warn('send-signoff-mail invoke failed (ignored):', e));
}

window.srSave = async function () {
  const err = $('srFormErr');
  err.textContent = '';
  const desc = $('srDesc').value.trim();
  if (!desc) {
    err.textContent = 'กรุณากรอกข้อความ Review';
    return;
  }

  _srSetSaving(true);
  try {
    if (_sr.editingId) {
      const { error } = await supabase.from('signoff')
        .update({ description: desc })
        .eq('signoff_id', _sr.editingId);
      if (error) throw error;
    } else {
      const { data: newId, error: idErr } = await supabase
        .rpc('fn_next_signoff_id', { p_project_key: _sr.projectKey });
      if (idErr) throw idErr;

      const meta = await _getCurrentUserMeta();
      const { error } = await supabase.from('signoff').insert({
        signoff_id: newId,
        project_key: _sr.projectKey,
        author_emp_id: (meta && meta.pqa_emp_id) || null,
        description: desc,
      });
      if (error) throw error;
    }

    window.srCancelAdd();
    await srLoad();
    toast('บันทึกแล้ว ✓');
    _notifySignoffMail(_sr.projectKey);   // best-effort, never blocks the save
  } catch (e) {
    err.textContent = 'บันทึกไม่สำเร็จ: ' + (e && e.message ? e.message : e);
  } finally {
    _srSetSaving(false);
  }
};

window.srDelete = async function (signoffId) {
  if (!confirm('ยืนยันลบ Comment นี้?')) return;
  const { error } = await supabase.from('signoff')
    .update({ is_active: false })
    .eq('signoff_id', signoffId);
  if (error) {
    toast('ลบไม่สำเร็จ: ' + error.message, true);
    return;
  }
  toast('ลบแล้ว ✓');
  // no email on delete — matches old rev 19 behavior
  await srLoad();
};
