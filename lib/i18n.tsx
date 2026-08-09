"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Lang = "tr" | "en";

type LangContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
};

const LangContext = createContext<LangContextValue | null>(null);

const STORAGE_KEY = "t4f_lang";

// Shared across the whole site (not just the homepage nav) so any page can
// render bilingual copy and react live when the toggle in SiteNav flips —
// previously `lang` was local state inside SiteNav.tsx, so nothing outside
// the nav itself could ever see it.
export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("tr");

  useEffect(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as Lang) || "tr";
    setLangState(saved);
    document.documentElement.lang = saved;
  }, []);

  function setLang(next: Lang) {
    setLangState(next);
    document.documentElement.lang = next;
    localStorage.setItem(STORAGE_KEY, next);
  }

  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within LangProvider");
  return ctx;
}

// Tiny helper for the common "pick TR or EN string" case — t(lang, {tr,en}).
export function t<T>(lang: Lang, strings: { tr: T; en: T }): T {
  return strings[lang];
}
