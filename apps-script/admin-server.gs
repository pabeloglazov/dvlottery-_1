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
const REMOVED_ = 'Убран';

const COLS = {
  ts: ['timestamp', 'отметка времени'], name: ['напиши фамилию и имя'], sex: ['выберите свой пол'],
  birth: ['день вашего рождения'], birthCity: ['город в котором вы родились'], birthCountry: ['страна в которой вы родились'],
  photoNew: ['фотография'], photoOld: ['загрузите фотографию'], address: ['напишите ваш адрес'],
  country: ['страна, в которой вы живете сейчас'], email: ['ваш действующий e-mail адрес'],
  education: ['укажите, какое у вас образование'], marital: ['укажите ваше текущее семейное положение'],
  children: ['есть ли у вас дети?'], telegram: ['ваш telegram для связи'],
  spouseData: ['данные супруга(и)'], kidsData: ['данные детей'], passport: ['загранпаспорт'], passportScan: ['скан загранпаспорта'], photoCheck: ['проверка фото'],
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
      adminUpdateField: adminUpdateField, adminUpdateMember: adminUpdateMember, adminRemoveMember: adminRemoveMember, adminRemoveFromSeason: adminRemoveFromSeason,
      adminSetPassport: adminSetPassport, adminAddPassportScan: adminAddPassportScan,
      adminScanPassport: adminScanPassport, adminRemovePassportScan: adminRemovePassportScan, adminCheckPhoto: adminCheckPhoto, adminGetPhoto: adminGetPhoto, adminSetMemberPhoto: adminSetMemberPhoto, adminClearPassport: adminClearPassport, adminHistory: adminHistory, adminRevert: adminRevert };
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
        telegram: get(r, 'telegram'), spouseData: get(r, 'spouseData'), kidsData: get(r, 'kidsData'),
        passport: get(r, 'passport'), passportScan: get(r, 'passportScan'), photoCheck: get(r, 'photoCheck')
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
    if (sv[i][3] === REMOVED_) { delete subs[key][season]; continue; }
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
function adminSaveSub__(key, name, row, season, sub) {
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
function adminAddToSeason__(list, season) {
  assertOwner_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = subsSheet_();
    const rows = [];
    (list || []).forEach(function (c) {
      const at = findSubRow_(sh, c.key, season);
      if (at && sh.getRange(at, 4).getValue() === REMOVED_) {
        sh.getRange(at, 4, 1, 7).setValues([['Новая', '', '', '', '', Number(c.row) || '', new Date()]]);
        rows.push(null); return;
      }
      if (at) return;
      rows.push([String(c.name), String(c.key), Number(season), 'Новая', '', '', '', '', Number(c.row) || '', new Date()]);
    });
    const fresh = rows.filter(Boolean);
    if (fresh.length) sh.getRange(sh.getLastRow() + 1, 1, fresh.length, fresh[0].length).setValues(fresh);
    return rows.length;
  } finally { lock.releaseLock(); }
}

/** Удалить клиента: его строки анкеты (лист ответов) и все его подачи (лист «Подачи»). */
function adminDeleteClient__(key, rows) {
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
function adminUpdateField__(key, rows, field, value) {
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
function adminUpdateMember__(row, kind, idx, p) {
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
function adminRemoveMember__(row, kind, idx) {
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

/** Убрать клиента из сезона: анкета и данные остаются, в «Подачах» ставится отметка «Убран». */
function adminRemoveFromSeason__(key, name, row, season) {
  assertOwner_();
  season = Number(season);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = subsSheet_();
    const at = findSubRow_(sh, key, season);
    const values = [String(name), String(key), season, REMOVED_, '', '', '', '', Number(row) || '', new Date()];
    if (at) sh.getRange(at, 4, 1, 1).setValue(REMOVED_), sh.getRange(at, 10).setValue(new Date());
    else sh.appendRow(values);
    return true;
  } finally { lock.releaseLock(); }
}

// ---------- Загранпаспорт (обязателен с DV-2027) ----------
function clientRow_(sh, key, rows) {
  const v = sh.getDataRange().getValues();
  const c = colIndex_(v[0].map(String));
  const mine = (rows || []).map(Number).filter(function (r) {
    return r >= 2 && r <= v.length && keyOf_(String(v[r - 1][c.name] || '').trim(), fmtDate_(v[r - 1][c.birth], 'dd.MM.yyyy')) === key;
  });
  if (!mine.length) throw new Error('Клиент не найден — обновите страницу');
  return { row: Math.max.apply(null, mine), c: c, v: v };
}
function passportCols_(sh) {
  let c = colIndex_(sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0]);
  if (c.passport === undefined || c.passportScan === undefined) {
    ensurePassportItems_(openForm_());
    SpreadsheetApp.flush();
    c = colIndex_(sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0]);
  }
  if (c.passport === undefined || c.passportScan === undefined) throw new Error('Колонки паспорта ещё не появились в таблице — попробуйте через минуту');
  return c;
}

/** Паспорт клиента: { number, country, expiry: 'ДД.ММ.ГГГГ' } | { none: true } | { clear: true }. */
function adminSetPassport__(key, rows, p) {
  assertOwner_();
  p = p || {};
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = responsesSheet_();
    const c = passportCols_(sh);
    const at = clientRow_(sh, key, rows).row;
    let text = '';
    if (p.none) text = NO_PASSPORT;
    else if (!p.clear) {
      const num = String(p.number || '').replace(/\s+/g, '').toUpperCase();
      if (!/^[A-Z0-9]{5,20}$/.test(num)) throw new Error('Номер паспорта: только латиница и цифры');
      const ex = parseDob_(p.expiry);
      text = passportText_(num, p.country, ex.getDate(), ex.getMonth() + 1, ex.getFullYear());
    }
    sh.getRange(at, c.passport + 1).setValue(text);
    return text;
  } finally { lock.releaseLock(); }
}

/** Добавить скан паспорта: файл — в папку с фото, ссылка — в таблицу. */
function adminAddPassportScan__(key, rows, photo) {
  assertOwner_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = responsesSheet_();
    const c = passportCols_(sh);
    const at = clientRow_(sh, key, rows).row;
    const name = String(sh.getRange(at, c.name + 1).getDisplayValue()).toUpperCase();
    const url = savePhotoFile_(photo, name + ' PASSPORT');
    const cell = sh.getRange(at, c.passportScan + 1);
    const before = String(cell.getValue() || '').split('\n').filter(function (x) { return /^https?:/.test(x.trim()); });
    before.push(url);
    cell.setValue(before.join('\n'));
    return before.join('\n');
  } finally { lock.releaseLock(); }
}

/** Скан + распознавание: скан сохраняется всегда; данные паспорта пишутся сами, если их ещё не было.
 *  Если в таблице уже другой паспорт — возвращает распознанное, чтобы админ решил, заменять ли. */
function adminScanPassport__(key, rows, photo) {
  const scans = adminAddPassportScan__(key, rows, photo);
  const out = { scans: scans, parsed: null, applied: false, same: false, passport: null, error: '' };
  try { out.parsed = recognizePassport_(photo); } catch (e) { out.error = String(e && e.message || e); return out; }
  const p = out.parsed;
  if (!p.number || !p.expiry) { out.error = 'Не удалось прочитать данные со скана'; return out; }
  const sh = responsesSheet_(), c = passportCols_(sh), at = clientRow_(sh, key, rows).row;
  const cur = String(sh.getRange(at, c.passport + 1).getValue() || '').trim();
  const ex = parseDob_(p.expiry);
  const text = passportText_(p.number, p.country || '', ex.getDate(), ex.getMonth() + 1, ex.getFullYear());
  if (cur === text) { out.same = true; out.passport = cur; return out; }
  if (!/\d/.test(cur)) { out.passport = adminSetPassport__(key, rows, { number: p.number, country: p.country, expiry: p.expiry }); out.applied = true; }
  else out.passport = cur;
  return out;
}

/** Удалить паспорт целиком: номер, страну, срок и все сканы (файлы остаются в папке). */
function adminClearPassport__(key, rows) {
  assertOwner_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = responsesSheet_(), c = passportCols_(sh), at = clientRow_(sh, key, rows).row;
    sh.getRange(at, c.passport + 1).setValue('');
    sh.getRange(at, c.passportScan + 1).setValue('');
    return true;
  } finally { lock.releaseLock(); }
}

/** Убрать скан из карточки (файл остаётся в папке). */
function adminRemovePassportScan__(key, rows, url) {
  assertOwner_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = responsesSheet_(), c = passportCols_(sh), at = clientRow_(sh, key, rows).row;
    const cell = sh.getRange(at, c.passportScan + 1);
    const left = String(cell.getValue() || '').split('\n').map(function (x) { return x.trim(); }).filter(function (x) { return /^https?:/.test(x) && x !== String(url).trim(); });
    cell.setValue(left.join('\n'));
    return left.join('\n');
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
function adminAddMember__(row, kind, p) {
  assertOwner_();
  row = Number(row);
  const sh = responsesSheet_();
  if (!(row >= 2 && row <= sh.getLastRow())) throw new Error('Нет такой строки');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const c = colIndex_(headers);
  const col = kind === 'spouse' ? c.spouseData : c.kidsData;
  if (col === undefined) throw new Error('В таблице нет колонки для данных семьи — запустите setupFamily()');
  const applicant = String(sh.getRange(row, c.name + 1).getDisplayValue()).toUpperCase();
  const url = savePhotoFile_(p.photo, String(p.name || '') + (kind === 'spouse' ? ' (SPOUSE OF ' : ' (CHILD OF ') + applicant + ')') ||
    (/^https:\/\/(drive|docs)\.google\.com\//.test(String(p.photoUrl || '')) ? String(p.photoUrl) : '');
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

/** Отдать фото из Drive в админку (для ИИ-обработки старых фото). */
function adminGetPhoto(url) {
  assertOwner_();
  const id = (String(url || '').match(/[-\w]{25,}/) || [])[0];
  if (!id) throw new Error('Не нашёл файл фото');
  const blob = DriveApp.getFileById(id).getBlob();
  const bytes = blob.getBytes();
  if (bytes.length > 15 * 1024 * 1024) throw new Error('Фото слишком большое');
  return { mime: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(bytes), name: blob.getName() };
}

/** Заменить только фото родственника (остальные данные строки не трогаем). */
function adminSetMemberPhoto__(row, kind, idx, photo) {
  assertOwner_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const f = familyCell_(row, kind);
    idx = Number(idx);
    if (!(idx >= 0 && idx < f.lines.length)) throw new Error('Не найдено — обновите страницу');
    const name = f.lines[idx].split(',')[0].trim();
    const url = savePhotoFile_(photo, name + (kind === 'spouse' ? ' (SPOUSE OF ' : ' (CHILD OF ') + f.applicant + ') DV');
    f.lines[idx] = /фото:\s*\S*/.test(f.lines[idx]) ? f.lines[idx].replace(/фото:\s*\S*/, 'фото: ' + url) : f.lines[idx] + ', фото: ' + url;
    return writeFamily_(f, kind, row);
  } finally { lock.releaseLock(); }
}

/** ИИ-проверка фото из админки (фото уже обработано в браузере). */
function adminCheckPhoto(photo) {
  assertOwner_();
  return checkPhoto_(photo);
}

/** Обновить фото заявителя из админки. extra: { original, check } — оригинал и результат ИИ-проверки. */
function adminSetPhoto__(row, photo, extra) {
  assertOwner_();
  row = Number(row);
  const sh = responsesSheet_();
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const c = colIndex_(headers);
  if (c.photoNew === undefined) throw new Error('Нет колонки «Фотография»');
  const name = String(sh.getRange(row, c.name + 1).getDisplayValue());
  const url = savePhotoFile_(photo, name);
  sh.getRange(row, c.photoNew + 1).setValue(url);
  let meta = '';
  if (extra && (extra.original || extra.originalUrl || extra.check)) {
    let cc = c;
    if (cc.photoCheck === undefined) {
      try { ensurePassportItems_(openForm_()); SpreadsheetApp.flush(); cc = colIndex_(sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0]); } catch (e) { /* колонка появится позже */ }
    }
    if (cc.photoCheck !== undefined) {
      const orig = extra.original ? savePhotoFile_(extra.original, name + ' ORIGINAL') : String(extra.originalUrl || '');
      meta = photoCheckText_(orig, extra.check || null);
      sh.getRange(row, cc.photoCheck + 1).setValue(meta);
    }
  }
  return extra ? { url: url, photoCheck: meta } : url;
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


// Публичные действия админки — через журнал изменений.
function adminSaveSub() { return logged_('adminSaveSub', adminSaveSub__, Array.prototype.slice.call(arguments)); }
function adminAddToSeason() { return logged_('adminAddToSeason', adminAddToSeason__, Array.prototype.slice.call(arguments)); }
function adminDeleteClient() { return logged_('adminDeleteClient', adminDeleteClient__, Array.prototype.slice.call(arguments)); }
function adminUpdateField() { return logged_('adminUpdateField', adminUpdateField__, Array.prototype.slice.call(arguments)); }
function adminUpdateMember() { return logged_('adminUpdateMember', adminUpdateMember__, Array.prototype.slice.call(arguments)); }
function adminRemoveMember() { return logged_('adminRemoveMember', adminRemoveMember__, Array.prototype.slice.call(arguments)); }
function adminRemoveFromSeason() { return logged_('adminRemoveFromSeason', adminRemoveFromSeason__, Array.prototype.slice.call(arguments)); }
function adminSetPassport() { return logged_('adminSetPassport', adminSetPassport__, Array.prototype.slice.call(arguments)); }
function adminAddPassportScan() { return logged_('adminAddPassportScan', adminAddPassportScan__, Array.prototype.slice.call(arguments)); }
function adminScanPassport() { return logged_('adminScanPassport', adminScanPassport__, Array.prototype.slice.call(arguments)); }
function adminClearPassport() { return logged_('adminClearPassport', adminClearPassport__, Array.prototype.slice.call(arguments)); }
function adminRemovePassportScan() { return logged_('adminRemovePassportScan', adminRemovePassportScan__, Array.prototype.slice.call(arguments)); }
function adminAddMember() { return logged_('adminAddMember', adminAddMember__, Array.prototype.slice.call(arguments)); }
function adminSetMemberPhoto() { return logged_('adminSetMemberPhoto', adminSetMemberPhoto__, Array.prototype.slice.call(arguments)); }
function adminSetPhoto() { return logged_('adminSetPhoto', adminSetPhoto__, Array.prototype.slice.call(arguments)); }

// ---------- История изменений и откат ----------
// Каждое действие админки снимает «до» и «после» листов «Заявки» и «Подачи», разницу пишет в лист «История».
// Откат возвращает старые значения (и удалённые строки), если после этого ничего не меняли (или с подтверждением).
const HIST_SHEET = 'История';
const HIST_HEADERS = ['Время', 'Клиент', 'Действие', 'Что изменилось', 'Ключи', 'ID', 'Откат', 'Данные'];
const ACTION_NAMES_ = {
  adminSaveSub: 'Сезон: статус / оплата / номер', adminAddToSeason: 'Добавлен в сезон', adminDeleteClient: 'Заявка удалена',
  adminUpdateField: 'Изменены данные', adminUpdateMember: 'Изменён член семьи', adminRemoveMember: 'Убран член семьи',
  adminRemoveFromSeason: 'Убран из сезона', adminSetPassport: 'Паспорт изменён', adminAddPassportScan: 'Добавлен скан паспорта',
  adminScanPassport: 'Скан паспорта (ИИ)', adminClearPassport: 'Паспорт удалён', adminRemovePassportScan: 'Убран скан паспорта',
  adminAddMember: 'Добавлен член семьи', adminSetMemberPhoto: 'Фото члена семьи', adminSetPhoto: 'Фото заявителя', adminRevert: 'Откат'
};
const FIELD_NAMES_ = { ts: 'Дата анкеты', name: 'Имя', sex: 'Пол', birth: 'Дата рождения', birthCity: 'Город рождения', birthCountry: 'Страна рождения',
  photoNew: 'Фото', photoOld: 'Фото (анкета)', address: 'Адрес', country: 'Страна проживания', email: 'Email', education: 'Образование',
  marital: 'Семейное положение', children: 'Дети', telegram: 'Telegram', spouseData: 'Супруг(а)', kidsData: 'Дети (данные)',
  passport: 'Паспорт', passportScan: 'Сканы паспорта', photoCheck: 'Проверка фото', confirm: 'Номер подтверждения', result: 'Результат', status: 'Статус', note: 'Заметка' };
let LOGGING_ = false;

function histSheet_() {
  const ss = responsesSheet_().getParent();
  let sh = ss.getSheetByName(HIST_SHEET);
  if (!sh) {
    sh = ss.insertSheet(HIST_SHEET);
    sh.getRange(1, 1, 1, HIST_HEADERS.length).setValues([HIST_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(4, 520); sh.hideColumns(5, 2); sh.hideColumns(8);
  }
  return sh;
}
function ser_(v) { return v instanceof Date ? { d: v.toISOString() } : (v === null || v === undefined ? '' : v); }
function deser_(v) { return v && typeof v === 'object' && v.d ? new Date(v.d) : v; }
function same_(a, b) {
  const s = function (x) { x = ser_(x); return typeof x === 'object' ? JSON.stringify(x) : String(x).trim(); };
  return s(a) === s(b);
}
function show_(v) {
  v = deser_(v);
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), v.getHours() || v.getMinutes() ? 'dd.MM.yyyy HH:mm' : 'dd.MM.yyyy');
  return String(v === null || v === undefined ? '' : v);
}
function snap_() {
  const r = responsesSheet_(), ss = r.getParent(), s = ss.getSheetByName(SUBS_SHEET);
  const rv = r.getDataRange().getValues();
  return { R: rv, S: s ? s.getDataRange().getValues() : [SUBS_HEADERS] };
}
// Ключ строки, по которому её можно найти, даже если строки сдвинулись.
function rowId_(sheet, row, c) {
  if (sheet === 'R') return JSON.stringify(ser_(row[c.ts !== undefined ? c.ts : 0])) + '|' + String(row[c.name] || '').trim().toUpperCase();
  return String(row[1]) + '|' + String(row[2]);
}
function clientKeyOf_(sheet, row, c) {
  if (sheet === 'R') return String(row[c.name] || '').trim() ? keyOf_(String(row[c.name]).trim(), fmtDate_(row[c.birth], 'dd.MM.yyyy')) : '';
  return String(row[1] || '');
}
function diff_(a, b) {
  const out = [], keys = {}, names = {};
  ['R', 'S'].forEach(function (sheet) {
    const A = a[sheet], B = b[sheet];
    const head = (B[0] || A[0] || []).map(String);
    const c = sheet === 'R' ? colIndex_(head) : {};
    const note = function (row) { const k = clientKeyOf_(sheet, row, c); if (k) { keys[k] = 1; names[k.split('|')[0]] = 1; } };
    const cellsOf = function (ra, rb, rowNo) {
      const w = Math.max(ra.length, rb.length);
      for (let j = 0; j < w; j++) {
        if (sheet === 'S' && j === 9) continue; // «Обновлено»
        const x = ra[j] === undefined ? '' : ra[j], y = rb[j] === undefined ? '' : rb[j];
        if (same_(x, y)) continue;
        out.push({ t: 'cell', s: sheet, r: rowNo, id: rowId_(sheet, rb, c), c: j + 1, h: String(head[j] || ''), b: ser_(x), a: ser_(y) });
        note(ra); note(rb);
      }
    };
    if (A.length === B.length) {
      for (let i = 1; i < A.length; i++) cellsOf(A[i], B[i], i + 1);
      return;
    }
    // Строк стало больше или меньше — сопоставляем по ключу строки.
    const idx = {};
    for (let i = 1; i < B.length; i++) { const id = rowId_(sheet, B[i], c); (idx[id] = idx[id] || []).push(i); }
    const used = {};
    for (let i = 1; i < A.length; i++) {
      const id = rowId_(sheet, A[i], c), list = idx[id] || [];
      const j = list.filter(function (k) { return !used[k]; })[0];
      if (j === undefined) { out.push({ t: 'del', s: sheet, r: i + 1, id: id, v: A[i].map(ser_) }); note(A[i]); continue; }
      used[j] = 1; cellsOf(A[i], B[j], j + 1);
    }
    for (let j = 1; j < B.length; j++) if (!used[j]) { out.push({ t: 'add', s: sheet, r: j + 1, id: rowId_(sheet, B[j], c), v: B[j].map(ser_) }); note(B[j]); }
  });
  return { changes: out, keys: Object.keys(keys), names: Object.keys(names) };
}
function label_(ch) {
  if (ch.s === 'S') return (ch.h || 'Подачи') + (ch.id ? ' (DV-' + String(ch.id).split('|').pop() + ')' : '');
  const c = colIndex_([ch.h]);
  const k = Object.keys(c)[0];
  return FIELD_NAMES_[k] || ch.h || ('Колонка ' + ch.c);
}
function visible_(ch) { return !(ch.t === 'cell' && ch.s === 'S' && (ch.c === 1 || ch.c === 2)); }
function summary_(changes) {
  return changes.filter(visible_).map(function (ch) {
    if (ch.t === 'del') return (ch.s === 'R' ? 'Удалена строка анкеты ' : 'Удалена строка подачи ') + ch.r;
    if (ch.t === 'add') return (ch.s === 'R' ? 'Добавлена строка анкеты ' : 'Добавлена подача ') + ch.r;
    const cut = function (x) { x = show_(x); return x.length > 140 ? x.slice(0, 140) + '…' : x; };
    return label_(ch) + ': «' + cut(ch.b) + '» → «' + cut(ch.a) + '»';
  }).join('\n');
}

/** Обёртка для действий админки: выполнить и записать, что изменилось. */
function logged_(action, fn, args, meta) {
  if (LOGGING_) return fn.apply(null, args);
  LOGGING_ = true;
  let before = null;
  try { before = snap_(); } catch (e) { before = null; }
  try {
    const res = fn.apply(null, args);
    if (before) {
      try {
        SpreadsheetApp.flush();
        const d = diff_(before, snap_());
        if (d.changes.length) {
          let data = JSON.stringify(d.changes);
          if (data.length > 49000) data = '';
          const id = Utilities.getUuid().slice(0, 8);
          histSheet_().appendRow([new Date(), d.names.join(', '), (meta && meta.label) || ACTION_NAMES_[action] || action,
            summary_(d.changes).slice(0, 49000), d.keys.join('\n'), id, data ? '' : 'нельзя (слишком большое)', data]);
        }
      } catch (e) { console.warn('История: ' + e); }
    }
    return res;
  } finally { LOGGING_ = false; }
}

/** История: по клиенту (с учётом переименований) или последние изменения по всем. */
function adminHistory(key, limit) {
  assertOwner_();
  const sh = histSheet_();
  const n = sh.getLastRow();
  if (n < 2) return [];
  const v = sh.getRange(2, 1, n - 1, HIST_HEADERS.length).getValues();
  const want = {}; if (key) want[key] = 1;
  const out = [];
  limit = Number(limit) || (key ? 100 : 40);
  for (let i = v.length - 1; i >= 0 && out.length < limit; i--) {
    const ks = String(v[i][4] || '').split('\n').filter(String);
    if (key) {
      if (!ks.some(function (k) { return want[k]; })) continue;
      ks.forEach(function (k) { want[k] = 1; }); // переименование: дальше ищем и по старому ключу
    }
    let changes = [];
    try { changes = JSON.parse(v[i][7] || '[]'); } catch (e) { changes = []; }
    out.push({
      id: String(v[i][5]), time: show_(v[i][0]), name: String(v[i][1]), action: String(v[i][2]), keys: ks,
      reverted: String(v[i][6] || ''), canRevert: !!v[i][7] && !v[i][6],
      items: changes.length ? changes.filter(visible_).slice(0, 30).map(function (ch) {
        return ch.t === 'cell' ? { label: label_(ch), b: show_(ch.b), a: show_(ch.a) }
          : { label: ch.t === 'del' ? (ch.s === 'R' ? 'Удалена строка анкеты' : 'Удалена подача') : (ch.s === 'R' ? 'Добавлена строка анкеты' : 'Добавлена подача'), row: true };
      }) : String(v[i][3]).split('\n').map(function (t) { return { label: t, row: true }; })
    });
  }
  return out;
}

function findHist_(id) {
  const sh = histSheet_();
  const v = sh.getDataRange().getValues();
  for (let i = v.length - 1; i >= 1; i--) if (String(v[i][5]) === String(id)) return { sh: sh, row: i + 1, v: v[i] };
  throw new Error('Запись истории не найдена');
}

/** Откатить запись истории. Если после неё значения уже меняли — без force вернёт список конфликтов. */
function adminRevert(id, force) {
  assertOwner_();
  const h = findHist_(id);
  if (h.v[6]) throw new Error('Уже откачено');
  const changes = JSON.parse(h.v[7] || '[]');
  if (!changes.length) throw new Error('Для этой записи откат недоступен');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const res = logged_('adminRevert', function () {
      const R = responsesSheet_(), Sg = subsSheet_();
      const sheets = { R: R, S: Sg };
      const vals = { R: R.getDataRange().getValues(), S: Sg.getDataRange().getValues() };
      const cIdx = colIndex_(vals.R[0].map(String));
      const locate = function (ch) {
        const V = vals[ch.s];
        const c = ch.s === 'R' ? cIdx : {};
        if (ch.r < V.length && rowId_(ch.s, V[ch.r - 1], c) === ch.id) return ch.r;
        for (let i = 1; i < V.length; i++) if (rowId_(ch.s, V[i], c) === ch.id) return i + 1;
        return ch.r < V.length + 1 ? ch.r : 0;
      };
      const conflicts = [], plan = [];
      changes.forEach(function (ch) {
        if (ch.t === 'cell') {
          const r = locate(ch);
          const cur = r ? (vals[ch.s][r - 1] || [])[ch.c - 1] : undefined;
          if (!r || !same_(cur === undefined ? '' : cur, deser_(ch.a))) conflicts.push(label_(ch) + ': сейчас «' + show_(cur) + '»');
          if (r) plan.push({ k: 'set', s: ch.s, r: r, c: ch.c, val: deser_(ch.b) });
        } else if (ch.t === 'add') {
          const r = locate(ch);
          if (r && rowId_(ch.s, vals[ch.s][r - 1], ch.s === 'R' ? cIdx : {}) === ch.id) plan.push({ k: 'delrow', s: ch.s, r: r });
        } else if (ch.t === 'del') plan.push({ k: 'addrow', s: ch.s, v: ch.v.map(deser_), oldRow: ch.r });
      });
      if (conflicts.length && !force) return { conflicts: conflicts };
      plan.filter(function (p) { return p.k === 'set'; }).forEach(function (p) { sheets[p.s].getRange(p.r, p.c).setValue(p.val); });
      plan.filter(function (p) { return p.k === 'delrow'; }).sort(function (a, b) { return b.r - a.r; }).forEach(function (p) { sheets[p.s].deleteRow(p.r); });
      const moved = {};
      plan.filter(function (p) { return p.k === 'addrow' && p.s === 'R'; }).forEach(function (p) { R.appendRow(p.v); moved[p.oldRow] = R.getLastRow(); });
      plan.filter(function (p) { return p.k === 'addrow' && p.s === 'S'; }).forEach(function (p) {
        const row = p.v.slice(); if (moved[Number(row[8])]) row[8] = moved[Number(row[8])];
        Sg.appendRow(row);
      });
      return { ok: true };
    }, [], { label: 'Откат: ' + String(h.v[2]) });
    if (res && res.ok) h.sh.getRange(h.row, 7).setValue('откачено ' + show_(new Date()));
    return res;
  } finally { lock.releaseLock(); }
}
