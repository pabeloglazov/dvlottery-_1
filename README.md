# Beloglazov Green Card — сайт подачи заявок DV Lottery

Лендинг с анкетой участника. Ответы анкеты уходят в Google Form «Заявка на Green Card 2025-2026».

## Запуск

```sh
npm install
npm run dev
npm run build
```

## Как устроено

- `src/content.js` — все тексты (RU/EN), цены, варианты ответов.
- `src/config.js` — адрес Google Form, номера полей `entry.*`, адрес загрузки фото, Telegram.
- `src/EntryForm.jsx` — анкета из 5 шагов с проверкой полей. Отправка — POST на `formResponse`.
- `.github/workflows/pages.yml` — автодеплой на GitHub Pages при пуше в `main`.

## Требования к Google Form

Чтобы ответы с сайта принимались, форма не должна требовать входа в Google-аккаунт:

- без вопросов с загрузкой файла (фото передаётся ссылкой в текстовом вопросе);
- сбор email — «Ответ респондента» или выключен, не «Проверенные».

Если в форме поменяли вопросы, обновите номера полей в `src/config.js`.

Исходная версия страницы из ChatGPT (2025) лежит в `archive/`.
