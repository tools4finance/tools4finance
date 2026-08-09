# tools4finance — Handover / Devam Notu

_Son güncelleme: 2026-08-10, konuşma context'i dolduğu için yazıldı. Yeni bir Claude Code oturumu bu dosyayı okuyup kaldığı yerden devam edebilmeli._

## Genel durum

- **tools4finance.com** artık tamamen Next.js (App Router, Next 15, React 19, TS). Eskiden statik HTML siteydi.
- **Deploy**: `git push origin main` → Vercel GitHub entegrasyonu otomatik production'a deploy eder. **Başka hiçbir adım gerekmez.**
- **Auto-mode kuralı (kullanıcı verdi)**: Test aşamasındayız, hiç gerçek kullanıcı yok. Kullanıcı "test aşaması tamamlandı" demeden **onay almadan commit + push + deploy yapılacak**. Her değişiklikten sonra `npm run build` ile doğrula, sonra commit/push.
- **Supabase proje**: ref `jzfdniojscktfcretqmn`, org `tools4finance's Org` (gutklynfasqvzlejcxwz) — **kron'unkinden tamamen ayrı**, kron'a asla dokunma (C:\Users\bhdre\kron salt-okunur referans, düzenlenmedi).
- **Vercel proje**: `tools4financeteam/tools4finance`. CLI `VERCEL_TOKEN` ortam değişkeni ile (registry'de kalıcı, `[Environment]::GetEnvironmentVariable("VERCEL_TOKEN","User")` ile okunuyor — normal `vercel login` bu makinede Türkçe-I bug'ı yüzünden çöküyor, token kullan).
- **Supabase CLI**: `npx supabase db push --linked` ile migration, `npx supabase db query "..." --linked` ile sorgu (RLS'i bypass eder, service-role gibi davranır).
- `.env.local`, `.secrets/` gitignore'lu — Supabase URL/anon key/service role key `.env.local`'da; demo kullanıcı şifresi `.secrets/demo_user_password.local`'da (yeniden yazdırma, zaten bir kere chat'e sızdı, kullanıcıya rotate etmesini önerdim).

## Demo hesap

- E-posta: `demo@tools4finance.com`, şifre `.secrets/demo_user_password.local` dosyasında.
- Demo user id: `9df07bd1-e7cb-49e0-84c2-486785d18b0c`
- "Eser Demo Sitesi" adında aidat modülü için dolu bir demo site var (24 daire, 23 sakin, 6 aylık tahakkuk/tahsilat/gider).

## Tamamlanmış: Aidat / Site Bütçe Yönetimi modülü (`app/aidat/**`)

Tam çalışır durumda, production'da yayında. Sayfalar: Dashboard (KPI + pasta grafik + demo veri butonu), Daireler (+ aidat tutarı alanı), Sakinler (+ Excel toplu içe aktarma), Aidatlar (dairenin kendi tanımlı tutarıyla tahakkuk), Aidat Tutarları (daire×ay matris, kopyala-yapıştır, effective-dated), Tahsilatlar (filtreli: daire/kişi/tarih aralığı), Cari Hesap (arama+PDF/Excel export), Giderler, Diğer Gelirler, Bütçe (relevant-first + kategori ekle), Gelir Tablosu (+ alt segment "+" detayı), Dönem Karşılaştırma (+ alt segment detayı), Trend/Karşılaştırma (pasta grafik), Aidat Aksatanlar (daire filtreli), Kurlar (TCMB), Ayarlar (üye ekle/çıkar), Profilim (şifre belirle/değiştir).

Şema: `supabase/migrations/20260809190000_init_aidat_schema.sql` (ana) + `20260810000000..000003` (fx_rates, profiles phone, find_profile_by_email RPC, site_members/profiles FK fix).

## Şu an yapılıyor: Customer Segmentation modülü (`app/CustomerSegmentation/**`, tablolar `CS_` önekli)

Kullanıcı bir Excel dosyası verdi (`app/CustomerSegmentation/JH_Customer_Segmentation_saat 2213.xlsx`) — içinde hazır bir "Parametrik Risk Skoru Modeli" var (834 satır müşteri verisi + 6 parametre tablosu + tekil müşteri skor kartı şablonu). Bunu web uygulamasına dönüştürüyoruz, **tüm parametreler kullanıcı tarafından düzenlenebilir olmalı** (hardcode değil).

### Tamamlanan
- **Şema** (`supabase/migrations/20260810000004_customer_segmentation_schema.sql`) — push edildi, remote'ta doğrulandı. Tablolar: `CS_customers`, `CS_criteria_weights`, `CS_risk_class_scores`, `CS_overdue_days_bands`, `CS_tenure_bands`, `CS_payment_habit_scores`, `CS_strategic_scores`, `CS_grade_thresholds`. RLS basit: her tablo `user_id = auth.uid()` (site/tenant kavramı yok, aidat'tan farklı).
- **Skorlama motoru** (`lib/customerScoring.ts`) — `computeScore(customer, config)` fonksiyonu + Excel'den birebir alınmış varsayılan parametre değerleri (`DEFAULT_*` export'ları). **Tüm sayfalar bu dosyayı import etmeli, formülü tekrar yazmamalı.**
- **Seed script** hazır: `C:\Users\bhdre\AppData\Local\Temp\claude\...\scratchpad\gen_cs_seed.js` (node, xlsx paketini kullanıyor) → çıktı: aynı klasörde `cs_seed.sql` (834 müşteri + 6 parametre tablosunun varsayılan değerleri, demo user'a). **Bu dosya henüz DB'ye uygulanmadı** (`CS_customers` şu an 0 satır — kontrol edildi).
- `components/DonutChart.tsx` — yeni, gerçek SVG donut chart (responsive, hover tooltip, dilim üzeri % etiketi). Dashboard ve Trend sayfalarındaki eski conic-gradient div'lerin yerine geçti (o değişiklik commit edilmedi henüz, aşağıya bak).

### Yapılmadı / sıradaki adımlar (bu sırayla devam et)
1. **Seed'i çalıştır**: `npx supabase db query -f ".../scratchpad/cs_seed.sql" --linked` (dosya yolu için scratchpad'e bak, session'a göre değişebilir — script'i tekrar çalıştırmak gerekebilir, path session id'sine bağlı).
2. **3 sayfayı inşa et** (henüz hiçbiri yok, `app/CustomerSegmentation/` altında sadece xlsx duruyor):
   - **Parametreler sayfası**: 6 tabloyu (weights/active, risk class puanları, overdue days bantları, tenure bantları, payment habit puanları, strategic puanları, grade eşikleri) düzenlenebilir grid olarak göster + "Varsayılanları Yükle" butonu (lib/customerScoring.ts'deki DEFAULT_* dizilerini kullanır).
   - **Müşteri Listesi**: tablo (CS_customers), Excel'den toplu yapıştırma/içe aktarma (aidat/residents'daki xlsx pattern'i örnek al), her satırda hesaplanan skor (computeScore ile).
   - **Tekil Skor Kartı**: bir müşteri seç, Excel'in "Tekil Müşteri" sayfasındaki gibi kriter/max/input/skor/puan-çubuğu tablosu + toplam skor/not/aksiyon sinyali.
   - Ana sayfaya (`app/page.tsx`) yeni bir ürün kartı ekle: "Customer Segmentation" → `/CustomerSegmentation` veya `/customer-segmentation` (route'u nasıl kuracağına karar ver — kullanıcı klasörü büyük harfle açtı, Next.js route case-sensitive, URL büyük harfli kalabilir ya da lowercase'e taşınabilir).
   - Bu modülün kendi basit layout'u/nav'ı gerekebilir (aidat'ın layout.tsx'i gibi ama site-switcher yok, sadece kullanıcı bazlı).
3. **Araştırma ajanı** (kullanıcı istedi): benzer customer segmentation/KPI araçlarına bakıp, sormadan iyi bulduğu şeyleri uygulasın — ama bu, temel 3 sayfa bittikten SONRA, ayrı bir dalga olarak gönderilmeli (dosya çakışmasın diye).

## Bilinen backlog (öncelik sırasıyla, kullanıcı "sen sıraya koy" dedi)

1. Dashboard + Trend sayfalarını birleştirme fikri + "dönem" olan her yerde tekli ay yerine aralık seçme opsiyonu (henüz yapılmadı).
2. Fiili ve Projeksiyon bütçeleme modülü (enflasyon endeksli 12 aylık bütçe, yıl içi revizyon) + TCMB ileri kur tahmini geliştirmeleri.
3. Rakip araştırmasından çıkan öneriler (öncelik sırasıyla): arıza/talep takip sistemi, ortak alan rezervasyonu, sayaç bazlı ısı/su gider paylaşımı, tedarikçi/sözleşme yönetimi, icra/yasal takip, genel kurul + e-oylama, banka ekstresi otomatik eşleştirme, online ödeme (kredi kartı).
4. **EN SON** (kullanıcı açıkça "son görevin" dedi): mevcut aidat SQL tablolarının hepsinin başına `aidat_` öneki ekle (şu an: sites, blocks, units, residents, accruals, payments, vb. — CS_ ile karışmasın diye). **Büyük ve riskli refactor**: ~20 tabloyu rename + tüm RLS policy isimlerini + tüm `.from("...")` çağrılarını (aidat/**/*.tsx içinde onlarca dosya) güncellemek gerekir. Dikkatli ve kapsamlı test edilmeden yapılmamalı.

## Henüz commit edilmemiş değişiklikler (bu oturumda yapıldı, kontrol et)

`git status` çalıştır — şu an muhtemelen: `app/aidat/page.tsx`, `app/aidat/reports/trend/page.tsx` (DonutChart entegrasyonu), `app/globals.css` (marka renkleri lacivert→açık cyan-mavi `#0EA5E9`, tablo genişliği fix, nav-logo büyütme), `app/aidat/layout.tsx` (gerçek logo entegrasyonu) — bunlar **build edilip test edilmeden commit edilmemiş olabilir, önce `npm run build` çalıştır.**

## Önemli teknik notlar / tuzaklar

- **Vercel proje ayarı bir kere "Framework: Other" takılı kalmıştı** (eski statik site döneminden) — `vercel project update tools4finance --framework nextjs --auto-detect ...` ile düzeltildi. Bir daha böyle bir "build başarılı ama site 404/500" durumu görürsen önce bunu kontrol et.
- **Vercel/Supabase CLI login bu makinede Türkçe-I bug'ı yüzünden çöküyor** (bilgisayar adı "Bahadir" içinde 'i' harfi Türkçe locale'de "ı"ya çevrilip header'ı bozuyor). Token-tabanlı login kullan (yukarı bak).
- **Tablolar responsive olmalı, `width:100%` zorlama** — `table.data-table { width: auto; }` (fix edildi), `.table-scroll` overflow-x:auto ile scroll veriyor.
- **DonutChart** paylaşımlı komponent, yeni pasta grafik gereken her yerde onu kullan, conic-gradient tekrar yazma.
- Excel export/import için `lib/exportTable.ts` (Excel/PDF) ve `xlsx` npm paketi zaten kurulu, tekrar eklemeye gerek yok.
- Ortak CSS class'ları: `.panel`, `.kpi-grid`/`.kpi-card`, `.table-scroll`>`table.data-table`, `.pill`/`.pill-{green,amber,coral,blue,neutral}`, `.unit-picker-dropdown`/`.unit-picker-item` (aranabilir combobox pattern, unit'e özel değil, her yerde reuse edilebilir), `.auth-field`/`.auth-error`/`.auth-info`, `.btn-primary`/`.btn-secondary`/`.btn-danger`.
- 23+ ajan paralel çalıştırma pattern'i kullanıldı bu oturumda — büyük özellikleri, dosya çakışmayacak şekilde bölüp `general-purpose` subagent'lara dağıtmak hızlı ve güvenli çalıştı; her ajana tam bağlam (şema, konvansiyonlar, dosya kapsamı) ver.
