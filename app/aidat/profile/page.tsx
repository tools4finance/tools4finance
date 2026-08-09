"use client";

import { useCallback, useEffect, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";

type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
};

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  email: "E-posta/Şifre",
};

export default function ProfilePage() {
  const { loading: authLoading, user } = useAidat();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [providers, setProviders] = useState<string[]>([]);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!user) return;
    setProfileLoading(true);
    setProfileError(null);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, phone")
      .eq("id", user.id)
      .single();
    if (error) {
      setProfileError(error.message);
    } else if (data) {
      const p = data as Profile;
      setProfile(p);
      setFullName(p.full_name ?? "");
      setPhone(p.phone ?? "");
    }
    setProfileLoading(false);
  }, [user]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const identities = data.user?.identities ?? [];
      const list = identities
        .map((i) => PROVIDER_LABELS[i.provider] ?? i.provider)
        .filter((v, i, arr) => arr.indexOf(v) === i);
      setProviders(list);
    });
  }, []);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim() || null, phone: phone.trim() || null })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setSaveSuccess(true);
    await fetchProfile();
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);
    if (newPassword !== confirmPassword) {
      setPwError("Şifreler eşleşmiyor.");
      return;
    }
    setPwSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwSaving(false);
    if (error) {
      setPwError(error.message);
      return;
    }
    setPwSuccess("Şifren güncellendi, bir sonraki girişte e-posta + şifre ile de giriş yapabilirsin.");
    setNewPassword("");
    setConfirmPassword("");
  }

  if (authLoading || profileLoading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  if (!user) {
    return <div className="empty-state">Giriş yapmanız gerekiyor.</div>;
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Kişisel Bilgiler</div>
        </div>

        {profileError && <div className="auth-error" style={{ marginBottom: 16 }}>{profileError}</div>}

        <form onSubmit={handleSaveProfile} className="form-grid">
          <label className="auth-field">
            <span>Ad Soyad</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>
          <label className="auth-field">
            <span>Telefon</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="opsiyonel"
            />
          </label>
          <label className="auth-field">
            <span>E-posta</span>
            <input value={profile?.email ?? user.email ?? ""} disabled readOnly />
          </label>

          <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
            <button className="btn-primary" type="submit" disabled={saving}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>

          {saveError && <div className="auth-error">{saveError}</div>}
          {saveSuccess && <div className="auth-info">Kaydedildi.</div>}
        </form>

        {providers.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <span className="kpi-label">Bağlı giriş yöntemleri: </span>
            {providers.map((p) => (
              <span key={p} className="pill pill-blue" style={{ marginRight: 8 }}>
                {p}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Şifre Belirle / Değiştir</div>
        </div>

        <form onSubmit={handleSetPassword} className="form-grid">
          <label className="auth-field">
            <span>Yeni Şifre</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>
          <label className="auth-field">
            <span>Yeni Şifre (tekrar)</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>

          <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
            <button className="btn-primary" type="submit" disabled={pwSaving}>
              {pwSaving ? "Kaydediliyor…" : "Şifreyi Kaydet"}
            </button>
          </div>

          {pwError && <div className="auth-error">{pwError}</div>}
          {pwSuccess && <div className="auth-info">{pwSuccess}</div>}
        </form>
      </div>
    </div>
  );
}
