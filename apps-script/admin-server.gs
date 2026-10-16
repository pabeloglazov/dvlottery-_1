/* ============================== Админка ============================== */
/*
 * Клиент = человек (ФИО + дата рождения), может подавать анкету в разные годы.
 * Подача = клиент + сезон (DV-2025, DV-2026, DV-2027...). Статусы, оплата, номер
 * подтверждения и результат хранятся в листе «Подачи». Если для сезона записи
 * ещё нет, она собирается из строки анкеты (старые колонки «Column 1», «Результат»,
 * «Статус», «Заметка»), поэтому старые данные видны без переноса.
 */

const OWNER_EMAIL = 'pa.beloglazov@gmail.com';
const RESPONSES_SHEET_ID = '1FkV6QtxhMSCdAod3Eh6PudKhLT8wYz4I6wdWsLJF2Gw';
const SUBS_SHEET = 'Подачи';
const SUBS_HEADERS = ['Клиент', 'Ключ', 'Сезон', 'Статус', 'Оплата', 'Номер подтверждения', 'Результат', 'Заметка', 'Строка анкеты', 'Обновлено'];
const STATUSES = ['Новая', 'Связался', 'Оплачено', 'Подано'];
const DEFAULT_SEASON = 2027;

const COLS = {
  ts: ['timestamp', 'отметка времени'], name: ['напиши фамилию и имя'], sex: ['выберите свой пол'],
  birth: ['день вашего рождения'], birthCity: ['город в котором вы родились'], birthCountry: ['страна в которой вы родились'],
  photoNew: ['фотография'], photoOld: ['загрузите фотографию'], address: ['напишите ваш адрес'],
  country: ['страна, в которой вы живете сейчас'], email: ['ваш действующий e-mail адрес'],
  education: ['укажите, какое у вас образование'], marital: ['укажите ваше текущее семейное положение'],
  children: ['есть ли у вас дети?'], telegram: ['ваш telegram для связи'],
  spouseData: ['данные супруга(и)'], kidsData: ['данные детей'],
  confirm: ['column 1', 'номер подтверждения'], result: ['результат'], status: ['статус'], note: ['заметка']
};

let API_AUTH_ = false; // true, когда запрос пришёл с сайта с действующим ключом входа

function isOwner_() {
  try { return Session.getActiveUser().getEmail().toLowerCase() === OWNER_EMAIL; } catch (e) { return false; }
}
function assertOwner_() { if (!API_AUTH_ && !isOwner_()) throw new Error('Нет доступа'); }

/* ---------- Вход в админку на сайте: код на почту владельца ---------- */

const OTP_TTL_SEC = 600;          // код действует 10 минут
const OTP_MAX_TRIES = 5;          // попыток ввода на один код
const OTP_MAX_SENDS = 5;          // писем с кодом за 10 минут
const SESSION_DAYS = 30;

function sha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function maskEmail_(e) { const p = e.split('@'); return p[0].slice(0, 2) + '•••' + p[0].slice(-1) + '@' + p[1]; }

function requestCode_() {
  const cache = CacheService.getScriptCache();
  const sent = Number(cache.get('otp_sends') || 0);
  if (sent >= OTP_MAX_SENDS) return { ok: false, error: 'Слишком много запросов. Попробуйте через 10 минут.' };
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const salt = Utilities.getUuid();
  cache.put('otp', JSON.stringify({ h: sha_(salt + code), s: salt, t: 0 }), OTP_TTL_SEC);
  cache.put('otp_sends', String(sent + 1), OTP_TTL_SEC);
  MailApp.sendEmail({
    to: OWNER_EMAIL,
    subject: 'Код входа в админку DV Lottery: ' + code,
    body: 'Код для входа в админку заявок DV Lottery: ' + code + '\n\nКод действует 10 минут. Если вы не запрашивали вход — просто проигнорируйте письмо.',
    name: 'Beloglazov Green Card'
  });
  return { ok: true, email: maskEmail_(OWNER_EMAIL) };
}

function verifyCode_(code) {
  const cache = CacheService.getScriptCache();
  const raw = cache.get('otp');
  if (!raw) return { ok: false, error: 'Код устарел. Запросите новый.' };
  const o = JSON.parse(raw);
  if (o.t >= OTP_MAX_TRIES) { cache.remove('otp'); return { ok: false, error: 'Слишком много попыток. Запросите новый код.' }; }
  if (sha_(o.s + String(code || '').replace(/\D/g, '')) !== o.h) {
    o.t++; cache.put('otp', JSON.stringify(o), OTP_TTL_SEC);
    return { ok: false, error: 'Неверный код. Осталось попыток: ' + (OTP_MAX_TRIES - o.t) };
  }
  cache.remove('otp');
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('sess_' + sha_(token), String(Date.now() + SESSION_DAYS * 864e5));
  cleanupSessions_(props);
  return { ok: true, token: token };
}

function checkToken_(token) {
  if (!token || String(token).length < 40) return false;
  const exp = Number(PropertiesService.getScriptProperties().getProperty('sess_' + sha_(token)) || 0);
  return exp > Date.now();
}

function cleanupSessions_(props) {
  const all = props.getProperties(), now = Date.now();
  Object.keys(all).forEach(function (k) { if (k.indexOf('sess_') === 0 && Number(all[k]) < now) props.deleteProperty(k); });
}

/** API для админки на сайте: { action, token, args }. */
function api_(d) {
  try {
    if (d.action === 'requestCode') return requestCode_();
    if (d.action === 'verifyCode') return verifyCode_(d.code);
    if (!checkToken_(d.token)) return { ok: false, auth: false, error: 'Нужно войти' };
    if (d.action === 'logout') { PropertiesService.getScriptProperties().deleteProperty('sess_' + sha_(d.token)); return { ok: true }; }
    const fns = { adminData: adminData, adminSaveSub: adminSaveSub, adminAddToSeason: adminAddToSeason,
      adminSetCurrentSeason: adminSetCurrentSeason, adminAddMember: adminAddMember, adminSetPhoto: adminSetPhoto, adminDeleteClient: adminDeleteClient,
      adminUpdateField: adminUpdateField, adminUpdateMember: adminUpdateMember, adminRemoveMember: adminRemoveMember };
    const fn = fns[d.action];
    if (!fn) return { ok: false, error: 'Неизвестное действие' };
    API_AUTH_ = true;
    return { ok: true, result: fn.apply(null, Array.isArray(d.args) ? d.args : []) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally { API_AUTH_ = false; }
}

/** Разовый запуск из редактора: даёт скрипту разрешение отправлять письма с кодом. */
function authorizeMail() { return MailApp.getRemainingDailyQuota(); }

function responsesSheet_() {
  let id = RESPONSES_SHEET_ID;
  try { const dest = FormApp.openById(FORM_EDIT_ID).getDestinationId(); if (dest) id = dest; } catch (e) { /* по умолчанию */ }
  const ss = SpreadsheetApp.openById(id);
  const linked = ss.getSheets().filter(function (sh) { try { return !!sh.getFormUrl(); } catch (e) { return false; } })[0];
  return linked || ss.getSheets()[0];
}

function subsSheet_() {
  const ss = responsesSheet_().getParent();
  let sh = ss.getSheetByName(SUBS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SUBS_SHEET);
    sh.getRange(1, 1, 1, SUBS_HEADERS.length).setValues([SUBS_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function currentSeason_() {
  const v = Number(PropertiesService.getScriptProperties().getProperty('CURRENT_SEASON'));
  return v >= 2020 ? v : DEFAULT_SEASON;
}

function colIndex_(headers) {
  const idx = {};
  headers.forEach(function (h, i) {
    const n = norm_(h);
    Object.keys(COLS).forEach(function (k) { if (idx[k] === undefined && COLS[k].indexOf(n) !== -1) idx[k] = i; });
  });
  return idx;
}

function keyOf_(name, dob) { return String(name || '').toUpperCase().replace(/\s+/g, ' ').trim() + '|' + dob; }

function fmtDate_(v, pattern) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, Session.getScriptTimeZone(), pattern);
  return String(v || '').trim();
}

// Сезон строки анкеты: по номеру подтверждения, иначе по дате (осень года Y → DV-(Y+2)).
function seasonOf_(number, ts, current) {
  const m = String(number || '').match(/^\s*(20\d\d)/);
  if (m) return Number(m[1]);
  if (!(ts instanceof Date)) return current;
  const y = ts.getFullYear() + (ts.getMonth() >= 6 ? 2 : 1);
  return Math.min(y, current);
}

/** Все клиенты и подачи для админки. */
function adminData() {
  assertOwner_();
  const current = currentSeason_();
  const sh = responsesSheet_();
  const range = sh.getDataRange();
  const raw = range.getValues();
  const disp = range.getDisplayValues();
  const c = colIndex_(disp[0].map(String));
  const get = function (r, k) { return c[k] === undefined ? '' : String(disp[r][c[k]] || '').trim(); };
  const rawGet = function (r, k) { return c[k] === undefined ? '' : raw[r][c[k]]; };

  const clients = {};
  const subs = {};
  for (let r = 1; r < raw.length; r++) {
    if (!get(r, 'name')) continue;
    const ts = rawGet(r, 'ts');
    const dob = fmtDate_(rawGet(r, 'birth'), 'dd.MM.yyyy');
    const key = keyOf_(get(r, 'name'), dob);
    const tsNum = ts instanceof Date ? ts.getTime() : 0;
    let cl = clients[key];
    if (!cl || tsNum >= cl.ts) {
      cl = clients[key] = Object.assign(cl || { rows: [] }, {
        key: key, ts: tsNum, row: r + 1, date: fmtDate_(ts, 'dd.MM.yyyy'),
        name: get(r, 'name').toUpperCase().replace(/\s+/g, ' '), sex: get(r, 'sex'), dob: dob,
        birthCity: get(r, 'birthCity'), birthCountry: get(r, 'birthCountry'),
        photo: get(r, 'photoNew') && /^https?:/.test(get(r, 'photoNew')) ? get(r, 'photoNew') : get(r, 'photoOld'),
        address: get(r, 'address'), country: get(r, 'country'), email: get(r, 'email'),
        education: get(r, 'education'), marital: get(r, 'marital'), children: get(r, 'children'),
        telegram: get(r, 'telegram'), spouseData: get(r, 'spouseData'), kidsData: get(r, 'kidsData')
      });
    }
    cl.rows.push(r + 1);
    const number = get(r, 'confirm');
    const season = seasonOf_(number, ts, current);
    subs[key] = subs[key] || {};
    if (!subs[key][season]) {
      subs[key][season] = {
        status: number ? 'Подано' : (STATUSES.indexOf(get(r, 'status')) !== -1 ? get(r, 'status') : 'Новая'),
        paid: '', number: number, result: get(r, 'result'), note: get(r, 'note'),
        date: fmtDate_(ts, 'dd.MM.yyyy'), ts: tsNum, virtual: true
      };
    }
  }

  // Записи листа «Подачи» главнее собранных из анкеты.
  const ss = subsSheet_();
  const sv = ss.getDataRange().getDisplayValues();
  for (let i = 1; i < sv.length; i++) {
    const key = sv[i][1], season = Number(sv[i][2]);
    if (!key || !season) continue;
    subs[key] = subs[key] || {};
    const prev = subs[key][season] || {};
    subs[key][season] = {
      status: sv[i][3] || 'Новая', paid: sv[i][4], number: sv[i][5], result: sv[i][6], note: sv[i][7],
      date: prev.date || '', ts: prev.ts || 0, virtual: false
    };
  }

  const list = Object.keys(clients).map(function (k) { return clients[k]; });
  return {
    current: current, clients: list, subs: subs,
    sheetUrl: sh.getParent().getUrl(), folderUrl: photoFolder_().getUrl()
  };
}

function findSubRow_(sh, key, season) {
  const v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) if (v[i][1] === key && Number(v[i][2]) === Number(season)) return i + 1;
  return 0;
}

/** Сохранить подачу клиента за сезон (статус, оплата, номер, результат, заметка). */
function adminSaveSub(key, name, row, season, sub) {
  assertOwner_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = subsSheet_();
    const status = STATUSES.indexOf(sub.status) !== -1 ? sub.status : 'Новая';
    const values = [String(name), String(key), Number(season), status,
      String(sub.paid || '').slice(0, 200), String(sub.number || '').slice(0, 60),
      String(sub.result || '').slice(0, 60), String(sub.note || '').slice(0, 1000), Number(row) || '', new Date()];
    const at = findSubRow_(sh, key, season);
    if (at) sh.getRange(at, 1, 1, values.length).setValues([values]);
    else sh.appendRow(values);
    return true;
  } finally { lock.releaseLock(); }
}

/** Добавить клиентов в сезон со статусом «Новая». list: [{key, name, row}] */
function adminAddToSeason(list, season) {
  assertOwner_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = subsSheet_();
    const rows = [];
    (list || []).forEach(function (c) {
      if (findSubRow_(sh, c.key, season)) return;
      rows.push([String(c.name), String(c.key), Number(season), 'Новая', '', '', '', '', Number(c.row) || '', new Date()]);
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    return rows.length;
  } finally { lock.releaseLock(); }
}

/** Удалить клиента: его строки анкеты (лист ответов) и все его подачи (лист «Подачи»). */
function adminDeleteClient(key, rows) {
  assertOwner_();
  key = String(key || '');
  if (!key) throw new Error('Нет клиента');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = responsesSheet_();
    const v = sh.getDataRange().getValues();
    const c = colIndex_(v[0].map(String));
    // Удаляем только строки, где имя и дата рождения действительно этого клиента (на случай, если таблицу правили руками).
    const del = (rows || []).map(Number).filter(function (r, i, a) {
      if (!(r >= 2 && r <= v.length) || a.indexOf(r) !== i) return false;
      const row = v[r - 1];
      return keyOf_(String(row[c.name] || '').trim(), fmtDate_(row[c.birth], 'dd.MM.yyyy')) === key;
    }).sort(function (a, b) { return b - a; });
    del.forEach(function (r) { sh.deleteRow(r); });

    // «Подачи»: убрать строки клиента и сдвинуть номера строк анкеты у остальных.
    const ss = subsSheet_();
    const sv = ss.getDataRange().getValues();
    for (let i = sv.length - 1; i >= 1; i--) if (String(sv[i][1]) === key) ss.deleteRow(i + 1);
    const left = ss.getDataRange().getValues();
    if (left.length > 1 && del.length) {
      const col = left.slice(1).map(function (r) {
        const n = Number(r[8]);
        if (!n) return [r[8]];
        return [n - del.filter(function (d) { return d < n; }).length];
      });
      ss.getRange(2, 9, col.length, 1).setValues(col);
    }
    return del.length;
  } finally { lock.releaseLock(); }
}

// ---------- Редактирование данных клиента и семьи ----------
const EDITABLE_ = { name: 'name', sex: 'sex', dob: 'birth', birthCity: 'birthCity', birthCountry: 'birthCountry', country: 'country',
  address: 'address', email: 'email', telegram: 'telegram', education: 'education', marital: 'marital' };

function parseDob_(s) {
  const m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) throw new Error('Дата в формате ДД.ММ.ГГГГ');
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (d.getDate() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1) throw new Error('Такой даты нет');
  return d;
}

/** Изменить поле клиента. Имя и дата рождения — во всех его строках (они образуют ключ), остальное — в последней строке. */
function adminUpdateField(key, rows, field, value) {
  assertOwner_();
  const colKey = EDITABLE_[field];
  if (!colKey) throw new Error('Это поле нельзя менять');
  value = String(value == null ? '' : value).trim().slice(0, 1000);
  if (field === 'name') { value = value.toUpperCase().replace(/\s+/g, ' '); if (!/^[A-Z][A-Z .'\-]*$/.test(value)) throw new Error('Имя латиницей, как в паспорте'); }
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = responsesSheet_();
    const v = sh.getDataRange().getValues();
    const c = colIndex_(v[0].map(String));
    if (c[colKey] === undefined) throw new Error('Нет колонки для этого поля');
    const mine = (rows || []).map(Number).filter(function (r) {
      return r >= 2 && r <= v.length && keyOf_(String(v[r - 1][c.name] || '').trim(), fmtDate_(v[r - 1][c.birth], 'dd.MM.yyyy')) === key;
    });
    if (!mine.length) throw new Error('Клиент не найден — обновите страницу');
    const target = (field === 'name' || field === 'dob') ? mine : [Math.max.apply(null, mine)];
    const cellVal = field === 'dob' ? parseDob_(value) : value;
    target.forEach(function (r) { sh.getRange(r, c[colKey] + 1).setValue(cellVal); });
    const last = Math.max.apply(null, mine);
    const newKey = keyOf_(field === 'name' ? value : String(v[last - 1][c.name] || '').trim(),
      field === 'dob' ? value : fmtDate_(v[last - 1][c.birth], 'dd.MM.yyyy'));
    if (newKey !== key) {
      const ss = subsSheet_();
      const sv = ss.getDataRange().getValues();
      for (let i = 1; i < sv.length; i++) if (String(sv[i][1]) === key) {
        ss.getRange(i + 1, 1, 1, 2).setValues([[newKey.split('|')[0], newKey]]);
      }
    }
    return { key: newKey };
  } finally { lock.releaseLock(); }
}

function familyCell_(row, kind) {
  row = Number(row);
  const sh = responsesSheet_();
  if (!(row >= 2 && row <= sh.getLastRow())) throw new Error('Нет такой строки');
  const c = colIndex_(sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0]);
  const col = kind === 'spouse' ? c.spouseData : c.kidsData;
  if (col === undefined) throw new Error('В таблице нет колонки для данных семьи');
  const cell = sh.getRange(row, col + 1);
  const lines = String(cell.getValue() || '').split('\n').map(function (l) { return l.replace(/^\s*\d+\.\s*/, '').trim(); }).filter(String);
  return { sh: sh, c: c, cell: cell, lines: lines, applicant: String(sh.getRange(row, c.name + 1).getDisplayValue()).toUpperCase() };
}
function writeFamily_(f, kind, row) {
  const text = kind === 'spouse' ? (f.lines[0] || '') : f.lines.map(function (l, i) { return (i + 1) + '. ' + l; }).join('\n');
  f.cell.setValue(text);
  if (kind !== 'spouse' && f.c.children !== undefined) f.sh.getRange(Number(row), f.c.children + 1).setValue(f.lines.length ? 'Да, ' + f.lines.length : 'Нет');
  return text;
}

/** Изменить супруга(у) или ребёнка (kind: 'spouse' | 'child', idx — номер в списке). Новое фото — в папку. */
function adminUpdateMember(row, kind, idx, p) {
  assertOwner_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const f = familyCell_(row, kind);
    idx = Number(idx);
    if (!(idx >= 0 && idx < f.lines.length)) throw new Error('Не найдено — обновите страницу');
    const oldPhoto = (f.lines[idx].match(/фото:\s*(\S+)/) || [])[1] || '';
    const url = savePhotoFile_(p.photo, String(p.name || '') + (kind === 'spouse' ? ' (SPOUSE OF ' : ' (CHILD OF ') + f.applicant + ')');
    if (p.dob) parseDob_(p.dob);
    f.lines[idx] = [String(p.name || '').trim().toUpperCase().slice(0, 200), String(p.sex || '').slice(0, 2), String(p.dob || '').slice(0, 10),
      String(p.city || '').trim().toUpperCase().slice(0, 100), String(p.country || '').trim().toUpperCase().slice(0, 100),
      'фото: ' + (url || (/^https?:/.test(oldPhoto) ? oldPhoto : 'пришлёт в Telegram'))].join(', ');
    return writeFamily_(f, kind, row);
  } finally { lock.releaseLock(); }
}

/** Убрать супруга(у) или ребёнка из заявки. */
function adminRemoveMember(row, kind, idx) {
  assertOwner_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const f = familyCell_(row, kind);
    idx = Number(idx);
    if (!(idx >= 0 && idx < f.lines.length)) throw new Error('Не найдено — обновите страницу');
    f.lines.splice(idx, 1);
    return { text: writeFamily_(f, kind, row), marital: '' };
  } finally { lock.releaseLock(); }
}

function adminSetCurrentSeason(season) {
  assertOwner_();
  season = Number(season);
  if (!(season >= 2020 && season <= 2100)) throw new Error('Неверный сезон');
  PropertiesService.getScriptProperties().setProperty('CURRENT_SEASON', String(season));
  return season;
}

function savePhotoFile_(photo, label) {
  if (!photo || !photo.data) return '';
  const bytes = Utilities.base64Decode(photo.data);
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error('Фото слишком большое');
  const mime = /^image\/(jpeg|png)$/.test(photo.mime) ? photo.mime : 'image/jpeg';
  const stamp = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH-mm');
  const clean = String(label || 'BEZ IMENI').toUpperCase().replace(/[^A-Z0-9 \-()]/g, '').trim();
  return photoFolder_().createFile(Utilities.newBlob(bytes, mime, clean + ' — ' + stamp + (mime === 'image/png' ? '.png' : '.jpg'))).getUrl();
}

/** Добавить супруга(у) или ребёнка в анкету клиента. p: {name, sex, dob:'dd.mm.yyyy', city, country, photo?} */
function adminAddMember(row, kind, p) {
  assertOwner_();
  row = Number(row);
  const sh = responsesSheet_();
  if (!(row >= 2 && row <= sh.getLastRow())) throw new Error('Нет такой строки');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const c = colIndex_(headers);
  const col = kind === 'spouse' ? c.spouseData : c.kidsData;
  if (col === undefined) throw new Error('В таблице нет колонки для данных семьи — запустите setupFamily()');
  const applicant = String(sh.getRange(row, c.name + 1).getDisplayValue()).toUpperCase();
  const url = savePhotoFile_(p.photo, String(p.name || '') + (kind === 'spouse' ? ' (SPOUSE OF ' : ' (CHILD OF ') + applicant + ')');
  const line = [String(p.name || '').trim().toUpperCase().slice(0, 200), String(p.sex || '').slice(0, 2), String(p.dob || '').slice(0, 10),
    String(p.city || '').trim().toUpperCase().slice(0, 100), String(p.country || '').trim().toUpperCase().slice(0, 100),
    'фото: ' + (url || 'пришлёт в Telegram')].join(', ');
  const cell = sh.getRange(row, col + 1);
  const before = String(cell.getValue() || '').trim();
  if (kind === 'spouse') {
    cell.setValue(line);
    if (c.marital !== undefined) sh.getRange(row, c.marital + 1).setValue('Женат / замужем');
  } else {
    const n = before ? before.split('\n').filter(String).length + 1 : 1;
    cell.setValue((before ? before + '\n' : '') + n + '. ' + line);
    if (c.children !== undefined) sh.getRange(row, c.children + 1).setValue('Да, ' + n);
  }
  return line;
}

/** Обновить фото заявителя из админки. */
function adminSetPhoto(row, photo) {
  assertOwner_();
  row = Number(row);
  const sh = responsesSheet_();
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const c = colIndex_(headers);
  if (c.photoNew === undefined) throw new Error('Нет колонки «Фотография»');
  const name = String(sh.getRange(row, c.name + 1).getDisplayValue());
  const url = savePhotoFile_(photo, name);
  sh.getRange(row, c.photoNew + 1).setValue(url);
  return url;
}

function adminPage_() {
  if (!isOwner_()) {
    return HtmlService.createHtmlOutput(
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<div style="font:16px system-ui;max-width:420px;margin:15vh auto;padding:0 20px;color:#142140">' +
      '<h2 style="margin:0 0 12px">Нет доступа</h2>' +
      '<p>Админка открывается только владельцу. Войдите в Google как владелец и откройте ссылку снова.</p></div>'
    ).setTitle('DV Lottery — админка');
  }
  return HtmlService.createHtmlOutput(ADMIN_HTML)
    .setTitle('Заявки DV Lottery')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
