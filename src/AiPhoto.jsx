import { useEffect, useRef, useState } from "react";
import { INTAKE_URL } from "./config.js";
import { processPhoto, warmUpPhotoTools } from "./photoProcess.js";

const IMG_ACCEPT = "image/*,.heic,.heif";
const isImage = (file) => /^image\//.test(file.type) || /\.(heic|heif)$/i.test(file.name);

// Запасной вариант, если модели не загрузились: просто уменьшаем фото, обработает Павел.
function plainResize(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("load")); };
    img.src = url;
  });
}

async function checkPhotoApi(dataUrl) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(INTAKE_URL, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, signal: ctrl.signal,
      body: JSON.stringify({ action: "checkPhoto", image: { mime: "image/jpeg", data: dataUrl.split(",")[1] } }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "check");
    return j.result;
  } finally { clearTimeout(timer); }
}

/** Полный цикл: обработка в браузере + ИИ-проверка. → { fin, meta: { orig, check, metrics, raw } } */
export async function runAiPhoto(file, onStage = () => {}) {
  if (!isImage(file)) throw Object.assign(new Error("type"), { code: "type" });
  let r;
  try { r = await processPhoto(file, onStage); }
  catch (e) {
    if (e.code === "no_face" || e.code === "load") throw e;
    const raw = await plainResize(file);
    return { fin: raw, meta: { orig: raw, check: null, raw: true } };
  }
  onStage(3);
  let check = null;
  if (INTAKE_URL) { try { check = await checkPhotoApi(r.processed); } catch { check = null; } }
  if (r.metrics.cut) check = { ok: false, issues: [...((check && check.issues) || []), "cut_source"] };
  return { fin: r.processed, meta: { orig: r.original, check, metrics: r.metrics } };
}

// Пункты чек-листа и какие замечания ИИ к ним относятся.
const GROUPS = [["not_frontal", "no_face", "multiple_people", "cut_off", "cut_source"], ["glasses", "headwear"], ["eyes_closed", "mouth_open"], ["shadows", "dark", "blurry", "hair_covers_face"]];

const ICONS = {
  replace: <><path d="M3.5 8a4.5 4.5 0 0 1 7.8-3.1L13 6.5" /><path d="M13 2.8v3.7H9.3" /><path d="M12.5 8a4.5 4.5 0 0 1-7.8 3.1L3 9.5" /><path d="M3 13.2V9.5h3.7" /></>,
  add: <><path d="M8 3v10M3 8h10" /></>,
  remove: <><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></>,
  guides: <><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M2.5 6.5h11M2.5 9.5h11" strokeDasharray="1.5 1.2" /></>,
  zoom: <><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14M7 5v4M5 7h4" /></>,
};
/** Кнопка-значок; с accept — выбор файла. */
export function IconBtn({ icon, label, onClick, onFile, accept, danger, on, id }) {
  const svg = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[icon]}</svg>;
  const cls = "icon-btn" + (danger ? " is-danger" : "") + (on ? " is-on" : "");
  if (onFile) {
    return (
      <label className={cls} title={label} aria-label={label}>
        <input id={id} type="file" accept={accept} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) onFile(file); }} />
        {svg}
      </label>
    );
  }
  return <button type="button" className={cls} title={label} aria-label={label} onClick={onClick}>{svg}</button>;
}

function CamIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.7" /></svg>;
}

/** Разметка DV поверх фото 600×600: зона глаз и рамка допустимого размера головы. */
function Guides({ a }) {
  return (
    <svg className="ai-guides" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <rect x="0" y="31" width="100" height="13" fill="rgba(91,75,196,.16)" />
      <line x1="0" y1="31" x2="100" y2="31" stroke="#5b4bc4" strokeWidth=".5" strokeDasharray="2 1.5" />
      <line x1="0" y1="44" x2="100" y2="44" stroke="#5b4bc4" strokeWidth=".5" strokeDasharray="2 1.5" />
      <text x="98" y="29.5" textAnchor="end" fontSize="3.6" fill="#5b4bc4">{a.eyes}</text>
    </svg>
  );
}

export function Lightbox({ item, onClose, onReplace, t }) {
  const a = t.photoAi;
  const [busy, setBusy] = useState(-1);
  const [err, setErr] = useState("");
  useEffect(() => { setErr(""); }, [item?.title]);
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  if (!item) return null;
  const pick = async (e) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file || !onReplace) return;
    setBusy(0); setErr("");
    try { await onReplace(file, setBusy); } catch (x) { setErr(x.message); } finally { setBusy(-1); }
  };
  return (
    <div className="lbx" role="dialog" aria-modal="true" aria-label={item.title} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <figure className="lbx-fig">
        <div className={"lbx-img" + (item.doc ? " is-doc" : "")}><img src={item.src} alt={item.title} />{busy >= 0 && <span className="lbx-busy">{(item.doc ? a.readingDoc : a.stages[busy]) || a.stages[0]}…</span>}</div>
        <figcaption>
          <div className="lbx-t"><b>{item.title}</b>{item.sub && <span>{item.sub}</span>}</div>
          {err ? <p className="lbx-note is-bad" role="alert">{err}</p> : item.note && <p className={"lbx-note" + (item.bad ? " is-bad" : "")}>{item.note}</p>}
          <div className="lbx-acts">
            {onReplace && <label className={"btn btn-primary file-btn" + (busy >= 0 ? " is-disabled" : "")}><input type="file" accept={item.accept || IMG_ACCEPT} onChange={pick} disabled={busy >= 0} />{item.doc ? a.replaceDoc : a.replace}</label>}
            <button type="button" className="btn btn-ghost" onClick={onClose}>{a.close}</button>
          </div>
        </figcaption>
      </figure>
    </div>
  );
}

/**
 * Поле фото с ИИ-обработкой. value — итоговое фото (dataURL 600×600), meta — { orig, check, metrics, raw }.
 * compact — короткая карточка (для супруга и детей).
 */
export default function AiPhoto({ value, meta, onChange, t, compact = false, inputId, onOpen, error }) {
  const a = t.photoAi;
  const [stage, setStage] = useState(-1);
  const [preview, setPreview] = useState(null);
  const [over, setOver] = useState(false);
  const [guides, setGuides] = useState(false);
  const [err, setErr] = useState("");
  const alive = useRef(true);
  useEffect(() => { warmUpPhotoTools(); return () => { alive.current = false; }; }, []);

  const handle = async (file) => {
    setErr("");
    if (!isImage(file)) { setErr(a.type); return; }
    const url = URL.createObjectURL(file);
    setPreview(url); setStage(0);
    try {
      const r = await runAiPhoto(file, (i) => alive.current && setStage(i));
      if (alive.current) onChange(r.fin, r.meta);
    } catch (e) {
      if (alive.current) setErr(e.code === "no_face" ? a.noFace : a.type);
    } finally {
      URL.revokeObjectURL(url);
      if (alive.current) { setStage(-1); setPreview(null); }
    }
  };
  const pick = (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) handle(file); };
  const fileInput = (id) => <input id={id} type="file" accept={IMG_ACCEPT} onChange={pick} />;

  if (stage >= 0) {
    return (
      <div className={"ai-proc" + (compact ? " is-compact" : "")}>
        <span className="ai-th">{preview && <img src={preview} alt="" />}</span>
        <span className="ai-stages">
          {a.stages.map((s, i) => (
            <span key={s} className={"ai-stg" + (i < stage ? " is-ok" : i === stage ? " is-on" : "")}><i>{i < stage ? "✓" : ""}</i>{s}</span>
          ))}
        </span>
      </div>
    );
  }

  if (!value) {
    return (
      <>
        <label
          className={"scan-drop" + (over ? " is-over" : "") + (compact ? " is-compact" : "")}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const file = e.dataTransfer.files?.[0]; if (file) handle(file); }}
        >
          {fileInput(inputId)}
          <span className="scan-ic"><CamIcon /></span>
          <span><b>{a.upload}</b><span>{compact ? a.uploadHShort : a.uploadH}</span></span>
        </label>
        {(err || error) && <p className="field-error" role="alert">{err || error}</p>}
      </>
    );
  }

  const c = meta?.check, issues = c?.issues || [], bad = issues.length > 0, raw = meta?.raw;
  const verdict = raw ? a.rawNote : !c ? a.noCheck : bad ? a.badNote : a.okNote;
  const links = (
    <span className="icon-row">
      <IconBtn icon="replace" label={a.change} onFile={handle} accept={IMG_ACCEPT} id={inputId} />
      {!compact && !raw && <IconBtn icon="guides" label={guides ? a.hideGuides : a.showGuides} on={guides} onClick={() => setGuides((g) => !g)} />}
      <IconBtn icon="remove" label={a.remove} danger onClick={() => onChange(null, null)} />
    </span>
  );

  if (compact) {
    return (
      <>
        <div className="scan-card">
          <button type="button" className="ai-mini" onClick={() => onOpen && onOpen()}><img src={value} alt="" /></button>
          <span className="scan-meta">
            <b className={bad ? "is-warn" : "is-ok"}>{raw ? "✓ " + a.loaded : bad ? "! " + issues.map((k) => a.issues[k]).join(", ") : "✓ " + a.compactOk}</b>
            {bad && <span>{a.compactBad}</span>}
            {links}
          </span>
        </div>
        {err && <p className="field-error" role="alert">{err}</p>}
      </>
    );
  }

  return (
    <div className="ai-res">
      {raw ? (
        <div className="scan-card ai-raw">
          <button type="button" className="ai-mini is-tall" onClick={() => onOpen && onOpen()}><img src={value} alt="" /></button>
          <span className="scan-meta"><b className="is-ok">✓ {a.loaded}</b><span>{a.rawNote}</span>{links}</span>
        </div>
      ) : (
        <>
          <div className="ai-ba">
            <figure><span className="ai-pic"><img src={meta.orig} alt="" /></span><figcaption>{a.before}</figcaption></figure>
            <span className="ai-arr" aria-hidden="true">→</span>
            <figure>
              <button type="button" className="ai-pic" onClick={() => onOpen && onOpen()}>
                <img src={value} alt="" />
                {guides && <Guides a={a} />}
                <span className={"ai-badge" + (bad ? " is-bad" : c ? "" : " is-na")}>{bad ? "! " + a.badgeBad : c ? "✓ " + a.badgeOk : "600×600"}</span>
              </button>
              <figcaption><b>{a.after}</b> · 600×600</figcaption>
            </figure>
          </div>
          {guides && meta.metrics && <p className="ai-metrics">{a.metrics(meta.metrics.head, meta.metrics.eyes)}</p>}
          <div className="ai-checks">
            {a.checks.map((txt, i) => {
              const hit = i < 4 && c ? issues.filter((k) => GROUPS[i].includes(k)) : [];
              if (i < 4 && !c) return null;
              return hit.length
                ? hit.map((k) => <span key={k} className="ai-ck is-bad"><i>!</i>{a.issues[k]}</span>)
                : <span key={txt} className="ai-ck"><i>✓</i>{txt}</span>;
            })}
          </div>
        </>
      )}
      {!raw && <div className={"ai-verdict" + (bad ? " is-bad" : !c ? " is-na" : "")}><span>{verdict}</span>{bad && <label className="btn btn-primary file-btn">{fileInput()}{a.another}</label>}</div>}
      {!raw && links}
      {err && <p className="field-error" role="alert">{err}</p>}
    </div>
  );
}
