// Idaho Gutter Gussie Club — page routing, membership application, Hall of Fame search.
// The application posts to /api/applications (see src/index.js); proof files upload one at a time to private storage.
'use strict';

const CLUB_EMAIL = 'idahoguttergussieclub@gmail.com';
const MAX_FILES = 5;
const MAX_FILE_MB = 25;
const site = { turnstileSiteKey: '' };

/* ---------- menu ---------- */
const menuButton = document.querySelector('.menu');
const navLinks = document.querySelector('.links');
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', open);
  navLinks.classList.toggle('open', open);
});
navLinks.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => {
  navLinks.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
}));

/* ---------- routing (one page, hash sections) ---------- */
const PAGES = [
  { id: 'membership-page', root: '#membership', hashes: ['#membership', '#join-questions', '#application'], title: 'Membership · ' },
  { id: 'tournament-page', root: '#tournament', hashes: ['#tournament', '#tourney-entry', '#tourney-resources', '#tourney-results'], title: 'Tournament · ' },
  { id: 'story-page', root: '#story', hashes: ['#story', '#story-beginnings', '#story-milestones', '#story-friendship', '#story-sources'], title: 'Our Story · ' },
  { id: 'contact-page', root: '#contact', hashes: ['#contact', '#contact-officers'], title: 'Contact · ' },
  { id: 'hall-of-fame-page', root: '#hall-of-fame', hashes: ['#hall-of-fame', '#hof-honorees'], title: 'Hall of Fame · ' },
];
function route() {
  if (location.hash === '#main') { document.getElementById('main').focus(); return; }
  const hash = location.hash || '#home';
  const page = PAGES.find((p) => p.hashes.includes(hash));
  document.getElementById('home-content').hidden = !!page;
  PAGES.forEach((p) => { document.getElementById(p.id).hidden = p !== page; });
  const current = page ? page.root : hash;
  document.querySelectorAll('.links a').forEach((a) => {
    if (a.getAttribute('href') === current) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (PAGES.some((p) => p.root === hash)) window.scrollTo({ top: 0, behavior: 'instant' });
  else { const target = document.getElementById(hash.slice(1)); if (target) target.scrollIntoView(); }
  if (hash === '#story-sources') document.querySelector('#story-sources details').open = true;
  document.title = (page ? page.title : '') + 'Idaho Gutter Gussie Club';
}
window.addEventListener('hashchange', route);
route();

/* ---------- club settings (next tournament, payment instructions) ---------- */
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else n.setAttribute(k, v);
  }
  n.append(...kids.filter((k) => k != null && k !== ''));
  return n;
}
const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
const fmtDate = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return '';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};
function dateRange(a, b) {
  const s = fmtDate(a), e = fmtDate(b);
  return s && e && s !== e ? `${s} – ${e}` : s || e;
}

function applySettings(cfg) {
  site.turnstileSiteKey = cfg.turnstileSiteKey || '';
  const s = cfg.settings || {};
  if (s.payment_instructions) document.querySelectorAll('[data-site="payment"]').forEach((n) => { n.textContent = s.payment_instructions; });

  const t = s.tournament_name ? s : null;
  if (!t) return;
  const when = dateRange(t.tournament_start, t.tournament_end);
  const where = t.tournament_location || '';
  document.querySelector('[data-site="t-home-title"]').textContent = t.tournament_name;
  document.querySelector('[data-site="t-home-sub"]').textContent = [when, where].filter(Boolean).join(' · ') || 'Entry details are on the Tournament page.';
  document.querySelector('[data-site="t-intro"]').textContent = t.tournament_details || 'Here is what we know so far. Contact the club with any questions.';

  const notice = document.getElementById('tourney-notice');
  const facts = el('dl', { class: 'tourney-facts' });
  const addFact = (label, value) => { if (value) facts.append(el('div', {}, el('dt', {}, label), el('dd', {}, value))); };
  addFact('Dates', when);
  addFact('Where', where);
  addFact('Entry deadline', fmtDate(t.tournament_deadline));
  addFact('Entry fee', t.tournament_fee);
  const entry = safeUrl(t.tournament_entry_url || '');
  notice.replaceChildren(
    el('span', { class: 'tourney-status' }, 'NEXT TOURNAMENT'),
    el('h3', {}, t.tournament_name),
    facts,
    entry ? el('a', { href: entry, target: '_blank', rel: 'noopener' }, 'Entry form & details ↗') : el('a', { href: `mailto:${CLUB_EMAIL}` }, 'Email the tournament director ↗'),
  );
}
fetch('/api/site').then((r) => (r.ok ? r.json() : {})).then(applySettings).catch(() => {});

/* ---------- membership application ---------- */
const form = document.getElementById('club-application');
const panels = [...document.querySelectorAll('.wizard-step')];
const stepButtons = [...document.querySelectorAll('[data-step]')];
const reviewPanel = document.getElementById('application-review');
const receivedPanel = document.getElementById('application-received');
const proofInput = document.getElementById('score-proof');
const sendButton = document.getElementById('send-application');
let currentStep = 0;
let proofFiles = [];
let fileError = '';
let formStartedAt = null;
let sending = false;

// Same checks run again on the server.
const TEXT_FIELDS = ['fullName', 'street', 'addressLine2', 'city', 'state', 'association', 'eventName', 'director'];
const LINK_PATTERN = /(https?:\/\/|www\.|\.(com|net|org|ru|xyz|info|top)\b|<\s*\/?[a-z]|\[url)/i;
form.addEventListener('focusin', () => { if (!formStartedAt) formStartedAt = Date.now(); });

const today = new Date();
const dateISO = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
form.elements.scoreDate.max = dateISO(today);
form.elements.scoreDate.min = dateISO(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 365));

function fieldError(input, message) {
  let err = document.getElementById('error-' + input.name);
  if (!err) {
    err = document.createElement('small');
    err.id = 'error-' + input.name;
    err.className = 'field-error';
    input.closest('label').appendChild(err);
    const existing = input.getAttribute('aria-describedby');
    input.setAttribute('aria-describedby', [existing, err.id].filter(Boolean).join(' '));
  }
  err.textContent = message;
  err.hidden = !message;
  if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
}

function validateField(input) {
  let msg = '';
  const v = input.value.trim();
  if (input.required && ((input.type === 'checkbox' && !input.checked) || (input.type !== 'checkbox' && !v))) {
    msg = input.type === 'checkbox' ? 'Please acknowledge the fee and proof requirement.' : 'Please complete this field.';
  } else if (input.validity.typeMismatch) msg = 'Enter a valid email address.';
  else if (input.validity.patternMismatch) msg = 'Enter a 5-digit ZIP code or ZIP+4.';
  else if (input.validity.rangeUnderflow || input.validity.rangeOverflow) {
    msg = input.name === 'scoreDate' ? 'Choose a date within the past 365 days, not a future date.' : `Enter a score from ${input.min} to ${input.max}.`;
  } else if (input.validity.stepMismatch || input.validity.badInput) msg = 'Enter a whole number.';
  else if (TEXT_FIELDS.includes(input.name) && LINK_PATTERN.test(input.value)) msg = 'Links and code aren’t allowed here.';
  else if (input.name === 'fullName' && v && !/^[\p{L}][\p{L} .,'’-]*$/u.test(v)) msg = 'Enter your name using letters only.';
  else if (input.name === 'phone' && v && !/^1?\d{10}$/.test(input.value.replace(/\D/g, ''))) msg = 'Enter a 10-digit phone number.';
  fieldError(input, msg);
  return !msg;
}

function validateStep(index) {
  let valid = true, first;
  panels[index].querySelectorAll('input:not([type=radio]):not([type=file]),select').forEach((input) => {
    if (!validateField(input)) { valid = false; if (!first) first = input; }
  });
  if (index === 2 && form.elements.proofMethod.value === 'upload') {
    const error = fileError || (!proofFiles.length ? 'Choose at least one proof file, or select Mail proof.' : '');
    const box = document.getElementById('proof-error');
    box.textContent = error;
    box.hidden = !error;
    if (error) { valid = false; if (!first) first = proofInput; }
  }
  if (index === 2 && site.turnstileSiteKey && !turnstileToken()) {
    showTurnstileError('Please finish the quick human check above.');
    valid = false;
  }
  if (first) first.focus();
  return valid;
}

const HEADINGS = ['Start with a little about you.', 'Every great score has a story.', 'Finish with your proof and fee acknowledgment.'];
function showStep(index, focus = true) {
  currentStep = index;
  form.hidden = false;
  reviewPanel.hidden = true;
  receivedPanel.hidden = true;
  panels.forEach((panel, i) => { panel.hidden = i !== index; });
  stepButtons.forEach((button, i) => {
    if (i === index) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    button.classList.toggle('passed', i < index);
  });
  document.getElementById('step-status').textContent = `Step ${index + 1} of 3`;
  document.getElementById('previous-step').hidden = index === 0;
  document.getElementById('next-step').textContent = ['Continue to your score →', 'Continue to proof →', 'Review my application →'][index];
  document.querySelector('.wizard-heading>div>p').textContent = HEADINGS[index];
  if (index === 2) mountTurnstile();
  if (focus) panels[index].querySelector('legend').focus();
}

form.querySelectorAll('input:not([type=file]):not([type=radio]),select').forEach((input) => input.addEventListener('input', () => {
  if (input.getAttribute('aria-invalid')) validateField(input);
}));
form.elements.scoreType.addEventListener('change', () => {
  const game = form.elements.scoreType.value === 'game';
  const score = form.elements.score;
  score.min = game ? 225 : 550;
  score.max = game ? 300 : 900;
  document.getElementById('score-help').textContent = game ? 'Enter a scratch game score from 225 to 300.' : 'Enter a scratch series score from 550 to 900.';
  if (score.value) validateField(score);
});

/* proof files */
function renderFiles() {
  const list = document.getElementById('proof-files');
  list.replaceChildren();
  proofFiles.forEach((item, index) => {
    const li = document.createElement('li');
    if (item.url) li.appendChild(el('img', { src: item.url, alt: 'Selected proof image preview' }));
    else li.appendChild(el('span', { class: 'file-icon' }, '↥'));
    const info = el('span', {}, item.file.name, el('small', {}, (item.file.size / 1024 / 1024).toFixed(1) + ' MB'));
    li.appendChild(info);
    const remove = el('button', { type: 'button', 'aria-label': 'Remove ' + item.file.name }, 'Remove');
    remove.addEventListener('click', () => {
      if (item.url) URL.revokeObjectURL(item.url);
      proofFiles.splice(index, 1);
      fileError = '';
      document.getElementById('proof-error').hidden = true;
      renderFiles();
    });
    li.appendChild(remove);
    list.appendChild(li);
  });
}
proofInput.addEventListener('change', () => {
  fileError = '';
  for (const file of proofInput.files) {
    if (proofFiles.length >= MAX_FILES) { fileError = `You can attach up to ${MAX_FILES} files. Remove a file to add another.`; break; }
    if (file.size > MAX_FILE_MB * 1024 * 1024) { fileError = `Files must be ${MAX_FILE_MB} MB or smaller.`; continue; }
    if (!file.size) { fileError = 'That file is empty. Choose another.'; continue; }
    if (!/\.(pdf|docx?|png|jpe?g|webp|heic|xlsx?|csv)$/i.test(file.name)) { fileError = 'Choose a supported PDF, document, image, or spreadsheet.'; continue; }
    if (proofFiles.some((item) => item.file.name === file.name && item.file.size === file.size)) continue;
    proofFiles.push({ file, url: /^image\/(png|jpeg|webp)$/.test(file.type) ? URL.createObjectURL(file) : null });
  }
  proofInput.value = '';
  renderFiles();
  const err = document.getElementById('proof-error');
  err.textContent = fileError;
  err.hidden = !fileError;
});
form.querySelectorAll('[name=proofMethod]').forEach((input) => input.addEventListener('change', () => {
  const upload = form.elements.proofMethod.value === 'upload';
  document.getElementById('upload-area').hidden = !upload;
  document.getElementById('mail-proof-note').hidden = upload;
}));

/* Cloudflare Turnstile (human check). Loaded only when the proof step opens. */
let turnstileWidget = null;
let turnstileLoading = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (!turnstileLoading) {
    turnstileLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { turnstileLoading = null; reject(new Error('turnstile')); };
      document.head.appendChild(s);
    });
  }
  return turnstileLoading;
}
function showTurnstileError(msg) {
  const e = document.getElementById('turnstile-error');
  e.textContent = msg;
  e.hidden = !msg;
}
function mountTurnstile() {
  if (!site.turnstileSiteKey || turnstileWidget !== null) return;
  const slot = document.getElementById('turnstile-slot');
  slot.hidden = false;
  loadTurnstile().then(() => {
    if (turnstileWidget !== null) return;
    turnstileWidget = window.turnstile.render(slot, {
      sitekey: site.turnstileSiteKey,
      action: 'apply',
      callback: () => showTurnstileError(''),
      'expired-callback': () => window.turnstile.reset(turnstileWidget),
    });
  }).catch(() => showTurnstileError('The human check didn’t load. Check your connection and reload the page.'));
}
const turnstileToken = () => (window.turnstile && turnstileWidget !== null ? window.turnstile.getResponse(turnstileWidget) || '' : '');

/* review */
function collect() {
  const f = form.elements;
  return {
    fullName: f.fullName.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(),
    street: f.street.value.trim(), addressLine2: f.addressLine2.value.trim(), city: f.city.value.trim(),
    state: f.state.value.trim(), zip: f.zip.value.trim(), association: f.association.value.trim(),
    eventName: f.eventName.value.trim(), director: f.director.value.trim(), scoreDate: f.scoreDate.value,
    scoreType: f.scoreType.value, score: Number(f.score.value), proofMethod: f.proofMethod.value,
    acknowledged: f.acknowledged.checked, website: f.website.value,
  };
}
function showReview() {
  const d = collect();
  const sections = [
    ['About you', 0, [['Full name', d.fullName], ['Email', d.email], ['Phone', d.phone],
      ['Mailing address', [d.street, d.addressLine2, [d.city, d.state, d.zip].join(', ')].filter(Boolean).join('\n')],
      ['Local club or association', d.association]]],
    ['Your qualifying score', 1, [['League or tournament', d.eventName], ['Secretary or director', d.director],
      ['Date', fmtDate(d.scoreDate)], ['Score', d.score + ' — scratch ' + d.scoreType]]],
    ['Proof & fee', 2, [['Proof', d.proofMethod === 'mail' ? 'Mail a hard copy with my fee' : proofFiles.map((i) => i.file.name).join('\n')],
      ['Fee acknowledgment', '$20 fee and all proof required before processing']]],
  ];
  const list = document.getElementById('review-details');
  list.replaceChildren();
  sections.forEach(([title, index, rows]) => {
    const edit = el('button', { type: 'button', 'aria-label': 'Edit ' + title }, 'Edit');
    edit.addEventListener('click', () => showStep(index));
    const dl = el('dl');
    rows.forEach(([label, value]) => dl.append(el('div', {}, el('dt', {}, label), el('dd', {}, value))));
    list.append(el('section', {}, el('div', { class: 'review-section-head' }, el('h4', {}, title), edit), dl));
  });
  form.hidden = true;
  reviewPanel.hidden = false;
  document.getElementById('send-error').hidden = true;
  document.getElementById('send-progress').hidden = true;
  sendButton.disabled = false;
  stepButtons.forEach((b) => { b.removeAttribute('aria-current'); b.classList.add('passed'); });
  document.querySelector('.wizard-heading>div>p').textContent = 'Check your application before the next chapter.';
  reviewPanel.focus();
}

/* send */
function progress(text, fraction) {
  const box = document.getElementById('send-progress');
  box.hidden = false;
  box.querySelector('p').textContent = text;
  box.querySelector('.send-bar span').style.width = Math.round(fraction * 100) + '%';
}
function sendError(msg) {
  const e = document.getElementById('send-error');
  e.textContent = msg;
  e.hidden = false;
  document.getElementById('send-progress').hidden = true;
  sendButton.disabled = false;
  sending = false;
}
async function post(url, body, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { field: data.field, step: data.step });
  return data;
}
function uploadFile(id, token, file, onProgress) {
  // XHR so we can show upload progress for big scans.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/applications/${encodeURIComponent(id)}/files`);
    xhr.setRequestHeader('x-upload-token', token);
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `“${file.name}” didn’t upload.`;
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* keep default */ }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error(`“${file.name}” didn’t upload. Check your connection and try again.`));
    xhr.send(file);
  });
}

let pending = null; // { id, token, ref, uploaded:Set } — lets a failed upload resume without a duplicate application
sendButton.addEventListener('click', async () => {
  if (sending) return;
  sending = true;
  sendButton.disabled = true;
  document.getElementById('send-error').hidden = true;
  const data = collect();
  const files = data.proofMethod === 'upload' ? proofFiles.map((i) => i.file) : [];
  try {
    if (!pending) {
      progress('Sending your application…', 0.05);
      const res = await post('/api/applications', {
        ...data,
        fileCount: files.length,
        elapsedMs: formStartedAt ? Date.now() - formStartedAt : 0,
        turnstileToken: turnstileToken(),
      });
      pending = { id: res.id, token: res.uploadToken, ref: res.ref, uploaded: new Set() };
    }
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const key = f.name + ':' + f.size;
      if (pending.uploaded.has(key)) continue;
      await uploadFile(pending.id, pending.token, f, (p) => progress(`Uploading ${f.name} (${i + 1} of ${files.length})…`, 0.1 + 0.8 * ((i + p) / files.length)));
      pending.uploaded.add(key);
    }
    progress('Finishing up…', 0.95);
    await post(`/api/applications/${encodeURIComponent(pending.id)}/complete`, {}, { 'x-upload-token': pending.token });
    showReceived(pending.ref);
    pending = null;
    proofFiles.forEach((i) => i.url && URL.revokeObjectURL(i.url));
    proofFiles = [];
    renderFiles();
    form.reset();
  } catch (e) {
    if (!pending && window.turnstile && turnstileWidget !== null) window.turnstile.reset(turnstileWidget);
    if (!pending && e.step != null) {
      showStep(e.step);
      const input = e.field && e.field !== 'score-proof' && form.elements[e.field];
      if (e.field === 'score-proof') {
        const box = document.getElementById('proof-error');
        box.textContent = e.message;
        box.hidden = false;
      } else if (input && input.name && input.closest('label')) { fieldError(input, e.message); input.focus(); }
      else if (e.step === 2) showTurnstileError(e.message);
      sending = false;
      return;
    }
    sendError(e.message + (pending ? ' Press Send again to retry — your details are saved.' : ''));
  }
  sending = false;
});

function showReceived(ref) {
  form.hidden = true;
  reviewPanel.hidden = true;
  document.getElementById('received-ref').textContent = ref ? `Your reference number is ${ref}.` : '';
  receivedPanel.hidden = false;
  document.querySelector('.wizard-heading>div>p').textContent = 'Your application is on its way.';
  receivedPanel.focus();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!validateStep(currentStep)) return;
  if (currentStep < 2) { showStep(currentStep + 1); return; }
  for (let i = 0; i < 2; i++) if (!validateStep(i)) { showStep(i); return; }
  showReview();
});
document.getElementById('previous-step').addEventListener('click', () => showStep(currentStep - 1));
document.getElementById('edit-application').addEventListener('click', () => showStep(2));
stepButtons.forEach((button) => button.addEventListener('click', () => {
  const target = Number(button.dataset.step);
  if (!receivedPanel.hidden) return;
  if (target <= currentStep || form.hidden) { showStep(target); return; }
  for (let i = currentStep; i < target; i++) {
    if (!validateStep(i)) { if (i !== currentStep) showStep(i); return; }
  }
  showStep(target);
}));
showStep(0, false);

/* ---------- Hall of Fame search ---------- */
const hallSearch = document.getElementById('hof-search');
const hallClear = document.getElementById('hof-clear');
function filterHall() {
  const query = hallSearch.value.trim().toLocaleLowerCase();
  let matches = 0, years = 0;
  document.querySelectorAll('[data-hof-year]').forEach((group) => {
    let visible = 0;
    group.querySelectorAll('[data-hof-search]').forEach((row) => {
      row.hidden = !row.dataset.hofSearch.includes(query);
      if (!row.hidden) { matches++; visible++; }
    });
    group.hidden = !visible;
    if (visible) years++;
  });
  hallClear.hidden = !query;
  document.getElementById('hof-empty').hidden = matches > 0;
  document.getElementById('hof-count').textContent = `${matches} ${matches === 1 ? 'entry' : 'entries'} across ${years} ${years === 1 ? 'induction year' : 'induction years'}`;
}
hallSearch.addEventListener('input', filterHall);
hallClear.addEventListener('click', () => { hallSearch.value = ''; filterHall(); hallSearch.focus(); });
