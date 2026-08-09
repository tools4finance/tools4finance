"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type CsContextValue = {
  loading: boolean;
  user: User | null;
  refreshUser: () => Promise<void>;
};

const CsContext = createContext<CsContextValue | null>(null);

// Customer Segmentation has no site/tenant concept (unlike the aidat
// module) — every CS_* row is owned directly by auth.uid(), so this
// provider only needs to resolve the logged-in user, not a membership list.
export function CsProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  const refreshUser = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    setUser(data.user ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshUser();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      refreshUser();
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshUser]);

  return <CsContext.Provider value={{ loading, user, refreshUser }}>{children}</CsContext.Provider>;
}

export function useCs() {
  const ctx = useContext(CsContext);
  if (!ctx) throw new Error("useCs must be used within CsProvider");
  return ctx;
}
