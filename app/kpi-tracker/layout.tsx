"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { KpiProvider, useKpi } from "@/lib/kpiContext";
import { supabase } from "@/lib/supabase";
import BrandMark from "@/components/BrandMark";

const NAV_ITEMS = [
  { href: "/kpi-tracker", label: "Dashboard" },
  { href: "/kpi-tracker/departments", label: "Departmanlar" },
  { href: "/kpi-tracker/people", label: "Kişiler" },
  { href: "/kpi-tracker/periods", label: "Dönemler" },
  { href: "/kpi-tracker/my-goals", label: "Hedeflerim" },
  { href: "/kpi-tracker/results", label: "Sonuçlar" },
];

type Notification = { id: string; message: string; link: string | null; created_at: string; read_at: string | null };

function NewOrgForm() {
  const { refreshMemberships } = useKpi();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("create_kpi_organization", { p_name: name });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setName("");
    await refreshMemberships();
  }

  return (
    <div className="aidat-empty">
      <h2>Şirketini ekle</h2>
      <p>
        KPI Tracker&apos;ı kullanabilmek için önce bir organizasyon oluşturmalısın. Organizasyonu oluşturan kişi
        otomatik olarak İK Yöneticisi olur; departman ve kişileri buradan yönetebilirsin.
      </p>
      <form onSubmit={handleSubmit} className="aidat-empty-form">
        <label className="auth-field">
          <span>Organizasyon Adı</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="örn. Örnek A.Ş." />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button className="btn-primary" type="submit" disabled={saving || !name}>
          {saving ? "Kaydediliyor…" : "Organizasyon Oluştur"}
        </button>
      </form>
    </div>
  );
}

function NotificationBell({ memberId }: { memberId: string }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    const { data } = await supabase
      .from("KPI_notifications")
      .select("id, message, link, created_at, read_at")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(20);
    setNotifications((data ?? []) as Notification[]);
  }, [memberId]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  async function handleOpenNotification(n: Notification) {
    if (!n.read_at) {
      await supabase.from("KPI_notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
      await fetchNotifications();
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  return (
    <div style={{ position: "relative" }}>
      <button className="aidat-logout-btn" onClick={() => setOpen(!open)} style={{ position: "relative" }}>
        Bildirimler
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute", top: -6, right: -6, background: "var(--coral)", color: "#fff",
              borderRadius: 999, fontSize: 10, fontWeight: 600, minWidth: 16, height: 16,
              display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
            }}
          >
            {unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, width: 320, maxHeight: 360, overflowY: "auto",
            background: "var(--surface)", border: "0.5px solid var(--border-strong)", borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)", zIndex: 200,
          }}
        >
          {notifications.length === 0 ? (
            <div className="empty-state">Bildirim yok.</div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => handleOpenNotification(n)}
                style={{
                  padding: "10px 14px", fontSize: 12.5, cursor: "pointer",
                  borderBottom: "0.5px solid var(--border)",
                  background: n.read_at ? "transparent" : "var(--bg2)",
                  color: "var(--text)", lineHeight: 1.5,
                }}
              >
                {n.message}
                <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 4 }}>
                  {new Date(n.created_at).toLocaleString("tr-TR")}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function KpiTopBar({ memberId }: { memberId: string | null }) {
  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }
  return (
    <div className="aidat-topbar">
      <Link href="/" className="nav-brand">
        <BrandMark />
      </Link>
      <span className="aidat-topbar-title">KPI Tracker</span>
      <div className="aidat-topbar-right">
        {memberId && <NotificationBell memberId={memberId} />}
        <button className="aidat-logout-btn" onClick={handleLogout}>Çıkış</button>
      </div>
    </div>
  );
}

function KpiShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { loading, user, memberships, selectedMembership } = useKpi();

  if (loading) {
    return <div className="aidat-loading">Yükleniyor…</div>;
  }

  if (!user) {
    if (typeof window !== "undefined") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
    return <div className="aidat-loading">Yönlendiriliyor…</div>;
  }

  if (memberships.length === 0) {
    return (
      <div className="aidat-page">
        <KpiTopBar memberId={null} />
        <NewOrgForm />
      </div>
    );
  }

  const visibleNav = NAV_ITEMS.filter((item) => {
    if (item.href === "/kpi-tracker/departments" || item.href === "/kpi-tracker/people" || item.href === "/kpi-tracker/results") {
      return selectedMembership?.role === "hr_admin";
    }
    return true;
  });

  return (
    <div className="aidat-page">
      <KpiTopBar memberId={selectedMembership?.id ?? null} />
      <div className="aidat-body">
        <aside className="aidat-sidebar">
          {visibleNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`aidat-nav-item${pathname === item.href ? " active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </aside>
        <main className="aidat-main">{children}</main>
      </div>
    </div>
  );
}

export default function KpiTrackerLayout({ children }: { children: React.ReactNode }) {
  return (
    <KpiProvider>
      <KpiShell>{children}</KpiShell>
    </KpiProvider>
  );
}
