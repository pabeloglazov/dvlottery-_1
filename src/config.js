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
  photo: "entry.707002869",          // «Фотография»: ссылка на фото в Google Диске
  address: "entry.753521122",
  country: "entry.1965056974",
  email: "entry.1861919795",
  education: "entry.381089631",
  marital: "entry.673968928",
  children: "entry.1586250352",
  telegram: "entry.775143985",
};

// Веб-приложение Google Apps Script (apps-script/Code.gs): сохраняет фото
// в Google Диск и записывает ответ в форму. Пусто — анкета уходит напрямую
// в форму, а фото клиент присылает в Telegram.
export const INTAKE_URL = "https://script.google.com/macros/s/AKfycbyP97pqQquagl_uw_c40G2gRXsAsREoSKClzGZ4jB5ogkDe0pFtFWEKDeAGBlBxq5w5Xg/exec";

export const TELEGRAM = "pabeloglazov";
