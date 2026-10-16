import { useMemo, useCallback, useState, useEffect, useRef } from "react";

// Constants & Config
const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLScPpb6xumWrPSjkPOVaVp6a2oIM6T7PcWi5z4SpKBPvWQMfPg/viewform";
const contacts = { brand: "BELOGLAZOV GREEN CARD", telegram: "@pabeloglazov" };
const HERO_COLOR = "#051333";

// Helper Functions
const pluralizeDays = (number) => {
    let n = Math.abs(number);
    n %= 100;
    if (n >= 5 && n <= 20) return 'дней';
    n %= 10;
    if (n === 1) return 'день';
    if (n >= 2 && n <= 4) return 'дня';
    return 'дней';
};

// i18n messages object (unchanged)
const messages = {
    ru: {
        brandSubtitle: "Подготовка и подача заявки DV-Lottery",
        ui: { language: "Язык:", region: "Регион:", ru: "RU", en: "EN", inRussia: "В России (₽)", inUSA: "В США ($)", septemberPrice: "Сентябрьская акция:", septNote: "(для заявок и оплат в сентябре)", daysLeft: (n) => `осталось ${n} ${pluralizeDays(n)}` },
        hero: { title1: "Открываю заполнение заявок на", title2: "лотерею грин карт (DV)", lead: "Подготовлю и подам вашу заявку корректно и вовремя. Без обещаний «выигрышей», только аккуратная работа по правилам Госдепартамента США.", ctaPrimary: "Оставить заявку", ctaSecondary: "Почему стоит заказывать у меня", ctaTop: "Подать заявку" },
        sections: { benefits: "Что даёт грин-карта?", how: "Как это будет работать?", pricing: "Тарифы", why: "Почему стоит заказывать у меня", testimonials: "Что говорят клиенты", faq: "Частые вопросы", formTitle: "Оставить заявку", formNote: "Форма открывается в новой вкладке Google Forms.", disclaimerTitle: "Дисклеймер", disclaimerText: "Я не являюсь представителем правительства США и не даю гарантий выигрыша. DV-Lottery проводится Госдепартаментом США бесплатно; плата взимается только за услугу подготовки и корректной подачи вашей заявки." },
        benefits: { safety: { title: "Защита и стабильность", text: "Правовой статус постоянного жителя США даёт защиту и социальные гарантии." }, travel: { title: "Свобода передвижения", text: "Обладатели грин-карты могут путешествовать и возвращаться в США без визы." }, edu: { title: "Образование и медицина", text: "Широкий доступ к качественному образованию и медицинским услугам." }, citizenship: { title: "Путь к гражданству США", text: "После 5 лет постоянного проживания можно подавать на гражданство." } },
        steps: [{ title: "Заявка", text: "Вы заполняете анкету с вашими данными на сайте." }, { title: "Подготовка", text: "Я профессионально готовлю ваши фото и данные по стандартам DV." }, { title: "Подача", text: "В течение недели корректно подаю вашу заявку на официальном сайте." }, { title: "Подтверждение", text: "Вы получаете уникальный номер для проверки результата." }, { title: "Ожидание", text: "В мае вы сможете проверить статус вашей заявки." }],
        reasons: [{ text: "Имею лицензию иммиграционного консультанта в США и работаю под руководством иммиграционного адвоката более 2 лет", icon: 'license' }, { text: "Есть выигрышные заявки клиентов (это не гарантия результата, лотерея остаётся лотереей)", icon: 'star' }, { text: "Профессионально оформляю фото и данные согласно правилам DV", icon: 'camera' }, { text: "Проверяю на ошибки и дубликаты, снижаю риск дисквалификации", icon: 'check' }, { text: "Даю понятные инструкции и сопровождение до проверки результата", icon: 'support' }, { text: "Конфиденциальность: ваши данные хранятся безопасно", icon: 'lock' }],
        testimonials: [{ name: "Ангелина", location: "Россия", text: "Это просто чудо! Мы выиграли грин-карту с первой попытки благодаря Павлу. Он всё сделал идеально, и был на связи на каждом этапе. Огромное спасибо за мечту!" }, { name: "Алексей", location: "Россия", text: "Очень профессиональный подход. Все сделали быстро, четко, без лишних вопросов. Фото подготовили идеально. Рекомендую всем, кто ценит свое время." }, { name: "Даниил", location: "Россия", text: "Очень переживал за правильность заполнения. Павел всегда был на связи, даже поздно вечером, и отвечал на все наши вопросы. С таким сопровождением чувствуешь себя гораздо увереннее." }, { name: "Александр", location: "США", text: "Процесс оказался намного проще, чем я думал. Никакой головной боли, все инструкции понятные. Буквально через пару дней после оплаты получил номер подтверждения." }, { name: "Степан", location: "Россия", text: "Раньше пытался подать сам и запутался. С Павлом всё прошло гладко. Видно, что человек эксперт в своем деле, всё проверил. Спасибо за спокойствие и уверенность!" }, { name: "Сергей", location: "США", text: "Скорость работы впечатляет. Не ожидал, что все будет готово так быстро. Все максимально прозрачно и профессионально. Отличный сервис!" }],
        sticky: (isSep) => isSep ? "Готовы подать заявку? Сентябрьская цена действует сейчас." : "Готовы подать заявку? Перейдите к форме, отвечу на вопросы в Telegram.",
        priceNotes: { RUB: "Цены для клиентов в России (RUB). Цена указана за одного человека.", USD: "Цены для клиентов, находящихся в США (USD). Price is per person." }
    },
    en: {
        brandSubtitle: "DV-Lottery application prep & submission",
        ui: { language: "Language:", region: "Region:", ru: "RU", en: "EN", inRussia: "In Russia (₽)", inUSA: "In the U.S. ($)", septemberPrice: "September promotion:", septNote: "(for applications and payments in September)", daysLeft: (n) => `${n} day${n === 1 ? '' : 's'} left` },
        hero: { title1: "Opening submissions for", title2: "the Green Card Lottery (DV)", lead: "I will prepare and submit your entry correctly and on time. No \"guaranteed wins\" just careful work by U.S. Department of State rules.", ctaPrimary: "Apply now", ctaSecondary: "Why work with me", ctaTop: "Apply" },
        sections: { benefits: "What does a Green Card give you?", how: "How it works", pricing: "Pricing", why: "Why work with me", testimonials: "What clients say", faq: "FAQ", formTitle: "Submit a request", formNote: "The form opens in a new Google Forms tab.", disclaimerTitle: "Disclaimer", disclaimerText: "I am not a representative of the U.S. government and cannot guarantee selection. The DV-Lottery is free; payment is only for preparation and correct submission of your entry." },
        benefits: { safety: { title: "Protection & stability", text: "Permanent resident status provides protections and social guarantees." }, travel: { title: "Freedom to travel", text: "Green card holders can travel and return to the U.S. without a visa." }, edu: { title: "Education & healthcare", text: "Broad access to quality education and medical services." }, citizenship: { title: "Path to U.S. citizenship", text: "After 5 years of residence you may apply for citizenship." } },
        steps: [{ title: "Application", text: "You fill out a short questionnaire on the website." }, { title: "Preparation", text: "I professionally prepare your photos and data per DV standards." }, { title: "Submission", text: "Within a week, I correctly submit your entry on the official website." }, { title: "Confirmation", text: "You receive a unique number to check your result." }, { title: "Waiting", text: "In May, you can check the status of your application." }],
        reasons: [{ text: "Licensed immigration consultant in the U.S., working under an immigration attorney for 2+ years", icon: 'license' }, { text: "Winning client cases exist (no guarantee, it's still a lottery)", icon: 'star' }, { text: "Professional photo/data preparation per DV rules", icon: 'camera' }, { text: "I check for errors/duplicates, reducing disqualification risk", icon: 'check' }, { text: "Clear instructions and support through result check", icon: 'support' }, { text: "Confidentiality: your data is stored securely", icon: 'lock' }],
        testimonials: [{ name: "Angelina", location: "Russia", text: "It's a miracle! We won the green card on our first try thanks to Pavel. He did everything perfectly and was in touch at every stage. Thank you for making our dream come true!" }, { name: "Alexey", location: "Russia", text: "Very professional approach. Everything was done quickly, clearly, and without unnecessary questions. The photos were prepared perfectly. I recommend it to everyone who values their time." }, { name: "Daniel", location: "Russia", text: "We were very worried about filling out the form correctly. Pavel was always available, even late at night, and answered all our questions. With such support, you feel much more confident." }, { name: "Alexander", location: "USA", text: "The process turned out to be much simpler than I thought. No headaches, all instructions were clear. I received the confirmation number just a couple of days after payment." }, { name: "Stepan", location: "Russia", text: "I tried to apply by myself before and got confused. With Pavel, everything went smoothly. You can see that he is an expert in his field, he checked everything. Thank you for the peace of mind!" }, { name: "Sergey", location: "USA", text: "The speed of work is impressive. I didn't expect everything to be ready so quickly. Everything is as transparent and professional as possible. Excellent service!" }],
        sticky: (isSep) => isSep ? "Ready to apply? September price is active now." : "Ready to apply? Go to the form - I'll answer questions in Telegram.",
        priceNotes: { RUB: "Prices for clients in Russia (RUB). Price is per person.", USD: "Prices for clients located in the U.S. (USD). Price is per person." }
    }
};

// SVG Icons Component
const icons = {
    license: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 7l-6.5 6.5a2.5 2.5 0 103.5 3.5L18.5 10.5a5.5 5.5 0 10-7.8-7.8L4 10v6h6l4-4"></path></svg>),
    star: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.88 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>),
    camera: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>),
    check: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="M9 12l2 2 4-4"></path></svg>),
    support: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>),
    lock: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0110 0v4"></path></svg>),
};

// --- Main App Component ---
export default function App() {
    // Dates
    const { isSeptember, year, daysLeft } = useMemo(() => {
        const now = new Date();
        const year = now.getFullYear();
        const isSeptember = now.getMonth() === 8; // 0=Jan, 8=Sep
        const deadline = new Date(year, 8, 30, 23, 59, 59);
        const days = Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
        return { isSeptember, year, daysLeft: days };
    }, []);

    // Language autodetect
    const defaultLang = useMemo(() => {
        try {
            const lang = (navigator?.language || "").toLowerCase();
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
            const ruTZ = /(Europe\/(Moscow|Kaliningrad)|Asia\/(Yekaterinburg|Novosibirsk|Omsk|Krasnoyarsk|Irkutsk|Yakutsk|Vladivostok|Magadan|Kamchatka|Barnaul|Tomsk|Kemerovo|Novokuznetsk|Ust-Nera))/;
            if (lang.startsWith("ru") || ruTZ.test(tz)) return "ru";
            if (/-US\b/i.test(lang) || tz.startsWith("America")) return "en";
            return "ru";
        } catch { return "ru"; }
    }, []);

    const [lang, setLang] = useState(defaultLang);
    const m = messages[lang];

    // Currency
    const [currency, setCurrency] = useState(lang === "en" ? "USD" : "RUB");
    useEffect(() => { setCurrency(lang === "en" ? "USD" : "RUB"); }, [lang]);
    const prices = currency === "USD"
        ? { early: "$75", standard: "$100", note: m.priceNotes.USD }
        : { early: "₽1500", standard: "₽2000", note: m.priceNotes.RUB };

    // Smooth scroll
    const scrollTo = useCallback((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const prefersReduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });
    }, []);

    // Sticky CTA state and logic
    const [showSticky, setShowSticky] = useState(true);
    const [stickyExpanded, setStickyExpanded] = useState(false);
    useEffect(() => {
        let lastY = window.scrollY;
        let stopTimer;
        const onScroll = () => {
            const y = window.scrollY;
            if (window.innerWidth >= 640) { setShowSticky(true); return; }
            if (y > lastY + 10) { setShowSticky(false); setStickyExpanded(false); }
            else if (y < lastY - 10) { setShowSticky(true); }
            lastY = y;
            if (stopTimer) clearTimeout(stopTimer);
            stopTimer = setTimeout(() => setShowSticky(true), 600);
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => { window.removeEventListener("scroll", onScroll); if(stopTimer) clearTimeout(stopTimer); };
    }, []);
    
    // Sticky CTA overflow detection
    const textRef = useRef(null);
    const [isOverflowing, setIsOverflowing] = useState(false);
    useEffect(() => {
        const el = textRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const check = () => setIsOverflowing(el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
        const ro = new ResizeObserver(check);
        ro.observe(el);
        window.addEventListener("resize", check);
        check();
        return () => { ro.disconnect(); window.removeEventListener("resize", check); };
    }, []);

    useEffect(() => { if (isOverflowing && window.innerWidth < 380) setStickyExpanded(true); }, [isOverflowing]);

    // Derived content from messages
    const benefits = useMemo(() => [
        { key: "safety", title: m.benefits.safety.title, text: m.benefits.safety.text, icon: (<svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5" className="w-7 h-7" aria-hidden="true"><path d="M12 3l7 4v5c0 5-3.5 8.5-7 9-3.5-.5-7-4-7-9V7l7-4z" stroke="currentColor" /><path d="M9 12l2 2 4-4" stroke="currentColor" /></svg>),},
        { key: "travel", title: m.benefits.travel.title, text: m.benefits.travel.text, icon: (<svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5" className="w-7 h-7" aria-hidden="true"><path d="M3 10h18M5 6h14M7 14h10M9 18h6" stroke="currentColor" /><path d="M12 2v20" stroke="currentColor" /></svg>),},
        { key: "edu", title: m.benefits.edu.title, text: m.benefits.edu.text, icon: (<svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5" className="w-7 h-7" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5 9-5z" stroke="currentColor" /><path d="M6 12v4a6 6 0 0012 0v-4" stroke="currentColor" /></svg>),},
        { key: "citizenship", title: m.benefits.citizenship.title, text: m.benefits.citizenship.text, icon: (<svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5" className="w-7 h-7" aria-hidden="true"><path d="M4 7h16v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7z" stroke="currentColor" /><path d="M8 7V5a4 4 0 118 0v2" stroke="currentColor" /></svg>),},
    ], [m]);
    
    const faqs = useMemo(() => lang === "ru"
        ? [
            { q: "Когда проходит подача заявок?", a: "Обычно в октябре-ноябре. Точные даты публикуются на сайте Госдепартамента США; подача возможна только онлайн на официальном сайте." }, { q: "Сколько стоит подать заявку?", a: "Подача бесплатна. Сборы платят только отобранные заявители на этапах визовой обработки/интервью." }, { q: "Кто может подать?", a: "Нужна страна рождения из списка допуска и: среднее образование ИЛИ 2 года квалифицированного опыта работы за последние 5 лет." }, { q: "Можем ли мы с супругом(ой) подать отдельно?", a: "Да. Каждый супруг может подать по одной заявке (если оба соответствуют требованиям). Если выбран один, второй может идти как производный заявитель." }, { q: "Сколько заявок можно подать?", a: "Только одну на человека в каждый период регистрации. За дубликаты - дисквалификация." }, { q: "Нужно ли указывать супруга и детей?", a: "Да, всех супругов/детей до 21 года и не состоящих в браке. Неуказание может привести к отказу." }, { q: "Какие требования к фото?", a: "Цветное, квадрат 600-1200 пикселей, фон белый/светлый, снято за последние 6 месяцев, нейтральное выражение лица." }, { q: "Как узнать результат и что делать, если потерял номер?", a: "Проверка результата только через Entrant Status Check на официальном сайте. Там же можно восстановить номер подтверждения." }, { q: "Что делать после отбора?", a: "Заполнить DS-260, подготовить документы и дождаться приглашения на интервью. DV-год завершается 30 сентября — действуйте без промедления." }, { q: "Как избежать мошенников?", a: "Вход бесплатный, никто не может увеличить шанс. Проверяйте только на официальном сайте и не платите «за выигрыш»." }
        ]
        : [
            { q: "When is the entry period?", a: "Typically October-November. Exact dates are announced on the State Department website; entry is only online on the official site." }, { q: "How much does it cost to enter?", a: "Entry is free. Only selectees pay government fees later during visa processing/interview." }, { q: "Who is eligible?", a: "You must be born in an eligible country and have either a high-school education or two years of qualifying work experience within the past five years." }, { q: "Can spouses both apply?", a: "Yes. Each spouse may submit one entry (if eligible). If one is selected, the other may qualify as a derivative." }, { q: "How many entries can I submit?", a: "Only one entry per person per year. Multiple entries lead to disqualification." }, { q: "Do I have to list my spouse and children?", a: "Yes, all spouses and unmarried children under 21. Failure to list them can make you ineligible." }, { q: "What are the photo rules?", a: "Color, square 600-1200px, white/light background, taken within the last 6 months, neutral expression." }, { q: "How do I check results and what if I lost my number?", a: "Use the official Entrant Status Check; you can retrieve your confirmation number there as well." }, { q: "What happens if I'm selected?", a: "Submit the DS-260, prepare documents, and attend a consular interview. Visas are issued monthly and the DV year ends Sept 30 — act promptly." }, { q: "How do I avoid scams?", a: "Entry is free and no one can increase your chances. Check only on the official site and ignore \"winner\" emails." }
        ], [lang]);

    return (
        <div className="min-h-screen text-white root">
            <div className="bg-aurora" /><div className="bg-satin" /><div className="bg-grain" /><div className="bg-vignette" />
            <a href="#main" className="skip-link">{lang === "ru" ? "Перейти к основному контенту" : "Skip to main content"}</a>

            <style>{`:root{--anchor-offset:96px;--ring:0 0 0 3px rgba(59,130,246,.6);--hero-color:${HERO_COLOR}}.root{position:relative;isolation:isolate;overflow-x:hidden;background:#070e21}.bg-aurora,.bg-satin,.bg-grain,.bg-vignette{position:fixed;inset:0;pointer-events:none;will-change:transform,opacity}.bg-aurora{z-index:-4;--ax1:80%;--ay1:-10%;--ax2:12%;--ay2:0%;--ax3:50%;--ay3:115%;background:radial-gradient(40% 60% at var(--ax1) var(--ay1),rgba(56,139,253,.22),rgba(56,139,253,0) 65%),radial-gradient(45% 55% at var(--ax2) var(--ay2),rgba(151,71,255,.22),rgba(151,71,255,0) 62%),radial-gradient(55% 60% at var(--ax3) var(--ay3),rgba(0,188,212,.16),rgba(0,188,212,0) 60%),linear-gradient(180deg,#0a1330 0%,#081126 55%,#070e21 100%);animation:auroraDrift 12s ease-in-out infinite alternate;filter:saturate(112%) contrast(104%)}@keyframes auroraDrift{0%{--ax1:80%;--ay1:-10%;--ax2:12%;--ay2:0%;--ax3:50%;--ay3:115%}50%{--ax1:76%;--ay1:-2%;--ax2:16%;--ay2:6%;--ax3:46%;--ay3:118%}100%{--ax1:72%;--ay1:6%;--ax2:20%;--ay2:10%;--ax3:44%;--ay3:122%}}.bg-satin{z-index:-3;opacity:.16;background:repeating-linear-gradient(115deg,rgba(255,255,255,.07) 0,rgba(255,255,255,.07) 1px,transparent 2px,transparent 8px);mix-blend-mode:overlay;animation:satinShift 18s linear infinite alternate}@keyframes satinShift{from{transform:translate3d(0,0,0)}to{transform:translate3d(2%,-2%,0)}}.bg-grain{z-index:-2;opacity:.18;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.04'/></svg>");background-size:200px 200px;animation:grainMove 6s linear infinite alternate}@keyframes grainMove{from{transform:translate3d(0,0,0)}to{transform:translate3d(-1%,1%,0)}}.bg-vignette{z-index:-1;background:radial-gradient(120% 80% at 50% 30%,transparent 60%,rgba(0,0,0,.45) 100%)}.card{position:relative;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:1.5rem;transition:background .2s ease,border-color .2s ease,transform .2s ease}.card:is(:hover,:focus-within){background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.18);transform:translateY(-2px)}a:focus-visible,button:focus-visible{outline:none;box-shadow:var(--ring)}.skip-link{position:absolute;left:-999px;width:1px;height:1px;overflow:hidden}.skip-link:focus{left:1rem;top:1rem;width:auto;height:auto;padding:.5rem .75rem;border-radius:.5rem;background:#fff;color:#111827;box-shadow:var(--ring);z-index:10000}[id]{scroll-margin-top:var(--anchor-offset)}.timeline{position:relative;padding-left:2.5rem}.timeline::before{content:'';position:absolute;left:1rem;top:.5rem;bottom:.5rem;width:2px;background-image:linear-gradient(to bottom,transparent,#2563eb,transparent)}.timeline-item{position:relative;margin-bottom:2rem}.timeline-item::before{content:'';position:absolute;left:-2rem;top:.5rem;width:1rem;height:1rem;border-radius:999px;background-color:#3b82f6;border:3px solid rgba(59,130,246,.3)}.timeline-item:last-child{margin-bottom:0}.testimonial-grid{display:grid;gap:1.25rem;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}.testimonial-card{border-top:4px solid rgba(59,130,246,.3)}.quote-icon{position:absolute;top:.5rem;right:.5rem;width:4rem;height:4rem;color:rgba(255,255,255,.05)}.sticky-cta-surface{position:relative;color:#fff}.sticky-cta-surface>*{position:relative;z-index:1}.sticky-cta-surface::before{content:"";position:absolute;inset:0;border-radius:inherit;background:rgba(7,14,33,.88);mix-blend-mode:normal;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06),0 10px 24px rgba(0,0,0,.35);pointer-events:none;z-index:0}.cta-text{color:#fff!important;text-shadow:0 1px 2px rgba(0,0,0,.55)}.faq summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:1.25rem}.faq summary::-webkit-details-marker{display:none}.faq .icon{transition:transform .2s ease}.faq details[open]>summary .icon{transform:rotate(45deg)}.faq-content{padding:0 1.25rem 1.25rem;margin-top:-1rem}.faq.card{padding:0}@media (prefers-reduced-motion:reduce){.card,.bg-aurora,.bg-satin,.bg-grain{transition:none;animation:none}}@media (max-width:640px){:root{--anchor-offset:72px}.hero-title{font-size:clamp(1.75rem,7.2vw,2.5rem);line-height:1.2}.hero-lead{font-size:.95rem}.pad-for-sticky{padding-bottom:5rem}.bg-aurora,.bg-satin,.bg-grain{animation:none}.sticky-cta-surface::before{background:rgba(7,14,33,.92)}}`}</style>

            <header className="relative overflow-hidden">
                <div className="relative mx-auto max-w-6xl px-6 py-16 sm:py-28">
                    <div className="mb-4 sm:mb-6 flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold tracking-widest text-white/90">{contacts.brand}</div>
                        <div className="flex items-center gap-2 sm:gap-3">
                            <div role="tablist" aria-label={m.ui.language} className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
                                <button role="tab" aria-selected={lang === "ru"} onClick={() => setLang("ru")} className={`px-3 py-1.5 text-sm rounded-lg ${lang === "ru" ? "bg-white text-blue-700 font-semibold" : "text-white/80 hover:bg-white/10"}`}>{m.ui.ru}</button>
                                <button role="tab" aria-selected={lang === "en"} onClick={() => setLang("en")} className={`px-3 py-1.5 text-sm rounded-lg ${lang === "en" ? "bg-white text-blue-700 font-semibold" : "text-white/80 hover:bg-white/10"}`}>{m.ui.en}</button>
                            </div>
                            <a href={FORM_URL} target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-blue-500 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow hover:bg-blue-50">{m.hero.ctaTop}</a>
                        </div>
                    </div>

                    {isSeptember && (
                        <div className="mb-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 rounded-2xl border border-blue-400/40 bg-white/10 px-3 py-1.5 text-sm backdrop-blur max-w-full">
                            <span className="inline-flex h-2 w-2 rounded-full bg-blue-400 flex-none" />
                            <span className="whitespace-nowrap">{m.ui.septemberPrice}</span>
                            <strong className="whitespace-nowrap">{currency === "USD" ? prices.early : prices.early}</strong>
                            <span className="opacity-70 min-w-0 hidden sm:inline">{m.ui.septNote}</span>
                            {daysLeft > 0 && (<span className="ml-auto rounded bg-blue-400/20 px-2 py-0.5 whitespace-nowrap">{m.ui.daysLeft(daysLeft)}</span>)}
                        </div>
                    )}

                    <h1 className="hero-title text-3xl sm:text-5xl font-bold leading-tight tracking-tight">{m.hero.title1}<span className="block text-blue-300">{m.hero.title2}</span></h1>
                    <p className="hero-lead mt-4 max-w-2xl text-white/90">{m.hero.lead}</p>
                    <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        <a href={FORM_URL} target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto text-center rounded-2xl border border-blue-500 bg-white px-6 py-3 font-semibold text-blue-700 shadow hover:bg-blue-50">{m.hero.ctaPrimary}</a>
                        <button type="button" onClick={() => scrollTo("why")} className="w-full sm:w-auto rounded-2xl border border-white/20 bg-white/10 px-6 py-3 font-semibold text-white hover:bg-white/20">{m.hero.ctaSecondary}</button>
                    </div>
                </div>
            </header>
            
            <main id="main" className="pad-for-sticky">
                <section id="benefits" className="mx-auto max-w-6xl px-6 py-12 sm:py-18">
                    <h2 className="text-2xl sm:text-3xl font-bold">{m.sections.benefits}</h2>
                    <div className="mt-6 sm:mt-8 grid gap-5 sm:gap-6 sm:grid-cols-2 lg:grid-cols-4">
                        {benefits.map((b) => (<div key={b.key} className="card relative rounded-3xl p-5 sm:p-6"><div className="mb-3 sm:mb-4 text-blue-300">{b.icon}</div><h3 className="font-semibold text-base sm:text-lg">{b.title}</h3><p className="mt-2 text-sm text-white/90">{b.text}</p></div>))}
                    </div>
                </section>

                <section id="how" className="py-12 sm:py-18">
                    <div className="mx-auto max-w-6xl px-6">
                        <h2 className="text-2xl sm:text-3xl font-bold">{m.sections.how}</h2>
                        <div className="mt-8 sm:mt-10"><div className="timeline">{m.steps.map((step, i) => (<div key={i} className="timeline-item"><h3 className="font-semibold text-blue-300">{step.title}</h3><p className="mt-1 text-white/90">{step.text}</p></div>))}</div></div>
                    </div>
                </section>

                <section id="pricing" className="mx-auto max-w-6xl px-6 py-12 sm:py-18">
                    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                        <h2 className="text-2xl sm:text-3xl font-bold">{m.sections.pricing}</h2>
                         <div className="flex items-center gap-3">
                            <span className="text-sm text-white/70">{m.ui.region}</span>
                            <div role="tablist" aria-label={m.ui.region} className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
                                <button role="tab" aria-selected={currency === "RUB"} onClick={() => setCurrency("RUB")} className={`px-3 py-1.5 text-sm rounded-lg ${currency === "RUB" ? "bg-white text-blue-700 font-semibold" : "text-white/80 hover:bg-white/10"}`}>{m.ui.inRussia}</button>
                                <button role="tab" aria-selected={currency === "USD"} onClick={() => setCurrency("USD")} className={`px-3 py-1.5 text-sm rounded-lg ${currency === "USD" ? "bg-white text-blue-700 font-semibold" : "text-white/80 hover:bg-white/10"}`}>{m.ui.inUSA}</button>
                            </div>
                        </div>
                    </div>
                    <div className="mt-6 sm:mt-8 grid gap-5 sm:gap-6 lg:grid-cols-2">
                        <div className={`card relative rounded-3xl p-6 sm:p-8 ${isSeptember ? "ring-1 ring-blue-500/40" : ""}`}>
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                <h3 className="text-lg sm:text-xl font-semibold">{lang === "ru" ? "Ранняя пташка" : "Early bird"}</h3>
                                <span className={`self-start sm:self-auto rounded-full px-3 py-1 text-xs ${isSeptember ? "bg-blue-500 text-white" : "bg-white/20 text-white/80"}`}>{isSeptember ? (lang === "ru" ? "Сентябрь" : "September") : (lang === "ru" ? "Акция завершена" : "Promo ended")}</span>
                            </div>
                            <p className="mt-2 text-white/90">{lang === "ru" ? "Подготовка фото, проверка данных, аккуратная подача на официальном сайте и передача номера подтверждения." : "Photo prep, data check, correct filing on the official site and handing over the confirmation number."}</p>
                            <div className="mt-5 sm:mt-6 text-3xl sm:text-4xl font-bold text-white">{prices.early}</div>
                            <div className="mt-6 sm:mt-8"><a href={FORM_URL} target="_blank" rel="noopener noreferrer" className="w-full inline-flex justify-center rounded-2xl border border-blue-500 bg-white py-3 font-semibold text-blue-700 shadow hover:bg-blue-50">{lang === "ru" ? "Выбрать тариф" : "Choose plan"}</a></div>
                        </div>
                        <div className="card relative rounded-3xl p-6 sm:p-8">
                            <h3 className="text-lg sm:text-xl font-semibold">{lang === "ru" ? "Стандарт" : "Standard"}</h3>
                            <p className="mt-2 text-white/90">{lang === "ru" ? "Те же услуги: подготовка фото, проверка данных, подача заявки и передача номера подтверждения." : "Same services: photo prep, data check, filing and confirmation number."}</p>
                            <div className="mt-5 sm:mt-6 text-3xl sm:text-4xl font-bold text-white">{prices.standard}</div>
                            <div className="mt-6 sm:mt-8"><a href={FORM_URL} target="_blank" rel="noopener noreferrer" className="w-full inline-flex justify-center rounded-2xl border border-blue-500 bg-white py-3 font-semibold text-blue-700 shadow hover:bg-blue-50">{lang === "ru" ? "Выбрать тариф" : "Choose plan"}</a></div>
                        </div>
                    </div>
                    <div className="mt-4 text-xs text-white/70">{prices.note}</div>
                </section>

                <section id="why" className="py-12 sm:py-18">
                    <div className="mx-auto max-w-6xl px-6">
                        <h2 className="text-2xl sm:text-3xl font-bold">{m.sections.why}</h2>
                        <div className="mt-6 sm:mt-8 grid gap-5 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">{m.reasons.map((r, i) => (<div key={i} className="card relative rounded-3xl p-5 sm:p-6"><div className="mb-3 text-blue-300 w-8 h-8">{icons[r.icon]}</div><p className="text-white/90">{r.text}</p></div>))}</div>
                    </div>
                </section>

                <section id="testimonials" className="mx-auto max-w-6xl px-6 py-12 sm:py-18">
                    <h2 className="text-2xl sm:text-3xl font-bold text-center">{m.sections.testimonials}</h2>
                    <div className="mt-8 sm:mt-10 testimonial-grid">{m.testimonials.map((t, i) => (<div key={i} className="card testimonial-card rounded-3xl p-6 flex flex-col relative overflow-hidden"><div className="quote-icon"><svg fill="currentColor" viewBox="0 0 32 32"><path d="M9.08,5.16c-2,0-3.6,1.64-3.6,3.69V15c0,2.05,1.6,3.69,3.6,3.69H14v5.12c0,1-1.28,1.65-2.11,0.89L5,17.81V8.84C5,6.79,6.6,5.16,8.68,5.16H9.08z M23.08,5.16c-2,0-3.6,1.64-3.6,3.69V15c0,2.05,1.6,3.69,3.6,3.69H28v5.12c0,1-1.28,1.65-2.11,0.89L19,17.81V8.84C19,6.79,20.6,5.16,22.68,5.16H23.08z"></path></svg></div><p className="text-white/90 flex-grow z-10">{t.text}</p><div className="mt-4 pt-4 border-t border-white/10 z-10"><p className="font-semibold">{t.name}</p><p className="text-sm text-white/70">{t.location}</p></div></div>))}</div>
                </section>

                <section id="faq" className="mx-auto max-w-6xl px-6 py-12 sm:py-18">
                    <h2 className="text-2xl sm:text-3xl font-bold">{m.sections.faq}</h2>
                    <div className="mt-6 sm:mt-8 space-y-4">{faqs.map((faq, i) => (<details key={i} className="faq card rounded-2xl p-0"><summary><span className="font-semibold">{faq.q}</span><span className="icon text-blue-300"><svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v12m-6-6h12" /></svg></span></summary><div className="faq-content text-white/80">{faq.a}</div></details>))}</div>
                </section>

                <section id="form" className="mx-auto max-w-6xl px-6 py-12 sm:py-18">
                    <h2 className="text-2xl sm:text-3xl font-bold">{m.sections.formTitle}</h2>
                    <p className="mt-2 text-white/90">{m.sections.formNote}</p>
                    <div className="mt-6 sm:mt-8"><a href={FORM_URL} target="_blank" rel="noopener noreferrer" aria-label={lang === "ru" ? "Перейти к форме Google Forms" : "Go to Google Forms"} className="w-full sm:w-auto inline-flex items-center justify-center gap-3 rounded-2xl border border-blue-500 bg-white px-6 sm:px-8 py-3.5 sm:py-4 text-base sm:text-lg font-semibold text-blue-700 shadow-lg ring-1 ring-blue-500/30 transition hover:bg-blue-50 hover:-translate-y-px active:translate-y-0"><span>{lang === "ru" ? "Перейти к форме" : "Open the form"}</span><svg className="h-5 w-5 sm:h-6 sm:w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="M13 5l7 7-7 7" /></svg></a></div>
                </section>
            </main>

            <footer id="contacts" className="border-t border-white/15 bg-neutral-900/70">
                <div className="mx-auto max-w-6xl px-6 py-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                    <div><div className="text-lg font-semibold">{contacts.brand}</div><div className="mt-2 text-white/80">{m.brandSubtitle}</div></div>
                    <div className="space-y-2 text-white/80"><div>Telegram: <a className="underline decoration-dotted" href={`https://t.me/${contacts.telegram.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer">{contacts.telegram}</a></div></div>
                    <div className="sm:col-span-2 text-sm text-white/70"><div className="font-semibold text-white/80">{m.sections.disclaimerTitle}</div><p className="mt-2">{m.sections.disclaimerText}</p></div>
                </div>
                <div className="border-t border-white/15 py-6 text-center text-xs text-white/60">© {year} DV-Lottery Service. {lang === "ru" ? "Все права защищены." : "All rights reserved."}</div>
            </footer>

            <div className={`fixed inset-x-0 bottom-3 z-50 flex justify-center px-3 transition-all duration-300 ${showSticky ? '' : 'translate-y-24 opacity-0 pointer-events-none'}`}>
                <div className={`sticky-cta-surface pointer-events-auto flex ${stickyExpanded ? 'items-start' : 'items-center'} gap-3 sm:gap-4 rounded-2xl p-2.5 sm:p-3 backdrop-blur card`} style={{ width: stickyExpanded ? 'min(100%, 720px)' : 'fit-content', maxWidth: 'min(100%, 720px)' }}>
                    <button type="button" onClick={() => setStickyExpanded(v => !v)} aria-expanded={stickyExpanded} className="min-w-0 text-left text-sm leading-snug focus:outline-none px-1 flex items-center gap-1 cta-text">
                        <span ref={textRef} className={stickyExpanded ? 'whitespace-normal break-words' : 'block truncate'} title={m.sticky(isSeptember)}>{m.sticky(isSeptember)}</span>
                        {isOverflowing && (<svg className={`h-3 w-3 flex-none transition-transform ${stickyExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>)}
                    </button>
                    <a href={FORM_URL} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 rounded-xl border border-blue-500 bg-white px-3 py-1.5 text-[13px] sm:px-4 sm:py-2 sm:text-sm font-semibold text-blue-700 hover:bg-blue-50 whitespace-nowrap">{lang === "ru" ? "К форме" : "Open form"}</a>
                </div>
            </div>
        </div>
    );
}