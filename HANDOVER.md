# tools4finance — Handover / Devam Notu

_Son güncelleme: 2026-08-11. Yeni bir Claude Code oturumu bu dosyayı okuyup kaldığı yerden devam edebilmeli. Bu dosya kronolojik günlük değil — CURRENT STATE + bilinen tuzaklar + backlog. Eski/geçersiz içerik temizlendi._

## Genel durum

- **tools4finance.com** — Next.js 15 (App Router), React 19, TS strict, Supabase, Vercel.
- **Deploy**: `git push origin main` → Vercel otomatik production'a deploy eder. Başka adım gerekmez.
- **Kullanıcı iletişim dili**: Türkçe (kullanıcı açıkça istedi — sohbet yanıtları Türkçe olmalı).
- **Auto-mode kuralı (kullanıcı verdi, hâlâ geçerli)**: Test aşamasındayız, gerçek kullanıcı yok. Kullanıcı "test aşaması tamamlandı" demeden **onay almadan commit + push + deploy yapılacak**. Her değişiklikten sonra `npm run build` ile doğrula, sonra commit/push. `git status` çalıştır, sadece değiştirdiğin dosyaları `git add` et — repo kökünde `.claude.zip` adında kullanıcıya ait, commit edilmemesi gereken bir dosya duruyor, `-A` kullanma.
- **Supabase proje**: ref `jzfdniojscktfcretqmn`, org `tools4finance's Org`. **kron'unkinden tamamen ayrı**, `C:\Users\bhdre\kron`'a asla dokunma.
- **Vercel proje**: `tools4financeteam/tools4finance`. CLI `VERCEL_TOKEN` ortam değişkeni ile (`[Environment]::GetEnvironmentVariable("VERCEL_TOKEN","User")`) — normal `vercel login` bu makinede Türkçe-I locale bug'ı yüzünden çöküyor.
- **Supabase CLI**: `npx supabase db push --linked` (migration), `npx supabase db query "..." --linked` (sorgu, RLS bypass).
- `.env.local`, `.secrets/` gitignore'lu.
- **Ajan orkestrasyon**: Bu proje boyunca büyük/orta ölçekli işler (yeni modül, büyük refactor) arka planda `Agent` (fork ya da general-purpose) ile paralel yürütüldü — dosya çakışmayan işler aynı anda birden fazla ajana verilebilir. `.claude/*.md` altında bir "agent roster" var (23+ persona dosyası, örn. `hr-performance-management-systems-expert.md`, `supabase-architect.md`) — büyük işlerde ilgili persona dosyasını ajana okut, kapsamı persona'nın tam checklist'iyle ama "basit MVP" sınırını koruyarak sınırla.

## Demo hesap

- E-posta: `demo@tools4finance.com`, şifre `.secrets/demo_user_password.local`.
- Demo user id: `9df07bd1-e7cb-49e0-84c2-486785d18b0c`.
- Bu kullanıcının altında 3 modülde de dolu demo veri var (aşağıya bak).

---

## Modül 1: Site Bütçe Yönetimi / aidat (`app/aidat/**`, tablolar öneksiz)

Stabil, canlıda, kapsamlı test edildi. Demo: "Eser Demo Sitesi" (24 daire, 23 sakin, 6 aylık tahakkuk/tahsilat/gider).

Sayfalar: Dashboard (KPI + donut + demo veri butonu), Daireler, Sakinler (+Excel içe aktarma), Aidatlar, Aidat Tutarları (daire×ay matris), Tahsilatlar, Cari Hesap, Giderler, Diğer Gelirler, Bütçe, Gelir Tablosu, Dönem Karşılaştırma, Trend/Karşılaştırma, Aidat Aksatanlar, **Kurlar** (bkz. aşağıda FX bölümü), Ayarlar, Profilim.

Şema: `20260809190000_init_aidat_schema.sql` (ana) + `20260810000000..000003`.

**Bilinen açık konu**: `lib/aidatContext.tsx`'teki üyelik sorgusu (`site_members`) `user_id` filtresi olmadan RLS'e güveniyor — KPI Tracker'da bulunan aynı sınıf bug (bkz. Modül 3) burada da olabilir, henüz kontrol edilmedi/düzeltilmedi. Çok-üyeli bir sitede sorun yaratabilir.

---

## Modül 2: Müşteri Risk Skoru / Customer Segmentation (`app/customer-segmentation/**`, tablolar `CS_` önekli)

Stabil, canlıda. Görünen ad: **"Müşteri Risk Skoru" (TR) / "Customer Credit Score" (EN)** — route/klasör adı `customer-segmentation` olarak kaldı, sadece görünen isim değişti.

**Skorlama motoru tamamen kullanıcı tanımlı** (kritik tasarım kararı — kullanıcı "Excel'in 7 sabit kriterini gömme, hepsi silinebilir/eklenebilir olsun" dedi):
- `CS_criteria` — id, user_id, label (serbest metin), source_field (CS_customers'daki 13 alandan biri), formula_type (`lookup`/`linear`/`band`), direction+linear_min/max (sadece linear), weight, active, display_order. **Sabit bir kriter listesi/CHECK constraint'i yok.**
- `CS_criterion_lookup_values` — herhangi bir lookup-tipi kriter için jenerik değer→puan (force_100/force_0 override destekli).
- `CS_criterion_bands` — herhangi bir band-tipi kriter için jenerik aralık. Etiket serbest metin DEĞİL — `min_value`/`max_value`'dan türetiliyor ("1 – 4", "10+"). **Eşleşme mantığı ceiling-match** (sıralı, en küçük `max_value ≥ değer` olan ilk bandı bulur) — min/max pencere değil, çünkü pencere mantığı "0-7" ile "8-30" arası gibi görünen boşluklara düşen ondalıklı değerleri (örn. 7.01) yanlışlıkla 0 puanla cezalandırıyordu. Artık böyle bir değer otomatik bir sonraki dilime giriyor. Parametreler sayfasında canlı çakışma kontrolcüsü var (`checkBandIssues` — artık sadece gerçek çakışmaları uyarıyor, "boşluk" uyarısı kaldırıldı çünkü artık zararsız).
- `CS_customers`, `CS_grade_thresholds` jenerik, dokunulmadı.

Motor: `lib/customerScoring.ts` — `computeScore()` hiçbir kriter adına özel dal içermiyor, sadece `formula_type`'a dispatch yapıyor. `DEFAULT_CRITERIA_TEMPLATE` "önerilen başlangıç şablonu" — **Risk Class artık bu şablonda YOK** (kullanıcının açık isteğiyle çıkarıldı, "Varsayılan Parametreleri Yükle" butonundan da gelmiyor). Şu an varsayılan şablon 5 kriter: Overdue Rate (25), Overdue Days (30), Çalışma Yılı (5), Payment Habit (10), Stratejik Müşteri (5) — **toplam 75/100**, kasıtlı olarak 100'e tamamlanmadı (kullanıcı kendi ekleyeceği/ağırlıklandıracağı için) — "Eksik Ağırlık" uyarısı bu yüzden demo hesapta hep görünür, normal.

Sayfalar: Dashboard, Parametreler (kriter kartları: ekle/sil/düzenle + canlı ağırlık toplamı rozeti), Müşteriler (Excel içe aktarma + arama), tekil Skor Kartı (`customers/[id]`), Tekil Skor Hesapla (`/scorecard`, kayıtsız what-if hesaplayıcı — `components/CriterionInput.tsx` kullanıyor, kriter tipine göre dinamik input üretir).

Demo veri: 834 müşteri (dokunulmadı). **Not**: demo hesabın parametrelerinde bir ara migration/reseed sürecinden kalma duplicate kriterler ve eksik Risk Class oluşmuştu — elle SQL ile temizlendi (dedupe + Risk Class'ı geri ekleyip sonra kullanıcı isteğiyle tekrar sildi). Şu an temiz: 5 kriter, her biri bir kez.

---

## Modül 3: Performans Yönetim Sistemi / KPI Tracker (`app/kpi-tracker/**`, tablolar `KPI_` önekli)

Canlıda, HR-persona incelemesinden geçti, ölçülebilir hedef desteği eklendi, rol bazlı erişim sıkılaştırıldı. Görünen ad: **"Performans Yönetim Sistemi" (TR) / "Performance Management" (EN)**.

**Temel akış**: İK bir organizasyon açar (ilk kullanıcı otomatik `hr_admin`), departman/kişi ekler (`KPI_members`, `user_id=null`, davet e-postası kopyala-yapıştır ile manuel iletiliyor — gerçek e-posta gönderimi yok). O e-postayla giriş yapan kullanıcı `kpi_claim_membership()` RPC'siyle otomatik bağlanır. İK bir dönem açar (%40 şirket/%60 bireysel varsayılan ağırlık), şirket hedeflerini girer, "Duyur"la yayınlar. Çalışanlar "Hedeflerim"de bireysel hedeflerini girer. İK "Sonuçlar"dan puanlar, dönemi kapatır.

**Rol bazlı erişim (RBAC) — kullanıcı isteğiyle sıkılaştırıldı**: `KPI_members.role` (`hr_admin`/`employee`) zaten vardı ama sadece bazı sayfalarda (Departmanlar/Kişiler/Sonuçlar) hem nav'da gizli hem sayfa içinde `canManage` guard'lıydı. Dashboard, Dönemler ve dönem detay sayfasında HİÇBİR guard yoktu — URL bilse bir çalışan org-geneli veriyi görebilirdi. **Artık her admin-only sayfada `if (!canManage) return <empty-state>` var** (`app/kpi-tracker/page.tsx`, `periods/page.tsx`, `periods/[id]/page.tsx`), nav'da da (`app/kpi-tracker/layout.tsx`, `NAV_ITEMS[].adminOnly`) sadece "Hedeflerim" her role görünüyor.

**Yeni: `/kpi-tracker/reports` (İK-only)** — kullanıcı isteğiyle eklendi, kişi bazlı toplu rapor: satır=kişi, kolon=departman + her şirket hedefinin gerçekleşme %'si (dönemdeki şirket hedefi sayısı kadar dinamik kolon) + bireysel hedef sayısı/ağırlık toplamı/skoru + final skor + değerlendirme tamamlanma oranı + bireysel hedeflerin metin özeti. Excel export var (`lib/exportTable.ts`).

**Ölçülebilir hedefler** (kullanıcı isteği: "Ciro Hedefi gibi hedefler numerik olmalı, yön seçilebilmeli, gerçekleşme % elle değil hesaplanarak gelmeli"): `KPI_company_goals` ve `KPI_individual_goals`'a nullable `direction`/`target_value`/`actual_value`/`unit` kolonları eklendi (migration `20260810000008`). `target_value` boşsa eski manuel yüzde girişi aynen çalışır (geriye dönük uyumlu). Formül `lib/kpiScoring.ts::computeAchievementPct`:
- `higher_better`: `clamp(actual/target*100, 0, 100)`.
- `lower_better`: `clamp(target/actual*100, 0, 100)`, `actual=0`→100, `target=0`→(`actual=0` ise 100 yoksa 0). Örnek: LTIFR hedef %1, gerçekleşen %0,5 (düşük iyi) → **%100** ("hedef tutuldu"), naif oran değil.
- Hesaplanan değer mevcut `self_rating`/`achievement_pct` kolonuna yazılıyor, ağırlıklandırma formülü (`individualScore`/`companyScore`/`finalScore`) değişmedi.

**Skor formülü** (`lib/kpiScoring.ts`): `bireysel_skor = Σ(ağırlık% × (yönetici_puanı ?? kişi_puanı ?? 0))`, `şirket_skoru = Σ(ağırlık% × gerçekleşme%)`, `final = %şirket_ağırlığı×şirket_skoru + %bireysel_ağırlığı×bireysel_skor`.

**Audit trail**: `KPI_individual_goal_history` tablosu + `AFTER UPDATE` trigger — rating/comment/weight/title değişiklikleri kayıt altında (append-only, client insert/update policy'si yok). Sonuçlar sayfasında her hedefin yanında "Geçmiş" butonu.

**Alan bazlı kilit**: Bir hedef İK tarafından puanlandıktan (`manager_rating` dolu) sonra çalışan `weight_pct`/`title`/`description`/`direction`/`target_value`/`unit`'i değiştiremez, hedefi silemez (`kpi_guard_individual_goal_fields` trigger'ı) — puanlamayı sessizce geçersiz kılmasın diye. `self_rating`/`self_comment`/`actual_value` kilitlenmedi (skoru artık etkilemiyorlar çünkü `manager_rating ?? self_rating` formülünde manager_rating öncelikli).

**Migrasyonlar sırası**: `20260810000005` (ana şema) → `000007` (hardening: impersonation bug fix, RLS sıkılaştırma, audit trail, alan kilidi) → `000008` (ölçülebilir hedefler).

**Bilinçli olarak inşa EDİLMEYEN (backlog, enterprise kapsamı)**: kalibrasyon, 9-box, PIP, yetkinlik çerçevesi, 360 derece, çok aşamalı onay zinciri, çoklu pencereli dönem state machine, kişi bazlı ağırlık override UI'ı (`KPI_period_member_weights` tablosu var, UI yok). Gerekçeler HR persona incelemesinde detaylı.

**Demo veri**: org "Tools4Finance Demo A.Ş.", 5 departman, 9 kişi (1 İK + 8 çalışan, hepsi `pending` — hiç claim edilmedi), "2026 Hedefler" (active, 3 şirket hedefi + 26 bireysel hedef, karışık değerlendirme durumunda) + "2027 Hedefler" (draft, boş — duyuru akışını sıfırdan test etmek için).

---

## Marka / Logo / Navbar (`components/BrandMark.tsx`, tüm topbar'larda kullanılıyor)

Birkaç iterasyondan sonra şu an: ikon (`logo-icon.png`, gerçek alfa şeffaflığı var — renk tipi 6) + yazılı wordmark (resim değil, gerçek metin — `logo-wordmark.png` header yüksekliğinde soluk kaldığı için text olarak yazıldı):
```tsx
<div className="nav-logo"><Image src="/logo-icon.png" width={46} height={46} /></div>
<span className="nav-wordmark">
  <span className="nw-tools">tools</span>
  <span className="nw-4">4</span>
  <span className="nw-tools">finance</span>
</span>
```
Renk: "tools" ve "finance" `var(--text)` (lacivert/koyu), sadece "4" rakamı `var(--green)`. İkon kutusu açık temada **transparent** (46x46, büyütüldü), koyu temada beyaz zemin (`[data-theme="dark"] .nav-logo`) çünkü ikonun lacivert çizgi işi koyu arka planda kontrastsız kalıyor. Yeni bir modül eklerken bu component'i kullan, tekrar yazma — `SiteNav.tsx`, `app/aidat/layout.tsx`, `app/customer-segmentation/layout.tsx`, `app/kpi-tracker/layout.tsx`, `app/login/page.tsx` hepsi bunu kullanıyor.

Ana renk paleti: `--accent` açık cyan-mavi (`#0EA5E9` light / `#38BDF8` dark, kullanıcı tercihi), `--green` logonun teali (`#029982` light / `#3FDDB0` dark, sadece "4" ve semantik "iyi" durumlar için, accent değil).

---

## i18n (`lib/i18n.tsx`)

Paylaşımlı `LangProvider`/`useLang()`/`t()` — `localStorage` (`t4f_lang`) ile kalıcı, `SiteNav`'daki TR/EN toggle'ı ayarlıyor. **Kapsam**: ana sayfa (`app/page.tsx`) tam bilingual, her modülün topbar başlığı (`aidat-topbar-title`) bilingual. **Modül İÇİ sayfalar (dashboard'lar, tablolar, formlar) HENÜZ bilingual DEĞİL** — hep Türkçe sabit. Kullanıcı EN'e geçerse topbar İngilizce, altındaki içerik Türkçe kalır (kafa karıştırıcı ama beklenen davranış, bilinen bir eksik). Tam site-geneli çeviri hâlâ backlog'da (bkz. aşağı) — büyük bir iş, aidat/CS/KPI'ın ~30 sayfasını kapsıyor, aynı anda başka bir ajanın o dosyalara dokunmadığı bir zamanda yapılmalı.

---

## Kurlar / FX rates (`components/FxRatesPanel.tsx`, `lib/tcmbSync.ts`)

- `fx_rates` tablosu global (site'a bağlı değil), `fx_forecasts` site-scoped (bütçe amaçlı manuel tahmin, ayrı kaldı).
- **Tek gün senkronizasyonu**: `POST/GET /api/fx-rates/tcmb-sync` (bugün ya da `?date=`).
- **Aralık senkronizasyonu** (bug fix — önceden hiç yoktu, "Dönem Ortalama Kur" bu yüzden boş dönüyordu): `POST /api/fx-rates/tcmb-sync-range` `{startDate,endDate}` — hafta sonlarını atlar, zaten var olan günleri atlar, en fazla 186 gün, 6'lı paralel gruplar, `maxDuration=60`. Ortak parse/upsert mantığı `lib/tcmbSync.ts`'te (iki route da kullanıyor).
- **Herkese açık widget**: `fx_rates` SELECT policy'sine `anon` eklendi (migration `20260810000009`, yazma hâlâ authenticated-only). `FxRatesPanel` component'i hem `/aidat/rates` (canWrite=true, senkron/backfill butonları görünür) hem ana sayfada "TCMB Kurlar" başlığıyla (canWrite yok, salt okunur) kullanılıyor. Çoklu para birimi checkbox ile seçilip tablo halinde gösteriliyor (eski tek-seçmeli değil).
- **Tarih girişi**: `<input type="date">` KULLANMA — `lang="tr"` denendi, Chromium'da hiç etkisi yok (tarayıcının kendi UI dilini kullanıyor, sayfanın `lang`'ını değil). Bunun yerine `components/TrDateInput.tsx` — düz metin input, her zaman gg.aa.yyyy gösterip parse ediyor, tarayıcı diline bakmaksızın. Sitedeki TÜM tarih girişleri (Kurlar, Sakinler, Tahsilatlar, Giderler, Diğer Gelirler, Aidatlar) buna geçirildi — yeni bir tarih inputu gerekirse bunu kullan, native `type="date"` kullanma.

---

## Genel CSS / layout notları

- `.kpi-grid`, `.form-grid`: `grid-template-columns: repeat(auto-fill, minmax(X, Y))` — **`auto-fit`+`1fr` KULLANMA**, az sayıda kart/alan varken tüm satırı doldurup gereksiz yere genişliyorlardı (kullanıcı şikayeti). Fazla alan artık satır sonunda boş kalıyor, kartlar/alanlar kendi doğal boyutunda kalıyor.
- `DonutChart.tsx`: donut sarmalayıcısında `margin:"0 auto"` YOK — flex satırında auto-margin tüm boş alanı yutup donut+legend grubunu ortaya/sağa kaydırıyordu.
- Genel `input[type=text/number/...]`, `select`, `textarea` artık `var(--bg2)` arka plan + görünür kenarlık alıyor (global base rule) — önceden `.auth-field` dışındaki çıplak inputlar tarayıcı varsayılanına kalıp beyaz panelde neredeyse görünmüyordu.
- `.cell-pending` — KPI Tracker'da "başkasının girişini bekleyen" hücreler (örn. henüz değerlendirilmemiş yönetici puanı) için amber pill, düz "—" yerine.
- Tablolar: `table.data-table { width: auto }` (100% değil), `.table-scroll` overflow-x:auto sarmalıyor.
- Butonlar: `.btn-primary` (mavi, ana aksiyon), `.btn-secondary` (nötr), `.btn-danger` (kırmızı, silme).
- Excel export/import: `lib/exportTable.ts` (Excel/PDF) + `xlsx` paketi zaten kurulu.
- Ortak class'lar: `.panel`/`.panel-header`/`.panel-title`, `.kpi-card`/`.kpi-label`/`.kpi-value`/`.kpi-sub`, `.pill`+`.pill-{green,amber,coral,blue,neutral}`, `.auth-field`/`.auth-error`/`.auth-info`, `.empty-state`.

---

## Bilinen backlog (öncelik sırasıyla)

1. **Site-geneli i18n** — modül içi sayfaların (dashboard'lar, tablolar, formlar) tam TR/EN çevirisi. Büyük iş, ~30 dosya, `lib/i18n.tsx`'teki paterni takip et. Aynı anda o dosyalara dokunan başka bir ajan yokken yapılmalı.
2. `lib/aidatContext.tsx`'teki filtresiz üyelik sorgusu — KPI Tracker'da bulunan aynı sınıf bug burada da olabilir (bkz. Modül 1), kontrol edilip gerekirse düzeltilmeli.
3. Dashboard + Trend sayfalarını birleştirme + "dönem" olan her yerde aralık seçme opsiyonu (aidat).
4. Fiili ve Projeksiyon bütçeleme modülü (enflasyon endeksli 12 aylık bütçe) + TCMB ileri kur tahmini geliştirmeleri.
5. Rakip araştırmasından öneriler: arıza/talep takip, ortak alan rezervasyonu, sayaç bazlı gider paylaşımı, tedarikçi/sözleşme yönetimi, icra/yasal takip, genel kurul+e-oylama, banka ekstresi eşleştirme, online ödeme.
6. **EN SON** (kullanıcı açıkça "son görevin" dedi): mevcut aidat SQL tablolarının başına `aidat_` öneki ekle (CS_/KPI_ ile karışmasın diye). Büyük/riskli refactor — ~20 tablo rename + tüm RLS policy + tüm `.from("...")` çağrıları. Kapsamlı test edilmeden yapma.

## Önemli teknik tuzaklar

- **Vercel Framework Preset** bir kere "Other"a takılı kalmıştı (eski statik site döneminden) — build başarılı ama site 404/500 veriyorsa önce `vercel project ls`/ayarları kontrol et.
- **Vercel/Supabase CLI login** bu makinede Türkçe-I locale bug'ı yüzünden çöküyor — token-tabanlı kullan.
- **`<input type="date">` KULLANMA** — yukarı bak, `TrDateInput` kullan.
- **Native tarayıcı `lang` attribute'u date input formatını etkilemiyor** (Chromium tarayıcının kendi UI diline bakıyor) — genel ders: tarayıcı-native form kontrollerinin locale davranışına güvenme, kendi component'ini yaz.
