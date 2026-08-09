"use client";

import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { CsProvider, useCs } from "@/lib/csContext";
import { supabase } from "@/lib/supabase";
import BrandMark from "@/components/BrandMark";
import { useLang, t as pick } from "@/lib/i18n";

const MODULE_TITLE = { tr: "Müşteri Risk Skoru", en: "Customer Credit Score" };

const NAV_ITEMS = [
  { href: "/customer-segmentation", label: "Dashboard" },
  { href: "/customer-segmentation/customers", label: "Müşteriler" },
  { href: "/customer-segmentation/scorecard", label: "Tekil Skor Hesapla" },
  { href: "/customer-segmentation/parameters", label: "Parametreler" },
];

function CsTopBar() {
  const { lang } = useLang();
  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }
  return (
    <div className="aidat-topbar">
      <Link href="/" className="nav-brand">
        <BrandMark />
      </Link>
      <span className="aidat-topbar-title">{pick(lang, MODULE_TITLE)}</span>
      <div className="aidat-topbar-right">
        <button className="aidat-logout-btn" onClick={handleLogout}>Çıkış</button>
      </div>
    </div>
  );
}

function CsShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { loading, user } = useCs();

  if (loading) {
    return <div className="aidat-loading">Yükleniyor…</div>;
  }

  if (!user) {
    if (typeof window !== "undefined") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
    return <div className="aidat-loading">Yönlendiriliyor…</div>;
  }

  return (
    <div className="aidat-page">
      <CsTopBar />
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
        <main className="aidat-main">{children}</main>
      </div>
    </div>
  );
}

export default function CustomerSegmentationLayout({ children }: { children: React.ReactNode }) {
  return (
    <CsProvider>
      <CsShell>{children}</CsShell>
    </CsProvider>
  );
}
