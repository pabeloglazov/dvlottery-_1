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
            <Ticket t={t.ticket} />
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
