"use client";

import { useCallback, useEffect, useState } from "react";
import { useKpi } from "@/lib/kpiContext";
import { supabase } from "@/lib/supabase";

type Department = { id: string; name: string };

export default function KpiDepartmentsPage() {
  const { selectedMembership, canManage } = useKpi();
  const orgId = selectedMembership?.org_id ?? null;

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("KPI_departments")
      .select("id, name")
      .eq("org_id", orgId)
      .order("name");
    if (fetchError) setError(fetchError.message);
    setDepartments((data ?? []) as Department[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !name.trim()) return;
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase.from("KPI_departments").insert({ org_id: orgId, name: name.trim() });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setName("");
    await fetchAll();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Bu departmanı silmek istediğinize emin misiniz?")) return;
    const { error: deleteError } = await supabase.from("KPI_departments").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setDepartments(departments.filter((d) => d.id !== id));
  }

  if (!canManage) {
    return <div className="empty-state">Bu sayfayı görüntüleme yetkiniz yok.</div>;
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Departmanlar</div>
        </div>
        {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
        <form onSubmit={handleCreate} className="form-grid" style={{ marginBottom: 16 }}>
          <label className="auth-field">
            <span>Departman Adı</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="örn. Finans" />
          </label>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn-primary" type="submit" disabled={saving || !name.trim()}>
              {saving ? "Kaydediliyor…" : "Departman Ekle"}
            </button>
          </div>
        </form>

        {loading ? (
          <div className="empty-state">Yükleniyor…</div>
        ) : departments.length === 0 ? (
          <div className="empty-state">Henüz departman eklenmedi.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr><th>Ad</th><th></th></tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td><button className="btn-danger" onClick={() => handleDelete(d.id)}>Sil</button></td>
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
