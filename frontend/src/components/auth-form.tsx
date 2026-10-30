"use client";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ErrorState } from "@/components/ui/primitives";
import { api } from "@/lib/api";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState({ email: "", password: "", full_name: "", organisation: "" });
  const [busy, setBusy] = useState<"form" | "demo" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [demo, setDemo] = useState<{ enabled: boolean; email: string | null } | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  useEffect(() => {
    api<{ enabled: boolean; email: string | null }>("/auth/demo").then(setDemo).catch(() => setDemo(null));
  }, []);

  const next = () => {
    const n = params.get("next");
    router.replace(n && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy("form");
    setError(null);
    try {
      await api(`/auth/${mode}`, { body: mode === "login" ? { email: form.email, password: form.password } : form });
      next();
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  async function demoLogin() {
    setBusy("demo");
    setError(null);
    try {
      await api("/auth/demo-login", { body: {} });
      next();
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  const field = "h-12 w-full rounded-2xl border border-white/10 bg-black/40 px-4 text-[15px] text-white placeholder:text-white/30 transition-colors focus:border-[#ff5b2e]/60 focus:outline-none";
  const label = "mb-1.5 block text-[13px] font-medium text-white/70";
  return (
    <div className="space-y-4">
      <div className="mb-2 flex items-center gap-3 lg:hidden">
        <Logo size={36} />
        <div className="text-[17px] font-semibold">BACKFIRE<span className="text-[#ff5b2e]"> AI</span></div>
      </div>
      <div className="hud rounded-[28px] p-7 shadow-2xl shadow-black/50 md:p-8">
        <div className="mb-6">
          <h2 className="text-[26px] font-semibold tracking-[-0.025em] text-white">{mode === "login" ? "Welcome back" : "Create your lab account"}</h2>
          <p className="mt-1 text-[14.5px] text-white/55">{mode === "login" ? "Sign in to continue your investigations." : "The first account becomes the organisation admin."}</p>
        </div>
        {demo?.enabled && (
          <>
            <button
              type="button"
              onClick={demoLogin}
              disabled={!!busy}
              className="group relative flex w-full items-center gap-3.5 overflow-hidden rounded-2xl border border-[#ff5b2e]/40 bg-gradient-to-br from-[#ff5b2e]/[0.16] to-[#ff5b2e]/[0.04] p-4 text-left transition-[border-color,transform] hover:border-[#ff5b2e]/70 active:translate-y-px disabled:opacity-60"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#ff5b2e] to-[#ff8a5b] shadow-[0_8px_24px_-6px_rgba(255,91,46,0.6)]">
                {busy === "demo" ? <Loader2 className="h-5 w-5 animate-spin text-white" /> : <Sparkles className="h-5 w-5 text-white" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold text-white">Demo login</span>
                <span className="block truncate text-[13px] text-white/55">One click, signs you in as the demo admin</span>
              </span>
              <ArrowRight className="h-5 w-5 text-[#ff7a4d] transition-transform group-hover:translate-x-1" />
            </button>
            <div className="my-6 flex items-center gap-3 text-[12.5px] text-white/40">
              <span className="h-px flex-1 bg-white/10" /> or {mode === "login" ? "sign in" : "register"} with email <span className="h-px flex-1 bg-white/10" />
            </div>
          </>
        )}
        <form onSubmit={submit} className="space-y-4" noValidate>
          {mode === "register" && (
            <div className="grid grid-cols-2 gap-3">
              <div><label htmlFor="full_name" className={label}>Name</label><input id="full_name" className={field} autoComplete="name" value={form.full_name} onChange={set("full_name")} /></div>
              <div><label htmlFor="org" className={label}>Organisation</label><input id="org" className={field} autoComplete="organization" value={form.organisation} onChange={set("organisation")} /></div>
            </div>
          )}
          <div><label htmlFor="email" className={label}>Email</label><input id="email" className={field} type="email" autoComplete="email" required placeholder="you@institute.org" value={form.email} onChange={set("email")} /></div>
          <div>
            <label htmlFor="password" className={label}>Password</label>
            <input id="password" className={field} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required value={form.password} onChange={set("password")} />
            {mode === "register" && <p className="mt-1.5 text-[12.5px] text-white/40">10+ characters, mixing three of: lowercase, uppercase, digits, symbols.</p>}
          </div>
          {error ? <ErrorState error={error} compact /> : null}
          <button type="submit" disabled={!!busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-[15.5px] font-semibold text-black transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60">
            {busy === "form" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {mode === "login" ? "Sign in" : "Create account"} <ArrowRight className="h-4 w-4" />
          </button>
        </form>
        <div className="mt-6 text-center text-[14px] text-white/55">
          {mode === "login" ? <>New here? <Link href="/register" className="font-semibold text-[#ff7a4d] hover:underline">Create an account</Link></> : <>Already registered? <Link href="/login" className="font-semibold text-[#ff7a4d] hover:underline">Sign in</Link></>}
        </div>
      </div>
    </div>
  );
}

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <rect width="64" height="64" rx="14" fill="#0b0d11" stroke="rgba(255,255,255,0.12)" />
      <path d="M12 46 L26 30 L34 38 L52 16" fill="none" stroke="#ff5b2e" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="52" cy="16" r="5" fill="#3ee6a8" />
    </svg>
  );
}
