"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { AidatProvider, useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";

const NAV_ITEMS = [
  { href: "/aidat", label: "Dashboard" },
  { href: "/aidat/units", label: "Daireler" },
  { href: "/aidat/residents", label: "Sakinler" },
  { href: "/aidat/dues", label: "Aidatlar" },
  { href: "/aidat/dues/rates", label: "Aidat Tutarları" },
  { href: "/aidat/payments", label: "Tahsilatlar" },
  { href: "/aidat/current-account", label: "Cari Hesap" },
  { href: "/aidat/expenses", label: "Giderler" },
  { href: "/aidat/incomes", label: "Diğer Gelirler" },
  { href: "/aidat/budget", label: "Bütçe" },
  { href: "/aidat/reports", label: "Gelir Tablosu" },
  { href: "/aidat/reports/comparison", label: "Dönem Karşılaştırma" },
  { href: "/aidat/reports/trend", label: "Trend / Karşılaştırma" },
  { href: "/aidat/reports/late-payers", label: "Aidat Aksatanlar" },
  { href: "/aidat/rates", label: "Kurlar" },
  { href: "/aidat/settings", label: "Ayarlar" },
  { href: "/aidat/profile", label: "Profilim" },
];

const MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

function NewSiteForm() {
  const { refreshSites } = useAidat();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("create_site", {
      p_name: name,
      p_address: address || null,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setName("");
    setAddress("");
    await refreshSites();
  }

  return (
    <div className="aidat-empty">
      <h2>İlk siteni ekle</h2>
      <p>Site Bütçe Yönetimi&apos;ni kullanabilmek için önce bir site/bina tanımlamalısın. Birden fazla site tanımlayabilir ve hepsini aynı hesapla yönetebilirsin.</p>
      <form onSubmit={handleSubmit} className="aidat-empty-form">
        <label className="auth-field">
          <span>Site Adı</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="örn. Lokaston Sitesi" />
        </label>
        <label className="auth-field">
          <span>Adres</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="opsiyonel" />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button className="btn-primary" type="submit" disabled={saving || !name}>
          {saving ? "Kaydediliyor…" : "Site Oluştur"}
        </button>
      </form>
    </div>
  );
}

function AidatShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { loading, user, sites, selectedSiteId, selectedSite, selectSite, year, month, setPeriod } = useAidat();
  const [showNewSite, setShowNewSite] = useState(false);

  if (loading) {
    return <div className="aidat-loading">Yükleniyor…</div>;
  }

  if (!user) {
    if (typeof window !== "undefined") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
    return <div className="aidat-loading">Yönlendiriliyor…</div>;
  }

  if (sites.length === 0 || showNewSite) {
    return (
      <div className="aidat-page">
        <AidatTopBar minimal />
        <NewSiteForm />
      </div>
    );
  }

  const years = [year - 1, year, year + 1];

  return (
    <div className="aidat-page">
      <AidatTopBar
        onAddSite={() => setShowNewSite(true)}
        siteSwitcher={
          <select
            className="aidat-site-select"
            value={selectedSiteId ?? ""}
            onChange={(e) => selectSite(e.target.value)}
          >
            {sites.map((m) => (
              <option key={m.site_id} value={m.site_id}>{m.site.name}</option>
            ))}
          </select>
        }
      />
      <div className="aidat-body">
        <aside className="aidat-sidebar">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`aidat-nav-item${pathname === item.href ? " active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </aside>
        <main className="aidat-main">
          <div className="aidat-period-bar">
            <select value={month} onChange={(e) => setPeriod(year, Number(e.target.value))}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
            <select value={year} onChange={(e) => setPeriod(Number(e.target.value), month)}>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {selectedSite && selectedSite.role === "viewer" && (
              <span className="aidat-viewer-badge">Salt okunur</span>
            )}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

function AidatTopBar({
  minimal,
  siteSwitcher,
  onAddSite,
}: {
  minimal?: boolean;
  siteSwitcher?: React.ReactNode;
  onAddSite?: () => void;
}) {
  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }
  return (
    <div className="aidat-topbar">
      <Link href="/" className="nav-brand">
        <div className="nav-logo-wordmark">
          <Image src="/logo-wordmark.png" alt="tools4finance" width={1024} height={409} priority />
        </div>
      </Link>
      <span className="aidat-topbar-title">Site Bütçe Yönetimi</span>
      <div className="aidat-topbar-right">
        {!minimal && siteSwitcher}
        {!minimal && onAddSite && (
          <button className="aidat-add-site-btn" onClick={onAddSite}>+ Site Ekle</button>
        )}
        <button className="aidat-logout-btn" onClick={handleLogout}>Çıkış</button>
      </div>
    </div>
  );
}

export default function AidatLayout({ children }: { children: React.ReactNode }) {
  return (
    <AidatProvider>
      <AidatShell>{children}</AidatShell>
    </AidatProvider>
  );
}
