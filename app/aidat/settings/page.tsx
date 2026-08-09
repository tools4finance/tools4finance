"use client";

import { useCallback, useEffect, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";

type MemberRow = {
  id: string;
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

const ASSIGNABLE_ROLES: Array<"owner" | "admin" | "accountant" | "viewer"> = [
  "owner",
  "admin",
  "accountant",
  "viewer",
];

export default function SettingsPage() {
  const { selectedSiteId, selectedSite, canWrite, refreshSites } = useAidat();

  const canEditSite = canWrite && (selectedSite?.role === "owner" || selectedSite?.role === "admin");
  // Member management (add/remove) is more sensitive than routine data entry,
  // so it's further restricted to owner/admin even though the DB's
  // has_site_write_access() also allows 'accountant' to write site_members.
  // The RLS policies remain the real enforcement backstop regardless of this UI gate.
  const canManageMembers = canEditSite;

  const [name, setName] = useState(selectedSite?.site.name ?? "");
  const [address, setAddress] = useState(selectedSite?.site.address ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"owner" | "admin" | "accountant" | "viewer">("admin");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [rosterActionError, setRosterActionError] = useState<string | null>(null);

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
      .select("id, user_id, role, profiles(email, full_name)")
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

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSiteId || !newEmail.trim()) return;
    setAddLoading(true);
    setAddError(null);
    setAddSuccess(null);

    // profiles_select_own RLS restricts direct table SELECTs to your own
    // row, so looking up another user by email has to go through the
    // find_profile_by_email SECURITY DEFINER RPC instead of a table query.
    const emailTrimmed = newEmail.trim();
    const { data: profileRows, error: profileError } = await supabase.rpc(
      "find_profile_by_email",
      { p_email: emailTrimmed }
    );

    if (profileError) {
      setAddError(profileError.message);
      setAddLoading(false);
      return;
    }

    const profile = profileRows?.[0] ?? null;

    if (!profile) {
      setAddError(
        "Bu e-posta ile kayıtlı bir tools4finance hesabı bulunamadı. Kişinin önce /login sayfasından e-posta/şifre ya da Google ile bir hesap oluşturması gerekiyor. Hesabı oluşturduktan sonra aynı e-posta ile tekrar deneyebilirsiniz."
      );
      setAddLoading(false);
      return;
    }

    const alreadyMember = members.some((m) => m.user_id === profile.id);
    if (alreadyMember) {
      setAddError("Bu kişi zaten bu sitenin üyesi.");
      setAddLoading(false);
      return;
    }

    const { error: insertError } = await supabase
      .from("site_members")
      .insert({ site_id: selectedSiteId, user_id: profile.id, role: newRole });

    setAddLoading(false);

    if (insertError) {
      // 23505 = unique_violation, in case of a race with the pre-check above.
      if (insertError.code === "23505") {
        setAddError("Bu kişi zaten bu sitenin üyesi.");
      } else {
        setAddError(insertError.message);
      }
      return;
    }

    setAddSuccess(`${profile.full_name ?? profile.email} eklendi.`);
    setNewEmail("");
    setNewRole("admin");
    await fetchMembers();
  }

  async function handleRemoveMember(member: MemberRow) {
    setRosterActionError(null);

    if (member.role === "owner") {
      const ownerCount = members.filter((m) => m.role === "owner").length;
      if (ownerCount <= 1) {
        setRosterActionError("Sitenin en az bir sahibi olmalı; son sahibi kaldıramazsınız.");
        return;
      }
    }

    const label = member.profiles?.full_name ?? member.profiles?.email ?? "Bu üye";
    if (!window.confirm(`${label} bu siteden kaldırılsın mı?`)) return;

    setRemovingId(member.id);
    const { error } = await supabase.from("site_members").delete().eq("id", member.id);
    setRemovingId(null);

    if (error) {
      setRosterActionError(error.message);
      return;
    }
    await fetchMembers();
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
        {rosterActionError && <div className="auth-error" style={{ marginBottom: 16 }}>{rosterActionError}</div>}

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
                  {canManageMembers && <th>İşlem</th>}
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
                    {canManageMembers && (
                      <td>
                        <button
                          className="btn-danger"
                          type="button"
                          disabled={removingId === m.id}
                          onClick={() => handleRemoveMember(m)}
                        >
                          {removingId === m.id ? "Kaldırılıyor…" : "Kaldır"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canManageMembers && (
          <form onSubmit={handleAddMember} className="form-grid" style={{ marginTop: 16 }}>
            <label className="auth-field">
              <span>Üye Ekle (E-posta)</span>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="ornek@eposta.com"
                required
              />
            </label>
            <label className="auth-field">
              <span>Rol</span>
              <select
                className="aidat-site-select"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as typeof newRole)}
              >
                {ASSIGNABLE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
              <button className="btn-primary" type="submit" disabled={addLoading || !newEmail.trim()}>
                {addLoading ? "Ekleniyor…" : "Üye Ekle"}
              </button>
            </div>
            {addError && (
              <div className="auth-error" style={{ gridColumn: "1 / -1" }}>
                {addError}
              </div>
            )}
            {addSuccess && (
              <div className="auth-info" style={{ gridColumn: "1 / -1" }}>
                {addSuccess}
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
