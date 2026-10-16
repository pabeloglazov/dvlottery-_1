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

const OWNER_EMAIL = 'pa.beloglazov@gmail.com';
const RESPONSES_SHEET_ID = '1FkV6QtxhMSCdAod3Eh6PudKhLT8wYz4I6wdWsLJF2Gw';
const STATUS_HEADER = 'Статус';
const NOTE_HEADER = 'Заметка';
const CONFIRM_HEADER = 'Column 1';      // номер подтверждения (колонка, заведённая вручную)
const RESULT_HEADER = 'Результат';
const EDITABLE = [STATUS_HEADER, NOTE_HEADER, CONFIRM_HEADER, RESULT_HEADER];

function isOwner_() {
  try { return Session.getActiveUser().getEmail().toLowerCase() === OWNER_EMAIL; } catch (e) { return false; }
}
function assertOwner_() { if (!isOwner_()) throw new Error('Нет доступа'); }

function responsesSheet_() {
  let id = RESPONSES_SHEET_ID;
  try { const dest = FormApp.openById(FORM_EDIT_ID).getDestinationId(); if (dest) id = dest; } catch (e) { /* оставляем id по умолчанию */ }
  const ss = SpreadsheetApp.openById(id);
  // Лист, куда пишет форма, — тот, у которого есть URL формы; иначе первый.
  const linked = ss.getSheets().filter(function (sh) { try { return !!sh.getFormUrl(); } catch (e) { return false; } })[0];
  return linked || ss.getSheets()[0];
}

function ensureColumn_(sheet, header) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  const i = headers.indexOf(header);
  if (i !== -1) return i + 1;
  sheet.getRange(1, lastCol + 1).setValue(header);
  return lastCol + 1;
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
    .setTitle('DV Lottery — заявки')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Все заявки для админки. */
function adminData() {
  assertOwner_();
  const sh = responsesSheet_();
  [STATUS_HEADER, NOTE_HEADER].forEach(function (h) { ensureColumn_(sh, h); });
  const range = sh.getDataRange();
  const values = range.getDisplayValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    if (values[r].every(function (v) { return v === ''; })) continue;
    rows.push({ row: r + 1, v: values[r] });
  }
  return { headers: headers, rows: rows, sheetUrl: sh.getParent().getUrl() + '#gid=' + sh.getSheetId(), photoFolder: photoFolder_().getUrl() };
}

/** Сохранить статус, заметку, номер подтверждения или результат. */
function adminSet(row, header, value) {
  assertOwner_();
  if (EDITABLE.indexOf(header) === -1) throw new Error('Это поле нельзя менять');
  row = Number(row);
  const sh = responsesSheet_();
  if (!(row >= 2 && row <= sh.getLastRow())) throw new Error('Нет такой строки');
  const col = ensureColumn_(sh, header);
  sh.getRange(row, col).setValue(String(value || '').slice(0, 500));
  return true;
}

const ADMIN_HTML = String.raw`<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{--paper:#f4f6f9;--surface:#fff;--ink:#142140;--ink2:#4b5671;--ink3:#7a8399;--line:#dbe0e9;--green:#2e6a4e;--greenInk:#1f4d38;--tint:#e2eee6;--red:#b5323b;--amber:#9a6a12;--amberTint:#fbf0d9;--blueTint:#e4ebf7;--blue:#2b4c8c}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{font:15px/1.5 Onest,system-ui,sans-serif;color:var(--ink);background:var(--paper)}
button,input,select,textarea{font:inherit;color:inherit}
.app{display:grid;grid-template-columns:380px 1fr;height:100vh}
.side{display:flex;flex-direction:column;border-right:1px solid var(--line);background:var(--surface);min-height:0}
.side-head{padding:16px 16px 12px;border-bottom:1px solid var(--line)}
.title{display:flex;align-items:center;gap:10px;font-weight:700;font-size:17px}
.mark{display:grid;place-items:center;width:28px;height:28px;border-radius:7px;background:var(--green);color:#fff;font-size:11px;font-weight:800}
.count{margin-left:auto;color:var(--ink3);font-weight:500;font-size:14px}
.search{width:100%;margin-top:12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fbfcfd}
.search:focus,.inp:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px rgba(46,106,78,.2)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:4px 10px;font-size:13px;cursor:pointer;color:var(--ink2)}
.chip.on{background:var(--ink);border-color:var(--ink);color:#fff}
.list{overflow:auto;flex:1}
.year{position:sticky;top:0;background:var(--paper);padding:6px 16px;font-size:12.5px;color:var(--ink3);font-weight:600;border-bottom:1px solid var(--line)}
.item{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--line);background:none;padding:12px 16px;cursor:pointer}
.item:hover{background:#f8fafc}.item.sel{background:var(--tint)}
.item-top{display:flex;align-items:center;gap:8px}
.item-name{font-weight:600}.item-date{margin-left:auto;font-size:12.5px;color:var(--ink3);white-space:nowrap}
.item-sub{font-size:13px;color:var(--ink3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{display:inline-block;font-size:12px;font-weight:600;border-radius:6px;padding:1px 7px;margin-top:6px}
.b-new{background:var(--amberTint);color:var(--amber)}.b-contact{background:var(--blueTint);color:var(--blue)}.b-paid{background:var(--tint);color:var(--greenInk)}.b-done{background:var(--ink);color:#fff}.b-win{background:#e9dcf7;color:#5b2d91}
.main{overflow:auto;min-height:0}
.empty{display:grid;place-items:center;height:100%;color:var(--ink3);padding:24px;text-align:center}
.card{max-width:860px;margin:24px auto;padding:0 24px 48px}
.back{display:none;border:0;background:none;color:var(--green);padding:0;margin-bottom:12px;cursor:pointer;font-weight:600}
.head{display:flex;gap:20px;align-items:flex-start}
.photo{flex:none;width:132px;height:132px;border-radius:12px;background:#e9edf3 center/cover no-repeat;display:grid;place-items:center;color:var(--ink3);font-size:12.5px;text-align:center;text-decoration:none;border:1px solid var(--line)}
.h-name{font-size:26px;font-weight:800;letter-spacing:-.02em;line-height:1.15}
.h-meta{color:var(--ink3);margin-top:4px;font-size:14px}
.h-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:#fff;border-radius:9px;padding:7px 12px;font-weight:600;font-size:14px;cursor:pointer;text-decoration:none;color:var(--ink)}
.btn:hover{border-color:var(--ink3)}.btn.pri{background:var(--green);border-color:var(--green);color:#fff}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:14px;margin-top:20px}
.panel h3{margin:0;padding:14px 18px;border-bottom:1px solid var(--line);font-size:15px}
.row{display:grid;grid-template-columns:200px 1fr auto;gap:12px;align-items:center;padding:10px 18px;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}
.k{color:var(--ink3);font-size:13.5px}.v{font-weight:500;word-break:break-word;white-space:pre-line}
.cp{border:1px solid var(--line);background:#fff;border-radius:7px;padding:4px 9px;font-size:12.5px;cursor:pointer;color:var(--ink2)}
.cp.ok{border-color:var(--green);color:var(--green)}
.work{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:16px 18px}
.work label{display:block;font-size:13px;color:var(--ink3);margin-bottom:4px}
.inp{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:9px;background:#fbfcfd}
.work .wide{grid-column:1/-1}
.saved{font-size:12.5px;color:var(--green);height:18px;padding:0 18px 12px}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:#fff;padding:9px 16px;border-radius:10px;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none}
.toast.on{opacity:1}
.err{color:var(--red);padding:24px}
@media (max-width:820px){
 .app{grid-template-columns:1fr}.app.detail .side{display:none}.app:not(.detail) .main{display:none}
 .back{display:inline-block}.card{margin:16px auto;padding:0 16px 40px}
 .head{flex-direction:column}.row{grid-template-columns:1fr auto}.row .k{grid-column:1/-1;margin-bottom:-6px}
 .work{grid-template-columns:1fr}
}
</style></head>
<body>
<div class="app" id="app">
  <aside class="side">
    <div class="side-head">
      <div class="title"><span class="mark">GC</span>Заявки DV Lottery<span class="count" id="count"></span></div>
      <input class="search" id="q" placeholder="Поиск: имя, email, Telegram, номер" autocomplete="off">
      <div class="chips" id="chips"></div>
    </div>
    <div class="list" id="list"><div class="empty">Загружаю заявки…</div></div>
  </aside>
  <main class="main" id="main"><div class="empty">Выберите заявку слева</div></main>
</div>
<div class="toast" id="toast"></div>
<script>
var STATUSES = ['Новая', 'Связался', 'Оплачено', 'Подано'];
var RESULTS = ['', 'Не выиграл', 'Выиграл'];
var F = {
  ts: ['timestamp', 'отметка времени'], name: ['напиши фамилию и имя'], sex: ['выберите свой пол'],
  birth: ['день вашего рождения'], birthCity: ['город в котором вы родились'], birthCountry: ['страна в которой вы родились'],
  photoNew: ['фотография'], photoOld: ['загрузите фотографию'], address: ['напишите ваш адрес'],
  country: ['страна, в которой вы живете сейчас'], email: ['ваш действующий e-mail адрес'],
  education: ['укажите, какое у вас образование'], marital: ['укажите ваше текущее семейное положение'],
  children: ['есть ли у вас дети?'], telegram: ['ваш telegram для связи'],
  spouseData: ['данные супруга(и)'], kidsData: ['данные детей'],
  confirm: ['column 1'], result: ['результат'], status: ['статус'], note: ['заметка']
};
var LABELS = [
  ['name', 'Фамилия и имя'], ['sex', 'Пол'], ['birth', 'Дата рождения'], ['birthCity', 'Город рождения'],
  ['birthCountry', 'Страна рождения'], ['address', 'Адрес'], ['country', 'Страна проживания'], ['email', 'Email'],
  ['education', 'Образование'], ['marital', 'Семейное положение'], ['children', 'Дети'], ['telegram', 'Telegram'],
  ['spouseData', 'Супруг(а)'], ['kidsData', 'Дети — данные']
];
var D = null, idx = {}, filter = 'all', selected = null;

function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function linkify(v) { return esc(v).replace(/https?:\/\/[^\s,]+/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">фото</a>'; }); }
function get(r, k) { var i = idx[k]; return i == null ? '' : (r.v[i] || '').trim(); }
function statusOf(r) { return get(r, 'status') || (get(r, 'confirm') ? 'Подано' : 'Новая'); }
function badge(st, res) {
  if (res === 'Выиграл') return '<span class="badge b-win">Выиграл</span>';
  var c = { 'Новая': 'b-new', 'Связался': 'b-contact', 'Оплачено': 'b-paid', 'Подано': 'b-done' }[st] || 'b-new';
  return '<span class="badge ' + c + '">' + esc(st) + '</span>';
}
function photoUrl(r) { return get(r, 'photoNew') || get(r, 'photoOld'); }
function driveId(u) { var m = String(u).match(/[-\w]{25,}/); return m ? m[0] : ''; }
function tgUrl(t) {
  t = String(t).trim(); if (!t) return '';
  if (/^https?:/.test(t)) return t;
  if (/t\.me\//.test(t)) return 'https://' + t.replace(/^.*?t\.me\//, 't.me/');
  if (/^\+?\d[\d\s\-()]{6,}$/.test(t)) return 'https://t.me/+' + t.replace(/\D/g, '');
  return 'https://t.me/' + t.replace(/^@/, '');
}
function tsNum(r) {
  var m = get(r, 'ts').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return 0;
  return new Date(+m[3], +m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
}
function year(r) { var m = get(r, 'ts').match(/(\d{4})/); return m ? m[1] : '—'; }
function toast(t) { var el = document.getElementById('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.remove('on'); }, 1400); }

function copy(text, btn) {
  var done = function () { if (btn) { btn.classList.add('ok'); btn.textContent = 'Скопировано'; setTimeout(function () { btn.classList.remove('ok'); btn.textContent = 'Копировать'; }, 1200); } else toast('Скопировано'); };
  var fallback = function () { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Не удалось скопировать'); } ta.remove(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
}

function load() {
  google.script.run.withSuccessHandler(function (data) {
    D = data; idx = {};
    data.headers.forEach(function (h, i) { var n = norm(h); Object.keys(F).forEach(function (k) { if (idx[k] == null && F[k].indexOf(n) !== -1) idx[k] = i; }); });
    D.rows.sort(function (a, b) { return tsNum(b) - tsNum(a) || b.row - a.row; });
    renderChips(); renderList();
  }).withFailureHandler(function (e) { document.getElementById('list').innerHTML = '<div class="err">' + esc(e.message || e) + '</div>'; }).adminData();
}

function renderChips() {
  var counts = { all: D.rows.length };
  STATUSES.forEach(function (s) { counts[s] = 0; });
  D.rows.forEach(function (r) { counts[statusOf(r)] = (counts[statusOf(r)] || 0) + 1; });
  var html = '<button class="chip' + (filter === 'all' ? ' on' : '') + '" data-f="all">Все ' + counts.all + '</button>';
  STATUSES.forEach(function (s) { html += '<button class="chip' + (filter === s ? ' on' : '') + '" data-f="' + s + '">' + s + ' ' + (counts[s] || 0) + '</button>'; });
  var chips = document.getElementById('chips'); chips.innerHTML = html;
  chips.querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { filter = b.getAttribute('data-f'); renderChips(); renderList(); }; });
}

function renderList() {
  var q = norm(document.getElementById('q').value);
  var rows = D.rows.filter(function (r) {
    if (filter !== 'all' && statusOf(r) !== filter) return false;
    if (!q) return true;
    return norm([get(r, 'name'), get(r, 'email'), get(r, 'telegram'), get(r, 'confirm'), get(r, 'note')].join(' ')).indexOf(q) !== -1;
  });
  document.getElementById('count').textContent = rows.length;
  if (!rows.length) { document.getElementById('list').innerHTML = '<div class="empty">Ничего не найдено</div>'; return; }
  var html = '', y = null;
  rows.forEach(function (r) {
    var ry = year(r); if (ry !== y) { y = ry; html += '<div class="year">' + esc(y) + '</div>'; }
    html += '<button class="item' + (selected === r.row ? ' sel' : '') + '" data-row="' + r.row + '">' +
      '<div class="item-top"><span class="item-name">' + esc(get(r, 'name') || 'Без имени') + '</span><span class="item-date">' + esc(get(r, 'ts').split(' ')[0]) + '</span></div>' +
      '<div class="item-sub">' + esc([get(r, 'telegram'), get(r, 'email')].filter(Boolean).join(' · ')) + '</div>' +
      badge(statusOf(r), get(r, 'result')) + '</button>';
  });
  var list = document.getElementById('list'); list.innerHTML = html;
  list.querySelectorAll('.item').forEach(function (b) { b.onclick = function () { open(Number(b.getAttribute('data-row'))); }; });
}

function open(row) {
  selected = row; renderList();
  var r = D.rows.filter(function (x) { return x.row === row; })[0]; if (!r) return;
  document.getElementById('app').classList.add('detail');
  var p = photoUrl(r), pid = driveId(p), tg = tgUrl(get(r, 'telegram'));
  var photo = pid ? '<a class="photo" href="' + esc(p) + '" target="_blank" rel="noopener" style="background-image:url(https://drive.google.com/thumbnail?id=' + pid + '&sz=w400)"></a>'
    : '<div class="photo">' + (p ? esc(p) : 'Фото нет') + '</div>';
  var all = LABELS.map(function (l) { return l[1] + ': ' + get(r, l[0]); }).join('\n');
  var html = '<div class="card"><button class="back" id="back">← Все заявки</button>' +
    '<div class="head">' + photo + '<div><div class="h-name">' + esc(get(r, 'name') || 'Без имени') + '</div>' +
    '<div class="h-meta">Заявка от ' + esc(get(r, 'ts')) + ' · строка ' + r.row + '</div>' +
    '<div class="h-actions">' +
      (tg ? '<a class="btn pri" href="' + esc(tg) + '" target="_blank" rel="noopener">Написать в Telegram</a>' : '') +
      (get(r, 'email') ? '<a class="btn" href="mailto:' + esc(get(r, 'email')) + '">Email</a>' : '') +
      (p ? '<a class="btn" href="' + esc(p) + '" target="_blank" rel="noopener">Открыть фото</a>' : '') +
      '<button class="btn" id="copyAll">Скопировать всё</button>' +
    '</div></div></div>' +
    '<section class="panel"><h3>Работа с заявкой</h3><div class="work">' +
      '<div><label for="st">Статус</label><select class="inp" id="st">' + STATUSES.map(function (s) { return '<option' + (statusOf(r) === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>' +
      '<div><label for="rs">Результат</label><select class="inp" id="rs">' + RESULTS.map(function (s) { return '<option value="' + s + '"' + (get(r, 'result') === s ? ' selected' : '') + '>' + (s || '—') + '</option>'; }).join('') + '</select></div>' +
      '<div class="wide"><label for="cf">Номер подтверждения</label><input class="inp" id="cf" value="' + esc(get(r, 'confirm')) + '" placeholder="2027XXXXXXXXXXXX"></div>' +
      '<div class="wide"><label for="nt">Заметка</label><textarea class="inp" id="nt" rows="2" placeholder="Оплата, договорённости…">' + esc(get(r, 'note')) + '</textarea></div>' +
    '</div><div class="saved" id="saved"></div></section>' +
    '<section class="panel"><h3>Данные для подачи</h3>' +
    LABELS.map(function (l) { var v = get(r, l[0]); return '<div class="row"><div class="k">' + l[1] + '</div><div class="v">' + (esc(v) || '<span style="color:#aab1c0">—</span>') + '</div>' + (v ? '<button class="cp" data-v="' + esc(v) + '">Копировать</button>' : '<span></span>') + '</div>'; }).join('') +
    '</section></div>';
  var main = document.getElementById('main'); main.innerHTML = html; main.scrollTop = 0;
  document.getElementById('back').onclick = function () { document.getElementById('app').classList.remove('detail'); };
  document.getElementById('copyAll').onclick = function () { copy(all, null); };
  main.querySelectorAll('.cp').forEach(function (b) { b.onclick = function () { copy(b.getAttribute('data-v'), b); }; });
  bind(r, 'st', 'Статус', 'status'); bind(r, 'rs', 'Результат', 'result'); bind(r, 'cf', 'Column 1', 'confirm'); bind(r, 'nt', 'Заметка', 'note');
}

function bind(r, id, header, key) {
  var el = document.getElementById(id);
  el.onchange = function () {
    var val = el.value, saved = document.getElementById('saved');
    saved.textContent = 'Сохраняю…'; saved.style.color = '';
    google.script.run.withSuccessHandler(function () {
      if (idx[key] == null) { idx[key] = D.headers.length; D.headers.push(header); D.rows.forEach(function (x) { x.v.push(''); }); }
      r.v[idx[key]] = val; saved.textContent = 'Сохранено в таблицу'; renderChips(); renderList();
    }).withFailureHandler(function (e) { saved.textContent = 'Не сохранилось: ' + (e.message || e); saved.style.color = 'var(--red)'; }).adminSet(r.row, header, val);
  };
}

document.getElementById('q').oninput = renderList;
load();
</script>
</body></html>`;
