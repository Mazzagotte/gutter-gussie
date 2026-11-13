// Club admin: review membership applications and edit site settings. No build step.
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const S = { status: 'new', q: '', apps: [], counts: {}, selected: null, detail: null };

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids.flat().filter((k) => k != null && k !== false && k !== ''));
  return n;
}

async function api(path, opts = {}) {
  const res = await fetch('/api/admin' + path, {
    ...opts,
    headers: { 'x-requested-with': 'gg-admin', ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) { toast('Your sign-in expired. Reloading…', true); setTimeout(() => location.reload(), 1500); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

const fmtDay = (d) => {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const fmtWhen = (ms) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const STATUS_LABEL = { new: 'New', approved: 'Approved', declined: 'Declined' };

/* ---------- tabs ---------- */
function showTab() {
  const tab = location.hash === '#settings' ? 'settings' : 'applications';
  document.querySelectorAll('[data-tab]').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('#tab-applications').hidden = tab !== 'applications';
  $('#tab-settings').hidden = tab !== 'settings';
  if (tab === 'settings') loadSettings();
}
window.addEventListener('hashchange', showTab);

/* ---------- list ---------- */
async function loadList(keepSelection = true) {
  const params = new URLSearchParams({ status: S.status });
  if (S.q) params.set('q', S.q);
  try {
    const data = await api('/applications?' + params);
    S.apps = data.applications;
    S.counts = data.counts;
  } catch (e) {
    toast(e.message, true);
    return;
  }
  document.querySelectorAll('[data-status]').forEach((b) => { b.querySelector('span').textContent = S.counts[b.dataset.status] ?? ''; });
  const badge = $('#new-badge');
  badge.textContent = S.counts.new || '';
  badge.hidden = !S.counts.new;
  $('#export').href = '/api/admin/export.csv?status=' + S.status;
  renderList();
  if (!keepSelection) closeDetail();
}

function renderList() {
  const list = $('#list');
  list.replaceChildren(...S.apps.map((a) => h('li', {},
    h('button', { type: 'button', 'aria-current': a.id === S.selected ? 'true' : null, onclick: () => openDetail(a.id) },
      h('span', { class: 'nm' }, a.full_name),
      h('span', { class: 'sc' }, String(a.score)),
      h('span', { class: 'meta' }, `${a.ref} · ${a.city} · ${a.submitted_at ? fmtWhen(a.submitted_at) : ''}`),
      h('span', { class: 'flags' },
        S.status === 'all' ? h('span', { class: 'pill ' + a.status }, STATUS_LABEL[a.status]) : null,
        h('span', { class: 'pill ' + (a.proof_ok ? 'ok' : 'warn') }, a.proof_ok ? 'Proof ✓' : a.proof_method === 'mail' ? 'Proof by mail' : `${a.files} file${a.files === 1 ? '' : 's'}`),
        h('span', { class: 'pill ' + (a.fee_paid ? 'ok' : 'warn') }, a.fee_paid ? 'Paid ✓' : 'Fee due'))))));
  const empty = $('#empty');
  empty.hidden = S.apps.length > 0;
  empty.textContent = S.q ? 'No applications match that search.' : S.status === 'new' ? 'No new applications. Nice and tidy.' : 'Nothing here yet.';
}

document.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
  S.status = b.dataset.status;
  document.querySelectorAll('[data-status]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  loadList();
}));
let qTimer;
$('#q').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.q = e.target.value.trim(); loadList(); }, 250); });

/* ---------- detail ---------- */
function closeDetail() {
  S.selected = null;
  S.detail = null;
  $('#detail').hidden = true;
  $('#detail-empty').hidden = false;
  $('.split').classList.remove('has-detail');
  renderList();
}

async function openDetail(id) {
  S.selected = id;
  renderList();
  try {
    S.detail = await api('/applications/' + id);
  } catch (e) {
    toast(e.message, true);
    return;
  }
  renderDetail();
  $('.split').classList.add('has-detail');
  if (window.matchMedia('(max-width:900px)').matches) { $('#detail').focus({ preventScroll: true }); window.scrollTo({ top: 0 }); }
}

async function patch(body, okMsg) {
  try {
    S.detail = await api('/applications/' + S.selected, { method: 'PATCH', body: JSON.stringify(body) });
    renderDetail();
    if (okMsg) toast(okMsg);
    loadList();
  } catch (e) {
    toast(e.message, true);
  }
}

function scoreAge(a) {
  if (!a.submitted_at) return null;
  const [y, m, d] = a.score_date.split('-').map(Number);
  const days = Math.round((a.submitted_at - new Date(y, m - 1, d).getTime()) / 86400000);
  return days;
}

function renderDetail() {
  const { application: a, files, log } = S.detail;
  const box = $('#detail');
  const age = scoreAge(a);
  const statusBtns = [];
  if (a.status !== 'approved') statusBtns.push(h('button', { class: 'btn good', type: 'button', onclick: () => {
    if ((!a.proof_ok || !a.fee_paid) && !confirm('Proof and fee aren’t both marked as received. Approve anyway?')) return;
    patch({ status: 'approved' }, 'Membership approved');
  } }, 'Approve'));
  if (a.status !== 'declined') statusBtns.push(h('button', { class: 'btn danger', type: 'button', onclick: () => patch({ status: 'declined' }, 'Application declined') }, 'Decline'));
  if (a.status !== 'new') statusBtns.push(h('button', { class: 'btn', type: 'button', onclick: () => patch({ status: 'new' }, 'Moved back to New') }, 'Back to New'));

  const check = (key, label) => h('label', { class: 'check' + (a[key] ? ' done' : '') },
    h('input', { type: 'checkbox', checked: !!a[key], onchange: (e) => patch({ [key]: e.target.checked }) }), label);

  const memberInput = h('input', { value: a.member_number, maxlength: 30, 'aria-label': 'Member card number', placeholder: 'e.g. 13542' });
  const notes = h('textarea', { id: 'notes', maxlength: 4000 }, a.admin_notes);

  box.replaceChildren(...[
    h('button', { class: 'btn small back', type: 'button', onclick: closeDetail }, '← All applications'),
    h('div', { class: 'd-head' },
      h('div', {},
        h('h2', {}, a.full_name),
        h('div', { class: 'd-sub' }, h('span', { class: 'pill ' + a.status }, STATUS_LABEL[a.status]), ` ${a.ref} · sent ${fmtWhen(a.submitted_at)}`)),
      h('div', { class: 'd-actions' }, statusBtns)),
    age != null && age > 365 ? h('p', { class: 'warnline' }, `Heads up: the score was bowled ${age} days before the application was sent (limit is 365).`) : null,
    h('div', { class: 'checks' },
      check('proof_ok', 'Proof checked'),
      check('fee_paid', '$20 fee received'),
      h('span', { class: 'member' }, 'Card #', memberInput,
        h('button', { class: 'btn small', type: 'button', onclick: () => patch({ member_number: memberInput.value }, 'Saved card number') }, 'Save'))),
    h('div', { class: 'cols' },
      h('div', { class: 'box' }, h('h3', {}, 'Qualifying score'),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Score'), h('dd', {}, h('b', {}, String(a.score)), ` scratch ${a.score_type}`),
          h('dt', {}, 'Date bowled'), h('dd', {}, fmtDay(a.score_date)),
          h('dt', {}, 'League / tournament'), h('dd', {}, a.event_name),
          h('dt', {}, 'Secretary / director'), h('dd', {}, a.director))),
      h('div', { class: 'box' }, h('h3', {}, 'Proof'),
        a.proof_method === 'mail'
          ? h('p', { class: 'muted', style: 'margin:0' }, 'The applicant is mailing a recap or standing sheet with the fee.')
          : h('ul', { class: 'files' }, files.map((f) => h('li', {},
            h('span', { class: 'fn' }, f.name, h('small', {}, fmtSize(f.size))),
            h('a', { class: 'btn small', href: `/api/admin/files/${f.id}`, target: '_blank', rel: 'noopener' }, 'View'),
            h('a', { class: 'btn small', href: `/api/admin/files/${f.id}?download=1` }, 'Download'))))),
      h('div', { class: 'box' }, h('h3', {}, 'Contact'),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Email'), h('dd', {}, h('a', { href: 'mailto:' + a.email }, a.email)),
          h('dt', {}, 'Phone'), h('dd', {}, h('a', { href: 'tel:' + a.phone.replace(/\D/g, '') }, a.phone)),
          h('dt', {}, 'Mailing address'), h('dd', {}, [a.street, a.address_line2, `${a.city}, ${a.state} ${a.zip}`].filter(Boolean).join('\n')),
          h('dt', {}, 'Club / association'), h('dd', {}, a.association))),
      h('div', { class: 'box' }, h('h3', {}, 'Activity'),
        h('ul', { class: 'log' }, log.map((l) => h('li', {}, h('time', {}, fmtWhen(l.created_at)), h('span', {}, `${l.text} — ${l.actor}`)))))),
    h('div', { class: 'notes' },
      h('label', { for: 'notes' }, 'Club notes'),
      notes,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => patch({ admin_notes: notes.value }, 'Notes saved') }, 'Save notes'))),
    h('div', { class: 'danger-zone' },
      h('span', { class: 'muted' }, 'Deleting removes the application and its proof files for good.'),
      h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!confirm(`Delete ${a.full_name}'s application (${a.ref}) and its files? This can't be undone.`)) return;
        try {
          await api('/applications/' + a.id, { method: 'DELETE' });
          toast('Application deleted');
          closeDetail();
          loadList();
        } catch (e) { toast(e.message, true); }
      } }, 'Delete application')),
  ].filter(Boolean));
  box.hidden = false;
  $('#detail-empty').hidden = true;
}

/* ---------- settings ---------- */
const settingsForm = $('#settings-form');
async function loadSettings() {
  try {
    const s = await api('/settings');
    for (const el of settingsForm.elements) if (el.name) el.value = s[el.name] || '';
  } catch (e) { toast(e.message, true); }
}
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {};
  for (const el of settingsForm.elements) if (el.name) body[el.name] = el.value.trim();
  if (body.tournament_start && body.tournament_end && body.tournament_end < body.tournament_start) { toast('The last day is before the first day.', true); return; }
  const status = $('#settings-status');
  status.textContent = 'Saving…';
  try {
    await api('/settings', { method: 'PUT', body: JSON.stringify(body) });
    status.textContent = 'Saved. The public site updates within a minute.';
    toast('Settings saved');
  } catch (err) {
    status.textContent = '';
    toast(err.message, true);
  }
});

/* ---------- start ---------- */
api('/me').then((m) => { $('#who').textContent = m.email ? `Signed in as ${m.email}` : ''; }).catch(() => {});
showTab();
loadList();
