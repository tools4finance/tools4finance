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

## TAMAMLANDI (2026-08-10): Customer Segmentation modülü (`app/customer-segmentation/**`, tablolar `CS_` önekli)

Tüm modül bitti, build temiz geçti, commit `90a2d35` ile push edildi. Sayfalar: Dashboard (KPI + skor notu dağılımı donut), Parametreler, Müşteriler (Excel toplu içe aktarma + arama + skor/not/aksiyon kolonları), tekil Skor Kartı (`/customer-segmentation/customers/[id]`), Tekil Skor Hesapla (`/customer-segmentation/scorecard`, kayıtsız what-if hesaplayıcı). Ana sayfada ürün kartı var, adı **"Müşteri Risk Skoru" (TR) / "Customer Credit Score" (EN)** olarak değiştirildi (commit `54ce847` sonrası — klasör/route adı `customer-segmentation` aynı kaldı, sadece görünen isim değişti).

### Kriter motoru YENİDEN YAZILDI (2026-08-10, commit `df54b36`) — artık tamamen kullanıcı tanımlı

İlk versiyon Excel'in 7 sabit kriterini (`CS_criteria_weights.criterion_key` CHECK constraint'i + `computeScore()`'da her kriter için ayrı kod dalı) doğrudan uygulamaya gömmüştü. Kullanıcı geri bildirimi: kriterler ve ağırlıklar tamamen kullanıcı tarafından tanımlanabilmeli — örneğin "Risk Class" tamamen silinebilmeli, sadece pasifleştirilebilir olmamalı. Ayrıca "Çalışma Yılı" bantları belirsizdi ("1-4 yıl" etiketi, gerçek eşleşme mantığından kopuk serbest metindi — 3 değeri nereye düşüyor belli değildi).

**Yeni şema** (`supabase/migrations/20260810000006_cs_generic_criteria_engine.sql`, eski `CS_criteria_weights`/`CS_risk_class_scores`/`CS_overdue_days_bands`/`CS_tenure_bands`/`CS_payment_habit_scores`/`CS_strategic_scores` tablolarını drop edip yerine 3 jenerik tablo koyuyor):
- `CS_criteria` — id, user_id, label (serbest metin), source_field (CS_customers'daki 13 alandan biri: risk_class, overdue_rate, overdue_days, dso, sales_term, years_active, payment_habit, credit_limit, annual_revenue_target, strategic_customer, city, sum_overdue, sum_amount_local), formula_type (lookup/linear/band), direction + linear_min/linear_max (sadece linear), weight, active, display_order.
- `CS_criterion_lookup_values` — herhangi bir lookup-tipi kriter için jenerik değer→puan tablosu (eski risk_class/payment_habit/strategic tablolarının birleşik hali), special_rule (force_100/force_0) korundu.
- `CS_criterion_bands` — herhangi bir band-tipi kriter için jenerik aralık tablosu. **Ambiguity düzeltmesi burada**: artık serbest metin `label` yok, her bandın `min_value`/`max_value` (ikisi de dahil, max_value=null=sınırsız) alanları var ve gösterilen aralık etiketi ("1 – 4", "10+") doğrudan bu sayılardan türetiliyor — etiketin gerçek eşleşme mantığından kopması artık imkansız. Parametreler sayfasında canlı bir çakışma/boşluk kontrolcüsü var (`checkBandIssues()`).

`CS_customers` ve `CS_grade_thresholds` dokunulmadı (zaten jenerikti).

**Motor** (`lib/customerScoring.ts`, tamamen yeniden yazıldı) — `computeScore()` artık hiçbir kriter adına özel kod dalı içermiyor, sadece `formula_type`'a göre lookup/linear/band dispatch yapıyor. `linear` formülü genelleştirildi: `points = weight × normalize(value, linear_min, linear_max)` (yön `direction`'a göre ters çevrilir) — eski `overdue_rate` özel formülü (`weight × (1-rate)`) artık bunun `linear_min=0, linear_max=1, direction=lower_better` özel durumu. `DEFAULT_CRITERIA_TEMPLATE` aynı 6 kriteri (Risk Class dahil) **öneri şablonu** olarak tutuyor — hiçbiri koda gömülü değil, hepsi silinebilir/değiştirilebilir, kod hiçbir yerde "risk_class" string'ine özel davranmıyor.

**Yeni/değişen dosyalar**: `lib/csData.ts` (loadScoringConfig/loadDefaultParameters yeni şemaya göre yeniden yazıldı), `app/customer-segmentation/parameters/page.tsx` (tamamen yeniden yazıldı — kriter kartları: etiket/veri alanı/formül tipi/ağırlık/aktiflik editable + sil, altında formül tipine göre lookup/band alt-tablosu; üstte canlı "Toplam Ağırlık: X/100" rozeti, 100 değilse turuncu "Eksik/Fazla Ağırlık" uyarısı — engelleyici değil, sadece uyarı), `components/CriterionInput.tsx` (yeni paylaşımlı komponent — bir kriterin `source_field`'ının tipine [text/number/fraction/boolean] göre doğru input'u render eder, hem `customers/[id]/page.tsx` hem `scorecard/page.tsx` bunu kullanıyor, artık hiçbir yerde kriter anahtarına göre hardcoded input dalı yok).

**Araştırma** (kullanıcı "repoları ziyaret et, internet araştırması yap" dedi): WebSearch ile açık kaynak kredi skorkart motorları (WoE/FICO-tipi binning, "points-based scorecard") ve CRM lead-scoring UI'ları (HubSpot/Zoho-tipi: her attribute-rule için bağımsız puan değeri) araştırıldı — ikisi de bu tasarımın temel şeklini (kriter başına bağımsız puanlama, ağırlıklı toplam) doğruluyor, mimari sıfırdan bu paternlerden esinlenerek değil ama onlarla tutarlı şekilde kuruldu.

**Demo veri**: 834 müşteri korundu (dokunulmadı), parametreler yeni şemaya taşındı (aynı 6 varsayılan kriter, sadece tenure bantları düzeltildi). Birkaç müşterinin skoru elle çapraz kontrol edildi (örn. AAA + %10 gecikme oranı + 0 gün gecikme + 11 yıl + Good Payer + stratejik değil → 92.5 puan, A+ notu — beklenen formülle eşleşiyor).

**Not**: `CS_grade_thresholds` tablosunda demo kullanıcı için 8 satır var (beklenen 4'ün 2 katı) — muhtemelen "Varsayılan Parametreleri Yükle" butonunun daha önce iki kez tetiklenmesinden kalma, bu migration'ın kapsamı dışında, düzeltilmedi.

## TAMAMLANDI (2026-08-10): KPI Tracker modülü (`app/kpi-tracker/**`, tablolar `KPI_` önekli)

Kullanıcının isteği üzerine (aynı gece, Customer Segmentation'dan hemen sonra) sıfırdan inşa edildi, build temiz geçti, commit `953f7d2` ile push edildi. **Kullanıcı henüz test etmedi** (sabah test edeceğini söyledi) — bu modül canlıda ama hiç kullanıcı verisiyle doğrulanmadı, ilk incelemede dikkat edilmesi gereken en taze modül.

**Ne yapıyor**: Çok basit bir performans yönetim sistemi. İK yöneticisi bir organizasyon açar (`create_kpi_organization` RPC, ilk kullanıcı otomatik `hr_admin` olur), departman ve kişi ekler (kişi = `KPI_members` satırı, `user_id=null`, `invite_status='pending'`). Davet linki yok/mail yok — "Davet Linki Kopyala" sadece `{origin}/login?next=/kpi-tracker` kopyalar, İK bunu manuel iletir. O e-posta ile giriş yapan herhangi bir kullanıcı, `kpi_claim_membership()` RPC'si (her `/kpi-tracker` yüklemesinde `lib/kpiContext.tsx` içinde çağrılıyor) sayesinde otomatik olarak o satıra bağlanır.

İK bir dönem açar (örn. "2026 Hedefler", varsayılan %40 şirket / %60 bireysel ağırlık — `KPI_periods.company_weight_pct`/`individual_weight_pct`), taslakken şirket hedeflerini girer (`KPI_company_goals`, ağırlıkları toplamda %100 olmalı — UI uyarır ama DB'de sert kısıt yok), "Duyur" butonuyla `kpi_announce_period()` RPC'sini çağırır → dönem `active` olur + her üyeye bildirim düşer. Çalışanlar "Hedeflerim" sayfasında salt-okunur şirket hedeflerini görür, kendi bireysel hedeflerini girer (`KPI_individual_goals`, yine %100 toplam uyarısı), kendi gerçekleşme yüzdesini ve yorumunu girer. İK "Sonuçlar" sayfasından şirket hedeflerinin ortak gerçekleşme yüzdesini/yorumunu (tüm organizasyon için tek, kişi bazlı değil) ve her kişinin her bireysel hedefi için yönetici puanı/yorumu girer — bu bir hedefi güncellediğinde `trg_kpi_individual_goals_notify` trigger'ı otomatik bildirim oluşturur. İK dönemi kapatınca (`kpi_close_period()`) herkese "sonuçlarınız açıklandı" bildirimi gider ve "Hedeflerim" sayfası o kişinin final skorunu gösterir.

**Skor formülü** (`lib/kpiScoring.ts`, `lib/customerScoring.ts` ile aynı disiplinde saf/Supabase'siz modül):
`bireysel_skor = Σ(hedef.ağırlık% × (yönetici_puanı ?? kişi_puanı ?? 0))`, `şirket_skoru = Σ(hedef.ağırlık% × gerçekleşme%)`, `final = %şirket_ağırlığı × şirket_skoru + %bireysel_ağırlığı × bireysel_skor`.

**RLS / güvenlik notu**: `KPI_individual_goals` üzerinde `manager_rating`/`manager_comment` alanlarını sadece İK değiştirebilsin diye Postgres RLS'in yapamadığı column-level kısıtı bir **BEFORE INSERT/UPDATE trigger** (`kpi_guard_individual_goal_fields`) ile zorluyoruz — HR olmayan bir çağrı bu alanları değiştirmeye çalışırsa sessizce eski değerine (`UPDATE`) ya da `null`'a (`INSERT`) resetleniyor, hata fırlatmıyor (böylece kişinin kendi `self_rating`/`self_comment` düzenlemesi aynı istekte sorunsuz geçiyor). Şirket hedefleri için böyle bir trigger'a gerek yok çünkü çalışanların o tabloda hiç yazma policy'si yok.

**Bilinçli olarak basit bırakılanlar / ertelenenler**:
- `KPI_period_member_weights` (kişi bazlı %40/%60 override) tablosu şemada var ama UI'da yok — İK şu an sadece dönem geneli ağırlığı ayarlayabiliyor, kişi bazlı override gerekirse tabloya doğrudan satır eklenmesi gerekir.
- Gerçek e-posta/push bildirim yok, sadece uygulama içi (topbar'daki zil ikonu, `KPI_notifications` tablosu, hiçbir client-side insert policy'si yok — sadece RPC'ler ve trigger insert edebiliyor).
- Ağırlık toplamının %100 olması DB seviyesinde zorunlu değil (agregate CHECK constraint Postgres'te satır bazlı olmadığı için pratik değil) — sadece UI uyarısı var, "Duyur" butonu %100 değilse de (onay isteyerek) izin veriyor.
- Dashboard sayfası hafif tutuldu (detaylı skor tablosu yok, onun yerine "Sonuçlar" sayfasına link veriyor) — zaman kısıtı nedeniyle bilinçli kapsam kısıtlaması.
- HR admin'in kendi bireysel hedefleri olabilir mi? Şema/RLS buna izin veriyor (HR da bir `KPI_members` satırı) ama hiç test edilmedi.

**Kritik**: bu modül hiç manuel test edilmedi (build'in geçmesi dışında). Sabah ilk elden test edilmeli: org oluşturma → departman/kişi ekleme → davet linki ile ikinci bir hesapla giriş → auto-claim çalışıyor mu → dönem oluşturma → şirket hedefi girme → duyurma → bildirim gidiyor mu → ikinci hesaptan bireysel hedef girme → İK'nın Sonuçlar sayfasından puanlama → dönem kapatma → final skorun doğru hesaplanması.

## İyileştirme geçişi (HR Performance Management Systems Expert)

HR Performance Management Systems Expert persona'sıyla (`.claude/hr-performance-management-systems-expert.md`), kullanıcının "çok basit bir versiyon" isteği kapsam sınırı korunarak, mevcut KPI Tracker implementasyonu (şema, RLS, trigger'lar, 7 sayfa) tam checklist'e karşı incelendi: veri modeli, workflow, RBAC, audit, skor bütünlüğü, adillik, edge case'ler. Kalibrasyon/9-box/PIP/yetkinlik çerçevesi/360 gibi enterprise özellikler **kasıtlı olarak inşa edilmedi** — aşağıda backlog olarak listelendi.

### Bulunan ve düzeltilen gerçek sorunlar

1. **[KRİTİK, koddaki gerçek bug — talep edilenin ötesinde]** `lib/kpiContext.tsx`'teki üyelik sorgusu (`KPI_members` tablosundan `.order("created_at")` ile, `user_id` filtresi olmadan) sadece RLS'e güveniyordu. RLS (`has_kpi_org_access`) bir organizasyondaki HERKESİN satırını döndürdüğü için (İK'nın kendi satırı dahil, çünkü İK her zaman ilk üye), `memberships.find(m => m.org_id === selectedOrgId)` her zaman dizideki İLK eşleşen satırı (created_at artan sırayla — yani İK yöneticisinin kendi satırı) döndürüyordu. Sonuç: **birden fazla üyesi olan her organizasyonda, İK olmayan her çalışanın `selectedMembership`'i yanlışlıkla İK'nın kendi üyelik satırına çözümleniyordu** — "Hedeflerim" sayfasında hedef eklemeye çalıştıklarında `member_id` olarak İK'nın id'si gönderiliyor, RLS insert policy'si (`is_kpi_member_self(member_id)`) bunu reddediyor, çalışan hiç hedef giremiyordu. Demo veride tam olarak bunu tetikleyecek 9 üyeli bir org var — sabahki ilk manuel testte kesinlikle ortaya çıkacaktı. **Düzeltme**: sorguya `.eq("user_id", userData.user.id)` eklendi. (Not: `lib/aidatContext.tsx`'te de birebir aynı desen var — `site_members` sorgusu da filtresiz, RLS'in `has_site_access` fonksiyonu da aynı şekilde tüm site üyelerini döndürüyor. Kapsam dışı olduğu için dokunulmadı ama aynı sınıf bug orada da mevcut olabilir, ayrı bir görev olarak flag'lenmeli.)
2. **[Gizlilik/RLS, gerçek güvenlik açığı]** `KPI_individual_goals` SELECT policy'si `has_kpi_org_access(org_id)` idi — yani bir organizasyondaki HERHANGİ bir çalışan, doğrudan REST API çağrısıyla (UI'ı hiç kullanmadan) organizasyondaki TÜM kişilerin `self_rating`/`self_comment`/`manager_rating`/`manager_comment` alanlarını okuyabiliyordu. UI bunu hiç göstermiyordu ama "gizli frontend butonuna güvenme" ilkesi gereği asıl sınır RLS'tir. **Düzeltme**: policy `is_kpi_member_self(member_id) or is_kpi_hr_admin(org_id)` olarak sıkılaştırıldı (migration `20260810000007`).
3. **[Audit trail eksikliği — kullanıcının önceden şüphelendiği, doğrulandı]** `manager_rating`/`manager_comment`/`self_rating`/`self_comment` sadece UPDATE'te yerinde değiştirilen sütunlardı, önceki değerin hiçbir izi kalmıyordu — persona'nın "never overwrite original ratings" kuralına aykırı. **Düzeltme**: `KPI_individual_goal_history` tablosu eklendi (append-only, alan/eski değer/yeni değer/değiştiren/zaman), `AFTER UPDATE` trigger'ı (`kpi_log_individual_goal_history`) her değişen izlenen alan (self_rating, self_comment, manager_rating, manager_comment, weight_pct, title) için bir satır yazıyor. Client'ın insert/update/delete policy'si yok (sadece SECURITY DEFINER trigger yazabiliyor — `KPI_notifications` ile aynı desen). Sonuçlar sayfasında (`app/kpi-tracker/results/page.tsx`) her bireysel hedefin yanına "Geçmiş" butonu eklendi — İK bir hedefin değerlendirme geçmişini (eski→yeni, ne zaman) görebiliyor.
4. **[Skor bütünlüğü, gerçek gap]** Bir hedef İK tarafından zaten puanlanmışken (`manager_rating` dolu), çalışan yine de `weight_pct`/`title`/`description`'ını değiştirebiliyor ya da hedefi tamamen silebiliyordu — İK'nın değerlendirmesini sessizce geçersiz kılıp final skoru bozabiliyordu, hiçbir iz bırakmadan. **Düzeltme**: `kpi_guard_individual_goal_fields` trigger'ı genişletildi — `manager_rating` doluyken İK olmayan bir UPDATE artık `weight_pct`/`title`/`description`'ı da eski değerine sabitliyor; DELETE policy'si `manager_rating is null` şartına bağlandı (değerlendirilmiş bir hedefi sadece İK silebilir). `self_rating`/`self_comment` kilitlenmedi çünkü `lib/kpiScoring.ts`'teki `manager_rating ?? self_rating ?? 0` formülü gereği `manager_rating` doluyken zaten skoru etkilemiyorlar. UI (`my-goals/page.tsx`) da bunu yansıtıyor: değerlendirilmiş hedeflerde başlık/ağırlık salt-okunur, "Sil" butonu devre dışı, yeşil "Değerlendirildi" pill'i gösteriliyor.
5. **[Reporting/Manager Experience, küçük ekleme]** İK dashboard'unda dönemin ne kadarının tamamlandığına dair hiçbir gösterge yoktu. Persona'nın "Reporting & Dashboard" bölümü ("her KPI'ın açık bir payda/pay/kapsam mantığı olmalı, sıfır-payda kırılmamalı") uyarınca iki kart eklendi: "Hedef Girişi Tamamlanma" (`hedef girmiş kişi sayısı / toplam kişi`) ve "Değerlendirme Tamamlanma" (`değerlendirilmiş hedef sayısı / toplam hedef`) — her ikisi de payda 0 olduğunda "—" gösteriyor, yanıltıcı %0/%100 yerine.

### Doğrulanan, düzeltme gerektirmeyen (kullanıcının şüphelendiği ama kontrol edilince zaten var olan)

- **Ağırlık toplamı %100 uyarısı**: hem `app/kpi-tracker/periods/[id]/page.tsx` (şirket hedefleri) hem `app/kpi-tracker/my-goals/page.tsx` (bireysel hedefler) hem `app/kpi-tracker/page.tsx` (dashboard) hem `app/kpi-tracker/results/page.tsx` (kişi bazlı, sonuçlar tablosu) zaten `sumWeights`/`isFullyWeighted` (`lib/kpiScoring.ts`) kullanarak görünür, bloklamayan bir "Eksik Ağırlık" pill'i gösteriyordu (Customer Segmentation modülünde bulunan benzer bug'ın burada zaten çözülmüş olduğu doğrulandı) — dokunulmadı.
- **Sıfır-payda / boş durum**: dashboard, results ve my-goals sayfaları hedef sayısı 0 olduğunda skor formüllerinin 0 dönmesini uygun boş-durum mesajlarıyla (`"Henüz hedef girilmedi"` vb.) örtüyor, çökme ya da yanıltıcı %0 yok — dokunulmadı.

### Kasıtlı olarak inşa EDİLMEYEN enterprise özellikler (backlog, öncelik sırasıyla)

1. **Kalibrasyon (calibration session/pre-post rating/change reason)** — kapsam dışı; basit MVP'de tek bir `manager_rating` yeterli. Gerekirse `calibration_session_id` + `pre_calibration_rating`/`calibrated_rating` çiftiyle ayrı bir tabloya ihtiyaç var.
2. **9-box yetenek matrisi (performans × potansiyel)** — kapsam dışı; potansiyeli performanstan türetmeden ayrı bir boyut olarak modellemek gerekir, şu an hiç "potansiyel" kavramı yok.
3. **PIP (Performance Improvement Plan)** — kapsam dışı; hassas veri olduğu için ayrı, kısıtlı-erişimli bir tablo/rol gerekir.
4. **Yetkinlik çerçevesi (competency framework)** — kapsam dışı; şu an sadece hedef bazlı puanlama var, davranışsal/teknik yetkinlik değerlendirmesi yok.
5. **360 derece geri bildirim** — kapsam dışı; anonimlik/eşik gibi ek karmaşıklık gerektirir.
6. **Çok aşamalı onay zinciri (self → manager → 2nd-level → HR → calibration)** — kapsam dışı; şu an tek aşama (çalışan girer, İK puanlar).
7. **Çoklu pencereli dönem state machine (goal-setting → mid-year → year-end → calibration → finalize → archive)** — kapsam dışı; şu an sadece 3 durum var (draft/active/closed).
8. **Kişi bazlı ağırlık override UI'ı** (`KPI_period_member_weights` tablosu şemada zaten var ama hiç UI'ı yok) — önceki oturumda da not edilmişti, hâlâ yapılmadı.
9. **`lib/aidatContext.tsx`'teki aynı sınıf "filtresiz üyelik sorgusu" bug'ı** (yukarıdaki madde 1'e bak) — kapsam dışı (aidat modülüne dokunulmadı) ama flag'lendi, ayrı bir görev olarak ele alınmalı.

## Ölçülebilir hedefler: hedef/gerçekleşen bazlı gerçekleşme % hesaplama (commit `05758d7`)

Kullanıcı isteği: "Ciro Hedefi" gibi bir hedef numerik olmalı, yön (yüksek/düşük iyi) seçilebilmeli, gerçekleşen değer girilince gerçekleşme % **hesaplanmalı**, elle yazılmamalı. LTIFR gibi ters metrikler de var (0 = en iyi, düşük iyi) — hedef %1, gerçekleşen %0,5 ise hedef tutulmuş sayılmalı (naif oran değil, %100).

**Şema** (`supabase/migrations/20260810000008_kpi_goal_targets.sql`): `KPI_company_goals` ve `KPI_individual_goals`'a 4 nullable kolon eklendi — `direction` (`higher_better`/`lower_better`), `target_value`, `actual_value`, `unit` (serbest metin — HR persona dokümanının uyarısı gereği sabit bir enum yapılmadı, birim çok çeşitli). Tamamen opsiyonel/ek: `target_value` boşsa eski manuel yüzde girişi aynen çalışmaya devam eder (mevcut demo verisi ve nitel/milestone tipi hedefler etkilenmedi).

**Formül** (`lib/kpiScoring.ts`, `computeAchievementPct`):
- `higher_better`: `clamp(actual/target*100, 0, 100)` — örn. ciro hedef 1.000.000 / gerçekleşen 800.000 → %80.
- `lower_better`: `clamp(target/actual*100, 0, 100)`, `actual=0` her zaman %100 (sıfırdan iyisi olamaz), `target=0` (sıfır tolerans metriği) sadece `actual=0` ise %100 olur — örn. **LTIFR hedef %1 / gerçekleşen %0,5 → %100 ("hedef tutuldu")**, gerçekleşen %1,5 → %66,7.
- Hesaplanan değer, mevcut `achievement_pct`/`self_rating` kolonuna yazılıyor — `lib/kpiScoring.ts`'deki ağırlıklandırma formülü (`individualScore`/`companyScore`/`finalScore`) hiç değişmedi, sadece bu sayının nereden geldiği değişti.

**Sahiplik**: `KPI_individual_goals`'da `direction`/`target_value`/`unit`, `weight_pct`/`title` ile aynı "yapısal" kilit grubunda (yönetici puanladıktan sonra donuyor — `kpi_guard_individual_goal_fields` güncellendi). `actual_value`, `self_rating`/`self_comment` ile aynı kilitsiz grupta (değerlendirmeden sonra da düzenlenebilir, çünkü puanı artık etkilemiyor). Bilinçli tasarım kararı: yöneticiye ayrı bir "kendi actual_value'su" verilmedi — yönetici, çalışanın hesaplanan gerçekleşmesini (hedef/gerçekleşen/yön formülüyle birlikte) görüp `manager_rating` ile isterse override ediyor, aynı bugünkü self_rating/manager_rating ilişkisi gibi. Ayrı bir paralel "yöneticinin kendi gerçekleşen değeri" alanı gerçek bir kalibrasyon-workflow özelliği, bu MVP'nin kapsamı dışında.

**UI**: `app/kpi-tracker/my-goals/page.tsx` (çalışan: hedef ekleme formunda opsiyonel Yön/Hedef Değer/Birim; hedefi olan satırlarda "Gerçekleşme %" alanı yerine "Gerçekleşen Değer" girişi + hesaplanan % gösterimi), `app/kpi-tracker/periods/[id]/page.tsx` (İK: şirket hedefi tanımlarken aynı opsiyonel alanlar), `app/kpi-tracker/results/page.tsx` (İK: hedefi olan şirket hedeflerinde gerçekleşen değer girişi + hesaplanan %; bireysel hedeflerde hedef/gerçekleşen bilgisi görüntüleniyor).

Formül `node -e` ile elle doğrulandı (LTIFR örneği dahil) — build temiz, push edildi.

## Kurlar (FX rates): dönem ortalama backfill hatası düzeltildi + herkese açık "TCMB Kurlar" widget'ı eklendi

**Hata** (kullanıcı bildirdi): `app/aidat/rates/page.tsx`'teki "Dönem Ortalama Kur" paneli 2025-12-31 – 2026-01-01 aralığını seçince "TCMB kur verisi bulunamadı" veriyordu, oysa 31 Aralık bir iş günüydü. Kök neden veri değil, eksik bir yetenekti: `fx_rates` tablosu (global, site'a bağlı değil) sadece "Şimdi Güncelle" butonuyla (bugünün bülteni) ya da tek tek `?date=` ile dolduruluyordu — hiçbir zaman bir ARALIĞI toplu çekme yolu yoktu, o yüzden daha önce senkronize edilmemiş herhangi bir aralık boş dönüyordu.

**Düzeltme**:
- `lib/tcmbSync.ts` — TCMB bülten çekme/parse/upsert mantığı `app/api/fx-rates/tcmb-sync/route.ts`'ten buraya taşındı (iki route da paylaşıyor, kopyala-yapıştır yok).
- Yeni `POST /api/fx-rates/tcmb-sync-range` — `{startDate, endDate}` alır, hafta sonlarını atlar (TCMB'de bülten yok), aralıkta zaten olan günleri atlar (tekrar aralıklarda ucuz), en fazla 186 gün (~6 ay, Vercel timeout'u aşmasın diye), 6'lı gruplar halinde eşzamanlı çekiyor. `maxDuration = 60`.
- `app/aidat/rates/page.tsx`: ortalama hesaplaması 0 satır dönerse (canWrite kullanıcılar için) "TCMB'den Geçmiş Veri Çek" butonu çıkıyor, tıklanınca bulk-sync'i tetikleyip ortalamayı otomatik yeniden hesaplıyor.
- **Doğrulandı**: yerelde `npm run dev` + `curl` ile tam olarak kullanıcının denediği aralık (2025-12-29 → 2026-01-02) çağrıldı, `{"fetched":5,"failed":0}` döndü, `select * from fx_rates where rate_date between ...` ile 31 Aralık'ın gerçek USD/EUR verisiyle geldiği doğrulandı. İkinci çağrıda zaten var olan günler atlandı (idempotent).

**Herkese açık "TCMB Kurlar" widget'ı** (kullanıcı isteği — Kurlar sayfasının "fiili" kısmı, "Kur Tahmini" hariç, ana sayfaya da konsun):
- `supabase/migrations/20260810000009_fx_rates_public_read.sql` — `fx_rates` SELECT policy'sine `anon` eklendi (yazma yetkisi authenticated'da kalmaya devam ediyor, sadece okuma açıldı — zaten TCMB'nin kendi sitesinde herkese açık veri).
- `components/FxRatesPanel.tsx` — "Bugünün Kurları" + "Dönem Ortalama Kur" (artık **çoklu para birimi** checkbox ile seçilebiliyor, tek `<select>` değil — sonuç tablo halinde, her para birimi bir satır) ortak component olarak çıkarıldı, `canWrite` prop'una göre yazma butonları (Şimdi Güncelle / Geçmiş Veri Çek) gösterip gizliyor. `app/aidat/rates/page.tsx` artık bu component'i kullanıyor (Kur Tahmini bölümü dokunulmadı, ayrı/site-scoped kaldı). Ana sayfaya (`app/page.tsx`) `canWrite` vermeden (salt okunur) eklendi, TR/EN başlık/açıklama `lib/i18n.tsx`'teki mevcut desene uyuyor.
- Not: `FxRatesPanel` component'inin kendi iç metinleri (tablo başlıkları vb.) hâlâ sabit Türkçe — sadece onu saran ana sayfa bölüm başlığı bilingual. Bu, sitenin geri kalanıyla tutarlı (modül içi sayfalar henüz tam bilingual değil, bkz. "Not: topbar deseni değişti" altındaki genel i18n notu).

## Not: topbar deseni değişti (commit `edfac11`, bu handover'dan önce)

`app/aidat/layout.tsx` ve `app/customer-segmentation/layout.tsx`'teki topbar artık eski `.nav-logo` (34px ikon) + `.nav-name` yerine şunu kullanıyor — yeni modül eklerken bu deseni takip et:
```
<Link href="/" className="nav-brand">
  <div className="nav-logo-wordmark">
    <Image src="/logo-wordmark.png" alt="tools4finance" width={1024} height={409} priority />
  </div>
</Link>
<span className="aidat-topbar-title">Modül Adı</span>
```
`.aidat-topbar-title` topbar'a `position: absolute` ile ortalanmış (sol/sağ grup genişliğinden bağımsız). `.nav-logo`/`.nav-name` CSS'ten silindi, kullanma. KPI Tracker layout'u bu yeni deseni kullanıyor.

## Eski durum notu (referans, artık geçerli değil — yukarıdaki "TAMAMLANDI" bölümüne bakın)

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
