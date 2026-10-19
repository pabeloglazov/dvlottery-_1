import { useEffect, useState } from "react";
import EntryForm from "./EntryForm.jsx";
import { PRICES, T } from "./content.js";
import { TELEGRAM } from "./config.js";

function detectLang() {
  try {
    const saved = localStorage.getItem("lang");
    if (saved === "ru" || saved === "en") return saved;
  } catch { /* storage недоступен */ }
  return "ru";
}

const WHY_ICONS = {
  exp: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" /></svg>,
  win: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="9" cy="11" r="2.2" /><path d="M5.8 16.2c.7-1.6 1.8-2.3 3.2-2.3s2.5.7 3.2 2.3M14.5 10h3.5M14.5 13.5h2.5" /></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7.5-3.6 7.5-9.6V5.6L12 3 4.5 5.6v5.8C4.5 17.4 12 21 12 21z" /><path d="M8.8 12.1l2.2 2.2 4.3-4.4" /></svg>,
  chat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12.5a7.5 7.5 0 01-10.9 6.7L4 20.5l1.4-4.6A7.5 7.5 0 1120 12.5z" /><path d="M9 12h.01M12.5 12h.01M16 12h.01" /></svg>,
};

// Флаг США: 13 полос, 50 звёзд, пропорции 19:10 (viewBox 190×100).
const FLAG_STARS = (() => {
  const out = [];
  for (let r = 0; r < 9; r++) {
    const odd = r % 2 === 1;
    for (let c = 0; c < (odd ? 5 : 6); c++) out.push([6.33 * (2 * c + (odd ? 2 : 1)), 5.385 * (r + 1)]);
  }
  return out;
})();
const STAR = "M0,-2.46L0.58,-0.8L2.34,-0.76L0.94,0.3L1.45,1.99L0,0.98L-1.45,1.99L-0.94,0.3L-2.34,-0.76L-0.58,-0.8Z";

function Flag({ className }) {
  return (
    <svg className={className} viewBox="0 0 190 100" aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <linearGradient id="flag-wave" x1="0" x2="1" y1="0" y2="0.35">
          <stop offset="0" stopColor="#fff" stopOpacity=".18" />
          <stop offset=".18" stopColor="#000" stopOpacity=".10" />
          <stop offset=".38" stopColor="#fff" stopOpacity=".16" />
          <stop offset=".6" stopColor="#000" stopOpacity=".12" />
          <stop offset=".82" stopColor="#fff" stopOpacity=".14" />
          <stop offset="1" stopColor="#000" stopOpacity=".10" />
        </linearGradient>
      </defs>
      <rect width="190" height="100" fill="#fff" />
      {Array.from({ length: 7 }, (_, i) => <rect key={i} y={i * 200 / 13} width="190" height={100 / 13} fill="#b22234" />)}
      <rect width="76" height={700 / 13} fill="#3c3b6e" />
      {FLAG_STARS.map(([x, y], i) => <path key={i} d={STAR} transform={`translate(${x} ${y})`} fill="#fff" />)}
      <rect width="190" height="100" fill="url(#flag-wave)" />
    </svg>
  );
}

function Ticket({ t }) {
  return (
    <figure className="ticket" aria-label={t.head}>
      <div className="ticket-top">
        <svg className="seal" viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="24" cy="24" r="17" fill="none" stroke="currentColor" strokeWidth="1" />
          <path d="M24 12l3.2 6.6 7.3 1-5.3 5.1 1.3 7.2L24 28.5l-6.5 3.4 1.3-7.2-5.3-5.1 7.3-1z" fill="currentColor" />
        </svg>
        <span>{t.head}</span>
      </div>
      <dl className="ticket-body">
        <div><dt>{t.program}</dt><dd>DV-2027</dd></div>
        <div><dt>{t.entrant}</dt><dd>IVANOV IVAN</dd></div>
        <div className="ticket-number"><dt>{t.number}</dt><dd>2027 AA1R <span>●●●●</span> <span>●●●●</span></dd></div>
        <div><dt>{t.status}</dt><dd>{t.statusValue}</dd></div>
      </dl>
      <div className="stamp" aria-hidden="true"><span>{t.stamp}</span></div>
      <figcaption>{t.foot}</figcaption>
    </figure>
  );
}

const DOC_ICONS = {
  pass: <><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="10" r="3" /><path d="M8.5 16.5h7" /></>,
  photo: <><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  birth: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  home: <><path d="M4 11l8-6 8 6v9H4z" /><path d="M10 20v-5h4v5" /></>,
  edu: <><path d="M3 9l9-4 9 4-9 4z" /><path d="M7 11v4c0 1.5 2.2 3 5 3s5-1.5 5-3v-4" /></>,
  family: <><circle cx="8" cy="8" r="2.5" /><circle cx="16" cy="8" r="2.5" /><circle cx="12" cy="14" r="2" /><path d="M3.5 19c.5-3 2.3-5 4.5-5M20.5 19c-.5-3-2.3-5-4.5-5M8.5 21c.4-2 1.8-3.5 3.5-3.5s3.1 1.5 3.5 3.5" /></>,
};
function DocIcon({ name }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{DOC_ICONS[name]}</svg>;
}

export default function App() {
  const [lang, setLang] = useState(detectLang);
  const t = T[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = lang === "ru" ? "Подача заявки на лотерею грин-карт DV-2027 — Павел Белоглазов" : "DV-2027 Green Card Lottery entry — Pavel Beloglazov";
    try { localStorage.setItem("lang", lang); } catch { /* ignore */ }
  }, [lang]);

  const tg = `https://t.me/${TELEGRAM}`;

  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <a className="brand" href="#top">
            <span className="brand-mark" aria-hidden="true">GC</span>
            <span>Beloglazov <b>Green Card</b></span>
          </a>
          <nav className="topnav" aria-label="main">
            <a href="#how">{t.nav.how}</a>
            <a href="#price">{t.nav.price}</a>
            <a href="#faq">{t.nav.faq}</a>
          </nav>
          <div className="lang" role="group" aria-label="Language">
            <button type="button" aria-pressed={lang === "ru"} onClick={() => setLang("ru")}>RU</button>
            <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <p className="kicker">{t.hero.kicker}</p>
              <h1>{t.hero.title}</h1>
              <p className="lead">{t.hero.lead}</p>
              <div className="hero-actions">
                <a className="btn btn-primary btn-lg" href="#form">{t.hero.cta}</a>
                <a className="btn btn-ghost btn-lg" href={tg} target="_blank" rel="noopener">{t.hero.secondary}</a>
              </div>
            </div>
            <div className="hero-art">
              <Flag className="hero-flag" />
              <Ticket t={t.ticket} />
            </div>
          </div>
        </section>

        <section className="dates" aria-labelledby="dates-title">
          <div className="wrap">
            <h2 id="dates-title" className="sr-only">{t.dates.title}</h2>
            <ul className="dates-list">
              {t.dates.items.map((x) => (
                <li key={x.what}><b>{x.when}</b><span>{x.what}</span></li>
              ))}
            </ul>
            <p className="dates-note">{t.dates.asOf}</p>
          </div>
        </section>

        <section id="benefits" className="section benefits" aria-labelledby="benefits-title">
          <div className="wrap">
            <div className="benefits-head">
              <div>
                <h2 id="benefits-title">{t.benefits.title}</h2>
                <p className="benefits-lead">{t.benefits.lead}</p>
              </div>
              <Flag className="benefits-flag" />
            </div>
            <ol className="benefits-grid">
              {t.benefits.items.map((x, i) => (
                <li key={x.t} className={i === 4 ? "is-main" : undefined}>
                  <span className="b-num" aria-hidden="true">0{i + 1}</span>
                  <h3>{x.t}</h3>
                  <p>{x.d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="who" className="section section-tint who" aria-labelledby="who-title">
          <div className="wrap who-grid">
            <div className="who-card">
              <h2 id="who-title">{t.who.title}</h2>
              <p className="who-lead">{t.who.lead}</p>
              <ul className="who-list">
                {t.who.items.map((x) => (
                  <li key={x.t}><span className="who-ck" aria-hidden="true">✓</span><div><h3>{x.t}</h3><p>{x.d}</p></div></li>
                ))}
              </ul>
            </div>
            <div className="who-card is-docs">
              <h2>{t.who.docsTitle}</h2>
              <p className="who-lead">{t.who.docsLead}</p>
              <ul className="docs-list">
                {t.who.docs.map((x) => (
                  <li key={x.t}><span className="doc-ic" aria-hidden="true"><DocIcon name={x.i} /></span>
                    <div><h3>{x.t}{x.isNew && <span className="doc-new">{t.who.newBadge}</span>}</h3><p>{x.d}</p></div></li>
                ))}
              </ul>
            </div>
            <div className="who-cta">
              <a className="btn btn-primary" href="#form">{t.who.cta}</a>
              <p>{t.who.note} <a href={tg} target="_blank" rel="noopener">@{TELEGRAM}</a></p>
            </div>
          </div>
        </section>

        <section id="how" className="section">
          <div className="wrap">
            <h2>{t.how.title}</h2>
            <ol className="steps">
              {t.how.steps.map((s, i) => (
                <li key={s.t}><span className="step-num">{i + 1}</span><h3>{s.t}</h3><p>{s.d}</p></li>
              ))}
            </ol>
          </div>
        </section>

        <section id="price" className="section section-tint">
          <div className="wrap">
            <h2>{t.why.title}</h2>
            <ul className="why-grid">
              {t.why.items.map((x) => (
                <li key={x.t}>
                  <span className="why-icon" aria-hidden="true">{WHY_ICONS[x.icon]}</span>
                  <h3>{x.t}</h3>
                  <p>{x.d}</p>
                </li>
              ))}
            </ul>

            <div className="price-panel">
              <div className="price-main">
                <h2>{t.price.title}</h2>
                <div className="price-row">
                  <div><span className="price-num">{PRICES.ru}</span><span className="price-where">{t.price.ru}</span></div>
                  <div><span className="price-num">{PRICES.us}</span><span className="price-where">{t.price.us}</span></div>
                </div>
                <p className="price-per">{t.price.per}</p>
                <a className="btn btn-primary btn-lg price-cta" href="#form">{t.hero.cta}</a>
              </div>
              <div className="price-side">
                <ul className="ticks">{t.price.includes.map((x) => <li key={x}>{x}</li>)}</ul>
                <p className="muted">{t.price.fee}</p>
              </div>
            </div>
          </div>
        </section>

        <section id="form" className="section form-section">
          <div className="wrap form-wrap">
            <div className="form-intro">
              <h2>{t.form.title}</h2>
              <p>{t.form.lead}</p>
            </div>
            <EntryForm lang={lang} t={t.form} />
          </div>
        </section>

        <section id="faq" className="section">
          <div className="wrap faq-wrap">
            <h2>{t.faq.title}</h2>
            <div className="faq">
              {t.faq.items.map((x) => (
                <details key={x.q}>
                  <summary>{x.q}</summary>
                  <p>{x.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap">
          <p className="disclaimer">{t.disclaimer}</p>
          <p className="footer-line">
            <span>{t.footer}</span>
            <a href={tg} target="_blank" rel="noopener">Telegram @{TELEGRAM}</a>
          </p>
        </div>
      </footer>
    </>
  );
}
