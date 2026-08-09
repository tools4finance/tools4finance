"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabase";

const STRINGS = {
  tr: { contact: "İletişim", signin: "Giriş yap", panel: "Panele git" },
  en: { contact: "Contact", signin: "Sign in", panel: "Go to panel" },
};

export default function SiteNav() {
  const [lang, setLang] = useState<"tr" | "en">("tr");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const savedLang = (localStorage.getItem("t4f_lang") as "tr" | "en") || "tr";
    const savedTheme = (localStorage.getItem("t4f_theme") as "light" | "dark") || "light";
    setLang(savedLang);
    setTheme(savedTheme);
    document.documentElement.lang = savedLang;
    document.documentElement.dataset.theme = savedTheme;

    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session?.user);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  function changeLang(next: "tr" | "en") {
    setLang(next);
    document.documentElement.lang = next;
    localStorage.setItem("t4f_lang", next);
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("t4f_theme", next);
  }

  const t = STRINGS[lang];

  return (
    <nav className="site-nav">
      <Link href="/" className="nav-brand">
        <div className="nav-logo-wordmark">
          <Image src="/logo-wordmark.png" alt="tools4finance" width={1024} height={409} priority />
        </div>
      </Link>
      <div className="nav-links">
        <Link className="nav-link" href="/contact.html">{t.contact}</Link>
        <div className="lang-toggle">
          <button className={`lang-btn${lang === "tr" ? " active" : ""}`} onClick={() => changeLang("tr")}>TR</button>
          <button className={`lang-btn${lang === "en" ? " active" : ""}`} onClick={() => changeLang("en")}>EN</button>
        </div>
        <button className="theme-toggle" aria-label="Tema değiştir" onClick={toggleTheme} />
        <Link className="nav-login-btn" href={signedIn ? "/aidat" : "/login"}>
          {signedIn ? t.panel : t.signin}
        </Link>
      </div>
    </nav>
  );
}
