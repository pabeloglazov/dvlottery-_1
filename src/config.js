// Куда уходят ответы анкеты: та же Google Form, что и раньше.
export const FORM_ID = "1FAIpQLScPpb6xumWrPSjkPOVaVp6a2oIM6T7PcWi5z4SpKBPvWQMfPg";
export const FORM_POST_URL = `https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`;

// Номера полей (entry.*) в Google Form.
export const ENTRY = {
  name: "entry.949518608",
  sex: "entry.900024334",            // "М" | "Ж"
  birth: "entry.320684059",          // дата: _year / _month / _day
  birthCity: "entry.631570402",
  birthCountry: "entry.701730261",
  photo: "entry.1865791328",         // в форме: ссылка на фото (текстовый вопрос)
  address: "entry.753521122",
  country: "entry.1965056974",
  email: "entry.1861919795",
  education: "entry.381089631",
  marital: "entry.673968928",
  children: "entry.1586250352",
  telegram: "entry.775143985",
};

// Если в форме включён сбор email «по ответу респондента», передаём его отдельно.
export const SEND_EMAIL_ADDRESS = true;

// Веб-приложение Google Apps Script, которое сохраняет фото в Google Drive
// и возвращает ссылку. Пусто — фото не загружается, клиент отправляет его в Telegram.
export const PHOTO_UPLOAD_URL = "";

export const TELEGRAM = "pabeloglazov";
