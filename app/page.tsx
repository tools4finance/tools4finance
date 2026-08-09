import Link from "next/link";
import SiteNav from "@/components/SiteNav";

export default function HomePage() {
  return (
    <>
      <SiteNav />

      <section className="hero">
        <div className="hero-eyebrow">
          <span></span> Finans Ekipleri İçin Araç Seti
        </div>
        <h1 className="hero-title">
          Finans ekibinizin <em>günlük işini</em>
          <br />
          hızlandıran araçlar.
        </h1>
        <p className="hero-sub">
          IFRS raporlamadan mutabakata, site/bina bütçe yönetiminden finansal analize —
          her araç gerçek muhasebe mantığıyla, denetim standardında çalışır.
        </p>
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
              <div className="product-name">IFRS Reporting</div>
              <div className="product-desc">
                VUK mizanından IFRS finansal tablolara — AJE, RJE, ertelenmiş vergi otomasyonu ile
                çalışan Working Trial Balance platformu.
              </div>
            </div>
            <div className="product-footer">
              <span className="product-status status-live">Aktif</span>
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
              <div className="product-name">Site Bütçe Yönetimi</div>
              <div className="product-desc">
                Aidat tahakkuku, tahsilat, cari hesap, gider/gelir ve bütçe takibini tek panelde
                yönetin — mobilden de kullanılabilir.
              </div>
            </div>
            <div className="product-footer">
              <span className="product-status status-live">Aktif</span>
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
              <div className="product-name">Customer Segmentation</div>
              <div className="product-desc">
                Müşterilerinizi risk sınıfı, vade gecikmesi, ödeme alışkanlığı ve stratejik önem gibi
                kriterlerle puanlayın — tüm ağırlıklar ve eşikler size özel, tamamen düzenlenebilir.
              </div>
            </div>
            <div className="product-footer">
              <span className="product-status status-live">Aktif</span>
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
              <div className="product-name">KPI Tracker</div>
              <div className="product-desc">
                Şirket ve bireysel hedefleri tek yerde toplayın — ağırlıklandırılmış hedef girişi, kişi/yönetici
                yorumları ve otomatik skor hesaplama ile basit bir performans yönetim sistemi.
              </div>
            </div>
            <div className="product-footer">
              <span className="product-status status-live">Aktif</span>
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
              <div className="product-name">Bridge</div>
              <div className="product-desc">
                İki sistem arası mutabakatı otomatikleştirin. ERP, banka ekstresi ve kebir verisini
                eşleştirip farkları anında raporlayın.
              </div>
            </div>
            <div className="product-footer">
              <span className="product-status status-soon">Yakında</span>
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
              <div className="product-name">Graph</div>
              <div className="product-desc">
                Finansal verinizi etkileşimli panolara dönüştürün. Trend analizi, varyans
                karşılaştırması ve yönetim raporları tek ekranda.
              </div>
            </div>
            <div className="product-footer">
              <span className="product-status status-soon">Yakında</span>
              <span className="product-arrow">→</span>
            </div>
          </Link>
        </div>
      </section>

      <section className="bottom-section">
        <h2>Finans ekibiniz için doğru aracı seçin</h2>
        <p>IFRS Reporting ile başlayın ya da Site Bütçe Yönetimi ile aidat/bütçe takibinizi dijitalleştirin.</p>
        <Link className="btn-primary" href="/aidat">Site Bütçe Yönetimi&apos;ni incele</Link>
      </section>

      <footer className="site-footer">
        <span className="footer-left">tools4finance</span>
        <div className="footer-links">
          <Link href="/contact.html">İletişim</Link>
        </div>
      </footer>
    </>
  );
}
