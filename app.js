'use strict';

const $ = (id) => document.getElementById(id);

let db = null;
let currentUser = null;
let data = [];                   // entries (rows from Supabase), sorted by date desc

let pendingScreenshot = null;    // Blob of a newly added screenshot, not yet uploaded
let screenshotChanged = false;   // user added/removed the screenshot since the form loaded
let currentScreenshotPath = '';  // storage path of the screenshot in the loaded entry
let previewUrl = null;           // active blob: object URL for the preview, needs revoking

const TEXT_FIELDS = ['breakfast', 'lunch', 'dinner', 'snacks', 'medications', 'workout', 'notes'];

/* ---------- helpers ---------- */
function todayStr() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function fmtDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2800);
}
function showView(name) {
  $('loadingView').hidden = name !== 'loading';
  $('authView').hidden = name !== 'auth';
  $('appView').hidden = name !== 'app';
}

/* ---------- auth ---------- */
function authMsg(text, ok) {
  const el = $('authMsg');
  el.textContent = text || '';
  el.classList.toggle('ok', !!ok);
}
function translateAuthError(error) {
  const m = (error && error.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'Неверный email или пароль';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Этот email уже зарегистрирован — нажми «Войти»';
  if (m.includes('password should be at least')) return 'Пароль слишком короткий (минимум 6 символов)';
  if (m.includes('unable to validate email') || m.includes('invalid email')) return 'Некорректный email';
  if (m.includes('email not confirmed')) return 'Email не подтверждён — проверь почту';
  if (m.includes('rate limit') || m.includes('too many')) return 'Слишком много попыток, подожди минуту';
  return (error && error.message) || 'Ошибка';
}
async function signIn() {
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || !password) { authMsg('Заполни email и пароль'); return; }
  authMsg('Вход…', true);
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) authMsg(translateAuthError(error));
}
async function signUp() {
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || !password) { authMsg('Заполни email и пароль'); return; }
  if (password.length < 6) { authMsg('Пароль минимум 6 символов'); return; }
  authMsg('Создаём аккаунт…', true);
  const { data: res, error } = await db.auth.signUp({ email, password });
  if (error) { authMsg(translateAuthError(error)); return; }
  if (res && res.session) {
    authMsg('Аккаунт создан', true);   // onAuthStateChange покажет дневник
  } else {
    authMsg('Аккаунт создан. Подтверди email по ссылке из письма, затем нажми «Войти».', true);
  }
}
async function signOut() {
  await db.auth.signOut();
}

/* ---------- screenshot UI ---------- */
function showPreview(url) {
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  const img = $('hrvPreview');
  if (url) {
    if (url.startsWith('blob:')) previewUrl = url;
    img.src = url;
    img.hidden = false;
    $('hrvEmpty').hidden = true;
    $('hrvRemove').hidden = false;
  } else {
    img.removeAttribute('src');
    img.hidden = true;
    $('hrvEmpty').hidden = false;
    $('hrvRemove').hidden = true;
  }
}
function setPendingScreenshot(blob) {
  pendingScreenshot = blob;
  screenshotChanged = true;
  showPreview(URL.createObjectURL(blob));
}
function removeScreenshot() {
  pendingScreenshot = null;
  currentScreenshotPath = '';
  screenshotChanged = true;
  showPreview(null);
}
async function resetScreenshot(path) {
  pendingScreenshot = null;
  screenshotChanged = false;
  currentScreenshotPath = path || '';
  if (currentScreenshotPath) {
    showPreview(await signedUrl(currentScreenshotPath, 3600));
  } else {
    showPreview(null);
  }
}

/* ---------- Supabase: screenshots ---------- */
async function uploadScreenshot(blob, date) {
  const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png';
  const path = currentUser.id + '/hrv-' + date + '.' + ext;
  const { error } = await db.storage.from('hrv')
    .upload(path, blob, { upsert: true, contentType: blob.type });
  if (error) { console.error(error); toast('Не удалось загрузить скриншот'); return null; }
  return path;
}
async function signedUrl(path, seconds) {
  if (!path) return null;
  const { data: res, error } = await db.storage.from('hrv').createSignedUrl(path, seconds);
  if (error) { console.error(error); return null; }
  return res.signedUrl;
}

/* ---------- form ---------- */
function num(id) { const v = $(id).value.trim(); return v === '' ? null : Number(v); }
function txt(id) { return $(id).value.trim(); }
function setVal(id, v) { $(id).value = (v == null ? '' : v); }

function readForm() {
  return {
    date: $('entryDate').value,
    wake_time: $('wakeTime').value,
    glucose_morning: num('glucoseMorning'),
    breakfast: txt('breakfast'),
    lunch: txt('lunch'),
    dinner: txt('dinner'),
    snacks: txt('snacks'),
    medications: txt('medications'),
    workout: txt('workout'),
    bed_time: $('bedTime').value,
    notes: txt('notes'),
  };
}
function fillForm(e) {
  $('entryDate').value = e.date;
  $('wakeTime').value = e.wake_time || '';
  setVal('glucoseMorning', e.glucose_morning);
  setVal('breakfast', e.breakfast);
  setVal('lunch', e.lunch);
  setVal('dinner', e.dinner);
  setVal('snacks', e.snacks);
  setVal('medications', e.medications);
  setVal('workout', e.workout);
  $('bedTime').value = e.bed_time || '';
  setVal('notes', e.notes);
  resetScreenshot(e.hrv_screenshot || '');
}
function clearForm() {
  setVal('glucoseMorning', '');
  TEXT_FIELDS.forEach((id) => setVal(id, ''));
  $('wakeTime').value = '';
  $('bedTime').value = '';
  resetScreenshot('');
}
function loadEntryForDate(date) {
  const e = data.find((x) => x.date === date);
  if (e) {
    fillForm(e);
  } else {
    clearForm();
    $('entryDate').value = date;
  }
}

/* ---------- Supabase: entries ---------- */
async function loadEntries() {
  const { data: rows, error } = await db.from('entries')
    .select('*').order('date', { ascending: false });
  if (error) { console.error(error); toast('Ошибка загрузки данных'); return; }
  data = rows || [];
  renderHistory();
  loadEntryForDate($('entryDate').value || todayStr());
}
async function saveEntry() {
  const entry = readForm();
  if (!entry.date) { toast('Укажи дату'); return; }
  const btn = $('saveBtn');
  btn.disabled = true;
  try {
    let hrvPath = currentScreenshotPath;
    if (screenshotChanged) {
      if (pendingScreenshot) {
        const uploaded = await uploadScreenshot(pendingScreenshot, entry.date);
        if (uploaded) hrvPath = uploaded;
      } else {
        hrvPath = '';
      }
    }
    if (screenshotChanged && currentScreenshotPath && currentScreenshotPath !== hrvPath) {
      db.storage.from('hrv').remove([currentScreenshotPath]).catch(() => {});
    }

    const row = {
      user_id: currentUser.id,
      date: entry.date,
      wake_time: entry.wake_time,
      glucose_morning: entry.glucose_morning,
      breakfast: entry.breakfast,
      lunch: entry.lunch,
      dinner: entry.dinner,
      snacks: entry.snacks,
      medications: entry.medications,
      workout: entry.workout,
      bed_time: entry.bed_time,
      notes: entry.notes,
      hrv_screenshot: hrvPath,
      saved_at: new Date().toISOString(),
    };
    const { error } = await db.from('entries').upsert(row, { onConflict: 'user_id,date' });
    if (error) { console.error(error); toast('Ошибка сохранения'); return; }

    toast('Запись за ' + fmtDate(entry.date) + ' сохранена');
    await loadEntries();
  } finally {
    btn.disabled = false;
  }
}
async function deleteEntry(date, ev) {
  ev.stopPropagation();
  if (!confirm('Удалить запись за ' + fmtDate(date) + '?')) return;
  const entry = data.find((e) => e.date === date);
  const { error } = await db.from('entries').delete().eq('date', date);
  if (error) { console.error(error); toast('Ошибка удаления'); return; }
  if (entry && entry.hrv_screenshot) {
    db.storage.from('hrv').remove([entry.hrv_screenshot]).catch(() => {});
  }
  toast('Запись удалена');
  await loadEntries();
}

/* ---------- history ---------- */
function shorten(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function entrySummary(e) {
  const p = [];
  if (e.glucose_morning != null) p.push('Глюкоза ' + e.glucose_morning);
  if (e.wake_time) p.push('↑ ' + e.wake_time);
  if (e.bed_time) p.push('↓ ' + e.bed_time);
  if (e.workout) p.push(shorten(e.workout, 26));
  if (e.hrv_screenshot) p.push('📷 ВСР');
  return p.join('  ·  ') || 'Запись сохранена';
}
function renderHistory() {
  const list = $('historyList');
  list.innerHTML = '';
  $('entryCount').textContent = data.length ? '· ' + data.length : '';
  if (!data.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = 'Пока нет записей. Заполни день и нажми «Сохранить запись».';
    list.appendChild(d);
    return;
  }
  data.forEach((e) => {
    const row = document.createElement('div');
    row.className = 'history-row';
    row.onclick = () => { loadEntryForDate(e.date); window.scrollTo({ top: 0, behavior: 'smooth' }); };

    const dt = document.createElement('div');
    dt.className = 'h-date';
    dt.textContent = fmtDate(e.date);

    const sm = document.createElement('div');
    sm.className = 'h-sum';
    sm.textContent = entrySummary(e);

    const del = document.createElement('button');
    del.className = 'h-del';
    del.textContent = '×';
    del.title = 'Удалить';
    del.onclick = (ev) => deleteEntry(e.date, ev);

    row.append(dt, sm, del);
    list.appendChild(row);
  });
}

/* ---------- export ---------- */
async function exportJson() {
  const btn = $('exportBtn');
  btn.disabled = true;
  try {
    const out = { version: 2, exportedAt: new Date().toISOString(), entries: [] };
    for (const e of data) {
      const item = {
        date: e.date,
        savedAt: e.saved_at,
        wakeTime: e.wake_time,
        glucoseMorning: e.glucose_morning,
        breakfast: e.breakfast,
        lunch: e.lunch,
        dinner: e.dinner,
        snacks: e.snacks,
        medications: e.medications,
        workout: e.workout,
        bedTime: e.bed_time,
        notes: e.notes,
        hrvScreenshot: e.hrv_screenshot || '',
        hrvScreenshotUrl: e.hrv_screenshot ? (await signedUrl(e.hrv_screenshot, 604800) || '') : '',
      };
      out.entries.push(item);
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'health-data.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('Файл health-data.json скачан');
  } finally {
    btn.disabled = false;
  }
}

/* ---------- init ---------- */
function bindEvents() {
  $('signInBtn').addEventListener('click', signIn);
  $('signUpBtn').addEventListener('click', signUp);
  $('signOutBtn').addEventListener('click', signOut);
  $('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn(); });

  $('entryDate').addEventListener('change', () => loadEntryForDate($('entryDate').value));
  $('todayBtn').addEventListener('click', () => loadEntryForDate(todayStr()));
  $('saveBtn').addEventListener('click', saveEntry);
  $('exportBtn').addEventListener('click', exportJson);

  $('hrvZone').addEventListener('click', (e) => {
    if (e.target.id === 'hrvRemove') return;
    $('hrvInput').click();
  });
  $('hrvInput').addEventListener('change', () => {
    const f = $('hrvInput').files[0];
    if (f) { setPendingScreenshot(f); toast('Скриншот ВСР добавлен'); }
    $('hrvInput').value = '';
  });
  $('hrvRemove').addEventListener('click', (e) => { e.stopPropagation(); removeScreenshot(); });
  document.addEventListener('paste', (e) => {
    if ($('appView').hidden) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const blob = it.getAsFile();
        if (blob) { setPendingScreenshot(blob); toast('Скриншот ВСР добавлен'); e.preventDefault(); }
        return;
      }
    }
  });
}

function init() {
  bindEvents();
  $('entryDate').value = todayStr();

  if (typeof SUPABASE_URL !== 'string' || SUPABASE_URL.includes('ВСТАВЬ') ||
      typeof SUPABASE_ANON_KEY !== 'string' || SUPABASE_ANON_KEY.includes('ВСТАВЬ')) {
    $('loadingView').innerHTML =
      '<p class="muted">Не заполнен config.js — впиши туда Project URL и anon key из Supabase.</p>';
    return;
  }

  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  db.auth.onAuthStateChange((event, session) => {
    if (session && session.user) {
      currentUser = session.user;
      $('userEmail').textContent = session.user.email || '';
      showView('app');
      if (event !== 'TOKEN_REFRESHED') loadEntries();
    } else {
      currentUser = null;
      data = [];
      showView('auth');
    }
  });
}

init();
