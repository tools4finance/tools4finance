"use client";

import { useCallback, useEffect, useState } from "react";
import { useKpi } from "@/lib/kpiContext";
import { supabase } from "@/lib/supabase";

type Department = { id: string; name: string };
type Member = {
  id: string;
  full_name: string;
  email: string;
  department_id: string | null;
  role: "hr_admin" | "employee";
  invite_status: "pending" | "accepted";
};

export default function KpiPeoplePage() {
  const { selectedMembership, canManage } = useKpi();
  const orgId = selectedMembership?.org_id ?? null;

  const [members, setMembers] = useState<Member[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    const [memberRes, deptRes] = await Promise.all([
      supabase
        .from("KPI_members")
        .select("id, full_name, email, department_id, role, invite_status")
        .eq("org_id", orgId)
        .order("full_name"),
      supabase.from("KPI_departments").select("id, name").eq("org_id", orgId).order("name"),
    ]);
    if (memberRes.error) setError(memberRes.error.message);
    setMembers((memberRes.data ?? []) as Member[]);
    setDepartments((deptRes.data ?? []) as Department[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !fullName.trim() || !email.trim()) return;
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase.from("KPI_members").insert({
      org_id: orgId,
      full_name: fullName.trim(),
      email: email.trim().toLowerCase(),
      department_id: departmentId || null,
      role: "employee",
      invite_status: "pending",
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setFullName("");
    setEmail("");
    setDepartmentId("");
    await fetchAll();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Bu kişiyi silmek istediğinize emin misiniz?")) return;
    const { error: deleteError } = await supabase.from("KPI_members").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setMembers(members.filter((m) => m.id !== id));
  }

  function handleCopyInvite(id: string) {
    const link = `${window.location.origin}/login?next=${encodeURIComponent("/kpi-tracker")}`;
    navigator.clipboard.writeText(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const departmentsById = new Map(departments.map((d) => [d.id, d.name]));

  if (!canManage) {
    return <div className="empty-state">Bu sayfayı görüntüleme yetkiniz yok.</div>;
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Kişiler</div>
        </div>
        {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
        <div className="auth-info" style={{ marginBottom: 14 }}>
          Kişi ekledikten sonra &quot;Davet Linki Kopyala&quot; ile bir giriş linki alıp kendilerine
          iletebilirsiniz. Eklediğiniz e-posta ile giriş yaptıklarında otomatik olarak bu organizasyona bağlanırlar.
        </div>
        <form onSubmit={handleCreate} className="form-grid" style={{ marginBottom: 16 }}>
          <label className="auth-field">
            <span>Ad Soyad</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
          <label className="auth-field">
            <span>E-posta</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="auth-field">
            <span>Departman</span>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">— Seçiniz —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn-primary" type="submit" disabled={saving || !fullName.trim() || !email.trim()}>
              {saving ? "Kaydediliyor…" : "Kişi Ekle"}
            </button>
          </div>
        </form>

        {loading ? (
          <div className="empty-state">Yükleniyor…</div>
        ) : members.length === 0 ? (
          <div className="empty-state">Henüz kişi eklenmedi.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="wrap">Ad Soyad</th>
                  <th className="wrap">E-posta</th>
                  <th>Departman</th>
                  <th>Rol</th>
                  <th>Durum</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td className="wrap">{m.full_name}</td>
                    <td className="wrap">{m.email}</td>
                    <td>{m.department_id ? departmentsById.get(m.department_id) ?? "—" : "—"}</td>
                    <td>{m.role === "hr_admin" ? "İK Yöneticisi" : "Çalışan"}</td>
                    <td>
                      {m.invite_status === "accepted" ? (
                        <span className="pill pill-green">Üye Oldu</span>
                      ) : (
                        <span className="pill pill-amber">Bekliyor</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {m.invite_status === "pending" && (
                        <button className="btn-secondary" onClick={() => handleCopyInvite(m.id)}>
                          {copiedId === m.id ? "Kopyalandı!" : "Davet Linki Kopyala"}
                        </button>
                      )}{" "}
                      {m.role !== "hr_admin" && (
                        <button className="btn-danger" onClick={() => handleDelete(m.id)}>Sil</button>
                      )}
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
