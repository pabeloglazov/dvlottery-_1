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
    if (d.action) return json_(api_(d)); // админка на сайте
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

