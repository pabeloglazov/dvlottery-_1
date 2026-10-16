/**
 * Beloglazov Green Card — приём анкет с сайта.
 *
 * Сайт отправляет анкету (и фото) POST-запросом сюда. Скрипт:
 *  1) сохраняет фото в папку на Google Диске;
 *  2) записывает ответ в Google Form (он же попадает в таблицу ответов).
 *
 * Разовая настройка: запустить setup() из редактора, затем
 * «Развернуть → Новое развертывание → Веб-приложение»
 * (Выполнять от имени: я; Доступ: все).
 *
 * Админка: тот же адрес веб-приложения с ?admin. Данные видит только
 * владелец (OWNER_EMAIL), вошедший в свой Google-аккаунт.
 */

const FORM_EDIT_ID = '1sfOSuu6WaqLTD1-xzHwTKldX-_8S-OW9q5cGpBQTrf4';
const FORM_PUBLIC_ID = '1FAIpQLScPpb6xumWrPSjkPOVaVp6a2oIM6T7PcWi5z4SpKBPvWQMfPg';
const PHOTO_FOLDER_NAME = 'DV Lottery — фото с сайта';
const PHOTO_TITLE = 'Фотография';
const OLD_UPLOAD_TITLE = 'Загрузите фотографию';
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// Ключ из анкеты на сайте → заголовок вопроса в форме.
const TITLES = {
  name: 'Напиши фамилию и имя',
  sex: 'Выберите свой пол',
  birth: 'День вашего рождения',
  birthCity: 'Город в котором вы родились',
  birthCountry: 'Страна в которой вы родились',
  photo: PHOTO_TITLE,
  address: 'Напишите ваш адрес',
  country: 'Страна, в которой вы живете сейчас',
  email: 'Ваш действующий e-mail адрес',
  education: 'Укажите, какое у вас образование',
  marital: 'Укажите ваше текущее семейное положение',
  children: 'Есть ли у вас дети?',
  telegram: 'Ваш Telegram для связи',
  spouseData: 'Данные супруга(и)',
  kidsData: 'Данные детей',
};

function norm_(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

function openForm_() {
  const form = FormApp.openById(FORM_EDIT_ID);
  if (form.getPublishedUrl().indexOf(FORM_PUBLIC_ID) === -1) {
    throw new Error('Это не та форма: ' + form.getPublishedUrl());
  }
  return form;
}

function findItem_(form, title) {
  const t = norm_(title);
  return form.getItems().filter(function (it) { return norm_(it.getTitle()) === t; })[0] || null;
}

function photoFolder_() {
  const it = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
}

/** Разовая настройка формы. Запускать вручную из редактора. */
function setup() {
  const form = openForm_();
  const report = [];

  // 1. Вопрос с загрузкой файла требует входа в Google — заменяем на текстовый.
  let photo = findItem_(form, PHOTO_TITLE);
  if (!photo) {
    const old = findItem_(form, OLD_UPLOAD_TITLE);
    const index = old ? old.getIndex() : 5;
    const added = form.addTextItem()
      .setTitle(PHOTO_TITLE)
      .setHelpText('Ссылка на фото в Google Диске или пометка «пришлёт в Telegram». Заполняется сайтом автоматически.')
      .setRequired(false);
    form.moveItem(added.getIndex(), index);
    if (old) { form.deleteItem(old); report.push('Удалён вопрос с загрузкой файла: ' + OLD_UPLOAD_TITLE); }
    report.push('Добавлен текстовый вопрос: ' + PHOTO_TITLE);
    photo = added;
  } else {
    report.push('Текстовый вопрос «' + PHOTO_TITLE + '» уже есть');
  }

  // 2. Email уже спрашивается отдельным вопросом — системный сбор email выключаем.
  try {
    form.setEmailCollectionType(FormApp.EmailCollectionType.DO_NOT_COLLECT);
    report.push('Сбор email формой: выключен');
  } catch (e) {
    form.setCollectEmail(false);
    report.push('Сбор email формой: выключен (старый метод)');
  }
  try { form.setRequireLogin(false); } catch (e) { /* только для Workspace */ }
  form.setAcceptingResponses(true);

  // 3. Папка для фото.
  report.push('Папка для фото: ' + photoFolder_().getUrl());

  // 4. Номера полей entry.* для прямой отправки с сайта (запасной путь).
  const entries = {};
  Object.keys(TITLES).forEach(function (key) {
    const item = findItem_(form, TITLES[key]);
    if (!item) { entries[key] = 'НЕ НАЙДЕН'; return; }
    entries[key] = entryId_(item);
  });
  report.push('entry: ' + JSON.stringify(entries));

  Logger.log(report.join('\n'));
  return report.join('\n');
}

/** Добавляет в форму вопросы для данных супруга(и) и детей. Запускать вручную один раз. */
function setupFamily() {
  const form = openForm_();
  const report = [];
  let anchor = findItem_(form, TITLES.children);
  [['spouseData', 'Заполняется сайтом: ФИО, пол, дата и место рождения, ссылка на фото.'],
   ['kidsData', 'Заполняется сайтом: по одному ребёнку на строку, со ссылкой на фото.']].forEach(function (x) {
    let item = findItem_(form, TITLES[x[0]]);
    if (!item) {
      item = form.addParagraphTextItem().setTitle(TITLES[x[0]]).setHelpText(x[1]).setRequired(false);
      if (anchor) form.moveItem(item.getIndex(), anchor.getIndex() + 1);
      report.push('Добавлен вопрос: ' + TITLES[x[0]]);
    } else {
      report.push('Вопрос уже есть: ' + TITLES[x[0]]);
    }
    anchor = item;
  });
  Logger.log(report.join('\n'));
  return report.join('\n');
}

function entryId_(item) {
  let resp;
  switch (item.getType()) {
    case FormApp.ItemType.TEXT: resp = item.asTextItem().createResponse('x'); break;
    case FormApp.ItemType.PARAGRAPH_TEXT: resp = item.asParagraphTextItem().createResponse('x'); break;
    case FormApp.ItemType.MULTIPLE_CHOICE: resp = item.asMultipleChoiceItem().createResponse(item.asMultipleChoiceItem().getChoices()[0].getValue()); break;
    case FormApp.ItemType.CHECKBOX: resp = item.asCheckboxItem().createResponse([item.asCheckboxItem().getChoices()[0].getValue()]); break;
    case FormApp.ItemType.DATE: resp = item.asDateItem().createResponse(new Date(2000, 0, 1)); break;
    default: return 'тип ' + item.getType();
  }
  const url = FormApp.openById(FORM_EDIT_ID).createResponse().withItemResponse(resp).toPrefilledUrl();
  const m = url.match(/entry\.(\d+)/);
  return m ? 'entry.' + m[1] : '?';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (e && e.parameter && e.parameter.admin !== undefined) return adminPage_();
  return json_({ ok: true, service: 'dv-lottery-intake' });
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents || '{}');
    if (d.website) return json_({ ok: true }); // ловушка для ботов

    const form = openForm_();
    const fr = form.createResponse();
    const s = function (k) { return String(d[k] == null ? '' : d[k]).trim().slice(0, 2000); };

    const savePhoto = function (photo, label) {
      if (!photo || !photo.data) return '';
      const bytes = Utilities.base64Decode(photo.data);
      if (bytes.length > MAX_PHOTO_BYTES) throw new Error('photo too large');
      const mime = /^image\/(jpeg|png)$/.test(photo.mime) ? photo.mime : 'image/jpeg';
      const stamp = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH-mm');
      const clean = String(label || 'BEZ IMENI').toUpperCase().replace(/[^A-Z0-9 \-()]/g, '').trim();
      return photoFolder_().createFile(Utilities.newBlob(bytes, mime, clean + ' — ' + stamp + (mime === 'image/png' ? '.png' : '.jpg'))).getUrl();
    };
    const pad = function (n) { return ('0' + String(n || '')).slice(-2); };
    const applicant = s('name').toUpperCase();
    const personLine = function (p, role) {
      p = p || {};
      const b = p.birth || {};
      const url = savePhoto(p.photo, String(p.name || '') + ' (' + role + ' ' + applicant + ')');
      const name = String(p.name || '').trim().toUpperCase().slice(0, 200);
      return [name, String(p.sex || '').slice(0, 2), pad(b.d) + '.' + pad(b.m) + '.' + String(b.y || '').slice(0, 4),
        String(p.birthCity || '').trim().toUpperCase().slice(0, 100), String(p.birthCountry || '').trim().toUpperCase().slice(0, 100),
        'фото: ' + (url || 'пришлёт в Telegram')].join(', ');
    };

    // Фото заявителя
    let photoValue = savePhoto(d.photo, applicant) || 'Пришлёт фото в Telegram';
    const spouseText = d.spouse ? personLine(d.spouse, 'SPOUSE OF') : '';
    const kidsText = (Array.isArray(d.kids) ? d.kids.slice(0, 12) : []).map(function (k, i) { return (i + 1) + '. ' + personLine(k, 'CHILD OF'); }).join('\n');

    const values = {
      name: s('name').toUpperCase(), sex: s('sex'), birthCity: s('birthCity').toUpperCase(),
      birthCountry: s('birthCountry').toUpperCase(), photo: photoValue, address: s('address'),
      country: s('country').toUpperCase(), email: s('email'), marital: s('marital'),
      children: s('children'), telegram: s('telegram'), education: s('education'),
      spouseData: spouseText, kidsData: kidsText,
    };

    Object.keys(TITLES).forEach(function (key) {
      const item = findItem_(form, TITLES[key]);
      if (!item) return;
      const type = item.getType();
      if (key === 'birth') {
        const b = d.birth || {};
        const dt = new Date(Number(b.y), Number(b.m) - 1, Number(b.d));
        if (!isNaN(dt.getTime()) && type === FormApp.ItemType.DATE) fr.withItemResponse(item.asDateItem().createResponse(dt));
        return;
      }
      const v = values[key];
      if (!v) return;
      if (type === FormApp.ItemType.TEXT) fr.withItemResponse(item.asTextItem().createResponse(v));
      else if (type === FormApp.ItemType.PARAGRAPH_TEXT) fr.withItemResponse(item.asParagraphTextItem().createResponse(v));
      else if (type === FormApp.ItemType.MULTIPLE_CHOICE) fr.withItemResponse(item.asMultipleChoiceItem().createResponse(v));
      else if (type === FormApp.ItemType.CHECKBOX) fr.withItemResponse(item.asCheckboxItem().createResponse([v]));
      else if (type === FormApp.ItemType.LIST) fr.withItemResponse(item.asListItem().createResponse(v));
    });

    fr.submit();
    return json_({ ok: true, photo: photoValue !== 'Пришлёт фото в Telegram' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

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

function isOwner_() {
  try { return Session.getActiveUser().getEmail().toLowerCase() === OWNER_EMAIL; } catch (e) { return false; }
}
function assertOwner_() { if (!isOwner_()) throw new Error('Нет доступа'); }

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

const ADMIN_HTML = String.raw`<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{--ink:#142140;--ink2:#4b5671;--ink3:#7a8399;--line:#dbe0e9;--line2:#edf0f5;--paper:#f4f6f9;--green:#2e6a4e;--greenInk:#1f4d38;--tint:#e2eee6;--red:#b5323b;--amber:#e0a83a}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{font:15px/1.45 Onest,system-ui,sans-serif;color:var(--ink);background:var(--paper);-webkit-text-size-adjust:100%}
button,input,select{font:inherit;color:inherit}button{cursor:pointer}
a{color:var(--green)}
:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(46,106,78,.3);border-radius:8px}
.app{display:flex;min-height:100vh}
/* навигация */
.nav{flex:0 0 232px;background:var(--ink);color:#fff;padding:18px 12px;display:flex;flex-direction:column;gap:16px;position:sticky;top:0;height:100vh}
.brand{display:flex;align-items:center;gap:10px;padding:0 6px;font-weight:700}
.mark{display:grid;place-items:center;width:28px;height:28px;border-radius:7px;background:#5fa77f;color:var(--ink);font-size:11px;font-weight:800}
.season{position:relative}
.season-btn{display:flex;align-items:center;justify-content:space-between;width:100%;padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff}
.season-btn small{display:block;font-size:11.5px;color:#9aa6c2;text-align:left}
.season-btn b{font-size:16px}
.menu{position:absolute;left:0;right:0;top:calc(100% + 6px);background:#fff;color:var(--ink);border-radius:12px;box-shadow:0 18px 40px -12px rgba(0,0,0,.45);padding:6px;z-index:30}
.menu button{display:flex;justify-content:space-between;width:100%;padding:9px 10px;border:0;border-radius:8px;background:#fff;font-weight:600;text-align:left}
.menu button:hover,.menu button.on{background:var(--tint)}
.menu .sub{font-weight:500;color:var(--ink3);font-size:12.5px}
.menu hr{border:0;border-top:1px solid var(--line2);margin:6px 4px}
.nav-label{font-size:12px;color:#8f9ab3;padding:0 10px 4px}
.nav-list{display:flex;flex-direction:column;gap:2px}
.nav-item{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:9px;background:transparent;color:#dfe4ef;font-size:14.5px;text-align:left}
.nav-item:hover{background:rgba(255,255,255,.06)}
.nav-item.on{background:rgba(255,255,255,.12);color:#fff;font-weight:600}
.nav-item .n{color:#b8c1d6;font-variant-numeric:tabular-nums;font-weight:500}
.nav-item .badge{font-size:12px;font-weight:700;border-radius:999px;padding:1px 8px;background:var(--amber);color:var(--ink)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:10px}
.nav-foot{margin-top:auto;display:flex;flex-direction:column;gap:4px;padding:0 6px}
.nav-foot a{color:#b8c1d6;font-size:13px;text-decoration:none}
.nav-foot a:hover{color:#fff}
/* список */
.list{flex:0 0 360px;background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;height:100vh;position:sticky;top:0}
.list-head{padding:16px 16px 12px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:10px}
.list-title{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.list-title h2{margin:0;font-size:19px;font-weight:800}
.muted{color:var(--ink3);font-size:13px}
.search{display:flex;align-items:center;gap:8px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:#fbfcfd;color:var(--ink3)}
.search input{border:0;outline:none;background:transparent;width:100%;font-size:14.5px;color:var(--ink)}
.list-body{overflow:auto;flex:1}
.row{display:flex;gap:12px;width:100%;padding:12px 16px;border:0;border-bottom:1px solid var(--line2);background:#fff;text-align:left;align-items:flex-start}
.row:hover{background:#f8fafc}
.row.on{background:var(--tint);box-shadow:inset 3px 0 0 var(--green)}
.row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.row-top{display:flex;justify-content:space-between;gap:8px}
.row-name{font-weight:600;font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row-date{font-size:12px;color:var(--ink3);white-space:nowrap}
.row-tags{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.tag{font-size:12px;border-radius:6px;padding:1px 7px;background:#f1f3f7;color:var(--ink2)}
.pill{font-size:12px;font-weight:600;border-radius:6px;padding:1px 8px;white-space:nowrap}
.p-new{background:#fbf0d9;color:#8a5d0c}.p-contact{background:#e4ebf7;color:#2b4c8c}.p-paid{background:var(--tint);color:var(--greenInk)}.p-done{background:var(--ink);color:#fff}.p-win{background:#ece0fa;color:#5b2d91}.p-lose{background:#f1f3f7;color:var(--ink2)}.p-none{background:#f1f3f7;color:var(--ink3)}
.av{position:relative;flex:none;display:grid;place-items:center;width:38px;height:38px;border-radius:50%;font-size:13px;font-weight:700;color:var(--ink);overflow:hidden;background:#dfe8f5}
.av img,.big-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.list-action{padding:10px 16px;border-bottom:1px solid var(--line)}
.empty{padding:40px 20px;text-align:center;color:var(--ink3)}
/* основная часть */
.main{flex:1;min-width:0;padding:26px 32px 48px;display:flex;flex-direction:column;gap:16px;max-width:1080px}
.h-kicker{font-size:14px;color:var(--green);font-weight:600}
h1{margin:2px 0 0;font-size:30px;font-weight:800;letter-spacing:-.02em;line-height:1.15}
.grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.card{background:#fff;border:1px solid var(--line);border-radius:16px}
.pad{padding:18px 20px}
.kpi{padding:14px 16px;text-align:left;display:flex;flex-direction:column;gap:4px;border:1px solid var(--line);border-radius:14px;background:#fff}
.kpi:hover{border-color:var(--ink3)}
.kpi .v{font-size:32px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.kpi .l{font-size:13.5px;color:var(--ink2);display:flex;align-items:center}
.bar{display:flex;height:10px;border-radius:999px;overflow:hidden;background:var(--line2)}
.sec-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line2)}
.sec-head h3,.sec-title{margin:0;font-size:16px;font-weight:700}
.mini{display:flex;align-items:center;gap:12px;padding:11px 18px;border-bottom:1px solid #f1f3f7}
.mini:last-child{border-bottom:0}
.mini .t{flex:1;min-width:0;display:flex;flex-direction:column}
.mini .t b{font-weight:600;font-size:14.5px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 14px;border-radius:10px;border:1px solid var(--line);background:#fff;font-weight:600;font-size:14px;text-decoration:none;color:var(--ink);white-space:nowrap}
.btn:hover{border-color:var(--ink3)}
.btn.pri{background:var(--green);border-color:var(--green);color:#fff}.btn.pri:hover{background:var(--greenInk)}
.btn.dark{background:var(--ink);border-color:var(--ink);color:#fff}
.btn.soft{background:var(--tint);border-color:var(--tint);color:var(--greenInk)}
.btn.dash{border-style:dashed;border-color:#9cc6ad;background:#f4faf6;color:var(--greenInk)}
.btn.sm{padding:6px 11px;font-size:13px;border-radius:8px}
/* карточка клиента */
.head{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.big-av{position:relative;flex:none;width:84px;height:84px;border-radius:18px;display:grid;place-items:center;font-size:26px;font-weight:800;overflow:hidden;background:#dfe8f5;position:relative}
.head-main{flex:1;min-width:220px;display:flex;flex-direction:column;gap:6px}
.head-actions{display:flex;gap:8px;flex-wrap:wrap}
.steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.step{width:100%;border:0;background:none;padding:0;display:flex;flex-direction:column;gap:8px;text-align:left}
.step i{display:block;height:6px;border-radius:999px;background:var(--line)}
.step.done i{background:var(--green)}
.step span{font-size:14px;color:var(--ink3);font-weight:500}
.step.done span{color:var(--ink);font-weight:700}
.field{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--ink3)}
.field input,.field select{padding:9px 11px;border:1px solid var(--line);border-radius:9px;font-size:14.5px;color:var(--ink);background:#fbfcfd;width:100%}
.field input:focus,.field select:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px rgba(46,106,78,.18);background:#fff}
.hist{display:grid;grid-template-columns:80px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line2)}
.fam{display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line2)}
.fam .t{flex:1;min-width:0;display:flex;flex-direction:column}
.copy{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;padding:10px 0;border:0;border-top:1px solid var(--line2);background:none;text-align:left}
.copy .k{font-size:12.5px;color:var(--ink3)}.copy .v{font-size:14.5px;font-weight:500;word-break:break-word}
.copy .c{font-size:12px;border:1px solid var(--line);border-radius:7px;padding:3px 8px;color:var(--ink3);white-space:nowrap}
.copy.ok .c{border-color:var(--green);color:var(--green)}
.form-box{display:flex;flex-direction:column;gap:10px;padding:14px;margin-top:10px;border-radius:12px;background:#f7f9fb;border:1px solid var(--line)}
.notice{border-radius:14px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.notice.amber{background:#fbf0d9;border:1px solid #f0dcb0}
.back{display:none;align-self:flex-start;border:0;background:none;padding:0;color:var(--green);font-weight:600}
.toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:var(--ink);color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;box-shadow:0 10px 30px -10px rgba(0,0,0,.5);z-index:60;opacity:0;transition:opacity .2s;pointer-events:none;max-width:90vw}
.toast.on{opacity:1}
.loading{display:grid;place-items:center;height:100vh;color:var(--ink3)}
.file{position:relative;overflow:hidden}.file input{position:absolute;inset:0;opacity:0;cursor:pointer}
@media (max-width:1100px){.grid4{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:860px){
  .app{flex-direction:column}
  .nav{position:static;height:auto;flex:none;padding:12px;gap:10px}
  .nav-top{display:flex;gap:10px;align-items:center}
  .nav-top .season{flex:1}
  .nav-label,.nav-foot{display:none}
  .nav-list{flex-direction:row;overflow-x:auto;gap:6px;scrollbar-width:none}
  .nav-list::-webkit-scrollbar{display:none}
  .nav-item{flex:none;width:auto;white-space:nowrap;border:1px solid rgba(255,255,255,.14)}
  .nav-item .dot{display:none}
  .nav-item .n{margin-left:6px}
  .list{position:static;height:auto;flex:none;border-right:0}
  .list-body{overflow:visible}
  .has-sel .list{display:none}
  .no-sel .main{display:none}
  .main{padding:16px 14px 40px}
  .back{display:inline-flex}
  h1{font-size:24px}
  .grid2,.grid3{grid-template-columns:minmax(0,1fr)}
  .steps{grid-template-columns:repeat(2,minmax(0,1fr))}
  .big-av{width:64px;height:64px;font-size:20px;border-radius:14px}
  .head-actions .btn{flex:1}
}
@media (min-width:861px){.nav-top{display:flex;flex-direction:column;gap:16px}}
</style></head>
<body>
<div id="app"><div class="loading">Загружаю заявки…</div></div>
<div class="toast" id="toast" role="status"></div>
<script>
var STATUSES = ['Новая', 'Связался', 'Оплачено', 'Подано'];
var STATUS_NAV = { 'Новая': 'Новые', 'Связался': 'Связался', 'Оплачено': 'Оплачено', 'Подано': 'Подано' };
var DOT = { 'Новая': '#e0a83a', 'Связался': '#7f9fd9', 'Оплачено': '#5fa77f', 'Подано': '#b8c1d6' };
var PILL = { 'Новая': 'p-new', 'Связался': 'p-contact', 'Оплачено': 'p-paid', 'Подано': 'p-done', 'Выиграл': 'p-win', 'Не выиграл': 'p-lose' };
var AVC = ['#dfe8f5', '#e2eee6', '#f6e7d4', '#ece0fa', '#f1f3f7'];
var S = { data: null, season: null, view: 'all', q: '', sel: null, menu: false, fam: null, copied: '', busy: false };
var byKey = {};

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function norm(s) { return String(s || '').toLowerCase(); }
function initials(n) { var p = String(n || '').split(' '); return ((p[1] || '')[0] || '') + ((p[0] || '')[0] || ''); }
function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
function avColor(k) { return AVC[hash(k) % AVC.length]; }
function driveId(u) { var m = String(u || '').match(/[-\w]{25,}/); return m ? m[0] : ''; }
function thumb(u, w) { var id = driveId(u); return id ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w' + (w || 200) : ''; }
function tgUrl(t) {
  t = String(t || '').trim(); if (!t) return '';
  if (/^https?:/.test(t)) return t;
  if (/t\.me\//.test(t)) return 'https://' + t.replace(/^.*?t\.me\//, 't.me/');
  if (/^\+?\d[\d\s\-()]{6,}$/.test(t)) return 'https://t.me/+' + t.replace(/\D/g, '');
  return 'https://t.me/' + t.replace(/^@/, '');
}
function toast(t) { var el = document.getElementById('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.remove('on'); }, 1800); }
function copyText(text, label) {
  var done = function () { S.copied = label || ''; toast('Скопировано' + (label ? ': ' + label : '')); render(); setTimeout(function () { if (S.copied === label) { S.copied = ''; render(); } }, 1400); };
  var fb = function () { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Не удалось скопировать'); } ta.remove(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fb); else fb();
}
function run(fn, args, ok, fail) {
  var r = google.script.run.withSuccessHandler(function (x) { ok && ok(x); }).withFailureHandler(function (e) { toast('Ошибка: ' + (e && e.message || e)); fail && fail(e); });
  r[fn].apply(r, args);
}

/* ---------- данные ---------- */
function sub(c, y) { var s = S.data.subs[c.key]; return s && s[y]; }
function seasonsOf(c) { var s = S.data.subs[c.key] || {}; return Object.keys(s).map(Number).sort(function (a, b) { return b - a; }); }
function won(c) { return seasonsOf(c).some(function (y) { return sub(c, y).result === 'Выиграл'; }); }
function parsePeople(text) {
  return String(text || '').split('\n').map(function (l) { return l.replace(/^\s*\d+\.\s*/, '').trim(); }).filter(Boolean).map(function (l) {
    var photo = (l.match(/фото:\s*(\S+)/) || [])[1] || '';
    var parts = l.replace(/,?\s*фото:.*$/, '').split(',').map(function (x) { return x.trim(); });
    return { name: parts[0] || '', sex: parts[1] || '', dob: parts[2] || '', place: parts.slice(3).filter(Boolean).join(', '), photo: /^https?:/.test(photo) ? photo : '' };
  });
}
function family(c) {
  var out = [];
  parsePeople(c.spouseData).forEach(function (p) { p.rel = p.sex === 'М' ? 'супруг' : p.sex === 'Ж' ? 'супруга' : 'супруг(а)'; out.push(p); });
  parsePeople(c.kidsData).forEach(function (p) { p.rel = p.sex === 'М' ? 'сын' : p.sex === 'Ж' ? 'дочь' : 'ребёнок'; out.push(p); });
  return out;
}
function oldKidsNote(c) {
  if (c.kidsData) return '';
  var t = String(c.children || '').trim();
  if (!t || /^(0|нет|no|none|-)$/i.test(t) || /^да,\s*0$/i.test(t)) return '';
  return t;
}
function familySize(c) { return family(c).length + 1; }
function inSeason(y) { return S.data.clients.filter(function (c) { return sub(c, y); }); }
function inviteList(y) { return S.data.clients.filter(function (c) { return !sub(c, y) && seasonsOf(c).some(function (s) { return s < y; }) && !won(c); }); }
function wonList() { return S.data.clients.filter(won); }
function stOf(c, y) { var s = sub(c, y); return s ? s.status : ''; }
function lastDate(c) { var s = sub(c, S.season); return (s && s.date) || c.date || ''; }

function load(keepSel) {
  run('adminData', [], function (d) {
    S.data = d; byKey = {};
    d.clients.forEach(function (c) { byKey[c.key] = c; });
    if (!S.season) S.season = d.current;
    if (!keepSel) S.sel = null;
    render();
  }, function () { document.getElementById('app').innerHTML = '<div class="loading">Не удалось загрузить данные. Обновите страницу.</div>'; });
}

function saveSub(c, y, patch, msg) {
  var cur = sub(c, y) || { status: 'Новая', paid: '', number: '', result: '', note: '' };
  var next = Object.assign({}, cur, patch, { virtual: false });
  S.data.subs[c.key] = S.data.subs[c.key] || {};
  S.data.subs[c.key][y] = next;
  render();
  run('adminSaveSub', [c.key, c.name, c.row, y, { status: next.status, paid: next.paid, number: next.number, result: next.result, note: next.note }],
    function () { if (msg) toast(msg); }, function () { load(true); });
}
function addToSeason(list, y) {
  if (!list.length) return;
  list.forEach(function (c) { S.data.subs[c.key] = S.data.subs[c.key] || {}; S.data.subs[c.key][y] = { status: 'Новая', paid: '', number: '', result: '', note: '', date: '', virtual: false }; });
  render();
  run('adminAddToSeason', [list.map(function (c) { return { key: c.key, name: c.name, row: c.row }; }), y],
    function (n) { toast((list.length === 1 ? list[0].name : list.length + ' клиентов') + ' → DV-' + y); }, function () { load(true); });
}

function resizeImage(file, cb) {
  var url = URL.createObjectURL(file), img = new Image();
  img.onload = function () {
    var k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url); cb(c.toDataURL('image/jpeg', 0.9));
  };
  img.onerror = function () { URL.revokeObjectURL(url); toast('Не получилось открыть фото'); };
  img.src = url;
}

/* ---------- отрисовка ---------- */
function pill(status) { return '<span class="pill ' + (PILL[status] || 'p-none') + '">' + esc(status) + '</span>'; }
function avatar(c, cls) {
  var t = thumb(c.photo, 160);
  return '<span class="' + (cls || 'av') + '" style="background:' + avColor(c.key) + '">' + esc(initials(c.name)) + (t ? '<img src="' + t + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()">' : '') + '</span>';
}

function render() {
  if (!S.data) return;
  var y = S.season, sel = S.sel && byKey[S.sel];
  var html = '<div class="app ' + (sel ? 'has-sel' : 'no-sel') + '">' + renderNav(y) + renderList(y, sel) + '<main class="main">' + (sel ? renderCard(sel, y) : renderOverview(y)) + '</main></div>';
  var keep = document.activeElement && document.activeElement.id;
  var pos = keep && document.activeElement.selectionStart;
  document.getElementById('app').innerHTML = html;
  if (keep) { var el = document.getElementById(keep); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
}

function renderNav(y) {
  var ins = inSeason(y), counts = {};
  STATUSES.forEach(function (s) { counts[s] = 0; });
  ins.forEach(function (c) { counts[stOf(c, y)]++; });
  var seasons = {}; seasons[S.data.current] = 1;
  S.data.clients.forEach(function (c) { seasonsOf(c).forEach(function (s) { seasons[s] = 1; }); });
  var years = Object.keys(seasons).map(Number).sort(function (a, b) { return b - a; });
  var item = function (key, label, n, extra) {
    return '<button class="nav-item' + (S.view === key ? ' on' : '') + '" data-act="view" data-v="' + key + '"><span>' + (extra || '') + esc(label) + '</span>' + n + '</button>';
  };
  var inv = inviteList(y).length;
  var h = '<nav class="nav" aria-label="Разделы"><div class="nav-top"><div class="brand"><span class="mark">GC</span>Green Card</div>' +
    '<div class="season"><button class="season-btn" data-act="menu" aria-expanded="' + S.menu + '"><span><small>Сезон</small><b>DV-' + y + '</b></span><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>';
  if (S.menu) {
    h += '<div class="menu" role="menu">' + years.map(function (s) {
      return '<button role="menuitem" class="' + (s === y ? 'on' : '') + '" data-act="season" data-v="' + s + '"><span>DV-' + s + (s === S.data.current ? ' · текущий' : '') + '</span><span class="sub">' + inSeason(s).length + '</span></button>';
    }).join('') + '<hr><button data-act="newSeason" data-v="' + (S.data.current + 1) + '"><span>Начать сезон DV-' + (S.data.current + 1) + '</span></button></div>';
  }
  h += '</div></div><div><div class="nav-label">Воронка сезона</div><div class="nav-list">' +
    item('all', 'Все в сезоне', '<span class="n">' + ins.length + '</span>', '<span class="dot" style="background:#fff"></span>') +
    STATUSES.map(function (s) { return item(s, STATUS_NAV[s], '<span class="n">' + counts[s] + '</span>', '<span class="dot" style="background:' + DOT[s] + '"></span>'); }).join('') +
    item('invite', 'Пригласить снова', inv ? '<span class="badge">' + inv + '</span>' : '<span class="n">0</span>') +
    item('won', 'Выиграли', '<span class="n">' + wonList().length + '</span>') +
    item('everyone', 'Все клиенты', '<span class="n">' + S.data.clients.length + '</span>') +
    '</div></div><div class="nav-foot"><a href="' + esc(S.data.sheetUrl) + '" target="_blank" rel="noopener">Таблица →</a><a href="' + esc(S.data.folderUrl) + '" target="_blank" rel="noopener">Папка с фото →</a></div></nav>';
  return h;
}

function listSource(y) {
  var v = S.view, src, title;
  if (v === 'invite') { src = inviteList(y); title = 'Пригласить снова'; }
  else if (v === 'won') { src = wonList(); title = 'Выиграли'; }
  else if (v === 'everyone') { src = S.data.clients.slice(); title = 'Все клиенты'; }
  else if (v === 'all') { src = inSeason(y); title = 'Все в сезоне'; }
  else { src = inSeason(y).filter(function (c) { return stOf(c, y) === v; }); title = STATUS_NAV[v]; }
  var q = norm(S.q).trim();
  if (q) src = src.filter(function (c) {
    var nums = seasonsOf(c).map(function (s) { return sub(c, s).number; }).join(' ');
    return norm([c.name, c.telegram, c.email, nums, c.spouseData, c.kidsData].join(' ')).indexOf(q) !== -1;
  });
  src.sort(function (a, b) { var sa = sub(a, y), sb = sub(b, y); return ((sb && sb.ts) || b.ts) - ((sa && sa.ts) || a.ts); });
  return { src: src, title: title };
}

function plural(n, a, b, c) { var m = n % 100; if (m >= 11 && m <= 14) return c; m = n % 10; return m === 1 ? a : m >= 2 && m <= 4 ? b : c; }

function renderList(y, sel) {
  var L = listSource(y);
  var h = '<aside class="list" aria-label="Клиенты"><div class="list-head"><div class="list-title"><h2>' + esc(L.title) + '</h2><span class="muted">' + L.src.length + ' ' + plural(L.src.length, 'клиент', 'клиента', 'клиентов') + '</span></div>' +
    '<label class="search"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg><input id="q" aria-label="Поиск" placeholder="Имя, Telegram, номер" value="' + esc(S.q) + '"></label></div>';
  if (S.view === 'invite' && L.src.length) h += '<div class="list-action"><button class="btn pri" style="width:100%" data-act="inviteAll">Добавить всех ' + L.src.length + ' в DV-' + y + '</button></div>';
  h += '<div class="list-body">';
  if (!L.src.length) h += '<div class="empty">' + (S.q ? 'Никого не нашёл' : 'Здесь пока пусто') + '</div>';
  L.src.forEach(function (c) {
    var s = sub(c, y), st = s ? (s.result || s.status) : '';
    var fs = familySize(c);
    h += '<button class="row' + (sel && sel.key === c.key ? ' on' : '') + '" data-act="open" data-v="' + esc(c.key) + '">' + avatar(c) +
      '<span class="row-main"><span class="row-top"><span class="row-name">' + esc(c.name) + '</span><span class="row-date">' + esc(lastDate(c)) + '</span></span>' +
      '<span class="row-tags">' + (st ? pill(st) : '<span class="pill p-none">нет в DV-' + y + '</span>') + (fs > 1 ? '<span class="tag">семья · ' + fs + '</span>' : '') + '</span></span></button>';
  });
  return h + '</div></aside>';
}

function renderOverview(y) {
  var ins = inSeason(y), counts = {};
  STATUSES.forEach(function (s) { counts[s] = 0; });
  ins.forEach(function (c) { counts[stOf(c, y)]++; });
  var total = ins.length || 1, inv = inviteList(y);
  var paid = ins.filter(function (c) { return stOf(c, y) === 'Оплачено'; });
  var fresh = ins.filter(function (c) { return stOf(c, y) === 'Новая'; }).sort(function (a, b) { return (sub(b, y).ts || b.ts) - (sub(a, y).ts || a.ts); });
  var sub2 = { 'Новая': 'ответить в Telegram', 'Связался': 'ждут оплату', 'Оплачено': 'можно подавать', 'Подано': 'номер получен' };
  var h = '<div><div class="h-kicker">Сезон DV-' + y + '</div><h1>Что сделать сегодня</h1></div><div class="grid4">' +
    STATUSES.map(function (s) { return '<button class="kpi" data-act="view" data-v="' + s + '"><span class="l"><span class="dot" style="background:' + (s === 'Подано' ? '#142140' : DOT[s]) + '"></span>' + STATUS_NAV[s] + '</span><span class="v">' + counts[s] + '</span><span class="muted">' + sub2[s] + '</span></button>'; }).join('') +
    '</div><div class="card pad" style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;justify-content:space-between;gap:10px;font-size:14px"><b style="font-weight:600">Подано ' + counts['Подано'] + ' из ' + ins.length + (inv.length ? ' · ' + inv.length + ' прошлых клиентов ещё не вернулись' : '') + '</b><span class="muted">' + Math.round(counts['Подано'] / total * 100) + '%</span></div><div class="bar">' +
    [['Подано', '#142140'], ['Оплачено', '#2e6a4e'], ['Связался', '#5b7fc4'], ['Новая', '#e0a83a']].map(function (p) { return '<span style="width:' + (counts[p[0]] / total * 100) + '%;background:' + p[1] + '"></span>'; }).join('') +
    '</div></div><div class="grid2">';
  var block = function (title, n, items, empty, btn) {
    var b = '<section class="card"><div class="sec-head"><h3>' + title + '</h3><span class="muted">' + n + '</span></div>';
    if (!items.length) b += '<div class="empty" style="padding:22px 18px;text-align:left">' + empty + '</div>';
    items.slice(0, 6).forEach(function (c) { b += '<div class="mini">' + avatar(c) + '<span class="t"><b>' + esc(c.name) + '</b><span class="muted">' + esc(btn.meta(c)) + '</span></span>' + btn.html(c) + '</div>'; });
    if (items.length > 6) b += '<div style="padding:12px 18px"><button class="btn sm" data-act="view" data-v="' + btn.view + '">Все ' + items.length + '</button></div>';
    return b + '</section>';
  };
  h += block('Новые заявки — ответить', fresh.length, fresh, 'Новых заявок нет.', {
    view: 'Новая', meta: function (c) { return (sub(c, y).date || c.date) + ' · ' + (c.telegram || c.email || ''); },
    html: function (c) { return '<button class="btn sm" data-act="open" data-v="' + esc(c.key) + '">Открыть</button>'; } });
  h += block('Оплачено — подать на сайте DV', paid.length, paid, 'Всех оплативших уже подал.', {
    view: 'Оплачено', meta: function (c) { var fs = familySize(c); return (fs > 1 ? 'семья · ' + fs : 'один') + (sub(c, y).paid ? ' · ' + sub(c, y).paid : ''); },
    html: function (c) { return '<button class="btn sm" data-act="open" data-v="' + esc(c.key) + '">Открыть</button>'; } });
  h += '</div>';
  h += block('Подавались раньше — пригласить снова', inv.length, inv, 'Все прошлые клиенты уже в этом сезоне.', {
    view: 'invite', meta: function (c) { return seasonsOf(c).map(function (s) { return 'DV-' + s; }).join(', ') + ' · ' + (c.telegram || ''); },
    html: function (c) { return '<button class="btn sm soft" data-act="add" data-v="' + esc(c.key) + '">В DV-' + y + '</button>'; } });
  return h;
}

function renderCard(c, y) {
  var s = sub(c, y), idx = s ? STATUSES.indexOf(s.status) : -1, fam = family(c), seasons = seasonsOf(c);
  var tg = tgUrl(c.telegram), t = thumb(c.photo, 400);
  var missing = (c.photo ? 0 : 1) + fam.filter(function (m) { return !m.photo; }).length;
  var h = '<button class="back" data-act="close">← Назад к списку</button>' +
    '<div class="head"><span class="big-av" style="background:' + avColor(c.key) + '">' + esc(initials(c.name)) + (t ? '<a href="' + esc(c.photo) + '" target="_blank" rel="noopener" aria-label="Открыть фото" style="position:absolute;inset:0"><img src="' + t + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()"></a>' : '') + '</span>' +
    '<div class="head-main"><h1>' + esc(c.name) + '</h1><span class="muted">' + (seasons.length ? 'Клиент с DV-' + seasons[seasons.length - 1] + ' · сезонов: ' + seasons.length : 'Новый клиент') + (c.telegram ? ' · ' + esc(c.telegram) : '') + '</span>' +
    '<span class="row-tags">' + (s ? pill(s.result || s.status) : '<span class="pill p-none">нет в DV-' + y + '</span>') + '<span class="tag">' + (fam.length ? 'семья · ' + (fam.length + 1) : 'один') + '</span>' +
    (missing ? '<span class="pill" style="background:#fbe3e4;color:#9b2730">нет фото: ' + missing + '</span>' : '<span class="pill p-paid">все фото есть</span>') + '</span></div>' +
    '<div class="head-actions">' + (tg ? '<a class="btn pri" href="' + esc(tg) + '" target="_blank" rel="noopener">Telegram</a>' : '') + (c.email ? '<a class="btn" href="mailto:' + esc(c.email) + '">Email</a>' : '') + '<button class="btn" data-act="copyAll">Скопировать всё</button>' +
    (!c.photo ? '<label class="btn file">Загрузить фото<input type="file" accept="image/*" data-act="photo"></label>' : '') + '</div></div>';

  if (s) {
    h += '<section class="card pad" style="display:flex;flex-direction:column;gap:16px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap"><h2 class="sec-title" style="font-size:18px">Подача DV-' + y + '</h2><span class="muted">' + (s.date ? 'анкета ' + esc(s.date) : '') + '</span></div>' +
      '<ol class="steps">' + STATUSES.map(function (st, i) { return '<li><button class="step' + (i <= idx ? ' done' : '') + '" data-act="status" data-v="' + st + '"><i></i><span>' + (st === 'Новая' ? 'Анкета' : st) + '</span></button></li>'; }).join('') + '</ol>' +
      '<div class="grid3"><label class="field">Оплата<input id="f-paid" data-act="field" data-k="paid" value="' + esc(s.paid) + '" placeholder="$50 × ' + (fam.length + 1) + '"></label>' +
      '<label class="field">Номер подтверждения<input id="f-number" data-act="field" data-k="number" value="' + esc(s.number) + '" placeholder="' + y + 'XXXXXXXXXXXX"></label>' +
      '<label class="field">Заметка<input id="f-note" data-act="field" data-k="note" value="' + esc(s.note) + '" placeholder="договорённости, напоминания"></label></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      (idx < 3 ? '<button class="btn dark" data-act="next">Дальше: ' + STATUSES[idx + 1] + ' →</button>' : '') +
      (idx === 3 ? '<span style="font-weight:600;color:var(--greenInk);margin-right:6px">Результат:</span><button class="btn sm' + (s.result === 'Выиграл' ? ' pri' : '') + '" data-act="result" data-v="Выиграл">Выиграл</button><button class="btn sm' + (s.result === 'Не выиграл' ? ' dark' : '') + '" data-act="result" data-v="Не выиграл">Не выиграл</button>' + (s.result ? '<button class="btn sm" data-act="result" data-v="">Сбросить</button>' : '') : '') +
      '</div></section>';
  } else {
    h += '<div class="notice amber"><span><b>В сезоне DV-' + y + ' заявки нет</b><br><span class="muted" style="color:#6b5420">' + (seasons.length ? 'Подавался: ' + seasons.map(function (x) { return 'DV-' + x; }).join(', ') : '') + '</span></span><button class="btn pri" data-act="add" data-v="' + esc(c.key) + '">Добавить в DV-' + y + '</button></div>';
  }

  h += '<div class="grid2"><section class="card pad"><h2 class="sec-title" style="font-size:18px;margin-bottom:8px">История подач</h2>';
  if (!seasons.length) h += '<div class="muted" style="padding:8px 0">Пока нет подач.</div>';
  seasons.forEach(function (x) {
    var ss = sub(c, x), res = ss.result || (ss.status === 'Подано' ? 'Ждём результат' : ss.status);
    h += '<div class="hist"><b>DV-' + x + '</b><span style="min-width:0"><span style="display:block;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis">' + esc(ss.number || 'номера нет') + '</span><span class="muted">' + (ss.paid ? 'оплата ' + esc(ss.paid) : 'без отметки оплаты') + '</span></span>' + (PILL[res] ? pill(res) : '<span class="pill p-new">' + esc(res) + '</span>') + '</div>';
  });
  h += '</section><section class="card pad"><h2 class="sec-title" style="font-size:18px;margin-bottom:8px">Семья в заявке</h2>';
  fam.forEach(function (m) {
    var mt = thumb(m.photo, 120);
    h += '<div class="fam"><span class="av" style="background:' + avColor(m.name) + '">' + esc(initials(m.name)) + (mt ? '<img src="' + mt + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()">' : '') + '</span><span class="t"><b style="font-weight:600">' + esc(m.name) + '</b><span class="muted">' + esc([m.rel, m.dob, m.place].filter(Boolean).join(' · ')) + '</span></span>' +
      (m.photo ? '<a class="pill p-paid" href="' + esc(m.photo) + '" target="_blank" rel="noopener" style="text-decoration:none">фото</a>' : '<span class="pill" style="background:#fbe3e4;color:#9b2730">нет фото</span>') + '</div>';
  });
  var kidsOld = oldKidsNote(c);
  if (kidsOld) h += '<div class="fam"><span class="t"><b style="font-weight:600">Дети (из старой анкеты)</b><span class="muted">' + esc(kidsOld) + '</span></span></div>';
  if (!fam.length && !kidsOld) h += '<div class="muted" style="padding:10px 0;border-top:1px solid var(--line2)">Подаётся один, без супруга и детей.</div>';
  var hasSpouse = fam.some(function (m) { return /супруг/.test(m.rel); });
  if (!S.fam) {
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--line2)">' + (hasSpouse ? '' : '<button class="btn sm dash" data-act="fam" data-v="spouse">+ Супруг(а)</button>') + '<button class="btn sm dash" data-act="fam" data-v="child">+ Ребёнок</button></div>';
  } else {
    var d = S.fam;
    h += '<div class="form-box"><b>' + (d.kind === 'spouse' ? 'Добавить супруга(у)' : 'Добавить ребёнка') + '</b>' +
      '<label class="field">Фамилия и имя (латиницей)<input id="m-name" data-act="draft" data-k="name" value="' + esc(d.name) + '" placeholder="IVANOVA ANNA"></label>' +
      '<div class="grid2" style="gap:10px"><label class="field">Пол<select id="m-sex" data-act="draft" data-k="sex"><option value="">—</option><option' + (d.sex === 'М' ? ' selected' : '') + '>М</option><option' + (d.sex === 'Ж' ? ' selected' : '') + '>Ж</option></select></label>' +
      '<label class="field">Дата рождения<input id="m-dob" data-act="draft" data-k="dob" value="' + esc(d.dob) + '" placeholder="ДД.ММ.ГГГГ" inputmode="numeric"></label>' +
      '<label class="field">Город рождения<input id="m-city" data-act="draft" data-k="city" value="' + esc(d.city) + '" placeholder="MOSCOW"></label>' +
      '<label class="field">Страна рождения<input id="m-country" data-act="draft" data-k="country" value="' + esc(d.country) + '" placeholder="RUSSIA"></label></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><label class="btn sm file">' + (d.photo ? 'Фото выбрано ✓' : 'Фото (необязательно)') + '<input type="file" accept="image/*" data-act="memberPhoto"></label></div>' +
      '<div style="display:flex;gap:8px"><button class="btn pri" data-act="saveMember"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Сохраняю…' : 'Добавить в заявку') + '</button><button class="btn" data-act="cancelMember">Отмена</button></div></div>';
  }
  h += '</section></div>';

  var fields = [['Фамилия и имя', c.name], ['Пол', c.sex], ['Дата рождения', c.dob], ['Город рождения', c.birthCity], ['Страна рождения', c.birthCountry],
    ['Страна проживания', c.country], ['Адрес', c.address], ['Email', c.email], ['Telegram', c.telegram], ['Образование', c.education], ['Семейное положение', c.marital]];
  h += '<section class="card pad"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:6px"><h2 class="sec-title" style="font-size:18px">Данные для подачи</h2><span class="muted">клик — скопировать</span></div><div class="grid2" style="column-gap:24px;row-gap:0">' +
    fields.filter(function (f) { return f[1]; }).map(function (f) { var on = S.copied === f[0]; return '<button class="copy' + (on ? ' ok' : '') + '" data-act="copy" data-k="' + esc(f[0]) + '" data-v="' + esc(f[1]) + '"><span style="min-width:0"><span class="k" style="display:block">' + esc(f[0]) + '</span><span class="v">' + esc(f[1]) + '</span></span><span class="c">' + (on ? 'Скопировано' : 'Копировать') + '</span></button>'; }).join('') +
    '</div></section>';
  return h;
}

/* ---------- события ---------- */
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-act]'); if (!el) { if (S.menu && !e.target.closest('.season')) { S.menu = false; render(); } return; }
  var a = el.getAttribute('data-act'), v = el.getAttribute('data-v');
  var c = S.sel && byKey[S.sel], y = S.season;
  if (a === 'menu') { S.menu = !S.menu; render(); }
  else if (a === 'season') { S.season = Number(v); S.menu = false; S.sel = null; S.view = 'all'; render(); }
  else if (a === 'newSeason') {
    S.menu = false;
    if (!confirm('Сделать DV-' + v + ' текущим сезоном? Новые анкеты будут попадать в него.')) { render(); return; }
    run('adminSetCurrentSeason', [Number(v)], function (n) { S.data.current = n; S.season = n; S.view = 'all'; render(); toast('Текущий сезон: DV-' + n); });
  }
  else if (a === 'view') { S.view = v; S.sel = null; S.fam = null; render(); window.scrollTo(0, 0); }
  else if (a === 'open') { S.sel = v; S.fam = null; render(); window.scrollTo(0, 0); }
  else if (a === 'close') { S.sel = null; S.fam = null; render(); }
  else if (a === 'add') { var cl = byKey[v]; if (cl) addToSeason([cl], y); }
  else if (a === 'inviteAll') { var list = inviteList(y); if (list.length && confirm('Добавить ' + list.length + ' ' + plural(list.length, 'клиента', 'клиентов', 'клиентов') + ' в DV-' + y + ' со статусом «Новая»?')) addToSeason(list, y); }
  else if (a === 'status' && c) saveSub(c, y, { status: v }, 'Статус: ' + v);
  else if (a === 'next' && c) { var i = STATUSES.indexOf(sub(c, y).status); if (i < 3) saveSub(c, y, { status: STATUSES[i + 1] }, 'Статус: ' + STATUSES[i + 1]); }
  else if (a === 'result' && c) saveSub(c, y, { result: v }, v ? 'Отмечено: ' + v : 'Результат сброшен');
  else if (a === 'copy') copyText(v, el.getAttribute('data-k'));
  else if (a === 'copyAll' && c) {
    var lines = [['Фамилия и имя', c.name], ['Пол', c.sex], ['Дата рождения', c.dob], ['Место рождения', [c.birthCity, c.birthCountry].filter(Boolean).join(', ')], ['Страна проживания', c.country], ['Адрес', c.address], ['Email', c.email], ['Telegram', c.telegram], ['Образование', c.education], ['Семейное положение', c.marital]]
      .filter(function (f) { return f[1]; }).map(function (f) { return f[0] + ': ' + f[1]; });
    family(c).forEach(function (m) { lines.push(m.rel + ': ' + [m.name, m.sex, m.dob, m.place].filter(Boolean).join(', ')); });
    copyText(lines.join('\n'), 'все данные');
  }
  else if (a === 'fam') { S.fam = { kind: v, name: '', sex: '', dob: '', city: '', country: '', photo: null }; render(); }
  else if (a === 'cancelMember') { S.fam = null; render(); }
  else if (a === 'saveMember' && c && S.fam && !S.busy) {
    var d = S.fam;
    if (!/^[A-Za-z][A-Za-z .'\-]*$/.test(d.name.trim())) { toast('Имя латиницей, как в паспорте'); return; }
    if (d.dob && !/^\d{2}\.\d{2}\.\d{4}$/.test(d.dob.trim())) { toast('Дата в формате ДД.ММ.ГГГГ'); return; }
    S.busy = true; render();
    run('adminAddMember', [c.row, d.kind, { name: d.name, sex: d.sex, dob: d.dob.trim(), city: d.city, country: d.country, photo: d.photo ? { mime: 'image/jpeg', data: d.photo.split(',')[1] } : null }],
      function (line) {
        S.busy = false;
        if (d.kind === 'spouse') { c.spouseData = line; c.marital = 'Женат / замужем'; }
        else { var n = c.kidsData ? c.kidsData.split('\n').filter(String).length + 1 : 1; c.kidsData = (c.kidsData ? c.kidsData + '\n' : '') + n + '. ' + line; }
        S.fam = null; render(); toast(d.kind === 'spouse' ? 'Супруг(а) добавлен(а)' : 'Ребёнок добавлен');
      }, function () { S.busy = false; render(); });
  }
});
document.addEventListener('input', function (e) {
  var el = e.target;
  if (el.id === 'q') { S.q = el.value; render(); }
  else if (el.getAttribute('data-act') === 'draft' && S.fam) {
    var k = el.getAttribute('data-k'), v = el.value;
    if (k === 'name' || k === 'city' || k === 'country') { v = v.toUpperCase(); el.value = v; }
    S.fam[k] = v;
  }
});
document.addEventListener('change', function (e) {
  var el = e.target, a = el.getAttribute('data-act'), c = S.sel && byKey[S.sel];
  if (a === 'draft' && S.fam) S.fam[el.getAttribute('data-k')] = el.value;
  else if (a === 'field' && c) { var p = {}; p[el.getAttribute('data-k')] = el.value.trim(); saveSub(c, S.season, p, 'Сохранено'); }
  else if (a === 'memberPhoto' && S.fam && el.files[0]) resizeImage(el.files[0], function (u) { S.fam.photo = u; render(); toast('Фото выбрано'); });
  else if (a === 'photo' && c && el.files[0]) resizeImage(el.files[0], function (u) {
    toast('Загружаю фото…');
    run('adminSetPhoto', [c.row, { mime: 'image/jpeg', data: u.split(',')[1] }], function (url) { c.photo = url; render(); toast('Фото сохранено'); });
  });
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.menu) { S.menu = false; render(); } });
load();
</script>
</body></html>
`;
