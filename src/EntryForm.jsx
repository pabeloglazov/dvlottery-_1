import { useEffect, useMemo, useRef, useState } from "react";
import { ENTRY, FORM_POST_URL, PHOTO_UPLOAD_URL, SEND_EMAIL_ADDRESS, TELEGRAM } from "./config.js";
import { MONTHS, MONTHS_GEN, OPTIONS } from "./content.js";

const EMPTY = {
  name: "", sex: "", bd: "", bm: "", by: "", birthCity: "", birthCountry: "",
  photoLater: false, address: "", country: "", email: "", telegram: "",
  education: "", marital: "", children: "",
};

const LATIN = /^[A-Za-z][A-Za-z .'\-]*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CAN_UPLOAD = Boolean(PHOTO_UPLOAD_URL);

// Какие поля на каком шаге
const STEP_FIELDS = [
  ["name", "sex", "birth", "birthCity", "birthCountry"],
  ["photo"],
  ["address", "country", "email", "telegram"],
  ["education", "marital", "children"],
  [],
];

function validate(f, d, t, photo) {
  const e = {};
  const req = (k) => { if (!String(d[k] ?? "").trim()) e[k] = t.required; };
  switch (f) {
    case "name": case "birthCity": case "birthCountry":
      req(f); if (!e[f] && !LATIN.test(d[f].trim())) e[f] = t.latin; break;
    case "country":
      req(f); if (!e[f] && !LATIN.test(d[f].trim())) e[f] = t.latin; break;
    case "birth": {
      const day = +d.bd, m = +d.bm, y = +d.by, now = new Date().getFullYear();
      const ok = day >= 1 && day <= 31 && m >= 1 && m <= 12 && y >= now - 110 && y <= now
        && new Date(y, m - 1, day).getDate() === day;
      if (!ok) e.birth = t.date; break;
    }
    case "photo":
      if (CAN_UPLOAD && !photo && !d.photoLater) e.photo = t.required; break;
    case "email":
      req(f); if (!e[f] && !EMAIL.test(d.email.trim())) e[f] = t.email; break;
    default: req(f);
  }
  return e;
}

async function prepareImage(file) {
  // Уменьшаем до 2000 px по большей стороне, чтобы загрузка была быстрой.
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.92);
  } finally { URL.revokeObjectURL(url); }
}

async function uploadPhoto(dataUrl, name) {
  const res = await fetch(PHOTO_UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ name, mime: "image/jpeg", data: dataUrl.split(",")[1] }),
  });
  const json = await res.json();
  if (!json.url) throw new Error(json.error || "upload failed");
  return json.url;
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

export default function EntryForm({ lang, t }) {
  const [step, setStep] = useState(0);
  const [d, setD] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [photo, setPhoto] = useState(null);        // dataURL
  const [state, setState] = useState("idle");      // idle | sending | done | error
  const [errMsg, setErrMsg] = useState("");
  const [sentPhotoLater, setSentPhotoLater] = useState(false);
  const top = useRef(null);
  const f = t.fields;

  const set = (k) => (v) => {
    const val = typeof v === "object" && v?.target ? v.target.value : v;
    setD((p) => ({ ...p, [k]: val }));
    setErrors((p) => { const n = { ...p }; delete n[k]; if (["bd", "bm", "by"].includes(k)) delete n.birth; return n; });
  };
  const upper = (k) => (e) => set(k)(e.target.value.toUpperCase());

  useEffect(() => { setErrors({}); }, [lang]);

  const scrollTop = () => top.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });

  const checkStep = (s) => {
    const e = Object.assign({}, ...STEP_FIELDS[s].map((k) => validate(k, d, t, photo)));
    setErrors(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => document.querySelector(".has-error input, .has-error textarea, .has-error select")?.focus());
      return false;
    }
    return true;
  };

  const next = () => { if (checkStep(step)) { setStep(step + 1); scrollTop(); } };
  const back = () => { setErrors({}); setStep(step - 1); scrollTop(); };

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) { setErrors({ photo: t.photoType }); return; }
    try {
      setPhoto(await prepareImage(file));
      setD((p) => ({ ...p, photoLater: false }));
      setErrors({});
    } catch { setErrors({ photo: t.photoType }); }
  };

  const submit = async () => {
    setState("sending"); setErrMsg("");
    try {
      let photoValue = "Пришлёт фото в Telegram";
      if (CAN_UPLOAD && photo && !d.photoLater) {
        try { photoValue = await uploadPhoto(photo, d.name.trim().toUpperCase()); }
        catch { setState("error"); setErrMsg(t.photoError); setStep(1); return; }
      }
      const body = new URLSearchParams();
      body.append(ENTRY.name, d.name.trim().toUpperCase());
      body.append(ENTRY.sex, d.sex);
      body.append(ENTRY.birth + "_year", d.by);
      body.append(ENTRY.birth + "_month", d.bm);
      body.append(ENTRY.birth + "_day", d.bd);
      body.append(ENTRY.birthCity, d.birthCity.trim().toUpperCase());
      body.append(ENTRY.birthCountry, d.birthCountry.trim().toUpperCase());
      body.append(ENTRY.photo, photoValue);
      body.append(ENTRY.address, d.address.trim());
      body.append(ENTRY.country, d.country.trim().toUpperCase());
      body.append(ENTRY.email, d.email.trim());
      if (SEND_EMAIL_ADDRESS) body.append("emailAddress", d.email.trim());
      body.append(ENTRY.education, d.education);
      body.append(ENTRY.marital, d.marital);
      body.append(ENTRY.children, d.children.trim());
      body.append(ENTRY.telegram, d.telegram.trim());
      // Google Forms не отдаёт CORS-заголовки, поэтому ответ непрозрачный: успехом считаем то, что запрос ушёл.
      await fetch(FORM_POST_URL, { method: "POST", mode: "no-cors", body });
      setSentPhotoLater(!(CAN_UPLOAD && photo && !d.photoLater));
      setState("done");
      scrollTop();
    } catch {
      setState("error"); setErrMsg(t.error);
    }
  };

  const restart = () => { setD(EMPTY); setPhoto(null); setStep(0); setState("idle"); setErrors({}); scrollTop(); };

  const label = (list, v) => list.find((o) => o.value === v)?.[lang] || v;
  const review = useMemo(() => [
    { s: 0, k: f.name.l, v: d.name.toUpperCase() },
    { s: 0, k: f.sex.l, v: label(OPTIONS.sex, d.sex) },
    { s: 0, k: f.birth.l, v: d.bd && d.bm && d.by ? `${d.bd} ${MONTHS_GEN[lang][+d.bm - 1]} ${d.by}` : "" },
    { s: 0, k: f.birthCity.l, v: d.birthCity.toUpperCase() },
    { s: 0, k: f.birthCountry.l, v: d.birthCountry.toUpperCase() },
    { s: 1, k: f.photo.l, v: photo && !d.photoLater ? "✓" : f.photo.later },
    { s: 2, k: f.address.l, v: d.address },
    { s: 2, k: f.country.l, v: d.country.toUpperCase() },
    { s: 2, k: f.email.l, v: d.email },
    { s: 2, k: f.telegram.l, v: d.telegram },
    { s: 3, k: f.education.l, v: label(OPTIONS.education, d.education) },
    { s: 3, k: f.marital.l, v: label(OPTIONS.marital, d.marital) },
    { s: 3, k: f.children.l, v: d.children },
  ], [d, photo, lang, t]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === "done") {
    return (
      <div className="form-card done" ref={top} tabIndex={-1}>
        <div className="done-mark" aria-hidden="true">✓</div>
        <h3>{t.done.t}</h3>
        <p>{t.done.d}</p>
        {sentPhotoLater && <p className="done-photo">{t.done.photo}</p>}
        <div className="done-actions">
          <a className="btn btn-primary" href={`https://t.me/${TELEGRAM}`} target="_blank" rel="noopener">{t.done.tg}</a>
          <button type="button" className="btn btn-ghost" onClick={restart}>{t.done.again}</button>
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
              <div className="date-row">
                <input id="bd" inputMode="numeric" maxLength={2} placeholder={f.birth.d} aria-label={f.birth.d} value={d.bd} onChange={(e) => set("bd")(e.target.value.replace(/\D/g, ""))} />
                <select aria-label={f.birth.m} value={d.bm} onChange={set("bm")}>
                  <option value="">{f.birth.m}</option>
                  {MONTHS[lang].map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
                </select>
                <input inputMode="numeric" maxLength={4} placeholder={f.birth.y} aria-label={f.birth.y} value={d.by} onChange={(e) => set("by")(e.target.value.replace(/\D/g, ""))} />
              </div>
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
                <div className="photo-frame">
                  {photo && !d.photoLater ? <img src={photo} alt="" /> : (
                    <svg viewBox="0 0 120 120" aria-hidden="true"><rect x="1" y="1" width="118" height="118" rx="6" fill="none" stroke="currentColor" strokeDasharray="4 4" /><circle cx="60" cy="48" r="20" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M24 104c6-20 20-30 36-30s30 10 36 30" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
                  )}
                </div>
                <div className="photo-actions">
                  {CAN_UPLOAD && (
                    <label className="btn btn-primary file-btn">
                      <input id="photo" type="file" accept="image/*,.heic,.heif" onChange={onPhoto} />
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
            <Field id="children" label={f.children.l} hint={f.children.h} error={errors.children}>
              <textarea id="children" rows={2} value={d.children} onChange={set("children")} placeholder={f.children.p} />
            </Field>
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
