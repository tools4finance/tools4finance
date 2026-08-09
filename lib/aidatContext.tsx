"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type SiteMembership = {
  site_id: string;
  role: "owner" | "admin" | "accountant" | "viewer";
  site: { id: string; name: string; address: string | null; active: boolean };
};

type AidatContextValue = {
  loading: boolean;
  user: User | null;
  sites: SiteMembership[];
  selectedSiteId: string | null;
  selectedSite: SiteMembership | null;
  selectSite: (siteId: string) => void;
  refreshSites: () => Promise<void>;
  canWrite: boolean;
  year: number;
  month: number;
  setPeriod: (year: number, month: number) => void;
};

const AidatContext = createContext<AidatContextValue | null>(null);

const SITE_STORAGE_KEY = "t4f_aidat_selected_site";

export function AidatProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [sites, setSites] = useState<SiteMembership[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const refreshSites = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    setUser(userData.user ?? null);
    if (!userData.user) {
      setSites([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("site_members")
      .select("site_id, role, site:sites(id, name, address, active)")
      .order("created_at", { ascending: true });

    if (!error && data) {
      const memberships = data as unknown as SiteMembership[];
      setSites(memberships);
      setSelectedSiteId((prev) => {
        if (prev && memberships.some((m) => m.site_id === prev)) return prev;
        const saved = typeof window !== "undefined" ? localStorage.getItem(SITE_STORAGE_KEY) : null;
        if (saved && memberships.some((m) => m.site_id === saved)) return saved;
        return memberships[0]?.site_id ?? null;
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshSites();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      refreshSites();
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshSites]);

  function selectSite(siteId: string) {
    setSelectedSiteId(siteId);
    localStorage.setItem(SITE_STORAGE_KEY, siteId);
  }

  function setPeriod(y: number, m: number) {
    setYear(y);
    setMonth(m);
  }

  const selectedSite = sites.find((s) => s.site_id === selectedSiteId) ?? null;
  const canWrite = !!selectedSite && selectedSite.role !== "viewer";

  return (
    <AidatContext.Provider
      value={{ loading, user, sites, selectedSiteId, selectedSite, selectSite, refreshSites, canWrite, year, month, setPeriod }}
    >
      {children}
    </AidatContext.Provider>
  );
}

export function useAidat() {
  const ctx = useContext(AidatContext);
  if (!ctx) throw new Error("useAidat must be used within AidatProvider");
  return ctx;
}
