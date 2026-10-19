import { useEffect, useMemo, useRef, useState } from "react";
import { ENTRY, FORM_POST_URL, INTAKE_URL, TELEGRAM } from "./config.js";
import { MONTHS, MONTHS_GEN, OPTIONS } from "./content.js";

const MARRIED = "Женат / замужем";
const emptyPerson = () => ({ name: "", sex: "", bd: "", bm: "", by: "", birthCity: "", birthCountry: "", photo: null });

const EMPTY = {
  name: "", sex: "", bd: "", bm: "", by: "", birthCity: "", birthCountry: "",
  photoLater: false, address: "", country: "", email: "", telegram: "",
  education: "", marital: "", hasKids: "", spouse: emptyPerson(), kids: [],
  passportNone: false, pnum: "", pcountry: "", pd: "", pm: "", py: "", scan1: null, scan2: null, scanLater: false,
};

// Паспорт должен действовать на момент подачи (регистрация DV-2027 — ноябрь 2026).
const PASSPORT_MIN = new Date(2026, 11, 1);

const LATIN = /^[A-Za-z][A-Za-z .'\-]*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CAN_UPLOAD = Boolean(INTAKE_URL);

const STEP_FIELDS = [
  ["name", "sex", "birth", "birthCity", "birthCountry"],
  ["photo", "passport"],
  ["address", "country", "email", "telegram"],
  ["education", "marital", "family"],
  [],
];

function validDate(day, m, y) {
  const now = new Date().getFullYear();
  day = +day; m = +m; y = +y;
  return day >= 1 && day <= 31 && m >= 1 && m <= 12 && y >= now - 110 && y <= now && new Date(y, m - 1, day).getDate() === day;
}

function ageOn(p, date = new Date()) {
  const b = new Date(+p.by, +p.bm - 1, +p.bd);
  let a = date.getFullYear() - b.getFullYear();
  if (date.getMonth() < b.getMonth() || (date.getMonth() === b.getMonth() && date.getDate() < b.getDate())) a--;
  return a;
}

// Проверка данных человека (супруг(а) или ребёнок). Ключи ошибок: prefix + поле.
function validatePerson(p, prefix, t, isKid) {
  const e = {};
  ["name", "birthCity", "birthCountry"].forEach((k) => {
    const v = String(p[k] || "").trim();
    if (!v) e[prefix + k] = t.required; else if (!LATIN.test(v)) e[prefix + k] = t.latin;
  });
  if (!p.sex) e[prefix + "sex"] = t.required;
  if (!validDate(p.bd, p.bm, p.by)) e[prefix + "birth"] = t.date;
  else if (isKid && ageOn(p) >= 21) e[prefix + "birth"] = t.family.tooOld;
  return e;
}

function validate(f, d, t, photo) {
  const e = {};
  const req = (k) => { if (!String(d[k] ?? "").trim()) e[k] = t.required; };
  switch (f) {
    case "name": case "birthCity": case "birthCountry": case "country":
      req(f); if (!e[f] && !LATIN.test(d[f].trim())) e[f] = t.latin; break;
    case "birth":
      if (!validDate(d.bd, d.bm, d.by)) e.birth = t.date; break;
    case "photo":
      if (CAN_UPLOAD && !photo && !d.photoLater) e.photo = t.required; break;
    case "passport": {
      if (d.passportNone) break;
      const P = t.fields.passport;
      const num = d.pnum.replace(/\s+/g, "").toUpperCase();
      if (!num) e.pnum = t.required; else if (!/^[A-Z0-9]{5,20}$/.test(num)) e.pnum = P.bad;
      if (!d.pcountry.trim()) e.pcountry = t.required; else if (!LATIN.test(d.pcountry.trim())) e.pcountry = t.latin;
      const exp = new Date(+d.py, +d.pm - 1, +d.pd);
      if (!(d.pd && d.pm && d.py) || exp.getDate() !== +d.pd) e.pexp = P.expiryReq;
      else if (exp < PASSPORT_MIN) e.pexp = P.expired;
      if (CAN_UPLOAD && !d.scan1 && !d.scanLater) e.scan1 = t.required;
      break;
    }
    case "email":
      req(f); if (!e[f] && !EMAIL.test(d.email.trim())) e[f] = t.email; break;
    case "family":
      if (d.marital === MARRIED) Object.assign(e, validatePerson(d.spouse, "spouse.", t, false));
      if (!d.hasKids) e.hasKids = t.required;
      if (d.hasKids === "yes") {
        if (!d.kids.length) e.hasKids = t.family.addOne;
        d.kids.forEach((k, i) => Object.assign(e, validatePerson(k, `kid${i}.`, t, true)));
      }
      break;
    default: req(f);
  }
  return e;
}

async function prepareImage(file) {
  // Уменьшаем до 1600 px по большей стороне, чтобы загрузка была быстрой.
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  } finally { URL.revokeObjectURL(url); }
}

// Скан документа: крупнее, чем фото, чтобы читались все данные.
const isPdf = (file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

async function canvasToDoc(src, w, h) {
  const k = Math.min(1, 2200 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

// PDF → JPEG прямо в браузере (до 2 страниц): сервер и админка получают обычные картинки.
async function pdfToDocs(file, max = 2) {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let i = 1; i <= Math.min(max, pdf.numPages); i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(4, 2200 / Math.max(base.width, base.height)) });
    const c = document.createElement("canvas");
    c.width = Math.round(viewport.width); c.height = Math.round(viewport.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push(await canvasToDoc(c, c.width, c.height));
  }
  await pdf.destroy();
  if (!out.length) throw new Error("empty pdf");
  return out;
}

async function prepareDoc(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    return await canvasToDoc(img, img.naturalWidth, img.naturalHeight);
  } finally { URL.revokeObjectURL(url); }
}

const passportPayload = (d) => (d.passportNone ? { none: true } : {
  number: d.pnum.replace(/\s+/g, "").toUpperCase(), country: d.pcountry.trim().toUpperCase(),
  expiry: { d: d.pd, m: d.pm, y: d.py },
  scans: CAN_UPLOAD && !d.scanLater ? [d.scan1, d.scan2].filter(Boolean).map((x) => ({ mime: "image/jpeg", data: x.split(",")[1] })) : [],
});

const photoPayload = (dataUrl) => (dataUrl ? { mime: "image/jpeg", data: dataUrl.split(",")[1] } : null);
const personPayload = (p) => ({
  name: p.name.trim().toUpperCase(), sex: p.sex, birth: { d: p.bd, m: p.bm, y: p.by },
  birthCity: p.birthCity.trim().toUpperCase(), birthCountry: p.birthCountry.trim().toUpperCase(),
  photo: photoPayload(p.photo),
});
const childrenText = (d) => (d.hasKids === "yes" ? `Да, ${d.kids.length}` : "Нет");
const pad = (n) => String(n).padStart(2, "0");
const personLine = (p) => `${p.name.trim().toUpperCase()}, ${p.sex}, ${pad(p.bd)}.${pad(p.bm)}.${p.by}, ${p.birthCity.trim().toUpperCase()}, ${p.birthCountry.trim().toUpperCase()}`;

// Отправка через скрипт: фото + ответ в форму одним запросом, с подтверждением.
async function sendToScript(d, photo) {
  const married = d.marital === MARRIED;
  const res = await fetch(INTAKE_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      name: d.name, sex: d.sex, birthCity: d.birthCity, birthCountry: d.birthCountry,
      address: d.address, country: d.country, email: d.email, telegram: d.telegram,
      education: d.education, marital: d.marital, children: childrenText(d),
      birth: { d: d.bd, m: d.bm, y: d.by },
      photo: photoPayload(photo),
      spouse: married ? personPayload(d.spouse) : null,
      kids: d.hasKids === "yes" ? d.kids.map(personPayload) : [],
      passport: passportPayload(d),
      website: "",
    }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "intake failed");
  return json;
}

// Запасной путь: прямой POST в Google Form (ответ непрозрачный, без фото).
async function sendToForm(d) {
  const family = [
    childrenText(d),
    d.marital === MARRIED ? "Супруг(а): " + personLine(d.spouse) : "",
    ...(d.hasKids === "yes" ? d.kids.map((k, i) => `Ребёнок ${i + 1}: ` + personLine(k)) : []),
    d.passportNone ? "Загранпаспорт: НЕТ" : `Загранпаспорт: ${d.pnum.replace(/\s+/g, "").toUpperCase()}, ${d.pcountry.trim().toUpperCase()}, до ${pad(d.pd)}.${pad(d.pm)}.${d.py} (скан пришлёт в Telegram)`,
  ].filter(Boolean).join(" | ");
  const body = new URLSearchParams();
  body.append(ENTRY.name, d.name.trim().toUpperCase());
  body.append(ENTRY.sex, d.sex);
  body.append(ENTRY.birth + "_year", d.by);
  body.append(ENTRY.birth + "_month", d.bm);
  body.append(ENTRY.birth + "_day", d.bd);
  body.append(ENTRY.birthCity, d.birthCity.trim().toUpperCase());
  body.append(ENTRY.birthCountry, d.birthCountry.trim().toUpperCase());
  body.append(ENTRY.photo, "Пришлёт фото в Telegram");
  body.append(ENTRY.address, d.address.trim());
  body.append(ENTRY.country, d.country.trim().toUpperCase());
  body.append(ENTRY.email, d.email.trim());
  body.append(ENTRY.education, d.education);
  body.append(ENTRY.marital, d.marital);
  body.append(ENTRY.children, family);
  body.append(ENTRY.telegram, d.telegram.trim());
  await fetch(FORM_POST_URL, { method: "POST", mode: "no-cors", body });
}

function Field({ id, label, hint, error, children }) {
  return (
    <div className={"field" + (error ? " has-error" : "")}>
      <label htmlFor={id} className="field-label">{label}</label>
      {hint && <p className="field-hint" id={id + "-hint"}>{hint}</p>}
      {children}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

function Choice({ name, options, value, onChange, lang, columns }) {
  return (
    <div className={"choices" + (columns ? " choices-" + columns : "")} role="radiogroup">
      {options.map((o) => (
        <label key={o.value} className={"choice" + (value === o.value ? " is-on" : "")}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>{o[lang]}</span>
        </label>
      ))}
    </div>
  );
}

const daysIn = (m, y) => (m ? new Date(+y || 2000, +m, 0).getDate() : 31);

function DateInput({ id, p, onChange, lang, f, keys = ["bd", "bm", "by"], future = false }) {
  const [kd, km, ky] = keys;
  const now = new Date().getFullYear();
  const years = [];
  if (future) for (let y = now; y <= now + 15; y++) years.push(y);
  else for (let y = now; y >= now - 100; y--) years.push(y);
  const days = Array.from({ length: daysIn(p[km], p[ky]) }, (_, i) => i + 1);
  // Если выбранного дня нет в новом месяце (31 апреля, 29 февраля не в високосный) — сбрасываем день.
  const change = (k) => (e) => {
    const v = e.target.value;
    onChange(k, v);
    const m = k === km ? v : p[km], y = k === ky ? v : p[ky];
    if (k !== kd && p[kd] && +p[kd] > daysIn(m, y)) onChange(kd, "");
  };
  return (
    <div className="date-row">
      <select id={id} aria-label={f.birth.d} value={p[kd]} onChange={change(kd)}>
        <option value="">{f.birth.d}</option>
        {days.map((d) => <option key={d} value={String(d)}>{d}</option>)}
      </select>
      <select aria-label={f.birth.m} value={p[km]} onChange={change(km)}>
        <option value="">{f.birth.m}</option>
        {MONTHS[lang].map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
      </select>
      <select aria-label={f.birth.y} value={p[ky]} onChange={change(ky)}>
        <option value="">{f.birth.y}</option>
        {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
      </select>
    </div>
  );
}

// Поле для фото: клик по полю или перетаскивание файла — выбор, крестик — удалить.
function PhotoBox({ photo, onFile, onRemove, size, t, inputId, accept = "image/*,.heic,.heif", dropText }) {
  const [over, setOver] = useState(false);
  const pick = (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) onFile(file); };
  return (
    <div className="pbox" style={{ width: size, height: size }}>
      <label
        className={"pbox-drop" + (photo ? " has-photo" : "") + (over ? " is-over" : "")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const file = e.dataTransfer.files?.[0]; if (file) onFile(file); }}
      >
        <input id={inputId} type="file" accept={accept} onChange={pick} />
        {photo ? <img src={photo} alt="" /> : (
          <span className="pbox-empty">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {size >= 120 && <span>{dropText || t.fields.photo.drop}</span>}
          </span>
        )}
      </label>
      {photo && <button type="button" className="pbox-x" aria-label={t.fields.photo.remove} onClick={onRemove}>×</button>}
    </div>
  );
}

// Блок данных другого человека: супруг(а) или ребёнок.
function PersonFields({ prefix, p, onChange, errors, t, lang, onPhotoError }) {
  const f = t.fields, fm = t.family;
  const id = (k) => prefix.replace(/\W/g, "") + "-" + k;
  const err = (k) => errors[prefix + k];
  const onFile = async (file) => {
    try { onChange("photo", await prepareImage(file)); } catch { onPhotoError(t.photoType); }
  };

  return (
    <div className="person-fields">
      <Field id={id("name")} label={f.name.l} hint={f.name.h} error={err("name")}>
        <input id={id("name")} value={p.name} onChange={(e) => onChange("name", e.target.value.toUpperCase())} placeholder={fm.namePh} />
      </Field>
      <Field id={id("sex")} label={f.sex.l} error={err("sex")}>
        <Choice name={id("sex")} options={OPTIONS.sex} value={p.sex} onChange={(v) => onChange("sex", v)} lang={lang} columns={2} />
      </Field>
      <Field id={id("bd")} label={f.birth.l} error={err("birth")}>
        <DateInput id={id("bd")} p={p} onChange={onChange} lang={lang} f={f} />
      </Field>
      <div className="two-col">
        <Field id={id("city")} label={f.birthCity.l} error={err("birthCity")}>
          <input id={id("city")} value={p.birthCity} onChange={(e) => onChange("birthCity", e.target.value.toUpperCase())} placeholder={f.birthCity.p} />
        </Field>
        <Field id={id("country")} label={f.birthCountry.l} error={err("birthCountry")}>
          <input id={id("country")} value={p.birthCountry} onChange={(e) => onChange("birthCountry", e.target.value.toUpperCase())} placeholder={f.birthCountry.p} />
        </Field>
      </div>
      <div className="field">
        <span className="field-label">{fm.photo}</span>
        <div className="mini-photo">
          <PhotoBox photo={p.photo} onFile={onFile} onRemove={() => onChange("photo", null)} size={88} t={t} inputId={id("photo")} />
          <div>
            {CAN_UPLOAD && (
              <label className="btn btn-ghost file-btn">
                <input type="file" accept="image/*,.heic,.heif" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) onFile(file); }} />
                {p.photo ? fm.photoChange : fm.photoPick}
              </label>
            )}
            <p className="field-hint">{fm.photoLater}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EntryForm({ lang, t }) {
  const [step, setStep] = useState(0);
  const [d, setD] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [photo, setPhoto] = useState(null);        // dataURL фото заявителя
  const [state, setState] = useState("idle");      // idle | sending | done | error
  const [errMsg, setErrMsg] = useState("");
  const [scanBusy, setScanBusy] = useState("");    // какой скан сейчас читается (PDF)
  const [missingPhotos, setMissingPhotos] = useState([]);
  const [last, setLast] = useState(null);          // что отправили — для подсказок после отправки
  const [lastPhoto, setLastPhoto] = useState(null);
  const [sibling, setSibling] = useState("");      // "" | "yes" | "no"
  const [copied, setCopied] = useState(false);
  const [passportNote, setPassportNote] = useState("");
  const top = useRef(null);
  const f = t.fields, fm = t.family;

  const clearErr = (...keys) => setErrors((p) => { const n = { ...p }; keys.forEach((k) => delete n[k]); return n; });
  const set = (k) => (v) => {
    const val = typeof v === "object" && v?.target ? v.target.value : v;
    setD((p) => ({ ...p, [k]: val }));
    clearErr(k, ...(["bd", "bm", "by"].includes(k) ? ["birth"] : []), ...(["pd", "pm", "py"].includes(k) ? ["pexp"] : []));
  };
  const upper = (k) => (e) => set(k)(e.target.value.toUpperCase());

  const setSpouse = (k, v) => {
    setD((p) => ({ ...p, spouse: { ...p.spouse, [k]: v } }));
    clearErr("spouse." + k, ...(["bd", "bm", "by"].includes(k) ? ["spouse.birth"] : []));
  };
  const setKid = (i) => (k, v) => {
    setD((p) => ({ ...p, kids: p.kids.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
    clearErr(`kid${i}.` + k, ...(["bd", "bm", "by"].includes(k) ? [`kid${i}.birth`] : []));
  };
  const addKid = () => { setD((p) => ({ ...p, kids: [...p.kids, emptyPerson()] })); clearErr("hasKids"); };
  const removeKid = (i) => { setD((p) => ({ ...p, kids: p.kids.filter((_, j) => j !== i) })); setErrors({}); };
  const setHasKids = (v) => {
    setD((p) => ({ ...p, hasKids: v, kids: v === "yes" && !p.kids.length ? [emptyPerson()] : p.kids }));
    clearErr("hasKids");
  };

  useEffect(() => { setErrors({}); }, [lang]);

  const scrollTop = () => top.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });

  const checkStep = (s) => {
    const e = Object.assign({}, ...STEP_FIELDS[s].map((k) => validate(k, d, t, photo)));
    setErrors(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => {
        const el = document.querySelector(".has-error input, .has-error textarea, .has-error select");
        el?.focus(); el?.scrollIntoView({ block: "center" });
      });
      return false;
    }
    return true;
  };

  const next = () => {
    if (!checkStep(step)) return;
    if (step === 0 && !d.pcountry) setD((p) => ({ ...p, pcountry: p.birthCountry.trim().toUpperCase() }));
    setStep(step + 1); scrollTop();
  };
  const back = () => { setErrors({}); setStep(step - 1); scrollTop(); };

  const onPhotoFile = async (file) => {
    if (!/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) { setErrors({ photo: t.photoType }); return; }
    try {
      setPhoto(await prepareImage(file));
      setD((p) => ({ ...p, photoLater: false }));
      setErrors({});
    } catch { setErrors({ photo: t.photoType }); }
  };

  const onScan = (k) => async (file) => {
    const pdf = isPdf(file);
    if (!pdf && !/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) { setErrors((e) => ({ ...e, [k]: t.scanType })); return; }
    setScanBusy(k);
    try {
      const pages = pdf ? await pdfToDocs(file) : [await prepareDoc(file)];
      setD((p) => {
        const n = { ...p, [k]: pages[0], scanLater: k === "scan1" ? false : p.scanLater };
        if (k === "scan1" && pages[1] && !p.scan2) n.scan2 = pages[1];
        return n;
      });
      clearErr(k);
    } catch { setErrors((e) => ({ ...e, [k]: pdf ? t.scanPdf : t.scanType })); }
    finally { setScanBusy(""); }
  };

  const submit = async () => {
    setState("sending"); setErrMsg("");
    const married = d.marital === MARRIED;
    const kids = d.hasKids === "yes" ? d.kids : [];
    const ownPhoto = CAN_UPLOAD && photo && !d.photoLater ? photo : null;
    try {
      let viaScript = false;
      if (INTAKE_URL) {
        try { await sendToScript(d, ownPhoto); viaScript = true; } catch { await sendToForm(d); }
      } else {
        await sendToForm(d);
      }
      // Чьих фото не хватает — напомним прислать в Telegram.
      const miss = [];
      if (!viaScript || !ownPhoto) miss.push(d.name.trim().toUpperCase());
      if (married && (!viaScript || !d.spouse.photo)) miss.push(d.spouse.name.trim().toUpperCase());
      kids.forEach((k) => { if (!viaScript || !k.photo) miss.push(k.name.trim().toUpperCase()); });
      setMissingPhotos(miss);
      setPassportNote(d.passportNone ? "none" : (!viaScript || d.scanLater || !d.scan1) ? "scan" : "");
      setLast(d); setLastPhoto(ownPhoto);
      setSibling(""); setCopied(false);
      setState("done");
      scrollTop();
    } catch {
      setState("error"); setErrMsg(t.error);
    }
  };

  const restart = (prefill = {}, newPhoto = null) => {
    setD({ ...EMPTY, spouse: emptyPerson(), kids: [], ...prefill }); setPhoto(newPhoto); setStep(0); setState("idle"); setErrors({}); scrollTop();
  };
  // Анкета на супруга(у): его/её данные становятся основными, а заявитель — супругом. Дети и контакты переносятся.
  const restartForSpouse = () => {
    const l = last, s = l.spouse;
    restart({
      name: s.name, sex: s.sex, bd: s.bd, bm: s.bm, by: s.by, birthCity: s.birthCity, birthCountry: s.birthCountry,
      address: l.address, country: l.country, telegram: l.telegram, marital: l.marital, hasKids: l.hasKids,
      kids: l.kids.map((k) => ({ ...k })),
      spouse: { name: l.name, sex: l.sex, bd: l.bd, bm: l.bm, by: l.by, birthCity: l.birthCity, birthCountry: l.birthCountry, photo: lastPhoto },
    }, s.photo);
  };

  const siteUrl = typeof window !== "undefined" ? window.location.href.split("#")[0] : "";
  const shareText = t.share.text;
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(siteUrl); setCopied(true); } catch { setCopied(false); }
  };

  const label = (list, v) => list.find((o) => o.value === v)?.[lang] || v;
  const dateText = (p) => (p.bd && p.bm && p.by ? `${p.bd} ${MONTHS_GEN[lang][+p.bm - 1]} ${p.by}` : "");
  const personSummary = (p) => [p.name.toUpperCase(), label(OPTIONS.sex, p.sex), dateText(p), [p.birthCity, p.birthCountry].filter(Boolean).join(", ").toUpperCase(), p.photo ? fm.photoYes : fm.photoNo].filter(Boolean).join("\n");
  const review = useMemo(() => [
    { s: 0, k: f.name.l, v: d.name.toUpperCase() },
    { s: 0, k: f.sex.l, v: label(OPTIONS.sex, d.sex) },
    { s: 0, k: f.birth.l, v: dateText(d) },
    { s: 0, k: f.birthCity.l, v: d.birthCity.toUpperCase() },
    { s: 0, k: f.birthCountry.l, v: d.birthCountry.toUpperCase() },
    { s: 1, k: f.photo.l, v: photo && !d.photoLater ? "✓" : f.photo.later },
    ...(d.passportNone ? [{ s: 1, k: f.passport.title, v: f.passport.noneShort }] : [
      { s: 1, k: f.passport.number, v: d.pnum.replace(/\s+/g, "").toUpperCase() },
      { s: 1, k: f.passport.country, v: d.pcountry.toUpperCase() },
      { s: 1, k: f.passport.expiry, v: d.pd && d.pm && d.py ? `${d.pd} ${MONTHS_GEN[lang][+d.pm - 1]} ${d.py}` : "" },
      { s: 1, k: f.passport.scan, v: d.scan1 && !d.scanLater ? f.passport.scanYes + (d.scan2 ? " (2)" : "") : f.passport.scanNo },
    ]),
    { s: 2, k: f.address.l, v: d.address },
    { s: 2, k: f.country.l, v: d.country.toUpperCase() },
    { s: 2, k: f.email.l, v: d.email },
    { s: 2, k: f.telegram.l, v: d.telegram },
    { s: 3, k: f.education.l, v: label(OPTIONS.education, d.education) },
    { s: 3, k: f.marital.l, v: label(OPTIONS.marital, d.marital) },
    ...(d.marital === MARRIED ? [{ s: 3, k: fm.spouseShort, v: personSummary(d.spouse) }] : []),
    ...(d.hasKids === "yes" ? d.kids.map((k, i) => ({ s: 3, k: fm.kid(i + 1), v: personSummary(k) })) : [{ s: 3, k: fm.kidsShort, v: d.hasKids === "no" ? fm.no : "" }]),
  ], [d, photo, lang, t]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === "done") {
    const married = last?.marital === MARRIED;
    return (
      <div className="form-card done-card" ref={top} tabIndex={-1}>
        <div className="done">
          <div className="done-mark" aria-hidden="true">✓</div>
          <h3>{t.done.t}</h3>
          <p>{t.done.d}</p>
          {missingPhotos.length > 0 && <p className="done-photo">{t.done.photo} {missingPhotos.length > 1 ? "(" + missingPhotos.join(", ") + ")" : ""}</p>}
          {passportNote === "scan" && <p className="done-photo">{t.done.passport}</p>}
          {passportNote === "none" && <p className="done-photo">{t.done.noPassport}</p>}
          <div className="done-actions">
            <a className="btn btn-primary" href={`https://t.me/${TELEGRAM}`} target="_blank" rel="noopener">{t.done.tg}</a>
          </div>
        </div>

        {married && (
          <section className="next-card next-spouse">
            <h4>{t.spouse.title}</h4>
            <p>{t.spouse.text}</p>
            <button type="button" className="btn btn-primary" onClick={restartForSpouse}>{t.spouse.cta}</button>
          </section>
        )}

        <section className="next-card">
          <h4>{t.share.q}</h4>
          {sibling === "" && (
            <div className="yesno">
              <button type="button" className="btn btn-ghost" onClick={() => setSibling("yes")}>{t.share.yes}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setSibling("no")}>{t.share.no}</button>
            </div>
          )}
          {sibling === "yes" && (
            <>
              <p>{t.share.text2}</p>
              <div className="share-row">
                <a className="btn btn-ghost" href={`https://t.me/share/url?url=${encodeURIComponent(siteUrl)}&text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener">Telegram</a>
                <a className="btn btn-ghost" href={`https://wa.me/?text=${encodeURIComponent(shareText + " " + siteUrl)}`} target="_blank" rel="noopener">WhatsApp</a>
                <button type="button" className="btn btn-ghost" onClick={copyLink}>{copied ? t.share.copied : t.share.copy}</button>
              </div>
            </>
          )}
          {sibling === "no" && <p className="muted">{t.share.other}</p>}
        </section>

        <div className="done-more">
          <button type="button" className="link" onClick={() => restart()}>{t.done.again}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="form-card" ref={top}>
      <ol className="progress" aria-label="progress">
        {t.steps.map((s, i) => (
          <li key={s} className={i === step ? "is-now" : i < step ? "is-done" : ""} aria-current={i === step ? "step" : undefined}>
            <span className="progress-num">{i + 1}</span><span className="progress-name">{s}</span>
          </li>
        ))}
      </ol>
      <p className="progress-caption">{step + 1} / 5 · {t.steps[step]}</p>

      <form noValidate onSubmit={(e) => { e.preventDefault(); step < 4 ? next() : submit(); }}>
        {step === 0 && (
          <div className="fields">
            <Field id="name" label={f.name.l} hint={f.name.h} error={errors.name}>
              <input id="name" autoComplete="name" value={d.name} onChange={upper("name")} placeholder={f.name.p} aria-describedby="name-hint" />
            </Field>
            <Field id="sex" label={f.sex.l} error={errors.sex}>
              <Choice name="sex" options={OPTIONS.sex} value={d.sex} onChange={set("sex")} lang={lang} columns={2} />
            </Field>
            <Field id="bd" label={f.birth.l} error={errors.birth}>
              <DateInput id="bd" p={d} onChange={(k, v) => set(k)(v)} lang={lang} f={f} />
            </Field>
            <Field id="birthCity" label={f.birthCity.l} hint={f.birthCity.h} error={errors.birthCity}>
              <input id="birthCity" value={d.birthCity} onChange={upper("birthCity")} placeholder={f.birthCity.p} />
            </Field>
            <Field id="birthCountry" label={f.birthCountry.l} hint={f.birthCountry.h} error={errors.birthCountry}>
              <input id="birthCountry" value={d.birthCountry} onChange={upper("birthCountry")} placeholder={f.birthCountry.p} />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="fields">
            <Field id="photo" label={f.photo.l} hint={f.photo.h} error={errors.photo || (state === "error" ? errMsg : "")}>
              <div className="photo-zone">
                {CAN_UPLOAD
                  ? <PhotoBox photo={photo && !d.photoLater ? photo : null} onFile={onPhotoFile} onRemove={() => setPhoto(null)} size={160} t={t} inputId="photo" />
                  : <div className="photo-frame" />}
                <div className="photo-actions">
                  {CAN_UPLOAD && (
                    <label className="btn btn-primary file-btn">
                      <input type="file" accept="image/*,.heic,.heif" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) onPhotoFile(file); }} />
                      {photo && !d.photoLater ? f.photo.change : f.photo.pick}
                    </label>
                  )}
                  <label className="check">
                    <input type="checkbox" checked={!CAN_UPLOAD || d.photoLater} disabled={!CAN_UPLOAD} onChange={(e) => { set("photoLater")(e.target.checked); setErrors({}); }} />
                    <span>{f.photo.later}</span>
                  </label>
                  {(!CAN_UPLOAD || d.photoLater) && <p className="field-hint">{f.photo.laterNote}</p>}
                </div>
              </div>
            </Field>

            <section className="sub-block passport-block">
              <h4>{f.passport.title}</h4>
              <p className="sub-hint">{f.passport.h}</p>
              <label className="check">
                <input type="checkbox" checked={d.passportNone} onChange={(e) => { set("passportNone")(e.target.checked); setErrors({}); }} />
                <span>{f.passport.none}</span>
              </label>
              {d.passportNone ? <p className="note">{f.passport.noneNote}</p> : (
                <>
                  <div className="two-col">
                    <Field id="pnum" label={f.passport.number} hint={f.passport.numberH} error={errors.pnum}>
                      <input id="pnum" value={d.pnum} onChange={(e) => set("pnum")(e.target.value.toUpperCase().replace(/\s+/g, ""))} placeholder={f.passport.numberP} autoComplete="off" />
                    </Field>
                    <Field id="pcountry" label={f.passport.country} error={errors.pcountry}>
                      <input id="pcountry" value={d.pcountry} onChange={upper("pcountry")} placeholder={f.passport.countryP} />
                    </Field>
                  </div>
                  <Field id="pd" label={f.passport.expiry} error={errors.pexp}>
                    <DateInput id="pd" p={d} onChange={(k, v) => set(k)(v)} lang={lang} f={f} keys={["pd", "pm", "py"]} future />
                  </Field>
                  {CAN_UPLOAD && (
                    <div className="scan-row">
                      {[["scan1", f.passport.scan, f.passport.scanH], ["scan2", f.passport.scan2, f.passport.scan2H]].map(([k, l, h]) => (
                        <Field key={k} id={k} label={l} hint={h} error={errors[k]}>
                          <div className="scan-box">
                            <PhotoBox photo={d[k] && !(k === "scan1" && d.scanLater) ? d[k] : null} onFile={onScan(k)} onRemove={() => set(k)(null)} size={120} t={t} inputId={k} accept="image/*,.heic,.heif,application/pdf,.pdf" dropText={scanBusy === k ? f.passport.reading : f.passport.drop} />
                          </div>
                        </Field>
                      ))}
                    </div>
                  )}
                  {CAN_UPLOAD && (
                    <label className="check">
                      <input type="checkbox" checked={d.scanLater} onChange={(e) => { set("scanLater")(e.target.checked); clearErr("scan1"); }} />
                      <span>{f.passport.scanLater}</span>
                    </label>
                  )}
                </>
              )}
            </section>
          </div>
        )}

        {step === 2 && (
          <div className="fields">
            <Field id="address" label={f.address.l} hint={f.address.h} error={errors.address}>
              <textarea id="address" rows={2} autoComplete="street-address" value={d.address} onChange={set("address")} placeholder={f.address.p} />
            </Field>
            <Field id="country" label={f.country.l} hint={t.latin} error={errors.country}>
              <input id="country" value={d.country} onChange={upper("country")} placeholder={f.country.p} />
            </Field>
            <Field id="email" label={f.email.l} hint={f.email.h} error={errors.email}>
              <input id="email" type="email" autoComplete="email" inputMode="email" value={d.email} onChange={set("email")} placeholder={f.email.p} />
            </Field>
            <Field id="telegram" label={f.telegram.l} hint={f.telegram.h} error={errors.telegram}>
              <input id="telegram" value={d.telegram} onChange={set("telegram")} placeholder={f.telegram.p} />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="fields">
            <Field id="education" label={f.education.l} hint={f.education.h} error={errors.education}>
              <Choice name="education" options={OPTIONS.education} value={d.education} onChange={set("education")} lang={lang} />
            </Field>
            <Field id="marital" label={f.marital.l} error={errors.marital}>
              <Choice name="marital" options={OPTIONS.marital} value={d.marital} onChange={set("marital")} lang={lang} columns={2} />
            </Field>

            {d.marital === MARRIED && (
              <section className="sub-block">
                <h4>{fm.spouseTitle}</h4>
                <p className="sub-hint">{fm.spouseHint}</p>
                <p className="note">{t.spouse.hint}</p>
                <PersonFields prefix="spouse." p={d.spouse} onChange={setSpouse} errors={errors} t={t} lang={lang} onPhotoError={(m) => setErrors((e) => ({ ...e, "spouse.photo": m }))} />
              </section>
            )}

            <Field id="hasKids" label={fm.kidsQ} hint={fm.kidsHint} error={errors.hasKids}>
              <Choice name="hasKids" options={[{ value: "yes", ru: fm.yes, en: fm.yes }, { value: "no", ru: fm.no, en: fm.no }]} value={d.hasKids} onChange={setHasKids} lang={lang} columns={2} />
            </Field>

            {d.hasKids === "yes" && (
              <>
                {d.kids.map((k, i) => (
                  <section className="sub-block" key={i}>
                    <header className="sub-head">
                      <h4>{fm.kid(i + 1)}</h4>
                      {d.kids.length > 1 && <button type="button" className="link" onClick={() => removeKid(i)}>{fm.remove}</button>}
                    </header>
                    <PersonFields prefix={`kid${i}.`} p={k} onChange={setKid(i)} errors={errors} t={t} lang={lang} onPhotoError={(m) => setErrors((e) => ({ ...e, [`kid${i}.photo`]: m }))} />
                  </section>
                ))}
                <button type="button" className="btn btn-ghost add-kid" onClick={addKid}>+ {fm.add}</button>
              </>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="review">
            <p className="review-lead">{t.review}</p>
            {[0, 1, 2, 3].map((s) => (
              <section key={s} className="review-group">
                <header>
                  <h4>{t.steps[s]}</h4>
                  <button type="button" className="link" onClick={() => { setStep(s); scrollTop(); }}>{t.edit}</button>
                </header>
                <dl>
                  {review.filter((r) => r.s === s).map((r) => (
                    <div key={r.k}><dt>{r.k}</dt><dd>{r.v}</dd></div>
                  ))}
                </dl>
              </section>
            ))}
            <p className="consent">{t.consent}</p>
            {state === "error" && <p className="field-error" role="alert">{errMsg}</p>}
          </div>
        )}

        <div className="form-nav">
          {step > 0 ? <button type="button" className="btn btn-ghost" onClick={back}>{t.back}</button> : <span />}
          <button type="submit" className="btn btn-primary" disabled={state === "sending"}>
            {step < 4 ? t.next : state === "sending" ? t.sending : t.submit}
          </button>
        </div>
      </form>
    </div>
  );
}
