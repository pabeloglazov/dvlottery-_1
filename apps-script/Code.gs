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
  passport: 'Загранпаспорт',
  passportScan: 'Скан загранпаспорта',
  photoCheck: 'Проверка фото',
};
const NO_PASSPORT = 'НЕТ ЗАГРАНПАСПОРТА';

/** Вопросы для паспорта добавляются в форму сами при первой анкете (колонки появятся в таблице). */
function ensurePassportItems_(form) {
  let anchor = findItem_(form, TITLES.kidsData);
  [['passport', 'Заполняется сайтом: номер, страна выдачи, срок действия — или «НЕТ ЗАГРАНПАСПОРТА».'],
   ['passportScan', 'Заполняется сайтом: ссылки на сканы страницы с фото и страницы с подписью.'],
   ['photoCheck', 'Заполняется сайтом: ссылка на оригинал фото и результат ИИ-проверки требований.']].forEach(function (x) {
    let item = findItem_(form, TITLES[x[0]]);
    if (!item) {
      item = form.addParagraphTextItem().setTitle(TITLES[x[0]]).setHelpText(x[1]).setRequired(false);
      if (anchor) form.moveItem(item.getIndex(), anchor.getIndex() + 1);
    }
    anchor = item;
  });
}

function passportText_(number, country, d, m, y) {
  const pad = function (n) { return ('0' + String(n || '')).slice(-2); };
  return [String(number || '').replace(/\s+/g, '').toUpperCase().slice(0, 30), String(country || '').trim().toUpperCase().slice(0, 60),
    'до ' + pad(d) + '.' + pad(m) + '.' + String(y || '').slice(0, 4)].join(', ');
}

/* ---------- распознавание загранпаспорта (OpenAI) ----------
 * Ключ хранится только в свойствах скрипта: OPENAI_API_KEY (Настройки проекта → Свойства скрипта).
 * Дневной лимит защищает ключ: адрес веб-приложения публичный. */
const OCR_MODEL = 'gpt-4o-mini';
const OCR_DAILY_LIMIT = 300;
const COUNTRY_FIX_ = { 'RUSSIAN FEDERATION': 'RUSSIA', 'REPUBLIC OF BELARUS': 'BELARUS', 'REPUBLIC OF KAZAKHSTAN': 'KAZAKHSTAN', 'KYRGYZ REPUBLIC': 'KYRGYZSTAN', 'REPUBLIC OF UZBEKISTAN': 'UZBEKISTAN', 'REPUBLIC OF MOLDOVA': 'MOLDOVA', 'REPUBLIC OF ARMENIA': 'ARMENIA', 'REPUBLIC OF TAJIKISTAN': 'TAJIKISTAN', 'REPUBLIC OF AZERBAIJAN': 'AZERBAIJAN', 'UNITED STATES OF AMERICA': 'USA' };

function ocrQuota_() {
  const props = PropertiesService.getScriptProperties();
  const k = 'ocr_' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyyMMdd');
  const n = Number(props.getProperty(k) || 0);
  if (n >= OCR_DAILY_LIMIT) throw new Error('Дневной лимит распознавания исчерпан');
  props.setProperty(k, String(n + 1));
}

/** images: [{mime, data(base64)}] → { number, country, expiry: 'ДД.ММ.ГГГГ' } (пустые строки, если не прочиталось). */
function recognizePassport_(images) {
  const key = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!key) throw new Error('Распознавание не настроено: нет OPENAI_API_KEY');
  images = (Array.isArray(images) ? images : [images]).filter(function (x) { return x && x.data; }).slice(0, 2);
  if (!images.length) throw new Error('Нет изображения');
  images.forEach(function (x) { if (x.data.length > MAX_PHOTO_BYTES * 1.4) throw new Error('Файл слишком большой'); });
  ocrQuota_();
  const content = [{ type: 'text', text: 'Read this passport (photo/data page). Return JSON: {"is_passport": bool, "number": "", "country": "", "expiry": ""}. ' +
    'number = passport number exactly as printed, Latin letters and digits only, no spaces (check against the MRZ). ' +
    'country = ISSUING country as a short English name in capitals (RUSSIA, BELARUS, KAZAKHSTAN, UKRAINE, UZBEKISTAN, KYRGYZSTAN, ARMENIA...), from the MRZ issuing state if unsure. ' +
    'expiry = date of expiry as DD.MM.YYYY. Use "" for anything you cannot read with confidence. Never guess.' }];
  images.forEach(function (x) {
    const mime = /^image\/(jpeg|png|webp)$/.test(x.mime) ? x.mime : 'image/jpeg';
    content.push({ type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + x.data, detail: 'high' } });
  });
  const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify({ model: OCR_MODEL, temperature: 0, max_tokens: 200, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: 'You extract fields from identity documents and answer only with JSON.' }, { role: 'user', content: content }] })
  });
  if (res.getResponseCode() !== 200) { console.error('OpenAI ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 500)); throw new Error('Сервис распознавания недоступен'); }
  let out = {};
  try { out = JSON.parse(JSON.parse(res.getContentText()).choices[0].message.content || '{}'); } catch (e) { out = {}; }
  let number = String(out.number || '').replace(/[\s<]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(number)) number = '';
  let country = String(out.country || '').trim().toUpperCase().replace(/[^A-Z .'\-]/g, '').slice(0, 60);
  country = COUNTRY_FIX_[country] || country;
  let expiry = String(out.expiry || '').trim();
  const m = expiry.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (m) {
    const dt = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    expiry = dt.getDate() === Number(m[1]) && dt.getMonth() === Number(m[2]) - 1 ? ('0' + m[1]).slice(-2) + '.' + ('0' + m[2]).slice(-2) + '.' + m[3] : '';
  } else expiry = '';
  return { isPassport: out.is_passport !== false, number: number, country: country, expiry: expiry };
}

/** Разовый запуск из редактора после добавления ключа: даёт скрипту доступ к интернету и проверяет ключ (должно вернуть «Ключ работает»). */
function checkOpenAiKey() {
  const key = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!key) return 'Нет свойства OPENAI_API_KEY';
  const code = UrlFetchApp.fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true }).getResponseCode();
  return code === 200 ? 'Ключ работает' : 'OpenAI ответил ' + code + ' — проверьте ключ';
}

/* ---------- ИИ-проверка фото на требования DV ---------- */
const PHOTO_ISSUES = { glasses: 'очки', headwear: 'головной убор', not_frontal: 'не анфас', eyes_closed: 'глаза закрыты', mouth_open: 'открыт рот / улыбка с зубами',
  shadows: 'тени на лице', blurry: 'размыто', dark: 'темно / пересвет', hair_covers_face: 'волосы закрывают лицо', multiple_people: 'несколько людей', no_face: 'лицо не видно', cut_off: 'голова обрезана', cut_source: 'исходник обрезан по краю' };

/** image: {mime, data} — фото уже на белом фоне 600×600. → { ok: bool, issues: [коды] } */
function checkPhoto_(image) {
  const key = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!key) throw new Error('Проверка не настроена: нет OPENAI_API_KEY');
  if (!image || !image.data) throw new Error('Нет изображения');
  if (image.data.length > MAX_PHOTO_BYTES * 1.4) throw new Error('Файл слишком большой');
  ocrQuota_();
  const prompt = 'This is a US Diversity Visa (DV lottery) entry photo, already cropped to 600x600 with the background replaced by white. ' +
    'Check ONLY the person against DV photo rules. Return JSON {"issues": [codes]} using only these codes: ' + Object.keys(PHOTO_ISSUES).join(', ') + '. ' +
    'glasses = any eyeglasses or sunglasses; headwear = hat/cap/scarf (religious head covering is allowed — do not flag); not_frontal = head turned or tilted, not looking at camera; ' +
    'eyes_closed; mouth_open = open mouth or big toothy smile (a closed-mouth smile is fine); shadows = noticeable shadows on the face; blurry; dark = too dark or overexposed face; ' +
    'hair_covers_face = hair covers eyes or part of the face; multiple_people; no_face; cut_off = top of head or chin cut off by the frame. Return an empty list if the photo is fine. Be strict but do not invent problems.';
  const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify({ model: OCR_MODEL, temperature: 0, max_tokens: 120, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: 'You check photos for official document requirements and answer only with JSON.' },
        { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + image.data, detail: 'high' } }] }] })
  });
  if (res.getResponseCode() !== 200) { console.error('OpenAI ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 500)); throw new Error('Сервис проверки недоступен'); }
  let out = {};
  try { out = JSON.parse(JSON.parse(res.getContentText()).choices[0].message.content || '{}'); } catch (e) { out = {}; }
  const issues = (Array.isArray(out.issues) ? out.issues : []).map(String).filter(function (c, i, a) { return PHOTO_ISSUES[c] && a.indexOf(c) === i; });
  return { ok: !issues.length, issues: issues };
}
function publicCheckPhoto_(d) {
  try { return { ok: true, result: checkPhoto_(d.image) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
}
/** Текст для колонки «Проверка фото». */
function photoCheckText_(origUrl, check) {
  const lines = [];
  if (origUrl) lines.push('оригинал: ' + origUrl);
  if (check && Array.isArray(check.issues)) lines.push('проверка: ' + (check.issues.length ? check.issues.map(function (c) { return PHOTO_ISSUES[c] || c; }).join(', ') : 'подходит'));
  else if (origUrl) lines.push('проверка: не проводилась');
  return lines.join('\n');
}

/** Публичное распознавание для анкеты: { action: 'recognizePassport', image: {mime, data} }. */
function publicRecognize_(d) {
  try { return { ok: true, result: recognizePassport_(d.image) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
}

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
    if (d.action === 'recognizePassport') return json_(publicRecognize_(d)); // распознавание паспорта в анкете
    if (d.action === 'checkPhoto') return json_(publicCheckPhoto_(d)); // ИИ-проверка фото в анкете
    if (d.action) return json_(api_(d)); // админка на сайте
    if (d.website) return json_({ ok: true }); // ловушка для ботов

    const form = openForm_();
    ensurePassportItems_(form);
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
      passport: '', passportScan: '',
      photoCheck: d.photo && d.photo.data ? photoCheckText_(savePhoto(d.photoOriginal, applicant + ' ORIGINAL'), d.photoCheck) : '',
    };
    const pp = d.passport || null;
    if (pp && pp.none) values.passport = NO_PASSPORT;
    else if (pp && pp.number) {
      const ex = pp.expiry || {};
      values.passport = passportText_(pp.number, pp.country, ex.d, ex.m, ex.y);
      values.passportScan = (Array.isArray(pp.scans) ? pp.scans.slice(0, 2) : []).map(function (sc, i) {
        return savePhoto(sc, applicant + ' PASSPORT ' + (i + 1));
      }).filter(String).join('\n') || 'пришлёт в Telegram';
    }

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
.brand .lbl{flex:1}
.nav-toggle{width:28px;height:28px;display:grid;place-items:center;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#b8c1d6;cursor:pointer;flex:none}
.nav-toggle:hover{color:#fff;background:rgba(255,255,255,.1)}
.nav-item .lab{display:flex;align-items:center}
.nav-item .ic,.nav-item .sh{display:none}
.nav{transition:flex-basis .18s ease}
.nav.min{flex-basis:72px;padding:18px 10px}
.nav.min .lbl,.nav.min .nav-label,.nav.min .season-btn svg,.nav.min .nav-foot a{display:none}
.nav.min .brand{flex-direction:column;gap:10px;padding:0}
.nav.min .season-btn{justify-content:center;padding:8px 0}.nav.min .season-btn b{font-size:13px}
.nav.min .menu{right:auto;width:230px}
.nav.min .nav-item{flex-direction:column;justify-content:center;gap:1px;padding:7px 0 6px;position:relative}
.nav.min .nav-item .lab{display:none}
.nav.min .nav-item .n{font-size:16px;font-weight:700;color:#fff}
.nav.min .nav-item .badge{font-size:13px;padding:1px 8px}
.nav.min .nav-item .sh{display:block;font-size:10.5px;color:#8f9ab3;letter-spacing:.01em}
.nav.min .nav-item.on .sh{color:#dfe4ef}
.nav.min .nav-item[data-v="Новая"]::before,.nav.min .nav-item[data-v="Связался"]::before,.nav.min .nav-item[data-v="Оплачено"]::before,.nav.min .nav-item[data-v="Подано"]::before{content:"";position:absolute;left:6px;top:50%;width:3px;height:22px;margin-top:-11px;border-radius:3px;background:var(--c)}
.nav.min .nav-item[data-v="Новая"]{--c:#e2a33a}.nav.min .nav-item[data-v="Связался"]{--c:#7f9bd6}.nav.min .nav-item[data-v="Оплачено"]{--c:#5fa77f}.nav.min .nav-item[data-v="Подано"]{--c:#c9d0de}
.nav.min .nav-list{gap:4px}
.nav.min .season-btn small{display:block;text-align:center;font-size:10px}
.ph-btn{position:absolute;inset:0;padding:0;border:0;background:none;cursor:zoom-in}
.ph-btn img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.av{position:relative}
.lb{position:fixed;inset:0;z-index:100;background:rgba(10,16,32,.82);display:grid;place-items:center;padding:24px;cursor:zoom-out;animation:lbIn .15s ease}
@keyframes lbIn{from{opacity:0}to{opacity:1}}
.lb-fig{margin:0;cursor:default;display:flex;flex-direction:column;gap:12px;max-width:min(560px,100%);width:100%}
.lb-img{background:#fff;border-radius:16px;overflow:hidden;display:grid;place-items:center;min-height:200px}
.lb-img{position:relative}
.lbai{position:absolute;inset:0;pointer-events:none;overflow:hidden;border-radius:16px}
.lbai .beam{position:absolute;left:0;right:0;height:36%;top:-36%;background:linear-gradient(180deg,rgba(124,108,240,0),rgba(124,108,240,.26));border-bottom:2px solid #7c6cf0;box-shadow:0 8px 22px rgba(124,108,240,.45);animation:ppScan 1.5s cubic-bezier(.45,0,.55,1) infinite}
.lbai .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(124,108,240,.10) 1px,transparent 1px),linear-gradient(90deg,rgba(124,108,240,.10) 1px,transparent 1px);background-size:28px 28px;opacity:0;animation:lbIn .4s ease forwards}
.lbai .crn{position:absolute;inset:9% 16% 7%;opacity:0;transition:opacity .3s}
.lbai .crn.on{opacity:1}
.lbai .crn i{position:absolute;width:26px;height:26px;border:2.5px solid #7c6cf0}
.lbai .crn i:nth-child(1){left:0;top:0;border-right:0;border-bottom:0;border-radius:8px 0 0 0}
.lbai .crn i:nth-child(2){right:0;top:0;border-left:0;border-bottom:0;border-radius:0 8px 0 0}
.lbai .crn i:nth-child(3){left:0;bottom:0;border-right:0;border-top:0;border-radius:0 0 0 8px}
.lbai .crn i:nth-child(4){right:0;bottom:0;border-left:0;border-top:0;border-radius:0 0 8px 0}
.lbai .chip{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:center;gap:9px;white-space:nowrap;max-width:calc(100% - 24px);padding:8px 14px 8px 11px;border-radius:999px;background:rgba(20,24,44,.82);backdrop-filter:blur(8px);color:#fff;font-size:13.5px;font-weight:600;box-shadow:0 10px 24px -10px rgba(0,0,0,.5);animation:lbChip .25s ease}
.lbai .chip .sp{width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.3);border-top-color:#b9afff;animation:aiSpin .8s linear infinite;flex:none}
.lbai .chip .dots{display:flex;gap:4px;margin-left:2px}
.lbai .chip .dots b{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.25)}
.lbai .chip .dots b.on{background:#b9afff}
.lbai .chip.ok{background:rgba(31,107,72,.92)}
.lbai .chip.warn{background:rgba(150,98,10,.92)}
.lbai .chip.err{background:rgba(155,39,48,.92)}
.lbai .chip svg{width:15px;height:15px;flex:none}
.lbai .chip span{overflow:hidden;text-overflow:ellipsis}
.lbai.out{animation:lbOut .5s ease forwards}
.lb-img.ai-run img{filter:saturate(.8) brightness(.96);transition:filter .3s}
.lb-img.ai-new img{animation:lbReveal .8s cubic-bezier(.2,.7,.2,1)}
.lb-img.ai-new::after{content:"";position:absolute;left:0;right:0;height:2px;top:0;background:#7c6cf0;box-shadow:0 0 18px 4px rgba(124,108,240,.55);animation:lbLine .8s cubic-bezier(.2,.7,.2,1) forwards;pointer-events:none}
.lb-fig.busy .lb-btns{opacity:.45;pointer-events:none}
.lb-fig.busy .lb-btns [data-act=lbClose]{opacity:1;pointer-events:auto}
@keyframes lbChip{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes lbOut{to{opacity:0}}
@keyframes lbReveal{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes lbLine{from{top:0;opacity:1}90%{opacity:1}to{top:100%;opacity:0}}
.lb-img img{display:block;max-width:100%;max-height:calc(100vh - 160px);object-fit:contain}
.lb-fig figcaption{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#fff;flex-wrap:wrap}
.lb-btns{display:flex;gap:8px;flex-wrap:wrap}
.btn.lb-ic{width:40px;height:40px;padding:0;position:relative;overflow:hidden}
.btn.lb-ic svg{width:18px;height:18px}
.btn.lb-ic input{position:absolute;inset:0;opacity:0;cursor:pointer}
.btn.sm.lb-ic{width:32px;height:32px}.btn.sm.lb-ic svg{width:15px;height:15px}
.sec-r{display:flex;align-items:center;gap:10px}
.pp-h .btn.pp-del{width:34px;height:34px;padding:0;display:inline-grid;place-items:center;flex:none}
.pp-h .btn.pp-del svg{width:16px !important;height:16px !important;flex:none}
.btn.pp-del:hover{color:var(--red);border-color:#e6b9bd;background:#fbeef0}
.av-up{position:absolute;inset:0;display:grid;place-items:center;background:rgba(255,255,255,.7);font-size:12px;font-weight:700;color:var(--green);cursor:pointer;opacity:0;transition:opacity .15s}
.big-av:hover .av-up,.av-up:focus-within{opacity:1}
.av-up input{position:absolute;inset:0;opacity:0;cursor:pointer}
.pass-scans{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.ai-box{width:min(420px,100%);background:#fff;border-radius:16px;padding:16px;cursor:default}
.ai-box-h{display:flex;flex-direction:column;margin-bottom:12px}.ai-box-h b{font-size:16px}
.ai-box-b{display:flex;gap:14px;align-items:center}
.ai-th{flex:none;width:76px;height:96px;border-radius:10px;overflow:hidden;border:1px solid var(--line);background:#eef2f7}
.ai-th img{width:100%;height:100%;object-fit:cover;display:block}
.ai-stages{display:grid;gap:7px}
.ai-stg{display:flex;align-items:center;gap:9px;font-size:14px;color:var(--ink3)}
.ai-stg i{flex:none;width:18px;height:18px;border-radius:50%;border:1.5px solid #c8cfdc;display:grid;place-items:center;font-style:normal;font-size:11px}
.ai-stg.on{color:#5b4bc4;font-weight:600}.ai-stg.on i{border-color:#5b4bc4;border-top-color:transparent;animation:aiSpin .8s linear infinite}
.ai-stg.ok{color:var(--ink)}.ai-stg.ok i{background:var(--green);border-color:var(--green);color:#fff}
@keyframes aiSpin{to{transform:rotate(360deg)}}
.crop-ov{cursor:default;z-index:110}
.crop-fig{max-width:min(560px,100%,calc(100vh - 190px))}
.crop-stage{position:relative;width:100%;aspect-ratio:1;overflow:hidden;border-radius:16px;background:#fff;cursor:grab;touch-action:none;user-select:none}
.crop-stage:active{cursor:grabbing}
.crop-stage.is-loading{cursor:progress}
body.cropping .lb:not(.crop-ov){visibility:hidden}
.crop-stage img{position:absolute;left:0;top:0;max-width:none;transform-origin:0 0;pointer-events:none}
.crop-stage img.crop-prev{width:100%;height:100%;object-fit:cover;filter:saturate(.8) brightness(.96)}
.crop-guides{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;animation:lbIn .3s ease}
.crop-lbl{position:absolute;right:8px;top:calc(31% - 20px);font-size:11px;color:#5b4bc4;background:rgba(255,255,255,.88);padding:1px 6px;border-radius:6px;pointer-events:none}
.crop-metrics{position:absolute;left:8px;right:8px;bottom:8px;display:flex;gap:6px;flex-wrap:wrap;justify-content:center;pointer-events:none}
.crop-metrics span{font-size:12px;font-weight:600;border-radius:999px;padding:3px 9px;backdrop-filter:blur(6px)}
.crop-metrics small{font-weight:500;opacity:.75;margin-left:4px}
.crop-metrics .ok{background:rgba(232,243,236,.92);color:var(--greenInk)}.crop-metrics .bad{background:rgba(251,227,228,.95);color:#9b2730}
.crop-bar{display:flex;gap:8px;align-items:center}
.crop-bar input{flex:1;accent-color:#7c6cf0}
.crop-bar .lb-ic{font-size:18px}
.crop-bar .crop-auto{flex:none}
.crop-fig figcaption b small{display:block;font-weight:500;font-size:12px;color:#b8c1d6;margin-top:2px}
.btn.crop-ok{height:38px;display:inline-flex;align-items:center;gap:6px}
.btn.crop-ok svg{width:16px;height:16px}
.crop-fig [disabled]{opacity:.45;pointer-events:none}
.crop-chip{padding:2px 6px}
.ai-chip{display:inline-flex;align-items:center;gap:3px;border:1px solid #d9d3f5;background:#f4f2fd;color:#5b4bc4;border-radius:999px;padding:2px 8px;font-size:11.5px;font-weight:700;cursor:pointer}
.ai-chip svg,.ai-btn svg{width:12px;height:12px}
.ai-chip:hover{background:#e9e5fb}
.btn.ai-btn{border-color:#d9d3f5;background:#f4f2fd;color:#5b4bc4}.btn.ai-btn:hover{background:#e9e5fb}
.fam-ph{display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap}.fam-ph img{width:56px;height:56px;border-radius:10px;object-fit:cover;border:1px solid var(--line)}
.fam-ph .muted{flex-basis:100%}
.ph-check{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px}
.linkbtn{border:0;background:none;padding:0;font-size:13px;color:var(--green);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
/* блок загранпаспорта */
.pp{padding:0;overflow:hidden}
.pp-h{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line2);flex-wrap:wrap}
.pp-h h2{margin:0;font-size:17px;font-weight:700}.pp-h .sp{flex:1}
.pp-st{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;padding:4px 10px 4px 9px;border-radius:999px;white-space:nowrap}
.pp-st i{width:7px;height:7px;border-radius:50%;background:currentColor}
.pp-st.ok{background:var(--tint);color:var(--greenInk)}.pp-st.warn{background:#fbf1dc;color:#9a6512}.pp-st.bad{background:#f8e3e5;color:var(--red)}.pp-st.need{background:#eef1f6;color:var(--ink2)}.pp-st.ai{background:#efecfb;color:#5b4bc4}
.btn.ghost-red{border-color:transparent;background:none;color:var(--red)}.btn.ghost-red:hover{background:#fbeef0}
.pp-b{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:18px;align-items:stretch}
.pp-scans{display:flex;flex-direction:column;gap:10px;min-width:0}
.pp-grid{display:grid;grid-template-columns:1fr;gap:10px}.pp-grid.two{grid-template-columns:1fr 1fr}
.pp-th{position:relative;display:block;width:100%;aspect-ratio:1.42;border-radius:10px;overflow:hidden;border:1px solid var(--line);background:#eef2f7;padding:0;cursor:zoom-in}
.pp-th img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.pp-th .n{position:absolute;left:6px;bottom:6px;background:rgba(20,33,64,.72);color:#fff;font-size:11px;font-weight:600;padding:2px 7px;border-radius:6px}
.pp-x{position:absolute;right:6px;top:6px;width:24px;height:24px;border-radius:50%;border:0;background:rgba(20,33,64,.72);color:#fff;font-size:15px;line-height:1;display:grid;place-items:center;cursor:pointer;opacity:0;transition:opacity .15s}
.pp-th:hover .pp-x,.pp-x:focus-visible{opacity:1}
@media (hover:none){.pp-x{opacity:1}}
.pp-th.scan::before{content:"";position:absolute;z-index:1;left:0;right:0;height:38%;top:-38%;background:linear-gradient(180deg,rgba(91,75,196,0),rgba(91,75,196,.35));border-bottom:2px solid #5b4bc4;animation:ppScan 1.1s ease-in-out infinite}
@keyframes ppScan{to{top:100%}}
.pp-drop{position:relative;cursor:pointer;flex:1;min-height:190px;border-radius:12px;border:1.5px dashed #c3cad8;background:#fafbfd;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:var(--ink3);font-size:13px;text-align:center;padding:16px}
.pp-drop .ic{width:44px;height:44px;border-radius:12px;background:#fff;border:1px solid var(--line);display:grid;place-items:center;color:var(--green);margin-bottom:4px}
.pp-drop b{font-size:15px;color:var(--ink)}
.pp-line{position:relative;cursor:pointer;height:44px;border-radius:10px;border:1.5px dashed #c3cad8;background:#fafbfd;display:flex;align-items:center;justify-content:center;gap:8px;color:var(--ink2);font-size:13.5px;font-weight:600}
.pp-line small{font-weight:500;color:var(--ink3)}
.pp-drop input,.pp-line input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.pp-drop:hover,.pp-line:hover,.pp-over{border-color:var(--green)!important;background:#f4f9f6!important;color:var(--green)}
.pp-data{display:flex;flex-direction:column;min-width:0}
.pp-r{display:grid;grid-template-columns:110px minmax(0,1fr) auto;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line2);transition:background .6s}
.pp-r:first-child{padding-top:0}
.pp-r .k{font-size:13px;color:var(--ink3)}
.pp-r .v{font-size:16px;font-weight:600;font-variant-numeric:tabular-nums;word-break:break-word}
.pp-r .v.e{color:#b4bccb;font-weight:500}
.pp-r .v small{display:block;font-size:12px;font-weight:500;color:var(--ink3)}.pp-r .v small.w{color:#9a6512}
.pp-r.flash{background:linear-gradient(90deg,#efecfb,rgba(239,236,251,0));border-radius:8px}
.pp-sk{display:inline-block;height:14px;width:120px;border-radius:6px;background:linear-gradient(90deg,#eef0f6 25%,#e1def5 50%,#eef0f6 75%);background-size:200% 100%;animation:ppSh 1s linear infinite;vertical-align:middle}
@keyframes ppSh{to{background-position:-200% 0}}
.pp-cp{width:30px;height:30px;border-radius:8px;border:0;background:none;color:var(--ink3);display:grid;place-items:center}
.pp-cp:hover{background:#f1f4f8;color:var(--ink)}.pp-cp.ok{color:var(--green)}
.pp-cp svg{width:16px;height:16px}
.pp-all{margin-top:auto;padding-top:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pp-line1{flex:1;min-width:0;font-size:13px;color:var(--ink2);background:#f6f8fb;border-radius:8px;padding:7px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pp-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pp-warn{margin:14px 18px 0;padding:10px 12px;border-radius:10px;background:#fbf1dc;color:#7a5212;font-size:13.5px}
.pp-ai{margin:0 18px 16px;padding:10px 12px;border-radius:10px;background:#efecfb;color:#3f3394;font-size:13.5px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.pp-ai .sp{display:none}.pp-ai>span:not(.sp){flex:1 1 260px;min-width:0}.pp-ai svg{width:16px;height:16px;flex:none;color:#5b4bc4}
.pp-ai.err{background:#fbf1dc;color:#7a5212}.pp-ai.err svg{color:#9a6512}
.pp-empty{padding:18px;display:flex;flex-direction:column;gap:14px}.pp-empty p{margin:0;color:var(--ink2);max-width:620px}
.pp-form{padding:18px;display:flex;flex-direction:column;gap:14px}
.pp-fg{display:grid;grid-template-columns:1.2fr 1fr 1.25fr;gap:10px}
.pp-f{display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--ink3);font-weight:600}
.pp-f input,.pp-f select{height:40px;border:1px solid var(--line);border-radius:10px;padding:0 10px;font-size:15px;font-weight:500;color:var(--ink);background:#fff;min-width:0}
.pp-f input:focus,.pp-f select:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px rgba(46,106,78,.15)}
.pp-ds{display:grid;grid-template-columns:.8fr 1fr 1fr;gap:6px}
@media (max-width:720px){.pp-b{grid-template-columns:minmax(0,1fr)}.pp-fg{grid-template-columns:minmax(0,1fr)}.pp-drop{min-height:150px}.pp-line small{display:none}.pp-h .sp{flex-basis:100%;height:0}.pp-r{grid-template-columns:96px minmax(0,1fr) auto}}
.scan-th{position:relative;width:120px;height:84px;border-radius:10px;border:1px solid var(--line);background:#f3f5f8;overflow:hidden;padding:0;cursor:zoom-in}
.scan-th img{width:100%;height:100%;object-fit:cover;display:block}
.scan-th span{position:absolute;left:6px;bottom:6px;font-size:11px;font-weight:600;background:rgba(255,255,255,.9);border-radius:6px;padding:1px 6px;color:var(--ink2)}
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
a.row,a.nav-item{text-decoration:none;color:inherit}a.nav-item{color:#dfe4ef}
.row:hover{background:#f8fafc}
.row.on{background:var(--tint);box-shadow:inset 3px 0 0 var(--green)}
.row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.row-top{display:flex;justify-content:space-between;gap:8px}
.row-name{font-weight:600;font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row-date{font-size:12px;color:var(--ink3);white-space:nowrap}
.row-tags{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.tag{font-size:12px;border-radius:6px;padding:1px 7px;background:#f1f3f7;color:var(--ink2)}
.pill{font-size:12px;font-weight:600;border-radius:6px;padding:1px 8px;white-space:nowrap}
.p-new{background:#fbf0d9;color:#8a5d0c}.p-contact{background:#e4ebf7;color:#2b4c8c}.p-paid{background:var(--tint);color:var(--greenInk)}.p-done{background:var(--ink);color:#fff}.p-win{background:#ece0fa;color:#5b2d91}.p-lose{background:#f1f3f7;color:var(--ink2)}.p-none{background:#f1f3f7;color:var(--ink3)}.p-nopass{background:#fbe3e4;color:#9b2730}
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
.rel{display:flex;flex-direction:column;gap:8px;margin:0 0 12px}
.rel-i{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:12px;background:#f6f7fa;border:1px solid var(--line2)}
.rel-i.act{background:#f4f2fd;border-color:#ddd7f7}
.rel-ic{flex:none;width:26px;height:26px;border-radius:8px;display:grid;place-items:center;background:#fff;color:var(--ink3);border:1px solid var(--line2)}
.rel-i.act .rel-ic{color:#5b4bc4;border-color:#ddd7f7}
.rel-ic svg{width:14px;height:14px}
.rel-t{display:flex;flex-direction:column;gap:3px;min-width:0;font-size:14px}
.rel-top a{color:inherit;font-weight:600}
.rel-t .muted{font-size:12.5px}
.rel-note{font-size:12.5px;color:#8a5a00}
.rel-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}
.btn.ghost{background:none;border-color:transparent;color:var(--ink3)}
.hlog-head{display:flex;align-items:center;gap:10px;width:100%;padding:14px 18px;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;border-radius:16px}
.hlog-head h3{margin:0;font-size:16px;font-weight:700}
.hlog-head .cnt{min-width:22px;height:22px;padding:0 7px;border-radius:999px;background:#eef1f6;color:var(--ink2);font-size:12px;font-weight:700;display:inline-grid;place-items:center;font-variant-numeric:tabular-nums}
.hlog-head .muted{flex:1;text-align:right}
.hlog-head svg{flex:none;color:var(--ink3);transition:transform .15s}
.hlog-head[aria-expanded="true"]{border-bottom:1px solid var(--line2);border-radius:16px 16px 0 0}
.hlog-head[aria-expanded="true"] svg{transform:rotate(180deg)}
.hlog-more{padding:10px 18px 14px}

.hlog{display:flex;flex-direction:column}
.hlog-e{padding:12px 18px;border-bottom:1px solid #f1f3f7;display:flex;flex-direction:column;gap:6px}
.hlog-e:last-child{border-bottom:0}
.hlog-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.hlog-top b{font-weight:600;font-size:14px}
.hlog-top .t{color:var(--ink2);font-size:12.5px}
.hlog-top .sp{flex:1}
.hlog-top a{color:inherit;font-weight:600;text-decoration:none}
.hlog-ch{font-size:13px;line-height:1.45;color:var(--ink2);overflow-wrap:anywhere}
.hlog-ch .lbl{color:var(--ink);font-weight:600}
.hlog-ch s{color:#9b2730;text-decoration-color:rgba(155,39,48,.45)}
.hlog-ch ins{color:var(--greenInk);text-decoration:none}
.hlog-done{font-size:12px;color:var(--ink2);background:#eef1f6;border-radius:999px;padding:2px 9px}
.hlog-e.rv{opacity:.6}
.danger-box{display:flex;flex-direction:column;gap:10px;border:1px solid #f1c4c7;background:#fdf3f3}
.btn.danger{background:#b3261e;border-color:#b3261e;color:#fff}
.btn.ghost-danger{background:none;border-color:transparent;color:#b3261e}
.btn.ghost-danger:hover{background:#fdf3f3}
.step{width:100%;border:0;background:none;padding:0;display:flex;flex-direction:column;gap:8px;text-align:left}
.step i{display:block;height:6px;border-radius:999px;background:var(--line)}
.step.done i{background:var(--green)}
.step span{font-size:14px;color:var(--ink3);font-weight:500}
.step.done span{color:var(--ink);font-weight:700}
.field{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--ink3)}
.field input,.field select{padding:9px 11px;border:1px solid var(--line);border-radius:9px;font-size:14.5px;color:var(--ink);background:#fbfcfd;width:100%}
.field input:focus,.field select:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px rgba(46,106,78,.18);background:#fff}
.hist{display:grid;grid-template-columns:80px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line2)}
.fam-link{align-self:flex-start;font-weight:600;color:inherit;text-decoration:underline;text-decoration-color:rgba(20,33,64,.35);text-underline-offset:3px}.fam-link:hover{text-decoration-color:currentColor}
.fam{display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line2)}
.fam .t{flex:1;min-width:0;display:flex;flex-direction:column}
.frow{display:flex;align-items:center;gap:4px;border-top:1px solid var(--line2)}.frow .copy{border-top:0;flex:1;min-width:0}
.pen{width:30px;height:30px;flex:none;display:grid;place-items:center;border-radius:8px;border:1px solid transparent;background:none;color:var(--ink3);cursor:pointer}
.pen:hover{border-color:var(--line);color:var(--green);background:#fff}.pen svg{width:15px;height:15px}
.pen.del:hover{color:#b3261e}
.fedit{display:flex;flex-direction:column;gap:8px;padding:10px 0 12px;border-top:1px solid var(--line2)}
.fedit .k{font-size:12.5px;color:var(--green);font-weight:600}
.fedit input,.fedit select,.fedit textarea{padding:9px 11px;border:1px solid var(--green);border-radius:9px;font:inherit;font-size:14.5px;color:var(--ink);background:#fff;width:100%;box-shadow:0 0 0 3px rgba(46,106,78,.15);outline:none}
.fedit .row-btns{display:flex;gap:8px}
.empty-v{color:var(--ink3);font-weight:400;font-style:italic}
.fam .acts{display:flex;gap:2px}
.fam-del{display:flex;gap:8px;align-items:center;padding:8px 10px;margin:4px 0;border-radius:10px;background:#fdf3f3;border:1px solid #f1c4c7;font-size:13.5px}
.copy{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;padding:10px 0;border:0;border-top:1px solid var(--line2);background:none;text-align:left}
.copy .k{font-size:12.5px;color:var(--ink3)}.copy .v{font-size:14.5px;font-weight:500;word-break:break-word}
.copy .c{font-size:12px;border:1px solid var(--line);border-radius:7px;padding:3px 8px;color:var(--ink3);white-space:nowrap}
.copy.ok .c{border-color:var(--green);color:var(--green)}
.form-box{display:flex;flex-direction:column;gap:10px;padding:14px;margin-top:10px;border-radius:12px;background:#f7f9fb;border:1px solid var(--line)}
.notice{border-radius:14px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.notice{background:#fff;border:1px solid var(--line)}
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
  .nav-label,.nav-foot,.nav-toggle{display:none}
  .nav.min{padding:12px}.nav.min .lbl,.nav.min .season-btn small{display:inline}
  .nav.min .nav-item .sh{display:none}.nav.min .nav-item .lab{display:flex}.nav.min .nav-item::before{display:none}.nav.min .nav-item .n{font-size:14px;font-weight:500;color:#b8c1d6}
  .nav.min .nav-item{flex-direction:row;padding:8px 10px}.nav.min .nav-item .ic,.nav.min .season-btn small{display:none}.nav.min .brand{flex-direction:row}.nav.min .season-btn svg{display:block}.nav.min .season-btn{justify-content:space-between;padding:9px 12px}.nav.min .nav-item .dot{display:none}
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
  .head-actions .btn{flex:1 1 auto}
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
var S = { navMin: (function () { try { return localStorage.getItem('dv_nav_min') === '1'; } catch (e) { return false; } })(), data: null, season: null, view: 'all', q: '', sel: null, menu: false, fam: null, copied: '', busy: false, edit: null, memDel: null };
var PEN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 2.5l2.5 2.5L5.5 13H3v-2.5z"/><path d="M9.5 4l2.5 2.5"/></svg>';
var XIC = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
var FIELDS = [['name','Фамилия и имя'],['sex','Пол','sel',['М','Ж']],['dob','Дата рождения'],['birthCity','Город рождения'],['birthCountry','Страна рождения'],['country','Страна проживания'],['address','Адрес','area'],['email','Email'],['telegram','Telegram'],['education','Образование'],['marital','Семейное положение','sel',['Не женат / не замужен','Женат / замужем','Разведен / разведена','Вдовец / вдова']]];
var byKey = {};

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function norm(s) { return String(s || '').toLowerCase(); }
function initials(n) { var p = String(n || '').split(' '); return ((p[1] || '')[0] || '') + ((p[0] || '')[0] || ''); }
function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
function avColor(k) { return AVC[hash(k) % AVC.length]; }

/* ---------- адреса: #/dv-2027/oplacheno/ivanov-ivan ---------- */
var VIEW_SLUG = { all: 'vse', 'Новая': 'novye', 'Связался': 'svyazalsya', 'Оплачено': 'oplacheno', 'Подано': 'podano', needPass: 'zaprosit-pasport', noPass: 'net-pasporta', invite: 'priglasit', won: 'vyigrali', everyone: 'klienty' };
var VIEW_TITLE = { all: 'Все в сезоне', needPass: 'Запросить паспорт', noPass: 'Нет паспорта', invite: 'Пригласить снова', won: 'Выиграли', everyone: 'Все клиенты' };
var TRL = { 'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya' };
var slugOf = {}, bySlug = {};
function slugify(t) { return String(t || '').toLowerCase().replace(/[а-яё]/g, function (ch) { return TRL[ch]; }).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function buildSlugs() {
  slugOf = {}; bySlug = {};
  var cnt = {};
  S.data.clients.forEach(function (c) { var b = slugify(c.name) || 'klient'; cnt[b] = (cnt[b] || 0) + 1; });
  S.data.clients.forEach(function (c) {
    var b = slugify(c.name) || 'klient', sl = cnt[b] > 1 && c.dob ? b + '-' + slugify(c.dob) : b, n = 2, u = sl;
    while (bySlug[u]) u = sl + '-' + n++;
    slugOf[c.key] = u; bySlug[u] = c.key;
  });
}
function viewHref(v, y) { return '#/dv-' + (y || S.season) + '/' + (VIEW_SLUG[v] || 'vse'); }
function clientHref(key, v, y) { return viewHref(v || S.view, y) + '/' + (slugOf[key] || ''); }
function routeHash() { return S.sel && slugOf[S.sel] ? clientHref(S.sel) : viewHref(S.view); }
function applyRoute(h) {
  var m = /^#\/dv-(\d{4})(?:\/([^\/?]+))?(?:\/([^\/?]+))?/.exec(h || '');
  S.pass = null; S.fam = null; S.del = null; S.unseason = null; S.lb = null; S.edit = null; S.memDel = null; S.menu = false;
  if (!m) { S.season = S.data.current; S.view = 'all'; S.sel = null; return; }
  S.season = Number(m[1]);
  var v = 'all', sl = m[2] ? decodeURIComponent(m[2]) : '';
  Object.keys(VIEW_SLUG).forEach(function (k) { if (VIEW_SLUG[k] === sl) v = k; });
  var cs = m[3] ? decodeURIComponent(m[3]) : (sl && v === 'all' && bySlug[sl] ? sl : '');
  S.view = v; S.sel = cs && bySlug[cs] ? bySlug[cs] : null;
}
function syncUrl() {
  var h = routeHash(), c = S.sel && byKey[S.sel];
  if (location.hash !== h) { try { history[S.replaceUrl ? 'replaceState' : 'pushState'](null, '', h); } catch (e) {} }
  S.replaceUrl = false;
  document.title = (c ? c.name : (STATUS_NAV[S.view] || VIEW_TITLE[S.view] || 'Заявки')) + ' · DV-' + S.season + ' — админка';
}
window.addEventListener('popstate', function () { if (!S.data || location.hash === routeHash()) return; applyRoute(location.hash); S.replaceUrl = true; render(); window.scrollTo(0, 0); });
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
/* ---------- связь с сервером ----------
   Внутри Apps Script — google.script.run (вход через Google-аккаунт).
   На сайте (window.ADMIN_API_URL) — запросы к веб-приложению с ключом входа по коду из почты. */
var API = window.ADMIN_API_URL || '';
function getToken() { try { return localStorage.getItem('dv_admin_token') || ''; } catch (e) { return ''; } }
function setToken(t) { try { if (t) localStorage.setItem('dv_admin_token', t); else localStorage.removeItem('dv_admin_token'); } catch (e) {} }
function post(body) {
  return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
}
var READ_FNS = { adminData: 1, adminHistory: 1, adminGetPhoto: 1, adminCheckPhoto: 1 };
function run(fn, args, ok0, fail) {
  var ok = READ_FNS[fn] ? ok0 : function (x) { ok0 && ok0(x); histStale(); };
  if (!API) {
    var r = google.script.run.withSuccessHandler(function (x) { ok && ok(x); }).withFailureHandler(function (e) { toast('Ошибка: ' + (e && e.message || e)); fail && fail(e); });
    r[fn].apply(r, args);
    return;
  }
  post({ action: fn, args: args, token: getToken() }).then(function (j) {
    if (j.ok) { ok && ok(j.result); return; }
    if (j.auth === false) { setToken(''); S.data = null; renderLogin(); return; }
    toast('Ошибка: ' + j.error); fail && fail(j.error);
  }, function () { toast('Нет связи с сервером. Проверьте интернет.'); fail && fail('network'); });
}



/* ---------- родственники: кто кому супруг / ребёнок, по фамилии, адресу, контактам, общим детям и возрасту ---------- */
function relWords(n) {
  return String(n || '').toLowerCase().replace(/[а-яё]/g, function (ch) { return TRL[ch]; }).toUpperCase()
    .replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1; })
    .map(function (w) { return w.replace(/IY$|II$|YI$|Y$/, 'I').replace(/KH/g, 'H').replace(/IA$|YA$/, 'A').replace(/IE/g, 'E'); });
}
function relRoot(w) { w = w.replace(/(SKAIA|SKAYA)$/, 'SK').replace(/SKI$/, 'SK'); return /(OVA|EVA|INA|YNA)$/.test(w) ? w.slice(0, -1) : w; }
function relSurname(n) { var w = relWords(n); return w.length ? relRoot(w[0]) : ''; }
function sameName(a, b) {
  var x = relWords(a), y = relWords(b); if (!x.length || !y.length) return false;
  var hit = x.filter(function (w) { return y.indexOf(w) !== -1; }).length;
  return hit >= Math.min(2, Math.min(x.length, y.length)) || (x.length === 1 || y.length === 1) && hit === 1 && relRoot(x[0]) === relRoot(y[0]);
}
function relPersonMatch(p, o) { if (!p || !p.name) return false; return sameName(p.name, o.name) && (!p.dob || !o.dob || p.dob === o.dob) || (p.dob && p.dob === o.dob && relWords(p.name).some(function (w) { return relWords(o.name).indexOf(w) !== -1; })); }
function relAddr(a, b) {
  var t = function (x) { return String(x || '').toLowerCase().replace(/[а-яё]/g, function (ch) { return TRL[ch]; }).split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2 || /\d/.test(w); }); };
  var A = t(a), B = t(b); if (A.length < 3 || B.length < 3) return 0;
  var inter = A.filter(function (w, i) { return A.indexOf(w) === i && B.indexOf(w) !== -1; });
  var nums = inter.filter(function (w) { return /\d/.test(w); }).length;
  var j = inter.length / (new Set(A.concat(B))).size;
  return nums >= 2 || (nums >= 1 && j >= 0.45) || j >= 0.6 ? 1 : 0;
}
function relAge(dob) { var m = String(dob || '').match(/^(\d\d)\.(\d\d)\.(\d{4})$/); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; }
function yearsBetween(a, b) { return (b - a) / 31557600000; }
function relContact(x) { return String(x || '').toLowerCase().replace(/^https?:\/\/(t\.me|telegram\.me)\//, '').replace(/^@/, '').replace(/[^a-z0-9@._]/g, ''); }
var DV_KID_AGE = 21;
function married(m) { m = String(m || ''); return /жена|замуж|married/i.test(m) && !/не\s*(жена|замуж)|not\s+married|single/i.test(m); }
function relSurnames(n) { return relWords(n).map(relRoot).filter(function (w) { return w.length > 2; }); }
function relNo() { try { return JSON.parse(localStorage.getItem('dv_rel_no') || '{}'); } catch (e) { return {}; } }
function relPairKey(a, b) { return [a, b].sort().join('||'); }

/** Для клиента c: связанные заявки и предложения. [{o, rel, sure, reasons, acts:[{t, label, kids?}], note}] */
function relFor(c) {
  var out = [], no = relNo(), mine = family(c), cDob = relAge(c.dob);
  var myKids = mine.filter(function (m) { return m.kind === 'child'; }), mySp = mine.filter(function (m) { return m.kind === 'spouse'; })[0];
  S.data.clients.forEach(function (o) {
    if (o.key === c.key) return;
    var theirs = family(o), oKids = theirs.filter(function (m) { return m.kind === 'child'; }), oSp = theirs.filter(function (m) { return m.kind === 'spouse'; })[0];
    var reasons = [], score = 0, rel = '', sure = false;
    // явные связи из анкет
    if (mySp && relPersonMatch(mySp, o) || oSp && relPersonMatch(oSp, c)) { rel = 'spouse'; sure = true; reasons.push(mySp && relPersonMatch(mySp, o) ? 'указан(а) супругом в этой анкете' : 'указал(а) этого клиента супругом в своей анкете'); }
    else if (myKids.some(function (k) { return relPersonMatch(k, o); })) { rel = 'child'; sure = true; reasons.push('указан(а) ребёнком в этой анкете'); }
    else if (oKids.some(function (k) { return relPersonMatch(k, c); })) { rel = 'parent'; sure = true; reasons.push('указал(а) этого клиента ребёнком'); }
    var cs = relSurnames(c.name), os = relSurnames(o.name);
    var sur = cs.some(function (w) { return os.indexOf(w) !== -1; });
    if (c.dob && c.dob === o.dob && sur) { out.push({ o: o, rel: 'self', sure: false, reasons: ['та же дата рождения и похожее имя'], acts: [], notes: ['Похоже, это тот же человек — дубль заявки'], pk: relPairKey(c.key, o.key) }); return; }
    if (sur) { score += 3; reasons.push('одна фамилия'); }
    if (relAddr(c.address, o.address)) { score += 3; reasons.push('один адрес'); }
    if (c.email && relContact(c.email) === relContact(o.email)) { score += 3; reasons.push('общий email'); }
    if (c.telegram && relContact(c.telegram).length > 3 && relContact(c.telegram) === relContact(o.telegram)) { score += 3; reasons.push('общий Telegram'); }
    var shared = myKids.filter(function (k) { return oKids.some(function (q) { return sameName(k.name, q.name) && (!k.dob || !q.dob || k.dob === q.dob); }); });
    if (shared.length) { score += 4; reasons.push('общие дети: ' + shared.map(function (k) { return k.name; }).join(', ')); }
    if (!sure && score < 6) return;
    var oDob = relAge(o.dob), d = cDob && oDob ? yearsBetween(oDob, cDob) : null; // >0 — o старше
    if (!rel) {
      if (d !== null && d >= 16) rel = 'parent';
      else if (d !== null && d <= -16) rel = 'child';
      else {
        var adult = function (x) { var a = relAge(x.dob); return !a || yearsBetween(a, new Date()) >= 18; };
        if (c.sex && o.sex && c.sex !== o.sex && adult(c) && adult(o) && (shared.length || married(c.marital) || married(o.marital))) rel = 'spouse';
        else rel = 'sibling';
      }
    }
    var r = { o: o, rel: rel, sure: sure, reasons: reasons, acts: [], notes: [] };
    var pk = relPairKey(c.key, o.key);
    if (rel === 'spouse') {
      if (!mySp) r.acts.push({ t: 'addSpouse', label: 'Вписать ' + (o.sex === 'Ж' ? 'супругой' : 'супругом') + ' в эту заявку' });
      else if (!relPersonMatch(mySp, o)) r.notes.push('В анкете уже указан(а) другой супруг: ' + mySp.name);
      var miss = oKids.filter(function (q) { return !myKids.some(function (k) { return sameName(k.name, q.name); }); });
      if (miss.length) r.acts.push({ t: 'addKids', kids: miss, label: 'Добавить детей из их анкеты (' + miss.length + ')' });
    } else if (rel === 'child') {
      var ageNow = cDob && oDob ? yearsBetween(oDob, new Date()) : null;
      var listed = myKids.some(function (k) { return relPersonMatch(k, o); });
      if (!listed) {
        if (ageNow !== null && ageNow >= DV_KID_AGE) r.notes.push('Ему/ей уже ' + Math.floor(ageNow) + ' — в заявку родителя не вписать (до 21 года)');
        else if (married(o.marital)) r.notes.push('В браке — в заявку родителя не вписать');
        else r.acts.push({ t: 'addChild', label: 'Вписать ребёнком в эту заявку' });
      }
    } else if (rel === 'parent') {
      var listed2 = oKids.some(function (k) { return relPersonMatch(k, c); });
      var myAge = cDob ? yearsBetween(cDob, new Date()) : null;
      if (!listed2) {
        if (myAge !== null && myAge >= DV_KID_AGE) r.notes.push('Этому клиенту уже ' + Math.floor(myAge) + ' — в заявку родителя не вписать');
        else r.acts.push({ t: 'toParent', label: 'Вписать этого клиента ребёнком в их заявку' });
      }
    }
    r.dismissed = !!no[pk];
    r.pk = pk;
    out.push(r);
  });
  out.sort(function (a, b) { return (b.acts.length ? 1 : 0) - (a.acts.length ? 1 : 0) || (b.sure ? 1 : 0) - (a.sure ? 1 : 0); });
  return out;
}
var REL_NAME = { spouse: function (o) { return o.sex === 'Ж' ? 'жена' : o.sex === 'М' ? 'муж' : 'супруг(а)'; }, child: function (o) { return o.sex === 'Ж' ? 'дочь' : o.sex === 'М' ? 'сын' : 'ребёнок'; },
  parent: function (o) { return o.sex === 'Ж' ? 'мама' : o.sex === 'М' ? 'папа' : 'родитель'; }, sibling: function (o) { return o.sex === 'Ж' ? 'сестра' : o.sex === 'М' ? 'брат' : 'родственник'; }, self: function () { return 'дубль'; } };
function relPending() { return S.data.clients.filter(function (c) { return relFor(c).some(function (r) { return r.acts.length && !r.dismissed; }); }); }
function memberCard(m, c) { return S.data.clients.filter(function (o) { return o.key !== c.key && relPersonMatch(m, o); })[0] || null; }
function renderRel(c) {
  // Только то, что требует внимания: предложения, дубли, замечания. Уже вписанные родственники видны в списке семьи (имя — ссылка на карточку).
  var list = relFor(c).filter(function (r) { return (r.acts.length && !r.dismissed) || r.notes.length && !r.dismissed && r.rel !== 'sibling'; });
  if (!list.length) return '';
  var h = '<div class="rel">';
  list.forEach(function (r) {
    var o = r.o, act = r.acts.length && !r.dismissed;
    h += '<div class="rel-i' + (act ? ' act' : '') + '"><span class="rel-ic">' + (act ? SPARK : I_LINK) + '</span><span class="rel-t"><span class="rel-top">' + (r.sure ? '' : 'Возможно, ') + '<b>' + esc(REL_NAME[r.rel](o)) + '</b> — <a href="' + clientHref(o.key) + '" data-act="open" data-v="' + esc(o.key) + '">' + esc(o.name) + '</a>' + (o.dob ? ' <span class="muted">' + esc(o.dob) + '</span>' : '') + '</span>' +
      '<span class="muted">' + esc(r.reasons.join(' · ')) + '</span>' + r.notes.map(function (n) { return '<span class="rel-note">' + esc(n) + '</span>'; }).join('') +
      (act ? '<span class="rel-acts">' + r.acts.map(function (a, i) { return '<button class="btn sm' + (i === 0 ? ' pri' : '') + '" data-act="relDo" data-v="' + esc(o.key) + '" data-i="' + i + '"' + (S.busy ? ' disabled' : '') + '>' + esc(a.label) + '</button>'; }).join('') +
        (r.sure ? '' : '<button class="btn sm ghost" data-act="relNo" data-v="' + esc(r.pk) + '">Не родственники</button>') + '</span>' : '') + '</span></div>';
  });
  return h + '</div>';
}
function kidParts(k) { var pl = String(k.place || '').split(',').map(function (x) { return x.trim(); }); return { name: k.name, sex: k.sex, dob: k.dob, city: pl[0] || '', country: pl[1] || '', photoUrl: k.photo || '' }; }
function relDo(c, okey, i) {
  var r = relFor(c).filter(function (x) { return x.o.key === okey; })[0]; if (!r || !r.acts[i] || S.busy) return;
  var a = r.acts[i], o = r.o;
  var who = function (x) { return { name: x.name, sex: x.sex, dob: x.dob, city: x.birthCity, country: x.birthCountry, photoUrl: /^https?:/.test(x.photo || '') ? x.photo : '' }; };
  var jobs = a.t === 'addSpouse' ? [[c.row, 'spouse', who(o)]] : a.t === 'addChild' ? [[c.row, 'child', who(o)]] : a.t === 'toParent' ? [[o.row, 'child', who(c)]]
    : a.kids.map(function (k) { return [c.row, 'child', kidParts(k)]; });
  S.busy = true; render();
  var step = function (n) {
    if (n >= jobs.length) { S.busy = false; toast(a.t === 'addSpouse' ? 'Супруг(а) вписан(а)' : a.t === 'toParent' ? 'Вписан(а) ребёнком к ' + o.name : 'Дети добавлены'); load(true); return; }
    run('adminAddMember', jobs[n], function () { step(n + 1); }, function () { S.busy = false; load(true); });
  };
  step(0);
}

/* ---------- история изменений ---------- */
function histStale() { if (S.hist) loadHist(S.hist.key, true); if (S.histAll) loadHist('', true); }
function loadHist(key, quiet) {
  var slot = key ? 'hist' : 'histAll';
  var delay = quiet && S[slot] && S[slot].key === key && S[slot].items ? 700 : 0;
  if (!quiet || !S[slot]) S[slot] = { key: key, items: S[slot] && S[slot].key === key ? S[slot].items : null, loading: true };
  if (!quiet) render();
  clearTimeout(loadHist['t' + slot]);
  loadHist['t' + slot] = setTimeout(function () {
    run('adminHistory', [key || '', key ? 100 : 25], function (items) {
      if (!S[slot] || S[slot].key !== key) return;
      S[slot] = { key: key, items: items, loading: false }; render();
    }, function () { if (S[slot]) { S[slot].loading = false; render(); } });
  }, delay);
}
function shortVal(v) {
  v = String(v || '');
  if (!v) return '<i class="muted">пусто</i>';
  v = v.replace(/https?:\/\/\S+/g, function (u) { return '\u0001' + u + '\u0002'; });
  var t = esc(v.length > 260 ? v.slice(0, 260) + '…' : v);
  return t.replace(/\u0001(\S+?)\u0002/g, function (m, u) { return '<a href="' + u + '" target="_blank" rel="noopener">файл</a>'; }).replace(/\n/g, '<br>');
}

var HFOLD = (function () { try { return JSON.parse(localStorage.getItem('dv_hist_fold') || '{}'); } catch (e) { return {}; } })();
function histOpen(slot) { return !HFOLD[slot]; }
function histSection(slot, title, note, st, withName, style) {
  var open = histOpen(slot), n = st && st.items ? st.items.length : null;
  var cnt = n === null ? '…' : (n >= (slot === 'card' ? 100 : 25) ? n + '+' : String(n));
  var h = '<section class="card"' + (style ? ' style="' + style + '"' : '') + '><button class="hlog-head" data-act="histFold" data-v="' + slot + '" aria-expanded="' + open + '"><h3>' + title + '</h3><span class="cnt" title="Записей в истории">' + cnt + '</span><span class="muted">' + note + '</span>' +
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>';
  if (open) {
    var lim = S.histMore === slot ? 1e9 : 5;
    var cut = st && st.items && st.items.length > lim ? { key: st.key, items: st.items.slice(0, lim), loading: st.loading } : st;
    h += histList(cut, withName);
    if (cut !== st) h += '<div class="hlog-more"><button class="btn sm" data-act="histMore" data-v="' + slot + '">Показать все ' + st.items.length + '</button></div>';
  }
  return h + '</section>';
}
function histList(st, withName) {
  if (!st || (!st.items && st.loading)) return '<div class="empty" style="padding:18px;text-align:left">Загружаю…</div>';
  if (!st.items.length) return '<div class="empty" style="padding:18px;text-align:left">Изменений пока нет. История пишется с ' + '19.10.2026' + '.</div>';
  return '<div class="hlog">' + st.items.map(function (e) {
    var who = withName ? (byKey[e.keys.filter(function (k) { return byKey[k]; })[0]] ? '<a href="' + clientHref(e.keys.filter(function (k) { return byKey[k]; })[0]) + '" data-act="open" data-v="' + esc(e.keys.filter(function (k) { return byKey[k]; })[0]) + '">' + esc(e.name) + '</a>' : esc(e.name)) + ' · ' : '';
    return '<div class="hlog-e' + (e.reverted ? ' rv' : '') + '"><div class="hlog-top"><b>' + who + esc(e.action) + '</b><span class="t">' + esc(e.time) + '</span><span class="sp"></span>' +
      (e.reverted ? '<span class="hlog-done">' + esc(e.reverted) + '</span>' : e.canRevert ? '<button class="btn sm" data-act="histRevert" data-v="' + esc(e.id) + '"' + (S.busy ? ' disabled' : '') + '>' + I_REPL.replace('width="17" height="17"', 'width="14" height="14"') + ' Откатить</button>' : '') + '</div>' +
      e.items.map(function (it) {
        return '<div class="hlog-ch">' + (it.row ? '<span class="lbl">' + esc(it.label) + '</span>' : '<span class="lbl">' + esc(it.label) + ':</span> <s>' + shortVal(it.b) + '</s> → <ins>' + shortVal(it.a) + '</ins>') + '</div>';
      }).join('') + '</div>';
  }).join('') + '</div>';
}
function histRevert(id) {
  if (S.busy || !confirm('Откатить это изменение? Вернутся прежние значения.')) return;
  var go = function (force) {
    S.busy = true; render();
    run('adminRevert', [id, force], function (r) {
      S.busy = false;
      if (r && r.conflicts) {
        render();
        if (confirm('После этого изменения данные уже меняли:\n\n' + r.conflicts.join('\n') + '\n\nВсё равно вернуть прежние значения?')) go(true);
        return;
      }
      toast('Откатил'); load(true);
    }, function () { S.busy = false; render(); });
  };
  go(false);
}

/* ---------- вход по коду ---------- */
var L = { stage: 'start', busy: false, email: '', error: '' };
function renderLogin() {
  var h = '<div style="min-height:100vh;display:grid;place-items:center;padding:20px">' +
    '<form id="login" class="card" style="width:100%;max-width:380px;padding:28px 24px;display:flex;flex-direction:column;gap:14px">' +
    '<div style="display:flex;align-items:center;gap:10px"><span class="mark">GC</span><b style="font-size:17px">Заявки DV Lottery</b></div>';
  if (L.stage === 'start') {
    h += '<p class="muted" style="margin:0;font-size:14.5px">Вход только для владельца. Пришлю одноразовый код на почту.</p>' +
      '<button class="btn pri" type="submit" style="padding:12px"' + (L.busy ? ' disabled' : '') + '>' + (L.busy ? 'Отправляю…' : 'Отправить код на почту') + '</button>';
  } else {
    h += '<p class="muted" style="margin:0;font-size:14.5px">Код отправлен на ' + esc(L.email) + '. Он действует 10 минут.</p>' +
      '<label class="field">Код из письма<input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" style="font-size:22px;letter-spacing:.3em;text-align:center"></label>' +
      '<button class="btn pri" type="submit" style="padding:12px"' + (L.busy ? ' disabled' : '') + '>' + (L.busy ? 'Проверяю…' : 'Войти') + '</button>' +
      '<button class="btn" type="button" data-act="resend">Отправить код ещё раз</button>';
  }
  if (L.error) h += '<p style="margin:0;color:var(--red);font-size:14px">' + esc(L.error) + '</p>';
  h += '</form></div>';
  document.getElementById('app').innerHTML = h;
  var c = document.getElementById('code'); if (c) c.focus();
}
function sendCode() {
  L.busy = true; L.error = ''; renderLogin();
  post({ action: 'requestCode' }).then(function (j) {
    L.busy = false;
    if (j.ok) { L.stage = 'code'; L.email = j.email; } else L.error = j.error;
    renderLogin();
  }, function () { L.busy = false; L.error = 'Нет связи с сервером'; renderLogin(); });
}
function verify(code) {
  L.busy = true; L.error = ''; renderLogin();
  post({ action: 'verifyCode', code: code }).then(function (j) {
    L.busy = false;
    if (j.ok) { setToken(j.token); L = { stage: 'start', busy: false, email: '', error: '' }; document.getElementById('app').innerHTML = '<div class="loading">Загружаю заявки…</div>'; load(); }
    else { L.error = j.error; renderLogin(); }
  }, function () { L.busy = false; L.error = 'Нет связи с сервером'; renderLogin(); });
}
document.addEventListener('submit', function (e) {
  if (e.target.id !== 'login') return;
  e.preventDefault();
  if (L.busy) return;
  if (L.stage === 'start') sendCode();
  else { var v = (document.getElementById('code').value || '').replace(/\D/g, ''); if (v.length !== 6) { L.error = 'Введите 6 цифр из письма'; renderLogin(); return; } verify(v); }
});
function logout() {
  if (!confirm('Выйти из админки на этом устройстве?')) return;
  post({ action: 'logout', token: getToken() }).then(function () {}, function () {});
  setToken(''); S.data = null; S.sel = null; renderLogin();
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
  parsePeople(c.spouseData).forEach(function (p, i) { p.kind = 'spouse'; p.idx = i; p.rel = p.sex === 'М' ? 'супруг' : p.sex === 'Ж' ? 'супруга' : 'супруг(а)'; out.push(p); });
  parsePeople(c.kidsData).forEach(function (p, i) { p.kind = 'child'; p.idx = i; p.rel = p.sex === 'М' ? 'сын' : p.sex === 'Ж' ? 'дочь' : 'ребёнок'; out.push(p); });
  return out;
}
function oldKidsNote(c) {
  if (c.kidsData) return '';
  var t = String(c.children || '').trim();
  if (!t || /^(0|нет|no|none|-)$/i.test(t) || /^да,\s*0$/i.test(t)) return '';
  return t;
}
var NO_PASS = 'НЕТ ЗАГРАНПАСПОРТА', PASS_MIN = new Date(2026, 11, 1);
function passScans(c) { return String(c.passportScan || '').split('\n').map(function (x) { return x.trim(); }).filter(function (x) { return /^https?:/.test(x); }); }
function passInfo(c) {
  var t = String(c.passport || '').trim();
  if (t === NO_PASS) return { state: 'none', scans: passScans(c) };
  if (!/\d/.test(t)) return { state: 'need', scans: passScans(c) };
  var parts = t.split(',').map(function (x) { return x.trim(); });
  var ex = (t.match(/до\s*(\d{2}\.\d{2}\.\d{4})/) || [])[1] || '';
  var m = ex.split('.'), exD = ex ? new Date(+m[2], +m[1] - 1, +m[0]) : null;
  var scans = String(c.passportScan || '').split('\n').map(function (x) { return x.trim(); }).filter(function (x) { return /^https?:/.test(x); });
  return { state: exD && exD < PASS_MIN ? 'expiring' : 'ok', number: parts[0] || '', country: parts[1] || '', expiry: ex, scans: scans };
}
function passMatters(y) { return Number(y) >= 2027; }
function needPassList(y) { return passMatters(y) ? inSeason(y).filter(function (c) { var st = passInfo(c).state; return st === 'need' || st === 'expiring'; }) : []; }
function noPassList(y) { return passMatters(y) ? inSeason(y).filter(function (c) { return passInfo(c).state === 'none'; }) : []; }
function firstName(c) { var p = String(c.name || '').split(' '); var n = p[1] || p[0] || ''; return n.charAt(0) + n.slice(1).toLowerCase(); }
function passRequest(c) {
  return 'Здравствуйте, ' + firstName(c) + '! Готовлю вашу заявку на лотерею грин-карт DV-2027. С этого года Госдепартамент требует действующий загранпаспорт основного заявителя. Пришлите, пожалуйста:\n1) фото страницы с фотографией — все данные должны хорошо читаться;\n2) страницу с подписью, если она на другой странице.\nПаспорт должен действовать на момент подачи (ноябрь 2026). Если загранпаспорта нет — напишите, подскажу варианты.';
}
function passPill(c, y) {
  if (!passMatters(y)) return '';
  var st = passInfo(c).state;
  return st === 'need' ? '<span class="pill p-new">паспорт?</span>' : st === 'none' ? '<span class="pill p-nopass">нет паспорта</span>' : st === 'expiring' ? '<span class="pill p-new">паспорт истекает</span>' : '';
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
    buildSlugs();
    if (!S.season) S.season = d.current;
    if (!keepSel) S.sel = null;
    if (!S.routed) { S.routed = true; applyRoute(location.hash); S.replaceUrl = true; }
    render();
  }, function () { if (!S.data && !(API && !getToken())) document.getElementById('app').innerHTML = '<div class="loading">Не удалось загрузить данные. Обновите страницу.</div>'; });
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
// Смена статуса; при откате ниже «Оплачено» снимаем оплату, ниже «Подано» — результат.
function setStatus(c, y, st) {
  var cur = sub(c, y), i = STATUSES.indexOf(st), patch = { status: st }, extra = '';
  if (i < 2 && cur.paid) { patch.paid = ''; extra = ' · оплата снята'; }
  if (i < 3 && cur.result) { patch.result = ''; extra += ' · результат сброшен'; }
  saveSub(c, y, patch, 'Статус: ' + st + extra);
}
function saveEdit(c) {
  var el = document.getElementById('ed-in'), k = S.edit.k, v = (el ? el.value : S.edit.v).trim();
  if (k === 'name') { v = v.toUpperCase().replace(/\s+/g, ' '); if (!/^[A-Z][A-Z .'\-]*$/.test(v)) { toast('Имя латиницей, как в паспорте'); return; } }
  if (k === 'dob' && !/^\d{2}\.\d{2}\.\d{4}$/.test(v)) { toast('Дата в формате ДД.ММ.ГГГГ'); return; }
  if (k === 'email' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast('Проверьте email'); return; }
  if (/^(birthCity|birthCountry|country)$/.test(k)) v = v.toUpperCase();
  if (v === (c[k] || '')) { S.edit = null; render(); return; }
  S.busy = true; render();
  run('adminUpdateField', [c.key, c.rows || [c.row], k, v], function (r) {
    S.busy = false; S.edit = null;
    if (r && r.key && r.key !== c.key) {
      var old = c.key; S.data.subs[r.key] = S.data.subs[old]; delete S.data.subs[old]; delete byKey[old]; c.key = r.key; byKey[r.key] = c; S.sel = r.key;
    }
    c[k] = v; render(); toast('Сохранено');
  }, function () { S.busy = false; render(); });
}
function addToSeason(list, y) {
  if (!list.length) return;
  list.forEach(function (c) { S.data.subs[c.key] = S.data.subs[c.key] || {}; S.data.subs[c.key][y] = { status: 'Новая', paid: '', number: '', result: '', note: '', date: '', virtual: false }; });
  render();
  run('adminAddToSeason', [list.map(function (c) { return { key: c.key, name: c.name, row: c.row }; }), y],
    function (n) { toast((list.length === 1 ? list[0].name : list.length + ' клиентов') + ' → DV-' + y); }, function () { load(true); });
}

/* ---------- ИИ-обработка фото: белый фон, 600×600 по правилам DV, проверка требований (как в анкете) ---------- */
var MP_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
var MP_MODELS = 'https://greencard-pabeloglazov.ru/models/';
var AI_STAGES = ['Нахожу лицо', 'Убираю фон — делаю белый', 'Кадрирую 600×600 по правилам DV', 'Проверяю требования'];
var AI_ISSUES = { glasses: 'очки', headwear: 'головной убор', not_frontal: 'не анфас', eyes_closed: 'глаза закрыты', mouth_open: 'открыт рот', shadows: 'тени на лице', blurry: 'размыто', dark: 'темно / пересвет', hair_covers_face: 'волосы закрывают лицо', multiple_people: 'несколько людей', no_face: 'лицо не видно', cut_off: 'голова обрезана', cut_source: 'исходник обрезан по краю — нужен снимок с запасом' };
var mpP = null;
function mpTools() {
  if (!mpP) {
    mpP = import(MP_URL + '/vision_bundle.mjs').then(function (m) {
      return m.FilesetResolver.forVisionTasks(MP_URL + '/wasm').then(function (fs) {
        var make = function (dlg) {
          return Promise.all([
            m.FaceDetector.createFromOptions(fs, { baseOptions: { modelAssetPath: MP_MODELS + 'face.tflite', delegate: dlg }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 }),
            m.ImageSegmenter.createFromOptions(fs, { baseOptions: { modelAssetPath: MP_MODELS + 'selfie.tflite', delegate: dlg }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false })
          ]);
        };
        return make('GPU').catch(function () { return make('CPU'); }).then(function (r) { return { face: r[0], seg: r[1] }; });
      });
    });
    mpP.catch(function () { mpP = null; });
  }
  return mpP;
}
function cnv(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function jpegUnder(c, max) { var q = 0.92, u = c.toDataURL('image/jpeg', q); while (u.length * 0.75 > max && q > 0.4) { q -= 0.06; u = c.toDataURL('image/jpeg', q); } return u; }
function loadImg(file) {
  return new Promise(function (res, rej) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () { URL.revokeObjectURL(url); res(img); };
    img.onerror = function () { URL.revokeObjectURL(url); rej(Object.assign(new Error('load'), { code: 'load' })); };
    img.src = url;
  });
}
var pause = function () { return new Promise(function (r) { setTimeout(r, 30); }); };
/* Подготовка: лицо + маска + авто-кадр. Отдельно от сборки, чтобы кадр можно было поправить вручную. */
async function aiPrepare(file, onStage) {
  var SIZE = 600, img = await loadImg(file);
  var k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), W = Math.round(img.naturalWidth * k), H = Math.round(img.naturalHeight * k);
  var src = cnv(W, H); src.getContext('2d').drawImage(img, 0, 0, W, H);
  var original = jpegUnder(src, 1.5 * 1024 * 1024);
  onStage(0); await pause();
  var t;
  try { t = await mpTools(); } catch (e) { throw Object.assign(new Error('tools'), { code: 'tools', original: original }); }
  var det = t.face.detect(src).detections || [];
  if (!det.length) throw Object.assign(new Error('no_face'), { code: 'no_face' });
  var f = det.slice().sort(function (a, b) { return b.boundingBox.width * b.boundingBox.height - a.boundingBox.width * a.boundingBox.height; })[0];
  var kp = f.keypoints.map(function (p) { return { x: p.x * W, y: p.y * H }; });
  var eyeX = (kp[0].x + kp[1].x) / 2, eyeY = (kp[0].y + kp[1].y) / 2, mouthY = kp[3].y, bb = f.boundingBox;
  onStage(1); await pause();
  var res = t.seg.segment(src), masks = res.confidenceMasks || [], best = null, bestV = -1;
  masks.forEach(function (m) {
    var a = m.getAsFloat32Array(), mx = Math.min(m.width - 1, Math.round(eyeX / W * m.width)), my = Math.min(m.height - 1, Math.round(eyeY / H * m.height)), v = a[my * m.width + mx];
    if (v > bestV) { bestV = v; best = { a: Float32Array.from(a), w: m.width, h: m.height }; }
  });
  if (res.close) res.close();
  if (!best) throw Object.assign(new Error('tools'), { code: 'tools', original: original });
  var mc = cnv(best.w, best.h), md = mc.getContext('2d').createImageData(best.w, best.h);
  for (var i = 0; i < best.a.length; i++) md.data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, (best.a[i] - 0.25) / 0.5)) * 255);
  mc.getContext('2d').putImageData(md, 0, 0);
  var person = cnv(W, H), pc = person.getContext('2d');
  pc.drawImage(src, 0, 0); pc.globalCompositeOperation = 'destination-in';
  pc.filter = 'blur(' + Math.max(1, Math.round(W / 500)) + 'px)'; pc.drawImage(mc, 0, 0, W, H); pc.filter = 'none'; pc.globalCompositeOperation = 'source-over';
  var topY = Math.max(0, bb.originY - bb.height * 0.45);
  var x0 = Math.max(0, Math.floor((bb.originX + bb.width * 0.3) / W * best.w)), x1 = Math.min(best.w - 1, Math.ceil((bb.originX + bb.width * 0.7) / W * best.w)), yLim = Math.floor(eyeY / H * best.h);
  outer: for (var y = 0; y < yLim; y++) for (var x = x0; x <= x1; x++) if (best.a[y * best.w + x] > 0.5) { topY = y / best.h * H; break outer; }
  var chinY = Math.max(bb.originY + bb.height, mouthY + (mouthY - eyeY) * 0.9), headH = Math.max(10, chinY - topY);
  onStage(2); await pause();
  // Авто-кадр: края исходника, в которые упирается человек, — за кадром; голова 52–68%, глаза 56–69% от низа, отступ над головой.
  var edges = findEdges(best, W, H);
  var s0 = SIZE * 0.6 / headH, sMax = SIZE * 0.69 / headH, sMin = SIZE * 0.52 / headH, EMIN = SIZE * 0.31, EMAX = SIZE * 0.44, fit = null;
  for (var si = 0; si <= 24; si++) {
    var sc = sMin + (sMax - sMin) * si / 24;
    for (var et = EMIN + 4; et <= EMAX - 4; et += 4) for (var off = -36; off <= 36; off += 6) {
      var dx = SIZE / 2 + off - eyeX * sc, dy = et - eyeY * sc, top = dy + topY * sc;
      var gap = (edges.bY !== null ? Math.max(0, SIZE - (dy + edges.bY * sc)) : 0) + (edges.l ? Math.max(0, dx) : 0) + (edges.r ? Math.max(0, SIZE - (dx + W * sc)) : 0);
      var topPen = top < SIZE * 0.04 ? (SIZE * 0.04 - top) * 20 : top > SIZE * 0.16 ? (top - SIZE * 0.16) * 2 : 0;
      var score = gap * 10 + topPen + Math.abs(sc - s0) / s0 * 120 + Math.abs(et - SIZE * 0.375) * 0.15 + Math.abs(off) * 0.4;
      if (!fit || score < fit.score) fit = { score: score, s: sc, dx: dx, dy: dy };
    }
  }
  return { original: original, W: W, H: H, person: person, mask: best, edges: edges, eyeX: eyeX, eyeY: eyeY, topY: topY, chinY: chinY, headH: headH,
    rect: { x: -fit.dx / fit.s, y: -fit.dy / fit.s, size: SIZE / fit.s } };
}
/* Срезы: край исходника, в который упирается человек, или ровная горизонтальная граница внутри фото (фото уже обрезали). */
function findEdges(m, W, H) {
  var at = function (x, y) { return m.a[y * m.w + x] > 0.5; }, e = { bY: null, l: false, r: false, t: false }, x, y;
  for (x = 0; x < m.w; x++) if (at(x, m.h - 1) || at(x, m.h - 2)) { e.bY = H; break; }
  if (e.bY === null) for (y = m.h - 1; y > m.h * 0.5; y--) { var n = 0; for (x = 0; x < m.w; x++) if (at(x, y)) n++; if (n > 0) { if (n / m.w >= 0.3) e.bY = (y + 1) / m.h * H; break; } }
  for (y = Math.floor(m.h * 0.2); y < m.h; y++) { if (at(0, y) || at(1, y)) e.l = true; if (at(m.w - 1, y) || at(m.w - 2, y)) e.r = true; }
  for (x = 0; x < m.w; x++) if (at(x, 0) || at(x, 1)) { e.t = true; break; }
  return e;
}
/** Сколько срезов видно в кадре rect (px кадра 600). */
function cutGaps(p, rect) {
  var fs = 600 / rect.size, dx = -rect.x * fs, dy = -rect.y * fs, e = p.edges;
  return { b: e.bY !== null ? 600 - (dy + e.bY * fs) : 0, l: e.l ? dx : 0, r: e.r ? 600 - (dx + p.W * fs) : 0, t: e.t ? dy : 0 };
}
function hasCut(p, rect) { var g = cutGaps(p, rect); return g.b > 6 || g.l > 6 || g.r > 6 || g.t > 6; }
/** Сборка 600×600 по квадрату rect (в пикселях исходника), без растушёвки. */
function aiRender(p, rect) {
  var SIZE = 600, fs = SIZE / rect.size;
  var out = cnv(SIZE, SIZE), oc = out.getContext('2d');
  oc.fillStyle = '#fff'; oc.fillRect(0, 0, SIZE, SIZE); oc.imageSmoothingQuality = 'high';
  oc.drawImage(p.person, -rect.x * fs, -rect.y * fs, p.W * fs, p.H * fs);
  return { original: p.original, processed: jpegUnder(out, 240 * 1024), head: Math.round(p.headH * fs / SIZE * 100), eyes: Math.round((SIZE - (p.eyeY - rect.y) * fs) / SIZE * 100), cut: hasCut(p, rect) };
}
async function aiProcess(file, onStage) { var p = await aiPrepare(file, onStage); return aiRender(p, p.rect); }
var asJpeg = function (u) { return { mime: 'image/jpeg', data: u.split(',')[1] }; };
/** Обработать фото с окном прогресса. → Promise { fin, orig, check, raw } */
function aiPhoto(file, title) {
  S.proc = { stage: 0, title: title, preview: URL.createObjectURL(file) }; overlay();
  var done = function () { if (S.proc && S.proc.preview) URL.revokeObjectURL(S.proc.preview); S.proc = null; overlay(); };
  var stage = function (i) { if (S.proc) { S.proc.stage = i; overlay(); } };
  return aiProcess(file, stage).then(function (r) {
    stage(3);
    return new Promise(function (res) { run('adminCheckPhoto', [asJpeg(r.processed)], function (chk) { res(chk); }, function () { res(null); }); })
      .then(function (chk) {
        if (r.cut) chk = { ok: false, issues: ((chk && chk.issues) || []).concat(['cut_source']) };
        done(); return { fin: r.processed, orig: r.original, check: chk, raw: false };
      });
  }, function (e) {
    if (e.code === 'tools') return new Promise(function (res) { resizeImage(file, function (u) { done(); res({ fin: u, orig: null, check: null, raw: true }); }); });
    done(); toast(e.code === 'no_face' ? 'Не нашёл лицо на фото — нужен снимок анфас' : 'Не получилось открыть фото'); throw e;
  });
}
/* ИИ для уже загруженного фото: берём файл из Drive, обрабатываем, сохраняем новую версию. */
function b64File(ph) {
  var bin = atob(ph.data), arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], ph.name || 'photo.jpg', { type: ph.mime || 'image/jpeg' });
}
function aiTarget(c, url) {
  if (!c || !url) return null;
  if (url === c.photo) return { kind: 'me', name: c.name, url: url };
  var m = family(c).filter(function (x) { return x.photo === url; })[0];
  return m ? { kind: m.kind, idx: m.idx, name: m.name, url: url } : null;
}
function aiSave(c, tg, r, srcUrl, onSaved) {
  toast('Сохраняю фото…');
  if (tg.kind === 'me') {
    var extra = r.raw ? null : (r.fresh ? { original: asJpeg(r.orig), check: r.check } : { originalUrl: srcUrl || tg.url, check: r.check });
    run('adminSetPhoto', [c.row, asJpeg(r.fin), extra], function (res) {
      c.photo = res && res.url ? res.url : res; if (res && res.photoCheck) c.photoCheck = res.photoCheck;
      onSaved && onSaved(c.photo); render(); toast('Фото обновлено · ' + aiVerdict(r));
    });
  } else {
    run('adminSetMemberPhoto', [c.row, tg.kind, tg.idx, asJpeg(r.fin)], function (text) {
      if (tg.kind === 'spouse') c.spouseData = text; else c.kidsData = text;
      var m = family(c).filter(function (x) { return x.kind === tg.kind && x.idx === tg.idx; })[0];
      onSaved && onSaved(m && m.photo); render(); toast(tg.name + ' · ' + aiVerdict(r));
    });
  }
}
function aiFix(c, tg) {
  if (!c || !tg || S.proc) return;
  if (S.lb) { S.lb = null; render(); } S.proc = { stage: 0, title: tg.name, preview: '' }; overlay();
  run('adminGetPhoto', [tg.url], function (ph) {
    S.proc = null;
    aiPhoto(b64File(ph), tg.name).then(function (r) { aiSave(c, tg, r); }, function () {});
  }, function () { S.proc = null; overlay(); });
}

/* ---------- ИИ прямо в просмотрщике фото: луч сканирует снимок, внизу — шаги, потом проявляется результат ---------- */
var LB_STEPS = ['Ищу лицо', 'Убираю фон', 'Кадрирую 600×600', 'Проверяю по правилам DV'];
function lbImgCls() { var a = S.lb && S.lb.ai; return 'lb-img' + (a && !a.done ? ' ai-run' : '') + (a && a.reveal ? ' ai-new' : ''); }
function lbAiHtml() {
  var a = S.lb && S.lb.ai; if (!a) return '';
  if (a.done) {
    var ic = a.kind === 'ok' ? OKI : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M8 4v5M8 11.8v.2"/></svg>';
    return '<div class="lbai' + (a.out ? ' out' : '') + '"><div class="chip ' + a.kind + '">' + ic + '<span>' + esc(a.text) + '</span></div></div>';
  }
  return '<div class="lbai"><div class="grid"></div><div class="beam"></div><div class="crn' + (a.stage >= 2 ? ' on' : '') + '"><i></i><i></i><i></i><i></i></div>' +
    '<div class="chip"><span class="sp"></span><span>' + esc(LB_STEPS[Math.min(a.stage, 3)]) + '…</span><span class="dots">' + LB_STEPS.map(function (t, i) { return '<b' + (i <= a.stage ? ' class="on"' : '') + '></b>'; }).join('') + '</span></div></div>';
}
function lbPaint(lb) {
  if (S.lb !== lb) return;
  var box = document.querySelector('.lb .lb-img'), fig = document.querySelector('.lb .lb-fig'); if (!box) return;
  box.className = lbImgCls();
  if (fig) fig.classList.toggle('busy', !!(lb.ai && !lb.ai.done));
  var img = box.querySelector('img');
  if (lb.local && img && img.getAttribute('src') !== lb.local) img.setAttribute('src', lb.local);
  var old = box.querySelector('.lbai'), html = lbAiHtml();
  if (old && old.outerHTML === html) return;
  if (old) old.remove();
  if (html) box.insertAdjacentHTML('beforeend', html);
}
function lbFinish(lb, kind, text, keep) {
  lb.ai = { done: true, kind: kind, text: text, reveal: kind !== 'err' && !!keep };
  lbPaint(lb);
  setTimeout(function () { if (lb.ai && lb.ai.done) { lb.ai.reveal = false; lb.ai.out = true; lbPaint(lb); } }, 3800);
  setTimeout(function () { if (lb.ai && lb.ai.out) { lb.ai = null; lbPaint(lb); } }, 4400);
}
/* Результат ИИ (r из aiProcess/aiRender): показать в просмотрщике, проверить, сохранить и подставить. */
function lbResult(c, tg, lb, r, fresh, srcUrl, finish) {
  finish = finish || function (k, t, keep) { lbFinish(lb, k, t, keep); };
  if (lb.local && lb.local.indexOf('blob:') === 0) URL.revokeObjectURL(lb.local);
  lb.local = r.processed; lb.ai = { stage: 3 }; lbPaint(lb);
  run('adminCheckPhoto', [asJpeg(r.processed)], function (chk) { next(chk); }, function () { next(null); });
  function next(chk) {
    if (r.cut) chk = { ok: false, issues: ((chk && chk.issues) || []).concat(['cut_source']) };
    var res = { fin: r.processed, orig: r.original, check: chk, raw: false, fresh: fresh };
    var v = aiVerdict(res).replace(/^ИИ:\s*/, '');
    finish(chk && chk.ok === false ? 'warn' : 'ok', chk ? (chk.ok === false ? v : 'Готово · фото подходит') : 'Готово · белый фон, 600×600', true);
    aiSave(c, tg, res, srcUrl, function (url) { if (S.lb === lb && url) lb.url = url; });
  }
}
function lbAi(c, tg, file) {
  var lb = S.lb; if (!c || !tg || !lb) return;
  var fresh = !!file;
  lb.ai = { stage: 0 };
  if (file) lb.local = URL.createObjectURL(file);
  lbPaint(lb);
  var stage = function (i) { if (lb.ai && !lb.ai.done) { lb.ai.stage = i; lbPaint(lb); } };
  var finish = function (kind, text, keep) { lbFinish(lb, kind, text, keep); };
  var fail = function (e) {
    if (file && lb.local && lb.local.indexOf('blob:') === 0) { URL.revokeObjectURL(lb.local); lb.local = null; lbPaint(lb); }
    finish('err', e && e.code === 'no_face' ? 'Не нашёл лицо — нужен снимок анфас' : 'Не получилось обработать фото');
  };
  var go = function (f) {
    aiProcess(f, stage).then(function (r) { lbResult(c, tg, lb, r, fresh, null, finish); }, fail);
  };
  if (file) go(file);
  else run('adminGetPhoto', [tg.url], function (ph) { go(b64File(ph)); }, fail);
}
/* ---------- ручное кадрирование: двигать/масштабировать, ИИ собирает 600×600 по выбранному кадру ---------- */
function origUrlOf(c) { return (String(c.photoCheck || '').match(/оригинал:\s*(https?:\S+)/) || [])[1] || ''; }
function openCrop(c, tg) {
  if (!c || !tg || S.proc || S.crop) return;
  var srcUrl = tg.kind === 'me' ? (origUrlOf(c) || tg.url) : tg.url;
  var cr = S.crop = { key: c.key, tg: tg, srcUrl: srcUrl, loading: true, stage: 0, preview: S.lb && S.lb.local || thumb(srcUrl, 1200) || srcUrl, busy: false };
  overlay();
  var stage = function (i) { if (S.crop === cr) { cr.stage = i; overlay(); } };
  var fail = function (e) { if (S.crop !== cr) return; S.crop = null; overlay(); toast(e && e.code === 'no_face' ? 'Не нашёл лицо на фото' : 'Не получилось открыть фото'); };
  run('adminGetPhoto', [srcUrl], function (ph) {
    if (S.crop !== cr) return;
    aiPrepare(b64File(ph), function (i) { stage(Math.min(i, 1)); }).then(function (p) {
      if (S.crop !== cr) return;
      var comp = cnv(p.W, p.H), cx = comp.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, p.W, p.H); cx.drawImage(p.person, 0, 0);
      cr.prep = p; cr.rect = Object.assign({}, p.rect); cr.comp = comp.toDataURL('image/jpeg', 0.9); cr.loading = false;
      overlay();
    }, fail);
  }, fail);
}
function cropBounds(p) { var mn = Math.max(40, p.headH / 1.6), mx = Math.max(p.W, p.H) * 3; return { min: mn, max: Math.max(mn * 2, mx) }; }
function cropZoomVal(cr) { var b = cropBounds(cr.prep); return Math.round(Math.log(b.max / cr.rect.size) / Math.log(b.max / b.min) * 1000); }
function cropSetSize(cr, size, ax, ay) {
  var b = cropBounds(cr.prep); size = Math.max(b.min, Math.min(b.max, size));
  if (ax == null) { ax = 0.5; ay = 0.5; }
  var px = cr.rect.x + cr.rect.size * ax, py = cr.rect.y + cr.rect.size * ay;
  cr.rect = { x: px - size * ax, y: py - size * ay, size: size };
}
function scanHtml(label, stage, n) {
  return '<div class="lbai"><div class="grid"></div><div class="beam"></div><div class="chip"><span class="sp"></span><span>' + esc(label) + '…</span><span class="dots">' +
    Array.apply(null, Array(n)).map(function (x, i) { return '<b' + (i <= stage ? ' class="on"' : '') + '></b>'; }).join('') + '</span></div></div>';
}
var CROP_STEPS = ['Загружаю оригинал', 'Ищу лицо и убираю фон'];
function renderCrop() {
  var cr = S.crop; if (!cr) return '';
  var stageIn = cr.loading
    ? '<img class="crop-prev" src="' + esc(cr.preview) + '" alt="" referrerpolicy="no-referrer">' + scanHtml(CROP_STEPS[cr.stage] || CROP_STEPS[1], cr.stage, 2)
    : '<img id="cropImg" src="' + cr.comp + '" alt="" draggable="false">' +
      '<svg class="crop-guides" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="31" width="100" height="13" fill="rgba(91,75,196,.14)"/><line x1="0" y1="31" x2="100" y2="31" stroke="#5b4bc4" stroke-width=".4" stroke-dasharray="2 1.5"/><line x1="0" y1="44" x2="100" y2="44" stroke="#5b4bc4" stroke-width=".4" stroke-dasharray="2 1.5"/><line x1="50" y1="0" x2="50" y2="100" stroke="#5b4bc4" stroke-width=".25" stroke-dasharray="1.5 2"/></svg>' +
      '<span class="crop-lbl">зона глаз</span><div class="crop-metrics" id="cropMetrics"></div>';
  var dis = cr.loading || cr.busy ? ' disabled' : '';
  return '<div class="lb crop-ov" role="dialog" aria-modal="true" aria-label="Кадрирование"><figure class="lb-fig crop-fig">' +
    '<div class="crop-stage' + (cr.loading ? ' is-loading' : '') + '" id="cropStage">' + stageIn + '</div>' +
    '<div class="crop-bar"><button class="btn lb-ic" data-act="cropZoomOut" aria-label="Отдалить"' + dis + '>−</button><input type="range" id="cropZoom" min="0" max="1000" value="' + (cr.loading ? 500 : cropZoomVal(cr)) + '" aria-label="Масштаб"' + dis + '><button class="btn lb-ic" data-act="cropZoomIn" aria-label="Приблизить"' + dis + '>+</button><button class="btn sm crop-auto" data-act="cropAuto"' + dis + '>Авто</button></div>' +
    '<figcaption><b>' + esc(cr.tg.name) + '<small>двигайте фото, масштаб — колесо или два пальца</small></b><span class="lb-btns">' +
    '<button class="btn lb-ic" data-act="cropCancel" title="Отмена" aria-label="Отмена">' + I_X + '</button>' +
    '<button class="btn pri crop-ok" data-act="cropApply"' + dis + '>' + OKI + ' Готово</button></span></figcaption></figure></div>';
}
function cropLayout() {
  var cr = S.crop, st = document.getElementById('cropStage'), im = document.getElementById('cropImg'); if (!cr || cr.loading || !st || !im) return;
  var F = st.clientWidth, z = F / cr.rect.size, p = cr.prep;
  im.style.width = (p.W * z) + 'px'; im.style.height = (p.H * z) + 'px';
  im.style.transform = 'translate(' + (-cr.rect.x * z) + 'px,' + (-cr.rect.y * z) + 'px)';
  var head = Math.round(p.headH / cr.rect.size * 100), eyes = Math.round((cr.rect.size - (p.eyeY - cr.rect.y)) / cr.rect.size * 100);
  var okH = head >= 50 && head <= 69, okE = eyes >= 56 && eyes <= 69;
  var m = document.getElementById('cropMetrics');
  if (m) m.innerHTML = '<span class="' + (okH ? 'ok' : 'bad') + '">Голова ' + head + '% <small>норма 50–69</small></span><span class="' + (okE ? 'ok' : 'bad') + '">Глаза ' + eyes + '% от низа <small>норма 56–69</small></span>' +
    (hasCut(p, cr.rect) ? '<span class="bad">Видна граница фото — приблизьте или сдвиньте</span>' : '');
  var zr = document.getElementById('cropZoom'); if (zr && document.activeElement !== zr) zr.value = cropZoomVal(cr);
}
var cropPts = {}, cropDrag = null, cropPinch = null;
document.addEventListener('pointerdown', function (e) {
  var st = e.target.closest && e.target.closest('#cropStage'); if (!st || !S.crop || S.crop.loading) return;
  e.preventDefault(); try { st.setPointerCapture(e.pointerId); } catch (x) {}
  cropPts[e.pointerId] = { x: e.clientX, y: e.clientY };
  var ids = Object.keys(cropPts);
  if (ids.length === 2) {
    var a = cropPts[ids[0]], b = cropPts[ids[1]], r = st.getBoundingClientRect();
    cropPinch = { d: Math.hypot(a.x - b.x, a.y - b.y), size: S.crop.rect.size, ax: ((a.x + b.x) / 2 - r.left) / r.width, ay: ((a.y + b.y) / 2 - r.top) / r.height };
    cropDrag = null;
  } else cropDrag = { x: e.clientX, y: e.clientY, F: st.clientWidth };
});
document.addEventListener('pointermove', function (e) {
  if (!S.crop || S.crop.loading || !cropPts[e.pointerId]) return;
  cropPts[e.pointerId] = { x: e.clientX, y: e.clientY };
  var ids = Object.keys(cropPts);
  if (cropPinch && ids.length >= 2) {
    var a = cropPts[ids[0]], b = cropPts[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 0) { var keep = Object.assign({}, S.crop.rect); S.crop.rect = keep; cropSetSize(S.crop, cropPinch.size * cropPinch.d / d, cropPinch.ax, cropPinch.ay); cropPinch.size = S.crop.rect.size; cropPinch.d = d; cropLayout(); }
    return;
  }
  if (!cropDrag) return;
  var z = cropDrag.F / S.crop.rect.size;
  S.crop.rect.x -= (e.clientX - cropDrag.x) / z; S.crop.rect.y -= (e.clientY - cropDrag.y) / z;
  cropDrag.x = e.clientX; cropDrag.y = e.clientY; cropLayout();
});
function cropUp(e) { delete cropPts[e.pointerId]; if (Object.keys(cropPts).length < 2) cropPinch = null; if (!Object.keys(cropPts).length) cropDrag = null; }
document.addEventListener('pointerup', cropUp);
document.addEventListener('pointercancel', cropUp);
document.addEventListener('wheel', function (e) {
  var st = e.target.closest && e.target.closest('#cropStage'); if (!st || !S.crop || S.crop.loading) return;
  e.preventDefault();
  var r = st.getBoundingClientRect(), ax = (e.clientX - r.left) / r.width, ay = (e.clientY - r.top) / r.height;
  cropSetSize(S.crop, S.crop.rect.size * (e.deltaY > 0 ? 1.06 : 1 / 1.06), ax, ay); cropLayout();
}, { passive: false });
function cropApply() {
  var cr = S.crop, c = cr && byKey[cr.key]; if (!cr || cr.busy || cr.loading || !c) return;
  var r = aiRender(cr.prep, cr.rect), tg = cr.tg, src = cr.srcUrl;
  S.crop = null; overlay();
  if (!S.lb) { S.lb = { url: tg.url, name: tg.name }; render(); }
  lbResult(c, tg, S.lb, r, false, src);
}
function aiVerdict(r) {
  if (r.raw) return 'Фото сохранено без автообработки';
  if (!r.check) return 'Фото обработано · проверка недоступна';
  return r.check.issues && r.check.issues.length ? 'ИИ: ' + r.check.issues.map(function (k) { return AI_ISSUES[k] || k; }).join(', ') : 'ИИ: фото подходит';
}
/* Окна обработки и кадрирования живут в отдельном слое — админка под ними не перерисовывается (без мигания). */
function overlay() {
  var el = document.getElementById('ovl');
  if (!el) { el = document.createElement('div'); el.id = 'ovl'; document.body.appendChild(el); }
  var keepZoom = document.activeElement && document.activeElement.id === 'cropZoom';
  document.body.classList.toggle('cropping', !!S.crop);
  var html = renderCrop() + renderAi();
  if (el.getAttribute('data-h') !== html) { el.innerHTML = html; el.setAttribute('data-h', html); }
  if (S.crop && !S.crop.loading) cropLayout();
  if (keepZoom) { var z = document.getElementById('cropZoom'); if (z) z.focus(); }
}
function renderAi() {
  var a = S.proc; if (!a) return '';
  return '<div class="lb ai-ov" role="dialog" aria-modal="true" aria-label="Обработка фото"><div class="ai-box"><div class="ai-box-h"><b>Обработка фото</b><span class="muted">' + esc(a.title || '') + '</span></div><div class="ai-box-b">' +
    '<span class="ai-th">' + (a.preview ? '<img src="' + a.preview + '" alt="">' : '') + '</span><span class="ai-stages">' + AI_STAGES.map(function (t, i) {
      return '<span class="ai-stg' + (i < a.stage ? ' ok' : i === a.stage ? ' on' : '') + '"><i>' + (i < a.stage ? '✓' : '') + '</i>' + t + '</span>';
    }).join('') + '</span></div></div></div>';
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
  buildSlugs();
  var y = S.season, sel = S.sel && byKey[S.sel];
  var html = '<div class="app ' + (sel ? 'has-sel' : 'no-sel') + '">' + renderNav(y) + renderList(y, sel) + '<main class="main">' + (sel ? renderCard(sel, y) : renderOverview(y)) + '</main></div>';
  var keep = document.activeElement && document.activeElement.id;
  var pos = keep && document.activeElement.selectionStart;
  if (S.lb) {
    var id = driveId(S.lb.url);
    html += '<div class="lb" data-act="lbClose" role="dialog" aria-modal="true" aria-label="Фото"><figure class="lb-fig' + (S.lb.ai && !S.lb.ai.done ? ' busy' : '') + '"><div class="' + lbImgCls() + '"><img src="' + (S.lb.local || (id ? thumb(S.lb.url, 1600) : esc(S.lb.url))) + '" alt="' + esc(S.lb.name) + '" referrerpolicy="no-referrer">' + lbAiHtml() + '</div>' +
      '<figcaption><b>' + esc(S.lb.name) + '</b><span class="lb-btns">' + (aiTarget(sel, S.lb.url) ?
        '<button class="btn lb-ic" data-act="cropOpen" title="Кадрировать вручную" aria-label="Кадрировать вручную">' + CROPI + '</button>' +
        '<button class="btn lb-ic ai-btn" data-act="aiFixLb" title="ИИ: белый фон и формат 600×600 по правилам DV" aria-label="Привести к формату DV">' + SPARK + '</button>' +
        '<label class="btn lb-ic" title="Заменить фото (ИИ обработает)" aria-label="Заменить фото">' + I_REPL + '<input type="file" accept="image/*,.heic,.heif" data-act="lbReplace"></label>' : '') +
        (id ? '<a class="btn lb-ic" href="https://drive.google.com/uc?export=download&id=' + id + '" download title="Скачать" aria-label="Скачать">' + I_DOWN + '</a>' : '') +
        '<button class="btn lb-ic" data-act="lbClose" title="Закрыть" aria-label="Закрыть">' + I_X + '</button></span></figcaption></figure></div>';
  }
  document.getElementById('app').innerHTML = html;
  if (keep) { var el = document.getElementById(keep); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
  overlay();
  syncUrl();
}

function renderNav(y) {
  var ins = inSeason(y), counts = {};
  STATUSES.forEach(function (s) { counts[s] = 0; });
  ins.forEach(function (c) { counts[stOf(c, y)]++; });
  var seasons = {}; seasons[S.data.current] = 1;
  S.data.clients.forEach(function (c) { seasonsOf(c).forEach(function (s) { seasons[s] = 1; }); });
  var years = Object.keys(seasons).map(Number).sort(function (a, b) { return b - a; });
  var SHORT = { needPass: 'паспорт?', noPass: 'нет пасп.', all: 'все', 'Новая': 'новые', 'Связался': 'связ.', 'Оплачено': 'оплач.', 'Подано': 'подано', invite: 'пригл.', won: 'выигр.', everyone: 'клиенты' };
  var item = function (key, label, n, extra) {
    return '<a class="nav-item' + (S.view === key ? ' on' : '') + '" href="' + viewHref(key, y) + '" data-act="view" data-v="' + key + '" title="' + esc(label) + '"><span class="lab">' + (extra || '') + '<span class="lbl">' + esc(label) + '</span></span>' + n + '<span class="sh">' + SHORT[key] + '</span></a>';
  };
  var inv = inviteList(S.data.current).length;
  var h = '<nav class="nav' + (S.navMin ? ' min' : '') + '" aria-label="Разделы"><div class="nav-top"><div class="brand"><span class="mark">GC</span><span class="lbl">Green Card</span><button class="nav-toggle" data-act="navMin" title="' + (S.navMin ? 'Развернуть панель' : 'Свернуть панель') + '" aria-label="' + (S.navMin ? 'Развернуть панель' : 'Свернуть панель') + '"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (S.navMin ? 'M6 4l4 4-4 4' : 'M10 4L6 8l4 4') + '"/></svg></button></div>' +
    '<div class="season"><button class="season-btn" data-act="menu" aria-expanded="' + S.menu + '"><span><small>Сезон</small><b><span class="lbl">DV-</span>' + y + '</b></span><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>';
  if (S.menu) {
    h += '<div class="menu" role="menu">' + years.map(function (s) {
      return '<button role="menuitem" class="' + (s === y ? 'on' : '') + '" data-act="season" data-v="' + s + '"><span>DV-' + s + (s === S.data.current ? ' · текущий' : '') + '</span><span class="sub">' + inSeason(s).length + '</span></button>';
    }).join('') + '<hr><button data-act="newSeason" data-v="' + (S.data.current + 1) + '"><span>Начать сезон DV-' + (S.data.current + 1) + '</span></button></div>';
  }
  h += '</div></div><div><div class="nav-label">Воронка сезона</div><div class="nav-list">' +
    item('all', 'Все в сезоне', '<span class="n">' + ins.length + '</span>', '<span class="dot" style="background:#fff"></span>') +
    STATUSES.map(function (s) { return item(s, STATUS_NAV[s], '<span class="n">' + counts[s] + '</span>', '<span class="dot" style="background:' + DOT[s] + '"></span>'); }).join('') +
    (passMatters(y) ? item('needPass', 'Запросить паспорт', needPassList(y).length ? '<span class="badge">' + needPassList(y).length + '</span>' : '<span class="n">0</span>', '<span class="ic">▣</span>') + item('noPass', 'Нет паспорта', '<span class="n">' + noPassList(y).length + '</span>', '<span class="ic">✕</span>') : '') +
    item('invite', 'Пригласить снова', inv ? '<span class="badge">' + inv + '</span>' : '<span class="n">0</span>', '<span class="ic">↻</span>') +
    item('won', 'Выиграли', '<span class="n">' + wonList().length + '</span>', '<span class="ic">★</span>') +
    item('everyone', 'Все клиенты', '<span class="n">' + S.data.clients.length + '</span>', '<span class="ic">☰</span>') +
    '</div></div><div class="nav-foot"><a href="' + esc(S.data.sheetUrl) + '" target="_blank" rel="noopener">Таблица →</a><a href="' + esc(S.data.folderUrl) + '" target="_blank" rel="noopener">Папка с фото →</a>' + (API ? '<a href="#" data-act="logout">Выйти</a>' : '') + '</div></nav>';
  return h;
}

function listSource(y) {
  var v = S.view, src, title;
  if (v === 'invite') { src = inviteList(S.data.current); title = 'Пригласить в DV-' + S.data.current; }
  else if (v === 'won') { src = wonList(); title = 'Выиграли'; }
  else if (v === 'everyone') { src = S.data.clients.slice(); title = 'Все клиенты'; }
  else if (v === 'all') { src = inSeason(y); title = 'Все в сезоне'; }
  else if (v === 'needPass') { src = needPassList(y); title = 'Запросить загранпаспорт'; }
  else if (v === 'noPass') { src = noPassList(y); title = 'Нет загранпаспорта'; }
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
  if (S.view === 'invite' && L.src.length) h += '<div class="list-action"><button class="btn pri" style="width:100%" data-act="inviteAll">Добавить всех ' + L.src.length + ' в DV-' + S.data.current + '</button></div>';
  h += '<div class="list-body">';
  if (!L.src.length) h += '<div class="empty">' + (S.q ? 'Никого не нашёл' : 'Здесь пока пусто') + '</div>';
  L.src.forEach(function (c) {
    var s = sub(c, y), st = s ? (s.result || s.status) : '';
    var fs = familySize(c);
    h += '<a class="row' + (sel && sel.key === c.key ? ' on' : '') + '" href="' + clientHref(c.key) + '" data-act="open" data-v="' + esc(c.key) + '">' + avatar(c) +
      '<span class="row-main"><span class="row-top"><span class="row-name">' + esc(c.name) + '</span><span class="row-date">' + esc(lastDate(c)) + '</span></span>' +
      '<span class="row-tags">' + (st ? pill(st) : '<span class="pill p-none">нет в DV-' + y + '</span>') + (s ? passPill(c, y) : '') + (fs > 1 ? '<span class="tag">семья · ' + fs + '</span>' : '') + '</span></span></a>';
  });
  return h + '</div></aside>';
}

function renderOverview(y) {
  var ins = inSeason(y), counts = {};
  STATUSES.forEach(function (s) { counts[s] = 0; });
  ins.forEach(function (c) { counts[stOf(c, y)]++; });
  var total = ins.length || 1, inv = inviteList(S.data.current);
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
    html: function (c) { return '<a class="btn sm" href="' + clientHref(c.key) + '" data-act="open" data-v="' + esc(c.key) + '">Открыть</a>'; } });
  h += block('Оплачено — подать на сайте DV', paid.length, paid, 'Всех оплативших уже подал.', {
    view: 'Оплачено', meta: function (c) { var fs = familySize(c); return (fs > 1 ? 'семья · ' + fs : 'один') + (sub(c, y).paid ? ' · ' + sub(c, y).paid : ''); },
    html: function (c) { return '<a class="btn sm" href="' + clientHref(c.key) + '" data-act="open" data-v="' + esc(c.key) + '">Открыть</a>'; } });
  h += '</div>';
  if (passMatters(y)) {
    var np = needPassList(y);
    h += block('Запросить загранпаспорт', np.length, np, 'У всех в сезоне паспорт есть или отмечено, что его нет.', {
      view: 'needPass', meta: function (c) { return (passInfo(c).state === 'expiring' ? 'паспорт истекает до подачи · ' : '') + (c.telegram || c.email || ''); },
      html: function (c) { return '<button class="btn sm" data-act="passCopy" data-v="' + esc(c.key) + '">Скопировать запрос</button><button class="btn sm" data-act="open" data-v="' + esc(c.key) + '">Открыть</button>'; } });
  }
  h += block('Подавались раньше — пригласить снова', inv.length, inv, 'Все прошлые клиенты уже в этом сезоне.', {
    view: 'invite', meta: function (c) { return seasonsOf(c).map(function (s) { return 'DV-' + s; }).join(', ') + ' · ' + (c.telegram || ''); },
    html: function (c) { return '<button class="btn sm soft" data-act="add" data-y="' + S.data.current + '" data-v="' + esc(c.key) + '">В DV-' + S.data.current + '</button>'; } });
  var fams = relPending();
  if (fams.length) h += block('Семьи — можно дополнить заявки', fams.length, fams, '', {
    view: 'everyone', meta: function (c) { var r = relFor(c).filter(function (x) { return x.acts.length && !x.dismissed; })[0]; return (r.sure ? '' : 'возможно, ') + REL_NAME[r.rel](r.o) + ': ' + r.o.name; },
    html: function (c) { return '<a class="btn sm" href="' + clientHref(c.key) + '" data-act="open" data-v="' + esc(c.key) + '">Открыть</a>'; } });
  if (!S.histAll) loadHist('', true);
  h += '</div>' + histSection('all', 'Последние изменения', '', S.histAll, true, 'margin-top:16px');
  return h;
}

var CROPI = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 1.5V12h10.5M1.5 4H12v10.5"/></svg>';
var ICO = function (d) { return '<svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
var I_REPL = ICO('<path d="M3.5 8a4.5 4.5 0 0 1 7.8-3.1L13 6.5"/><path d="M13 2.8v3.7H9.3"/><path d="M12.5 8a4.5 4.5 0 0 1-7.8 3.1L3 9.5"/><path d="M3 13.2V9.5h3.7"/>');
var I_DOWN = ICO('<path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10"/>');
var I_TRASH = ICO('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>');
var I_LINK = ICO('<path d="M6.5 9.5l3-3"/><path d="M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2"/><path d="M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8"/>');
var I_X = ICO('<path d="M4 4l8 8M12 4l-8 8"/>');
var I_COPY = ICO('<rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8A1.3 1.3 0 0 0 2.5 3.8v5.4a1.3 1.3 0 0 0 1.3 1.3h1.7"/>');
var SPARK = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5z"/><path d="M13 11l.6 1.4L15 13l-1.4.6L13 15l-.6-1.4L11 13l1.4-.6z"/></svg>';
var CPI = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8A1.3 1.3 0 0 0 2.5 3.8v5.4a1.3 1.3 0 0 0 1.3 1.3h1.7"/></svg>';
var OKI = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
var UPI = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19h14"/></svg>';
var TGI = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M14 2.5L1.8 7.3l4 1.4 1.5 4.6 2.2-2.6 3.2 2.4z"/></svg>';
var MON3 = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
var SCAN_ACCEPT = 'image/*,.heic,.heif,application/pdf,.pdf';
function passLeft(ex) {
  var m = String(ex || '').split('.'); if (m.length !== 3) return '';
  var d = new Date(+m[2], +m[1] - 1, +m[0]), now = new Date();
  if (d < PASS_MIN) return { w: true, t: d < now ? 'паспорт уже истёк' : 'истекает до подачи (ноябрь 2026) — нужен новый' };
  var mo = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth() - (d.getDate() < now.getDate() ? 1 : 0);
  var yy = Math.floor(mo / 12), mm = mo % 12;
  return { w: false, t: 'ещё ' + (yy ? yy + ' ' + plural(yy, 'год', 'года', 'лет') : '') + (yy && mm ? ' ' : '') + (mm ? mm + ' мес.' : '') };
}
function passCp(k, v) { var on = S.copied === k; return '<button class="pp-cp' + (on ? ' ok' : '') + '" data-act="copy" data-k="' + esc(k) + '" data-v="' + esc(v) + '" title="Копировать" aria-label="Копировать">' + (on ? OKI : CPI) + '</button>'; }
function passDateSel(v) {
  var p = String(v || '').split('.'), dd = +p[0] || 0, mm = +p[1] || 0, yy = +p[2] || 0, now = new Date().getFullYear();
  var o = function (val, txt, on) { return '<option value="' + val + '"' + (on ? ' selected' : '') + '>' + txt + '</option>'; };
  var dS = o('', 'день', !dd), mS = o('', 'месяц', !mm), yS = o('', 'год', !yy);
  for (var i = 1; i <= 31; i++) dS += o(i, i, i === dd);
  MON3.forEach(function (m, i) { mS += o(i + 1, m, i + 1 === mm); });
  for (var y = Math.min(now, yy || now); y <= now + 12; y++) yS += o(y, y, y === yy);
  return '<span class="pp-ds"><select id="ps-d" data-act="passDate" aria-label="День">' + dS + '</select><select data-act="passDate" aria-label="Месяц">' + mS + '</select><select data-act="passDate" aria-label="Год">' + yS + '</select></span>';
}
function renderPassport(c, y) {
  var P = passInfo(c), tg = tgUrl(c.telegram), busy = S.scanning === c.key, hasData = P.state === 'ok' || P.state === 'expiring';
  if (!passMatters(y) && P.state === 'need' && !P.scans.length) return '';
  var st = busy ? '<span class="pp-st ai"><i></i>распознаю скан…</span>'
    : P.state === 'none' ? '<span class="pp-st bad"><i></i>нет загранпаспорта</span>'
    : P.state === 'need' ? (P.scans.length ? '<span class="pp-st warn"><i></i>нет данных</span>' : '<span class="pp-st need"><i></i>нужно запросить</span>')
    : P.state === 'expiring' ? '<span class="pp-st warn"><i></i>истекает до подачи</span>'
    : P.scans.length ? '<span class="pp-st ok"><i></i>действует</span>' : '<span class="pp-st warn"><i></i>нет скана</span>';
  var editing = S.pass && S.pass.key === c.key;
  var btns = '';
  if (!editing && !busy) {
    if (P.state === 'need') btns = '<button class="btn sm ghost-red" data-act="passNone">Нет паспорта</button><button class="btn sm" data-act="passEdit">' + PEN.replace('aria-hidden', 'width="14" height="14" aria-hidden') + ' Ввести вручную</button>';
    else if (hasData) btns = '<button class="btn sm" data-act="passEdit">' + PEN.replace('aria-hidden', 'width="14" height="14" aria-hidden') + ' Изменить</button>';
    if (hasData || P.scans.length) btns += '<button class="btn sm lb-ic pp-del" data-act="passWipe" title="Удалить паспорт: данные и все сканы" aria-label="Удалить паспорт">' + I_TRASH + '</button>';
  }
  var h = '<section class="card pp" data-pp="' + esc(c.key) + '"><div class="pp-h"><h2>Загранпаспорт</h2>' + st + '<span class="sp"></span>' + btns + '</div>';
  if (editing) {
    var d = S.pass;
    return h + '<div class="pp-form"><div class="pp-fg">' +
      '<label class="pp-f">Номер паспорта<input id="ps-number" data-act="passDraft" data-k="number" value="' + esc(d.number) + '" placeholder="751234567" autocomplete="off"></label>' +
      '<label class="pp-f">Страна выдачи<input id="ps-country" data-act="passDraft" data-k="country" value="' + esc(d.country) + '" placeholder="RUSSIA" autocomplete="off"></label>' +
      '<div class="pp-f">Действует до' + passDateSel(d.expiry) + '</div></div>' +
      '<div class="pp-acts"><button class="btn pri" data-act="passSave"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Сохраняю…' : 'Сохранить') + '</button><button class="btn" data-act="passCancel">Отмена</button></div></div></section>';
  }
  var upl = function (cls, inner) { return '<label class="' + cls + '" data-drop="1">' + inner + '<input type="file" accept="' + SCAN_ACCEPT + '" data-act="passScan"></label>'; };
  if (P.state === 'none' && !busy) {
    return h + '<div class="pp-empty"><p>Клиент сообщил, что загранпаспорта нет. Без него подать на DV-2027 нельзя — если оформит до конца регистрации, загрузите скан, данные заполнятся сами.</p>' +
      '<div class="pp-acts">' + upl('btn sm pri', 'Загрузить скан') + '<button class="btn sm" data-act="passEdit">Ввести вручную</button><button class="btn sm" data-act="passClear">Снять отметку</button></div></div>' + passAiBar(c) + '</section>';
  }
  if (P.state === 'expiring' && !busy) h += '<div class="pp-warn">Паспорт истекает раньше подачи (ноябрь 2026) — нужен новый.</div>';
  // сканы
  var sc = '';
  var list = P.scans.slice(), pv = busy && S.scanPreview;
  if (!list.length && !pv) sc = upl('pp-drop', '<span class="ic">' + UPI + '</span><b>Загрузить скан паспорта</b><span>Нажмите или перетащите фото / PDF сюда<br>номер, страна и срок заполнятся сами</span>');
  else {
    var n = list.length + (pv ? 1 : 0);
    sc = '<div class="pp-grid' + (n > 1 ? ' two' : '') + '">' + list.map(function (u, i) {
      return '<span class="pp-th" role="button" tabindex="0" data-act="photoView" data-v="' + esc(u) + '" data-n="' + esc(c.name + ' — паспорт, скан ' + (i + 1)) + '"><img src="' + thumb(u, 600) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()"><span class="n">скан ' + (i + 1) + '</span>' +
        (busy ? '' : '<button class="pp-x" data-act="passRm" data-v="' + esc(u) + '" title="Убрать скан" aria-label="Убрать скан">×</button>') + '</span>';
    }).join('') + (pv ? '<span class="pp-th scan"><img src="' + pv + '" alt=""><span class="n">скан ' + n + '</span></span>' : '') + '</div>';
    if (!busy) sc += upl('pp-line', '<b>+</b> Добавить скан <small>· перетащите фото или PDF</small>');
  }
  // данные
  var fl = S.ppFlash === c.key ? ' flash' : '', lf = passLeft(P.expiry);
  var row = function (k, label, v, extra) {
    var val = busy && !hasData ? '<span class="pp-sk"></span>' : v ? esc(v) + (extra || '') : 'не указано';
    return '<div class="pp-r' + fl + '"><span class="k">' + label + '</span><span class="v' + (v || busy ? '' : ' e') + '">' + val + '</span>' + (v ? passCp(label, v) : '<span></span>') + '</div>';
  };
  var dt = '<div class="pp-data">' + row('n', 'Номер', hasData && P.number) + row('c', 'Страна выдачи', hasData && P.country) +
    row('e', 'Действует до', hasData && P.expiry, lf ? '<small' + (lf.w ? ' class="w"' : '') + '>' + lf.t + '</small>' : '');
  if (hasData) { var one = P.number + ', ' + P.country + ', до ' + P.expiry; dt += '<div class="pp-all"><span class="pp-line1">' + esc(one) + '</span><button class="btn sm" data-act="copy" data-k="pass-all" data-v="' + esc(one) + '">' + (S.copied === 'pass-all' ? 'Скопировано' : 'Всё строкой') + '</button></div>'; }
  else if (!busy) dt += '<div class="pp-acts" style="margin-top:auto;padding-top:14px"><button class="btn sm pri" data-act="passCopy" data-v="' + esc(c.key) + '">Скопировать запрос</button>' + (tg ? '<a class="btn sm" href="' + esc(tg) + '" target="_blank" rel="noopener">' + TGI + ' Telegram</a>' : '') + '</div>';
  dt += '</div>';
  return h + '<div class="pp-b"><div class="pp-scans">' + sc + '</div>' + dt + '</div>' + passAiBar(c) + '</section>';
}
function passAiBar(c) {
  var a = S.ai; if (!a || a.key !== c.key) return '';
  return '<div class="pp-ai' + (a.err ? ' err' : '') + '">' + SPARK + '<span>' + a.html + '</span><span class="sp"></span>' + (a.apply ? '<button class="btn sm pri" data-act="aiApply">Заменить данные</button>' : '') +
    (a.err ? '<button class="btn sm" data-act="passEdit">Ввести вручную</button>' : '') + '<button class="btn sm" data-act="aiOk">Ок</button></div>';
}
/* загрузка скана: фото или PDF → JPEG → сервер (сохранить + распознать) */
var pdfjsP = null;
function loadPdfjs() {
  if (!pdfjsP) pdfjsP = import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs').then(function (m) {
    m.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs'; return m; });
  return pdfjsP;
}
function pdfPages(file, max) {
  return loadPdfjs().then(function (pdfjs) { return file.arrayBuffer().then(function (buf) { return pdfjs.getDocument({ data: buf }).promise; }); }).then(function (pdf) {
    var out = [], n = Math.min(max || 2, pdf.numPages), i = 1;
    var next = function () {
      if (i > n) return Promise.resolve(out);
      return pdf.getPage(i++).then(function (page) {
        var b = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: Math.min(4, 2200 / Math.max(b.width, b.height)) });
        var cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
        return page.render({ canvasContext: cx, viewport: vp }).promise.then(function () { out.push(cv.toDataURL('image/jpeg', 0.85)); return next(); });
      });
    };
    return next();
  });
}
function docImage(file) {
  return new Promise(function (res, rej) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var k = Math.min(1, 2200 / Math.max(img.naturalWidth, img.naturalHeight)), cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url); res(cv.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('img')); };
    img.src = url;
  });
}
function passUpload(c, file) {
  if (!c || !file || S.scanning) return;
  var pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!pdf && !/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) { toast('Нужно фото или PDF'); return; }
  S.ai = null; S.pass = null;
  (pdf ? pdfPages(file, 2) : docImage(file).then(function (u) { return [u]; })).then(function (pages) {
    var first = pages[0], rest = pages.slice(1), key = c.key;
    S.scanning = key; S.scanPreview = first; render();
    run('adminScanPassport', [key, c.rows || [c.row], { mime: 'image/jpeg', data: first.split(',')[1] }], function (r) {
      c.passportScan = r.scans; if (r.passport != null) c.passport = r.passport;
      var p = r.parsed, line = p ? esc([p.number, p.country, p.expiry ? 'до ' + p.expiry : ''].filter(Boolean).join(', ')) : '';
      if (r.error) S.ai = { key: key, err: true, html: '<b>Скан сохранён, но данные не распознались.</b> ' + esc(r.error) };
      else if (r.applied) { S.ai = { key: key, html: '<b>Распознано и сохранено в таблицу:</b> ' + line + '. Проверьте глазами.' }; S.ppFlash = key; setTimeout(function () { if (S.ppFlash === key) { S.ppFlash = null; render(); } }, 1600); }
      else if (r.same) S.ai = { key: key, html: 'Скан сохранён · данные совпадают с паспортом ✓' };
      else S.ai = { key: key, apply: p, html: '<b>На скане другой паспорт:</b> ' + line + '.' };
      var finish = function () { S.scanning = null; S.scanPreview = null; render(); };
      if (!rest.length) return finish();
      run('adminAddPassportScan', [key, c.rows || [c.row], { mime: 'image/jpeg', data: rest[0].split(',')[1] }], function (t) { c.passportScan = t; finish(); }, finish);
    }, function () { S.scanning = null; S.scanPreview = null; render(); });
  }, function () { toast(pdf ? 'Не получилось открыть PDF' : 'Не получилось открыть файл'); });
}
/* Колонка «Проверка фото»: «оригинал: URL» и «проверка: подходит | очки, тени». */
function photoCheckLine(c) {
  var t = String(c.photoCheck || ''), orig = (t.match(/оригинал:\s*(https?:\S+)/) || [])[1], chk = ((t.match(/проверка:\s*(.+)/) || [])[1] || '').trim();
  if (!orig && !chk) return '';
  var ok = chk === 'подходит', na = !chk || chk === 'не проводилась';
  return '<span class="ph-check">' + (chk ? '<span class="pill ' + (ok ? 'p-paid' : na ? 'p-none' : 'p-new') + '">ИИ: ' + esc(ok ? 'фото подходит' : na ? 'не проверено' : chk) + '</span>' : '') +
    (orig ? '<button class="linkbtn" data-act="photoView" data-v="' + esc(orig) + '" data-n="' + esc(c.name + ' — оригинал фото') + '">оригинал фото</button>' : '') + '</span>';
}
function renderCard(c, y) {
  var s = sub(c, y), idx = s ? STATUSES.indexOf(s.status) : -1, fam = family(c), seasons = seasonsOf(c);
  var tg = tgUrl(c.telegram), t = thumb(c.photo, 400);
  var missing = (c.photo ? 0 : 1) + fam.filter(function (m) { return !m.photo; }).length;
  var h = '<button class="back" data-act="close">← Назад к списку</button>' +
    '<div class="head"><span class="big-av" style="background:' + avColor(c.key) + '">' + esc(initials(c.name)) + (t ? '<button class="ph-btn" data-act="photoView" data-v="' + esc(c.photo) + '" data-n="' + esc(c.name) + '" aria-label="Открыть фото"><img src="' + t + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()"></button>' : '<label class="av-up" title="Загрузить фото (ИИ обработает)">+ фото<input type="file" accept="image/*,.heic,.heif" data-act="photo"></label>') + '</span>' +
    '<div class="head-main"><h1>' + esc(c.name) + '</h1><span class="muted">' + (seasons.length ? 'Клиент с DV-' + seasons[seasons.length - 1] + ' · сезонов: ' + seasons.length : 'Новый клиент') + (c.telegram ? ' · ' + esc(c.telegram) : '') + '</span>' + photoCheckLine(c) +
    '<span class="row-tags">' + (s ? pill(s.result || s.status) : '<span class="pill p-none">нет в DV-' + y + '</span>') + '<span class="tag">' + (fam.length ? 'семья · ' + (fam.length + 1) : 'один') + '</span>' +
    (missing ? '<span class="pill" style="background:#fbe3e4;color:#9b2730">нет фото: ' + missing + '</span>' : '<span class="pill p-paid">все фото есть</span>') + '</span></div>' +
    '<div class="head-actions">' + (tg ? '<a class="btn pri" href="' + esc(tg) + '" target="_blank" rel="noopener">Telegram</a>' : '') + (c.email ? '<a class="btn" href="mailto:' + esc(c.email) + '">Email</a>' : '') + '</div></div>';

  if (s) {
    h += '<section class="card pad" style="display:flex;flex-direction:column;gap:16px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap"><h2 class="sec-title" style="font-size:18px">Подача DV-' + y + '</h2><span class="muted">' + (s.date ? 'анкета ' + esc(s.date) : '') + '</span></div>' +
      '<ol class="steps">' + STATUSES.map(function (st, i) { return '<li><button class="step' + (i <= idx ? ' done' : '') + '" data-act="status" data-v="' + st + '"><i></i><span>' + (st === 'Новая' ? 'Анкета' : st) + '</span></button></li>'; }).join('') + '</ol>' +
      '<div class="grid3"><label class="field">Оплата<input id="f-paid" data-act="field" data-k="paid" value="' + esc(s.paid) + '" placeholder="$50 × ' + (fam.length + 1) + '"></label>' +
      '<label class="field">Номер подтверждения<input id="f-number" data-act="field" data-k="number" value="' + esc(s.number) + '" placeholder="' + y + 'XXXXXXXXXXXX"></label>' +
      '<label class="field">Заметка<input id="f-note" data-act="field" data-k="note" value="' + esc(s.note) + '" placeholder="договорённости, напоминания"></label></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      (idx > 0 ? '<button class="btn" data-act="prev">← Вернуть: ' + STATUSES[idx - 1] + '</button>' : '') +
      (idx < 3 ? '<button class="btn dark" data-act="next">Дальше: ' + STATUSES[idx + 1] + ' →</button>' : '') +
      (idx === 3 ? '<span style="font-weight:600;color:var(--greenInk);margin-right:6px">Результат:</span><button class="btn sm' + (s.result === 'Выиграл' ? ' pri' : '') + '" data-act="result" data-v="Выиграл">Выиграл</button><button class="btn sm' + (s.result === 'Не выиграл' ? ' dark' : '') + '" data-act="result" data-v="Не выиграл">Не выиграл</button>' + (s.result ? '<button class="btn sm" data-act="result" data-v="">Сбросить</button>' : '') : '') +
      '</div></section>';
  }
  var cy = S.data.current;
  if (s && y !== cy && !won(c)) {
    h += sub(c, cy)
      ? '<div class="notice"><span><b>Уже в DV-' + cy + '</b> · ' + esc(sub(c, cy).status) + '</span><button class="btn sm" data-act="season" data-keep="1" data-v="' + cy + '">Перейти в DV-' + cy + '</button></div>'
      : '<div class="notice amber"><span><b>Пригласить в новый сезон?</b><br><span class="muted" style="color:#6b5420">В DV-' + cy + ' заявки пока нет</span></span><button class="btn pri" data-act="add" data-y="' + cy + '" data-v="' + esc(c.key) + '">Пригласить в DV-' + cy + '</button></div>';
  }
  if (!s) {
    h += '<div class="notice amber"><span><b>В сезоне DV-' + y + ' заявки нет</b><br><span class="muted" style="color:#6b5420">' + (seasons.length ? 'Подавался: ' + seasons.map(function (x) { return 'DV-' + x; }).join(', ') : '') + '</span></span><button class="btn pri" data-act="add" data-v="' + esc(c.key) + '">Добавить в DV-' + y + '</button></div>';
  }

  h += renderPassport(c, y);
  h += '<div class="grid2"><section class="card pad"><h2 class="sec-title" style="font-size:18px;margin-bottom:8px">История подач</h2>';
  if (!seasons.length) h += '<div class="muted" style="padding:8px 0">Пока нет подач.</div>';
  seasons.forEach(function (x) {
    var ss = sub(c, x), res = ss.result || (ss.status === 'Подано' ? 'Ждём результат' : ss.status);
    h += '<div class="hist"><b>DV-' + x + '</b><span style="min-width:0"><span style="display:block;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis">' + esc(ss.number || 'номера нет') + '</span><span class="muted">' + (ss.paid ? 'оплата ' + esc(ss.paid) : 'без отметки оплаты') + '</span></span>' + (PILL[res] ? pill(res) : '<span class="pill p-new">' + esc(res) + '</span>') + '</div>';
  });
  h += '</section><section class="card pad"><h2 class="sec-title" style="font-size:18px;margin-bottom:8px">Семья в заявке</h2>' + renderRel(c);
  fam.forEach(function (m) {
    var mt = thumb(m.photo, 120);
    h += '<div class="fam"><span class="av" style="background:' + avColor(m.name) + '">' + esc(initials(m.name)) + (mt ? '<button class="ph-btn" data-act="photoView" data-v="' + esc(m.photo) + '" data-n="' + esc(m.name) + '" aria-label="Открыть фото"><img src="' + mt + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()"></button>' : '') + '</span><span class="t">' + (function () { var mc = memberCard(m, c); return mc ? '<a class="fam-link" href="' + clientHref(mc.key) + '" data-act="open" data-v="' + esc(mc.key) + '" title="Открыть карточку">' + esc(m.name) + '</a>' : '<b style="font-weight:600">' + esc(m.name) + '</b>'; })() + '<span class="muted">' + esc([m.rel, m.dob, m.place].filter(Boolean).join(' · ')) + '</span></span>' +
      (m.photo ? '<button class="pill p-paid" data-act="photoView" data-v="' + esc(m.photo) + '" data-n="' + esc(m.name) + '" style="border:0;cursor:pointer">фото</button>' : '<span class="pill" style="background:#fbe3e4;color:#9b2730">нет фото</span>') +
      '<span class="acts"><button class="pen" data-act="memEdit" data-kind="' + m.kind + '" data-i="' + m.idx + '" title="Изменить" aria-label="Изменить">' + PEN + '</button><button class="pen del" data-act="memDel" data-kind="' + m.kind + '" data-i="' + m.idx + '" title="Убрать из заявки" aria-label="Убрать из заявки">' + XIC + '</button></span></div>';
    if (S.memDel === m.kind + m.idx) h += '<div class="fam-del"><span style="flex:1">Убрать <b>' + esc(m.name) + '</b> из заявки?</span><button class="btn sm danger" data-act="memDelYes" data-kind="' + m.kind + '" data-i="' + m.idx + '"' + (S.busy ? ' disabled' : '') + '>Убрать</button><button class="btn sm" data-act="memDelNo">Отмена</button></div>';
  });
  var kidsOld = oldKidsNote(c);
  if (kidsOld) h += '<div class="fam"><span class="t"><b style="font-weight:600">Дети (из старой анкеты)</b><span class="muted">' + esc(kidsOld) + '</span></span></div>';
  if (!fam.length && !kidsOld) h += '<div class="muted" style="padding:10px 0;border-top:1px solid var(--line2)">Подаётся один, без супруга и детей.</div>';
  var hasSpouse = fam.some(function (m) { return /супруг/.test(m.rel); });
  if (!S.fam) {
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--line2)">' + (hasSpouse ? '' : '<button class="btn sm dash" data-act="fam" data-v="spouse">+ Супруг(а)</button>') + '<button class="btn sm dash" data-act="fam" data-v="child">+ Ребёнок</button></div>';
  } else {
    var d = S.fam;
    h += '<div class="form-box"><b>' + (d.idx != null ? 'Изменить: ' + esc(d.orig) : d.kind === 'spouse' ? 'Добавить супруга(у)' : 'Добавить ребёнка') + '</b>' +
      '<label class="field">Фамилия и имя (латиницей)<input id="m-name" data-act="draft" data-k="name" value="' + esc(d.name) + '" placeholder="IVANOVA ANNA"></label>' +
      '<div class="grid2" style="gap:10px"><label class="field">Пол<select id="m-sex" data-act="draft" data-k="sex"><option value="">—</option><option' + (d.sex === 'М' ? ' selected' : '') + '>М</option><option' + (d.sex === 'Ж' ? ' selected' : '') + '>Ж</option></select></label>' +
      '<label class="field">Дата рождения<input id="m-dob" data-act="draft" data-k="dob" value="' + esc(d.dob) + '" placeholder="ДД.ММ.ГГГГ" inputmode="numeric"></label>' +
      '<label class="field">Город рождения<input id="m-city" data-act="draft" data-k="city" value="' + esc(d.city) + '" placeholder="MOSCOW"></label>' +
      '<label class="field">Страна рождения<input id="m-country" data-act="draft" data-k="country" value="' + esc(d.country) + '" placeholder="RUSSIA"></label></div>' +
      '<div class="fam-ph">' + (d.photo ? '<img src="' + d.photo + '" alt=""><span class="pill ' + (d.check && d.check.issues && d.check.issues.length ? 'p-new' : d.check ? 'p-paid' : 'p-none') + '">' + esc(aiVerdict({ raw: d.raw, check: d.check })) + '</span>' : '') +
        '<label class="btn sm file">' + (d.photo ? 'Другое фото' : d.keepPhoto ? 'Заменить фото' : 'Фото (необязательно)') + '<input type="file" accept="image/*,.heic,.heif" data-act="memberPhoto"></label><span class="muted" style="font-size:12.5px">ИИ поставит белый фон и подгонит 600×600</span></div>' +
      '<div style="display:flex;gap:8px"><button class="btn pri" data-act="saveMember"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Сохраняю…' : d.idx != null ? 'Сохранить' : 'Добавить в заявку') + '</button><button class="btn" data-act="cancelMember">Отмена</button></div></div>';
  }
  h += '</section></div>';

  h += '<section class="card pad"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:6px"><h2 class="sec-title" style="font-size:18px">Данные для подачи</h2><span class="sec-r"><span class="muted">клик — скопировать · ✎ — изменить</span><button class="btn sm lb-ic" data-act="copyAll" title="Скопировать всё" aria-label="Скопировать всё">' + I_COPY + '</button></span></div><div class="grid2" style="column-gap:24px;row-gap:0">' +
    FIELDS.map(function (f) {
      var k = f[0], label = f[1], val = c[k] || '';
      if (S.edit && S.edit.k === k) {
        var inp = f[2] === 'sel' ? '<select id="ed-in">' + f[3].map(function (o) { return '<option' + (o === S.edit.v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + (f[3].indexOf(S.edit.v) === -1 && S.edit.v ? '<option selected>' + esc(S.edit.v) + '</option>' : '') + '</select>'
          : f[2] === 'area' ? '<textarea id="ed-in" rows="2">' + esc(S.edit.v) + '</textarea>'
          : '<input id="ed-in" value="' + esc(S.edit.v) + '"' + (k === 'dob' ? ' placeholder="ДД.ММ.ГГГГ" inputmode="numeric"' : '') + '>';
        return '<div class="fedit"><span class="k">' + esc(label) + '</span>' + inp + '<div class="row-btns"><button class="btn sm pri" data-act="edSave"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Сохраняю…' : 'Сохранить') + '</button><button class="btn sm" data-act="edCancel">Отмена</button></div></div>';
      }
      var on = S.copied === label;
      return '<div class="frow">' + (val
        ? '<button class="copy' + (on ? ' ok' : '') + '" data-act="copy" data-k="' + esc(label) + '" data-v="' + esc(val) + '"><span style="min-width:0"><span class="k" style="display:block">' + esc(label) + '</span><span class="v">' + esc(val) + '</span></span><span class="c">' + (on ? 'Скопировано' : 'Копировать') + '</span></button>'
        : '<div class="copy" style="cursor:default"><span style="min-width:0"><span class="k" style="display:block">' + esc(label) + '</span><span class="v empty-v">не указано</span></span></div>') +
        '<button class="pen" data-act="edit" data-k="' + k + '" title="Изменить" aria-label="Изменить: ' + esc(label) + '">' + PEN + '</button></div>';
    }).join('') +
    '</div></section>';
  if (!S.hist || S.hist.key !== c.key) loadHist(c.key, true);
  h += histSection('card', 'История изменений', '', S.hist && S.hist.key === c.key ? S.hist : null, false);
  var nRows = (c.rows || [c.row]).length;
  h += S.del === c.key
    ? '<section class="card pad danger-box"><b>Удалить ' + esc(c.name) + '?</b><span class="muted">Из таблицы удалятся ' + (nRows > 1 ? 'все его анкеты (' + nRows + ' ' + plural(nRows, 'строка', 'строки', 'строк') + ')' : 'его анкета') + ' и все отметки по сезонам. Отменить нельзя. Фото в папке на Drive останутся.</span>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn danger" data-act="delYes"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Удаляю…' : 'Удалить навсегда') + '</button><button class="btn" data-act="delNo">Отмена</button></div></section>'
    : S.unseason === c.key && s
      ? '<section class="card pad danger-box" style="background:#fbf6ea;border-color:#f0dcb0"><b>Убрать ' + esc(c.name) + ' из DV-' + y + '?</b><span class="muted">Анкета и все данные останутся в таблице, клиент пропадёт только из этого сезона. Вернуть можно кнопкой «Добавить в DV-' + y + '».</span><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn dark" data-act="unseasonYes"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Убираю…' : 'Убрать из сезона') + '</button><button class="btn" data-act="unseasonNo">Отмена</button></div></section>'
      : '<div style="display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap">' + (s ? '<button class="btn sm ghost-danger" style="color:var(--ink2)" data-act="unseason">Убрать из DV-' + y + '</button>' : '') + '<button class="btn sm ghost-danger" data-act="del">Удалить заявку</button></div>';
  return h;
}

/* ---------- события ---------- */
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-act]'); if (!el) { if (S.menu && !e.target.closest('.season')) { S.menu = false; render(); } return; }
  if (el.tagName === 'A' && (el.getAttribute('href') || '').charAt(0) === '#' && el.getAttribute('data-act') !== 'logout') {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return; // новая вкладка — пусть открывает браузер
    e.preventDefault();
  }
  var a = el.getAttribute('data-act'), v = el.getAttribute('data-v');
  var c = S.sel && byKey[S.sel], y = S.season;
  if (a === 'resend') { L.stage = 'start'; sendCode(); return; }
  if (a === 'logout') { e.preventDefault(); logout(); return; }
  if (!S.data) return;
  if (a === 'cropOpen') { e.preventDefault(); openCrop(byKey[S.sel], aiTarget(byKey[S.sel], v || (S.lb && S.lb.url))); return; }
  if (a === 'cropCancel') { S.crop = null; overlay(); return; }
  if ((a === 'cropZoomIn' || a === 'cropZoomOut') && S.crop && !S.crop.loading) { cropSetSize(S.crop, S.crop.rect.size * (a === 'cropZoomIn' ? 1 / 1.15 : 1.15)); cropLayout(); return; }
  if (a === 'cropAuto' && S.crop && !S.crop.loading) { S.crop.rect = Object.assign({}, S.crop.prep.rect); cropLayout(); return; }
  if (a === 'cropApply') { cropApply(); return; }
  if (a === 'aiFix') { e.preventDefault(); aiFix(byKey[S.sel], aiTarget(byKey[S.sel], v)); return; }
  if (a === 'aiFixLb') { if (S.lb && !(S.lb.ai && !S.lb.ai.done)) lbAi(byKey[S.sel], aiTarget(byKey[S.sel], S.lb.url), null); return; }
  if (a === 'histRevert') { histRevert(v); return; }
  if (a === 'relDo') { relDo(byKey[S.sel], v, Number(el.getAttribute('data-i'))); return; }
  if (a === 'relNo') { var rn = relNo(); rn[v] = 1; try { localStorage.setItem('dv_rel_no', JSON.stringify(rn)); } catch (e3) {} toast('Подсказка скрыта'); render(); return; }
  if (a === 'histFold') { HFOLD[v] = histOpen(v); try { localStorage.setItem('dv_hist_fold', JSON.stringify(HFOLD)); } catch (e2) {} render(); return; }
  if (a === 'histMore') { S.histMore = v; render(); return; }
  if (a === 'photoView') { e.preventDefault(); S.lb = { url: v, name: el.getAttribute('data-n') || '' }; render(); return; }
  if (a === 'lbClose') { if (e.target.closest('.lb-fig') && !e.target.closest('[data-act="lbClose"].btn')) return; S.lb = null; render(); return; }
  if (a === 'passCopy') { var pc = byKey[v]; if (pc) copyText(passRequest(pc), 'запрос'); return; }
  if (a === 'navMin') { S.navMin = !S.navMin; S.menu = false; try { localStorage.setItem('dv_nav_min', S.navMin ? '1' : ''); } catch (e) {} render(); }
  else if (a === 'menu') { S.menu = !S.menu; render(); }
  else if (a === 'season') { var keep = el.hasAttribute('data-keep'); S.season = Number(v); S.menu = false; if (!keep) S.sel = null; S.view = 'all'; render(); window.scrollTo(0, 0); }
  else if (a === 'newSeason') {
    S.menu = false;
    if (!confirm('Сделать DV-' + v + ' текущим сезоном? Новые анкеты будут попадать в него.')) { render(); return; }
    run('adminSetCurrentSeason', [Number(v)], function (n) { S.data.current = n; S.season = n; S.view = 'all'; render(); toast('Текущий сезон: DV-' + n); });
  }
  else if (a === 'view') { S.view = v; S.sel = null; S.fam = null; render(); window.scrollTo(0, 0); }
  else if (a === 'open') { S.histMore = null; S.pass = null; S.sel = v; S.fam = null; S.del = null; S.unseason = null; S.lb = null; S.edit = null; S.memDel = null; render(); window.scrollTo(0, 0); }
  else if (a === 'close') { S.sel = null; S.fam = null; render(); }
  else if (a === 'add') { var cl = byKey[v]; if (cl) addToSeason([cl], Number(el.getAttribute('data-y')) || y); }
  else if (a === 'inviteAll') { var cy = S.data.current, list = inviteList(cy); if (list.length && confirm('Добавить ' + list.length + ' ' + plural(list.length, 'клиента', 'клиентов', 'клиентов') + ' в DV-' + cy + ' со статусом «Новая»?')) addToSeason(list, cy); }
  else if (a === 'status' && c) setStatus(c, y, v);
  else if (a === 'prev' && c) { var j = STATUSES.indexOf(sub(c, y).status); if (j > 0) setStatus(c, y, STATUSES[j - 1]); }
  else if (a === 'passEdit' && c) { var pi = passInfo(c); S.ai = null; S.pass = { key: c.key, number: pi.number || '', country: pi.country || String(c.birthCountry || '').toUpperCase(), expiry: pi.expiry || '' }; render(); var pn = document.getElementById('ps-number'); if (pn) pn.focus(); }
  else if (a === 'aiOk') { S.ai = null; render(); }
  else if (a === 'passWipe' && c && !S.busy) {
    if (!confirm('Удалить загранпаспорт ' + c.name + '? Номер, страна, срок и все сканы уберутся из карточки и таблицы. Файлы сканов останутся в папке.')) return;
    S.busy = true; S.ai = null; S.pass = null; render();
    run('adminClearPassport', [c.key, c.rows || [c.row]], function () { S.busy = false; c.passport = ''; c.passportScan = ''; render(); toast('Паспорт удалён'); }, function () { S.busy = false; render(); });
  }
  else if (a === 'aiApply' && c && S.ai && S.ai.apply && !S.busy) {
    var ap = S.ai.apply; S.busy = true; render();
    run('adminSetPassport', [c.key, c.rows || [c.row], { number: ap.number, country: ap.country, expiry: ap.expiry }], function (text) {
      S.busy = false; S.ai = null; c.passport = text; S.ppFlash = c.key; render(); toast('Данные заменены и сохранены');
      setTimeout(function () { S.ppFlash = null; render(); }, 1600);
    }, function () { S.busy = false; render(); });
  }
  else if (a === 'passRm' && c && !S.busy) {
    e.stopPropagation();
    if (!confirm('Убрать этот скан из карточки? Файл останется в папке с фото.')) return;
    run('adminRemovePassportScan', [c.key, c.rows || [c.row], v], function (t) { c.passportScan = t; render(); toast('Скан убран'); });
  }
  else if (a === 'passCancel') { S.pass = null; render(); }
  else if (a === 'passSave' && c && S.pass && !S.busy) {
    var pd = S.pass, num = pd.number.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z0-9]{5,20}$/.test(num)) { toast('Номер: только латиница и цифры'); return; }
    if (!/^[A-Za-z][A-Za-z .'\-]*$/.test(pd.country.trim())) { toast('Страна латиницей'); return; }
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(pd.expiry.trim())) { toast('Выберите день, месяц и год'); return; }
    S.busy = true; render();
    run('adminSetPassport', [c.key, c.rows || [c.row], { number: num, country: pd.country.trim().toUpperCase(), expiry: pd.expiry.trim() }],
      function (text) { S.busy = false; S.pass = null; c.passport = text; render(); toast('Паспорт сохранён'); }, function () { S.busy = false; render(); });
  }
  else if ((a === 'passNone' || a === 'passClear') && c && !S.busy) {
    S.busy = true; render();
    run('adminSetPassport', [c.key, c.rows || [c.row], a === 'passNone' ? { none: true } : { clear: true }],
      function (text) { S.busy = false; c.passport = text; render(); toast(a === 'passNone' ? 'Отмечено: нет загранпаспорта' : 'Отметка снята'); }, function () { S.busy = false; render(); });
  }
  else if (a === 'unseason' && c) { S.unseason = c.key; S.del = null; render(); }
  else if (a === 'unseasonNo') { S.unseason = null; render(); }
  else if (a === 'unseasonYes' && c && !S.busy) {
    S.busy = true; render();
    run('adminRemoveFromSeason', [c.key, c.name, c.row, y], function () {
      S.busy = false; S.unseason = null; if (S.data.subs[c.key]) delete S.data.subs[c.key][y]; render(); toast(c.name + ' убран(а) из DV-' + y);
    }, function () { S.busy = false; render(); });
  }
  else if (a === 'del' && c) { S.del = c.key; S.unseason = null; render(); }
  else if (a === 'delNo') { S.del = null; render(); }
  else if (a === 'delYes' && c && !S.busy) {
    S.busy = true; render();
    run('adminDeleteClient', [c.key, c.rows || [c.row]], function (n) {
      S.busy = false; S.del = null; S.sel = null; toast(c.name + ' удалён(а) из таблицы'); load();
    }, function () { S.busy = false; render(); });
  }
  else if (a === 'next' && c) { var i = STATUSES.indexOf(sub(c, y).status); if (i < 3) saveSub(c, y, { status: STATUSES[i + 1] }, 'Статус: ' + STATUSES[i + 1]); }
  else if (a === 'result' && c) saveSub(c, y, { result: v }, v ? 'Отмечено: ' + v : 'Результат сброшен');
  else if (a === 'copy') copyText(v, el.getAttribute('data-k'));
  else if (a === 'copyAll' && c) {
    var lines = [['Фамилия и имя', c.name], ['Пол', c.sex], ['Дата рождения', c.dob], ['Место рождения', [c.birthCity, c.birthCountry].filter(Boolean).join(', ')], ['Страна проживания', c.country], ['Адрес', c.address], ['Email', c.email], ['Telegram', c.telegram], ['Образование', c.education], ['Семейное положение', c.marital]]
      .filter(function (f) { return f[1]; }).map(function (f) { return f[0] + ': ' + f[1]; });
    family(c).forEach(function (m) { lines.push(m.rel + ': ' + [m.name, m.sex, m.dob, m.place].filter(Boolean).join(', ')); });
    if (c.passport) lines.push('Загранпаспорт: ' + c.passport);
    copyText(lines.join('\n'), 'все данные');
  }
  else if (a === 'fam') { S.fam = { kind: v, name: '', sex: '', dob: '', city: '', country: '', photo: null }; render(); }
  else if (a === 'cancelMember') { S.fam = null; render(); }
  else if (a === 'edit' && c) { S.edit = { k: el.getAttribute('data-k'), v: c[el.getAttribute('data-k')] || '' }; render(); var ei = document.getElementById('ed-in'); if (ei) { ei.focus(); if (ei.setSelectionRange && ei.value) ei.setSelectionRange(ei.value.length, ei.value.length); } }
  else if (a === 'edCancel') { S.edit = null; render(); }
  else if (a === 'edSave' && c && S.edit && !S.busy) saveEdit(c);
  else if (a === 'memEdit' && c) {
    var mm = family(c).filter(function (x) { return x.kind === el.getAttribute('data-kind') && x.idx === Number(el.getAttribute('data-i')); })[0]; if (!mm) return;
    var pl = mm.place.split(',').map(function (x) { return x.trim(); });
    S.fam = { kind: mm.kind, idx: mm.idx, orig: mm.name, name: mm.name, sex: mm.sex, dob: mm.dob, city: pl[0] || '', country: pl.slice(1).join(', '), photo: null, keepPhoto: mm.photo };
    S.memDel = null; render();
  }
  else if (a === 'memDel') { S.memDel = el.getAttribute('data-kind') + el.getAttribute('data-i'); S.fam = null; render(); }
  else if (a === 'memDelNo') { S.memDel = null; render(); }
  else if (a === 'memDelYes' && c && !S.busy) {
    var kind = el.getAttribute('data-kind'), idx = Number(el.getAttribute('data-i'));
    S.busy = true; render();
    run('adminRemoveMember', [c.row, kind, idx], function (r) {
      S.busy = false; S.memDel = null;
      if (kind === 'spouse') c.spouseData = r.text; else c.kidsData = r.text;
      if (r.marital) c.marital = r.marital;
      render(); toast('Убрано из заявки');
    }, function () { S.busy = false; render(); });
  }
  else if (a === 'saveMember' && c && S.fam && S.fam.idx != null && !S.busy) {
    var dm = S.fam;
    if (!/^[A-Za-z][A-Za-z .'\-]*$/.test(dm.name.trim())) { toast('Имя латиницей, как в паспорте'); return; }
    if (dm.dob && !/^\d{2}\.\d{2}\.\d{4}$/.test(dm.dob.trim())) { toast('Дата в формате ДД.ММ.ГГГГ'); return; }
    S.busy = true; render();
    run('adminUpdateMember', [c.row, dm.kind, dm.idx, { name: dm.name, sex: dm.sex, dob: dm.dob.trim(), city: dm.city, country: dm.country, photo: dm.photo ? { mime: 'image/jpeg', data: dm.photo.split(',')[1] } : null }],
      function (text) { S.busy = false; if (dm.kind === 'spouse') c.spouseData = text; else c.kidsData = text; S.fam = null; render(); toast('Сохранено'); },
      function () { S.busy = false; render(); });
  }
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
  if (el.id === 'cropZoom' && S.crop) { var b = cropBounds(S.crop.prep); cropSetSize(S.crop, b.max * Math.pow(b.min / b.max, Number(el.value) / 1000)); cropLayout(); return; }
  if (el.id === 'q') { S.q = el.value; render(); }
  else if (el.id === 'ed-in' && S.edit) S.edit.v = el.value;
  else if (el.getAttribute('data-act') === 'passDraft' && S.pass) { var pk = el.getAttribute('data-k'), pv = el.value; if (pk !== 'expiry') { pv = pv.toUpperCase(); el.value = pv; } S.pass[pk] = pv; }
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
  else if (a === 'passScan' && c && el.files[0]) { var pf = el.files[0]; el.value = ''; passUpload(c, pf); }
  else if (a === 'passDate' && S.pass) {
    var ss = el.parentNode.querySelectorAll('select'), pdd = ss[0].value, pmm = ss[1].value, pyy = ss[2].value;
    S.pass.expiry = pdd && pmm && pyy ? ('0' + pdd).slice(-2) + '.' + ('0' + pmm).slice(-2) + '.' + pyy : '';
  }
  else if (a === 'lbReplace' && c && el.files[0] && S.lb) {
    var rf = el.files[0], rtg = aiTarget(c, S.lb.url); el.value = '';
    if (rtg && !(S.lb.ai && !S.lb.ai.done)) lbAi(c, rtg, rf);
  }
  else if (a === 'memberPhoto' && S.fam && el.files[0]) {
    var mf = el.files[0], fam = S.fam; el.value = '';
    aiPhoto(mf, fam.name || (fam.kind === 'spouse' ? 'Супруг(а)' : 'Ребёнок')).then(function (r) {
      if (S.fam !== fam) return;
      fam.photo = r.fin; fam.check = r.check; fam.raw = r.raw; render(); toast('Фото готово · ' + aiVerdict(r));
    }, function () {});
  }
  else if (a === 'photo' && c && el.files[0]) {
    var apf = el.files[0]; el.value = '';
    aiPhoto(apf, c.name).then(function (r) {
      toast('Сохраняю фото…');
      run('adminSetPhoto', [c.row, asJpeg(r.fin), r.raw ? null : { original: asJpeg(r.orig), check: r.check }], function (res) {
        c.photo = res && res.url ? res.url : res; if (res && res.photoCheck) c.photoCheck = res.photoCheck; render(); toast('Фото сохранено · ' + aiVerdict(r));
      });
    }, function () {});
  }
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && S.crop && !S.crop.busy) { S.crop = null; overlay(); return; }
  if (e.key === 'Escape' && S.lb) { S.lb = null; render(); return; }
  if (e.key === 'Escape' && S.menu) { S.menu = false; render(); }
  if (S.edit && e.target && e.target.id === 'ed-in') {
    if (e.key === 'Escape') { S.edit = null; render(); }
    else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); var c = S.sel && byKey[S.sel]; if (c && !S.busy) saveEdit(c); }
  }
});
['dragenter', 'dragover'].forEach(function (t) {
  document.addEventListener(t, function (e) { var z = e.target.closest && e.target.closest('[data-drop]'); if (!z) return; e.preventDefault(); z.classList.add('pp-over'); });
});
document.addEventListener('dragleave', function (e) { var z = e.target.closest && e.target.closest('[data-drop]'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('pp-over'); });
document.addEventListener('drop', function (e) {
  var z = e.target.closest && e.target.closest('[data-drop]'); if (!z) return;
  e.preventDefault(); z.classList.remove('pp-over');
  var c = S.sel && byKey[S.sel], f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (c && f) passUpload(c, f);
});
window.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1) e.preventDefault(); });
window.addEventListener('drop', function (e) { if (!(e.target.closest && e.target.closest('[data-drop]'))) e.preventDefault(); });
if (API && !getToken()) renderLogin(); else load();
</script>
</body></html>
`;
