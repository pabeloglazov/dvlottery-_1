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
  shadows: 'тени на лице', blurry: 'размыто', dark: 'темно / пересвет', hair_covers_face: 'волосы закрывают лицо', multiple_people: 'несколько людей', no_face: 'лицо не видно', cut_off: 'голова обрезана' };

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

