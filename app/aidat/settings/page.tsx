"use client";

import { useCallback, useEffect, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";

type MemberRow = {
  user_id: string;
  role: string;
  profiles: { email: string | null; full_name: string | null } | null;
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Sahip",
  admin: "Yönetici",
  accountant: "Muhasebeci",
  viewer: "Görüntüleyici",
};

export default function SettingsPage() {
  const { selectedSiteId, selectedSite, canWrite, refreshSites } = useAidat();

  const canEditSite = canWrite && (selectedSite?.role === "owner" || selectedSite?.role === "admin");

  const [name, setName] = useState(selectedSite?.site.name ?? "");
  const [address, setAddress] = useState(selectedSite?.site.address ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);

  useEffect(() => {
    setName(selectedSite?.site.name ?? "");
    setAddress(selectedSite?.site.address ?? "");
    setSaveSuccess(false);
    setSaveError(null);
  }, [selectedSite]);

  const fetchMembers = useCallback(async () => {
    if (!selectedSiteId) return;
    setMembersLoading(true);
    setMembersError(null);
    const { data, error } = await supabase
      .from("site_members")
      .select("user_id, role, profiles(email, full_name)")
      .eq("site_id", selectedSiteId);
    if (error) {
      setMembersError(error.message);
    } else {
      setMembers((data ?? []) as unknown as MemberRow[]);
    }
    setMembersLoading(false);
  }, [selectedSiteId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  async function handleSaveSite(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSiteId || !name.trim()) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    const { error } = await supabase
      .from("sites")
      .update({ name: name.trim(), address: address.trim() || null })
      .eq("id", selectedSiteId);
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setSaveSuccess(true);
    await refreshSites();
  }

  if (!selectedSite) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Site Bilgileri</div>
        </div>

        {canEditSite ? (
          <form onSubmit={handleSaveSite} className="form-grid">
            <label className="auth-field">
              <span>Site Adı</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="auth-field">
              <span>Adres</span>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="opsiyonel" />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
              <button className="btn-primary" type="submit" disabled={saving || !name.trim()}>
                {saving ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
            {saveError && <div className="auth-error">{saveError}</div>}
            {saveSuccess && <div className="auth-info">Kaydedildi.</div>}
          </form>
        ) : (
          <div className="form-grid">
            <div>
              <div className="kpi-label">Site Adı</div>
              <div>{selectedSite.site.name}</div>
            </div>
            <div>
              <div className="kpi-label">Adres</div>
              <div>{selectedSite.site.address ?? "—"}</div>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Üyeler</div>
        </div>

        {membersError && <div className="auth-error" style={{ marginBottom: 16 }}>{membersError}</div>}

        {membersLoading ? (
          <div className="empty-state">Yükleniyor…</div>
        ) : members.length === 0 ? (
          <div className="empty-state">Üye bulunamadı.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ad Soyad</th>
                  <th>E-posta</th>
                  <th>Rol</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id}>
                    <td className="wrap">{m.profiles?.full_name ?? "—"}</td>
                    <td className="wrap">{m.profiles?.email ?? "—"}</td>
                    <td>
                      <span className="pill pill-blue">{ROLE_LABELS[m.role] ?? m.role}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
