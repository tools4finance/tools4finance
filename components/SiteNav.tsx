"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import BrandMark from "@/components/BrandMark";
import { useLang, t as pick } from "@/lib/i18n";

const STRINGS = {
  tr: { contact: "İletişim", signin: "Giriş yap", panel: "Panele git" },
  en: { contact: "Contact", signin: "Sign in", panel: "Go to panel" },
};

export default function SiteNav() {
  const { lang, setLang } = useLang();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const savedTheme = (localStorage.getItem("t4f_theme") as "light" | "dark") || "light";
    setTheme(savedTheme);
    document.documentElement.dataset.theme = savedTheme;

    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session?.user);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("t4f_theme", next);
  }

  const strings = pick(lang, STRINGS);

  return (
    <nav className="site-nav">
      <Link href="/" className="nav-brand">
        <BrandMark />
      </Link>
      <div className="nav-links">
        <Link className="nav-link" href="/contact.html">{strings.contact}</Link>
        <div className="lang-toggle">
          <button className={`lang-btn${lang === "tr" ? " active" : ""}`} onClick={() => setLang("tr")}>TR</button>
          <button className={`lang-btn${lang === "en" ? " active" : ""}`} onClick={() => setLang("en")}>EN</button>
        </div>
        <button className="theme-toggle" aria-label="Tema değiştir" onClick={toggleTheme} />
        <Link className="nav-login-btn" href={signedIn ? "/aidat" : "/login"}>
          {signedIn ? strings.panel : strings.signin}
        </Link>
      </div>
    </nav>
  );
}
