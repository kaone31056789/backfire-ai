"use client";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState, Input, Label, Panel } from "@/components/ui/primitives";
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

  return (
    <div className="space-y-4">
      <div className="mb-2 flex items-center gap-3 lg:hidden">
        <Logo size={36} />
        <div className="text-[17px] font-semibold">BACKFIRE<span className="text-holds"> AI</span></div>
      </div>
      <Panel ticks className="p-7 shadow-2xl shadow-black/40">
        <div className="mb-6">
          <h2 className="text-[24px] font-semibold tracking-[-0.02em]">{mode === "login" ? "Welcome back" : "Create your lab account"}</h2>
          <p className="mt-1 text-[14px] text-ink-3">{mode === "login" ? "Sign in to continue your investigations." : "The first account becomes the organisation admin."}</p>
        </div>
        {demo?.enabled && (
          <>
            <button
              type="button"
              onClick={demoLogin}
              disabled={!!busy}
              className="group relative flex w-full items-center gap-3 overflow-hidden rounded-[var(--radius-md)] border border-holds/35 bg-gradient-to-br from-holds/[0.14] to-signal/[0.06] p-4 text-left transition-[border-color,transform] hover:border-holds/60 active:translate-y-px disabled:opacity-60"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-holds/20 ring-1 ring-holds/40">
                {busy === "demo" ? <Loader2 className="h-5 w-5 animate-spin text-holds" /> : <Sparkles className="h-5 w-5 text-holds" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] font-semibold text-ink">Demo login</span>
                <span className="block truncate text-[13px] text-ink-3">Signs you in automatically as the demo admin</span>
              </span>
              <ArrowRight className="h-5 w-5 text-holds transition-transform group-hover:translate-x-0.5" />
            </button>
            <div className="my-6 flex items-center gap-3 text-[12.5px] text-ink-4">
              <span className="h-px flex-1 bg-line" /> or {mode === "login" ? "sign in" : "register"} with email <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}
        <form onSubmit={submit} className="space-y-4" noValidate>
          {mode === "register" && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="full_name">Name</Label><Input id="full_name" autoComplete="name" value={form.full_name} onChange={set("full_name")} /></div>
              <div><Label htmlFor="org">Organisation</Label><Input id="org" autoComplete="organization" value={form.organisation} onChange={set("organisation")} /></div>
            </div>
          )}
          <div><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" required placeholder="you@institute.org" value={form.email} onChange={set("email")} /></div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required value={form.password} onChange={set("password")} />
            {mode === "register" && <p className="mt-1.5 text-[12.5px] text-ink-4">10+ characters, mixing three of: lowercase, uppercase, digits, symbols.</p>}
          </div>
          {error ? <ErrorState error={error} compact /> : null}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy === "form"} disabled={!!busy}>
            {mode === "login" ? "Sign in" : "Create account"} <ArrowRight className="h-4 w-4" />
          </Button>
        </form>
        <div className="mt-6 text-center text-[14px] text-ink-3">
          {mode === "login" ? <>New here? <Link href="/register" className="font-medium text-holds hover:underline">Create an account</Link></> : <>Already registered? <Link href="/login" className="font-medium text-holds hover:underline">Sign in</Link></>}
        </div>
      </Panel>

    </div>
  );
}

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id="lg-bf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1c2029" />
          <stop offset="1" stopColor="#12151b" />
        </linearGradient>
        <linearGradient id="lg-curve" x1="0" x2="1">
          <stop offset="0" stopColor="#3ee6a8" />
          <stop offset="1" stopColor="#4cc9f0" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="33" height="33" rx="9" fill="url(#lg-bf)" stroke="#2a2f3a" />
      <path d="M7 23 C 12 23, 13 11, 17 11 S 22 19, 27 9" fill="none" stroke="url(#lg-curve)" strokeWidth="2" strokeLinecap="round" />
      <path d="M17 11 L 21.5 24" stroke="#ff7a8a" strokeWidth="1.6" strokeDasharray="2 2" />
      <circle cx="21.5" cy="24.5" r="2.4" fill="#ff7a8a" />
    </svg>
  );
}
