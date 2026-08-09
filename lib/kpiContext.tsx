"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type KpiOrg = { id: string; name: string; owner_id: string };
export type KpiMembership = {
  id: string;
  org_id: string;
  role: "hr_admin" | "employee";
  full_name: string;
  email: string;
  department_id: string | null;
  org: KpiOrg;
};

type KpiContextValue = {
  loading: boolean;
  user: User | null;
  memberships: KpiMembership[];
  selectedOrgId: string | null;
  selectedMembership: KpiMembership | null;
  selectOrg: (orgId: string) => void;
  refreshMemberships: () => Promise<void>;
  canManage: boolean;
};

const KpiContext = createContext<KpiContextValue | null>(null);

const ORG_STORAGE_KEY = "t4f_kpi_selected_org";

export function KpiProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<KpiMembership[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const refreshMemberships = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    setUser(userData.user ?? null);
    if (!userData.user) {
      setMemberships([]);
      setLoading(false);
      return;
    }

    // Attach this user to any pending KPI_members row invited under their
    // email before resolving the membership list, so a freshly-claimed
    // invite shows up immediately without a second page load.
    await supabase.rpc("kpi_claim_membership");

    // IMPORTANT: filter to this user's own rows explicitly. RLS
    // (has_kpi_org_access) allows a member to SELECT every member row in any
    // org they belong to (needed elsewhere for HR roster/results screens),
    // so an unfiltered query here would return every colleague's membership
    // row too. Without this .eq, `memberships.find(m => m.org_id === X)`
    // downstream would resolve to whichever row happens to sort first
    // (created_at ascending — i.e. the org's HR admin) instead of the
    // current user's own row, breaking every employee's "my goals" flow in
    // any org with more than one member.
    const { data, error } = await supabase
      .from("KPI_members")
      .select("id, org_id, role, full_name, email, department_id, org:KPI_organizations(id, name, owner_id)")
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: true });

    if (!error && data) {
      const rows = data as unknown as KpiMembership[];
      setMemberships(rows);
      setSelectedOrgId((prev) => {
        if (prev && rows.some((m) => m.org_id === prev)) return prev;
        const saved = typeof window !== "undefined" ? localStorage.getItem(ORG_STORAGE_KEY) : null;
        if (saved && rows.some((m) => m.org_id === saved)) return saved;
        return rows[0]?.org_id ?? null;
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshMemberships();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      refreshMemberships();
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshMemberships]);

  function selectOrg(orgId: string) {
    setSelectedOrgId(orgId);
    localStorage.setItem(ORG_STORAGE_KEY, orgId);
  }

  const selectedMembership = memberships.find((m) => m.org_id === selectedOrgId) ?? null;
  const canManage = selectedMembership?.role === "hr_admin";

  return (
    <KpiContext.Provider
      value={{ loading, user, memberships, selectedOrgId, selectedMembership, selectOrg, refreshMemberships, canManage }}
    >
      {children}
    </KpiContext.Provider>
  );
}

export function useKpi() {
  const ctx = useContext(KpiContext);
  if (!ctx) throw new Error("useKpi must be used within KpiProvider");
  return ctx;
}
