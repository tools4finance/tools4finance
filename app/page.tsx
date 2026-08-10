"use client";

import Link from "next/link";
import SiteNav from "@/components/SiteNav";
import FxRatesPanel from "@/components/FxRatesPanel";
import { useLang, t as pick } from "@/lib/i18n";

const STRINGS = {
  tr: {
    eyebrow: "Finans Ekipleri İçin Araç Seti",
    heroTitle1: "Finans ekibinizin ",
    heroTitleEm: "günlük işini",
    heroTitle2: "hızlandıran araçlar.",
    heroSub:
      "IFRS raporlamadan mutabakata, site/bina bütçe yönetiminden finansal analize — her araç gerçek muhasebe mantığıyla, denetim standardında çalışır.",
    live: "Aktif",
    soon: "Yakında",
    ifrsName: "IFRS Reporting",
    ifrsDesc:
      "VUK mizanından IFRS finansal tablolara — AJE, RJE, ertelenmiş vergi otomasyonu ile çalışan Working Trial Balance platformu.",
    aidatName: "Site Bütçe Yönetimi",
    aidatDesc:
      "Aidat tahakkuku, tahsilat, cari hesap, gider/gelir ve bütçe takibini tek panelde yönetin — mobilden de kullanılabilir.",
    csName: "Müşteri Risk Skoru",
    csDesc:
      "Müşterilerinizi risk sınıfı, vade gecikmesi, ödeme alışkanlığı ve stratejik önem gibi kriterlerle puanlayın — tüm ağırlıklar ve eşikler size özel, tamamen düzenlenebilir.",
    kpiName: "Performans Yönetim Sistemi",
    kpiDesc:
      "Şirket ve bireysel hedefleri tek yerde toplayın — ağırlıklandırılmış hedef girişi, kişi/yönetici yorumları ve otomatik skor hesaplama ile basit bir performans yönetim sistemi.",
    bridgeName: "Bridge",
    bridgeDesc:
      "İki sistem arası mutabakatı otomatikleştirin. ERP, banka ekstresi ve kebir verisini eşleştirip farkları anında raporlayın.",
    graphName: "Graph",
    graphDesc:
      "Finansal verinizi etkileşimli panolara dönüştürün. Trend analizi, varyans karşılaştırması ve yönetim raporları tek ekranda.",
    bottomTitle: "Finans ekibiniz için doğru aracı seçin",
    bottomSub: "IFRS Reporting ile başlayın ya da Site Bütçe Yönetimi ile aidat/bütçe takibinizi dijitalleştirin.",
    bottomCta: "Site Bütçe Yönetimi'ni incele",
    contact: "İletişim",
    fxEyebrow: "Ücretsiz Araç",
    fxTitle: "TCMB Kurlar",
    fxSub: "Bugünün alış/satış kurları ve seçtiğiniz tarih aralığı için birden fazla para biriminde dönem ortalaması — TCMB'nin resmi günlük bültenlerinden, giriş yapmadan.",
  },
  en: {
    eyebrow: "A Toolkit For Finance Teams",
    heroTitle1: "Tools that speed up your ",
    heroTitleEm: "finance team's daily work",
    heroTitle2: ".",
    heroSub:
      "From IFRS reporting to reconciliation, from building/site budget management to financial analysis — every tool runs on real accounting logic, at audit standard.",
    live: "Live",
    soon: "Coming soon",
    ifrsName: "IFRS Reporting",
    ifrsDesc:
      "From a statutory trial balance to IFRS financial statements — a Working Trial Balance platform with AJE, RJE and deferred tax automation.",
    aidatName: "Site Budget Management",
    aidatDesc:
      "Manage dues accrual, collections, current account, expenses/income and budgets in one panel — usable from mobile too.",
    csName: "Customer Credit Score",
    csDesc:
      "Score your customers on criteria like risk class, overdue days, payment habits and strategic importance — every weight and threshold is fully yours to configure.",
    kpiName: "Performance Management",
    kpiDesc:
      "Bring company and individual goals into one place — weighted goal entry, self/manager comments, and automatic score calculation in a simple performance management system.",
    bridgeName: "Bridge",
    bridgeDesc:
      "Automate reconciliation between two systems. Match ERP, bank statement and ledger data and report differences instantly.",
    graphName: "Graph",
    graphDesc:
      "Turn your financial data into interactive dashboards. Trend analysis, variance comparison and management reports on one screen.",
    bottomTitle: "Choose the right tool for your finance team",
    bottomSub: "Start with IFRS Reporting, or digitize your dues/budget tracking with Site Budget Management.",
    bottomCta: "Explore Site Budget Management",
    contact: "Contact",
    fxEyebrow: "Free Tool",
    fxTitle: "TCMB Exchange Rates",
    fxSub: "Today's buying/selling rates and a multi-currency period average for any date range you pick — straight from the Central Bank of Türkiye's official daily bulletins, no login required.",
  },
};

export default function HomePage() {
  const { lang } = useLang();
  const s = pick(lang, STRINGS);

  return (
    <>
      <SiteNav />

      <section className="hero">
        <div className="hero-eyebrow">
          <span></span> {s.eyebrow}
        </div>
        <h1 className="hero-title">
          {s.heroTitle1}
          <em>{s.heroTitleEm}</em>
          <br />
          {s.heroTitle2}
        </h1>
        <p className="hero-sub">{s.heroSub}</p>
      </section>

      <section className="products-section">
        <div className="products-grid">
          <Link className="product-card" href="/ifrs/index.html">
            <div className="product-icon icon-blue">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="2" y="2" width="16" height="16" rx="2" />
                <line x1="2" y1="7" x2="18" y2="7" />
                <line x1="2" y1="12" x2="18" y2="12" />
                <line x1="7" y1="2" x2="7" y2="18" />
              </svg>
            </div>
            <div>
              <div className="product-name">{s.ifrsName}</div>
              <div className="product-desc">{s.ifrsDesc}</div>
            </div>
            <div className="product-footer">
              <span className="product-status status-live">{s.live}</span>
              <span className="product-arrow">→</span>
            </div>
          </Link>

          <Link className="product-card" href="/aidat">
            <div className="product-icon icon-green">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M3 8l7-5 7 5v9a1 1 0 01-1 1h-4v-6H8v6H4a1 1 0 01-1-1V8z" />
              </svg>
            </div>
            <div>
              <div className="product-name">{s.aidatName}</div>
              <div className="product-desc">{s.aidatDesc}</div>
            </div>
            <div className="product-footer">
              <span className="product-status status-live">{s.live}</span>
              <span className="product-arrow">→</span>
            </div>
          </Link>

          <Link className="product-card" href="/customer-segmentation">
            <div className="product-icon icon-purple">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
                <circle cx="7" cy="6" r="2.6" />
                <path d="M2.5 17c0-2.8 2-4.6 4.5-4.6s4.5 1.8 4.5 4.6" />
                <circle cx="14.5" cy="7" r="2" />
                <path d="M12.5 12.8c2-.3 4.5.9 4.5 4.2" />
              </svg>
            </div>
            <div>
              <div className="product-name">{s.csName}</div>
              <div className="product-desc">{s.csDesc}</div>
            </div>
            <div className="product-footer">
              <span className="product-status status-live">{s.live}</span>
              <span className="product-arrow">→</span>
            </div>
          </Link>

          <Link className="product-card" href="/kpi-tracker">
            <div className="product-icon icon-blue">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
                <circle cx="10" cy="10" r="7.5" />
                <circle cx="10" cy="10" r="4" />
                <circle cx="10" cy="10" r="0.8" fill="currentColor" />
              </svg>
            </div>
            <div>
              <div className="product-name">{s.kpiName}</div>
              <div className="product-desc">{s.kpiDesc}</div>
            </div>
            <div className="product-footer">
              <span className="product-status status-live">{s.live}</span>
              <span className="product-arrow">→</span>
            </div>
          </Link>

          <Link className="product-card" href="/bridge/index.html">
            <div className="product-icon icon-purple">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M2 14h16M4 14V8a6 6 0 0112 0v6" />
                <line x1="4" y1="14" x2="4" y2="17" />
                <line x1="16" y1="14" x2="16" y2="17" />
                <line x1="10" y1="8" x2="10" y2="14" />
              </svg>
            </div>
            <div>
              <div className="product-name">{s.bridgeName}</div>
              <div className="product-desc">{s.bridgeDesc}</div>
            </div>
            <div className="product-footer">
              <span className="product-status status-soon">{s.soon}</span>
              <span className="product-arrow">→</span>
            </div>
          </Link>

          <Link className="product-card" href="/graph/index.html">
            <div className="product-icon icon-coral">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M3 17V9M9 17V3M15 17v-6M3 17h14" />
              </svg>
            </div>
            <div>
              <div className="product-name">{s.graphName}</div>
              <div className="product-desc">{s.graphDesc}</div>
            </div>
            <div className="product-footer">
              <span className="product-status status-soon">{s.soon}</span>
              <span className="product-arrow">→</span>
            </div>
          </Link>
        </div>
      </section>

      <section className="products-section">
        <div className="hero-eyebrow">
          <span></span> {s.fxEyebrow}
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 300, letterSpacing: "-0.02em", color: "var(--text)", marginBottom: 10 }}>
          {s.fxTitle}
        </h2>
        <p style={{ fontSize: 14, color: "var(--text2)", maxWidth: 640, lineHeight: 1.7, marginBottom: 28 }}>
          {s.fxSub}
        </p>
        <FxRatesPanel />
      </section>

      <section className="bottom-section">
        <h2>{s.bottomTitle}</h2>
        <p>{s.bottomSub}</p>
        <Link className="btn-primary" href="/aidat">{s.bottomCta}</Link>
      </section>

      <footer className="site-footer">
        <span className="footer-left">tools4finance</span>
        <div className="footer-links">
          <Link href="/contact.html">{s.contact}</Link>
        </div>
      </footer>
    </>
  );
}
