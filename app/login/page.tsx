"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import BrandMark from "@/components/BrandMark";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace(next);
    });
  }, [router, next]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (signUpError) throw signUpError;
        setInfo("Hesabın oluşturuldu. E-postana gelen linkle doğrulayıp giriş yapabilirsin.");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        router.replace(next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    const redirectTo = `${window.location.origin}/login?next=${encodeURIComponent(next)}`;
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (oauthError) setError(oauthError.message);
  }

  return (
    <div className="auth-card">
      <div className="auth-tabs">
        <button
          type="button"
          className={mode === "signin" ? "auth-tab active" : "auth-tab"}
          onClick={() => setMode("signin")}
        >
          Giriş yap
        </button>
        <button
          type="button"
          className={mode === "signup" ? "auth-tab active" : "auth-tab"}
          onClick={() => setMode("signup")}
        >
          Hesap oluştur
        </button>
      </div>

      <form onSubmit={handleSubmit} className="auth-form">
        {mode === "signup" && (
          <label className="auth-field">
            <span>Ad Soyad</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
        )}
        <label className="auth-field">
          <span>E-posta</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="auth-field">
          <span>Şifre</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
        </label>

        {error && <div className="auth-error">{error}</div>}
        {info && <div className="auth-info">{info}</div>}

        <button type="submit" className="btn-primary auth-submit" disabled={loading}>
          {loading ? "İşleniyor…" : mode === "signup" ? "Hesap oluştur" : "Giriş yap"}
        </button>
      </form>

      <div className="auth-divider"><span>veya</span></div>

      <button type="button" className="auth-google-btn" onClick={handleGoogle}>
        <svg width="18" height="18" viewBox="0 0 18 18">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.62z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 009 18z" />
          <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 013.68 9c0-.59.1-1.17.27-1.7V4.97H.95A9 9 0 000 9c0 1.45.35 2.83.95 4.03l3-2.33z" />
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
        </svg>
        Google ile devam et
      </button>

      <p className="auth-footnote">
        <Link href="/">← Ana sayfaya dön</Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="auth-page">
      <Link href="/" className="nav-brand auth-brand">
        <BrandMark />
      </Link>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
