"use client";
import { Check, Cpu, KeyRound, Lock, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth";
import { Button } from "@/components/ui/button";
import { Badge, ErrorState, Input, KV, Label, LoadingBlock, Notice, PageHeader, Panel, PanelHeader, Select } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { ago, fmt } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { MethodKey } from "@/lib/types";

interface SettingsResp {
  preferences: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  providers: Record<string, { label: string; models: string[]; requires_key: boolean; free_model?: boolean }>;
  api_keys: { id: string; provider: string; label: string; masked: string; created_at: string }[];
  investigation_defaults: Record<string, unknown>;
  user: { email: string; full_name: string; role: string };
}
interface Usage {
  llm: { provider: string; model: string; calls: number; input_tokens: number; output_tokens: number }[];
  compute: { investigations: number; optimisation_runs: number; model_evaluations: number; optimisation_seconds: number };
  audit: { action: string; resource_type: string | null; resource_id: string | null; ip: string | null; created_at: string }[];
}

export default function SettingsPage() {
  const { refreshUser } = useAuth();
  const s = useApi<SettingsResp>("/settings");
  const usage = useApi<Usage>("/settings/usage");
  const [prefs, setPrefs] = useState<Record<string, any>>({}); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [key, setKey] = useState({ provider: "anthropic", api_key: "", label: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; detail: string } | null>(null);

  async function testLlm() {
    setBusy("test");
    setTest(null);
    try {
      await savePrefs();
      setTest(await api<{ ok: boolean; detail: string }>("/settings/test-llm", { body: {} }));
    } catch (e) {
      setTest({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (s.data) setPrefs({ llm_provider: "deterministic", llm_model: "rules-v1", default_budget: 2000, default_lambda: 4, default_methods: ["mpfs", "random", "de", "nsga2"], full_name: s.data.user.full_name, ...s.data.preferences });
  }, [s.data]);

  async function savePrefs() {
    setBusy("prefs");
    setErr(null);
    try {
      const body = { ...prefs };
      if (body.llm_provider === "deterministic") delete body.llm_model;
      await api("/settings/preferences", { method: "PUT", body });
      await refreshUser();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  }

  async function addKey(e: React.FormEvent) {
    e.preventDefault();
    setBusy("key");
    setErr(null);
    try {
      await api("/settings/api-keys", { body: key });
      setKey({ ...key, api_key: "", label: "" });
      s.reload(true);
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(null);
    }
  }

  async function delKey(id: string) {
    await api(`/settings/api-keys/${id}`, { method: "DELETE" });
    s.reload(true);
  }

  if (s.loading && !s.data) return <Panel><LoadingBlock rows={8} /></Panel>;
  if (s.error) return <ErrorState error={s.error} onRetry={() => s.reload()} />;
  const d = s.data!;
  const provider = d.providers[prefs.llm_provider] || d.providers.deterministic;
  const hasKey = (p: string) => d.api_keys.some((k) => k.provider === p);

  return (
    <div>
      <PageHeader section="§10 · Settings" title="Configuration" lede="The AI model you choose here powers four features: reading proposals into claims, building scenarios from your ideas, the Ask-AI Copilot and the simulation-film narration. Every number still comes from the scientific engine — the AI is checked so it can never invent one." />
      {err ? <div className="mb-4"><ErrorState error={err} compact /></div> : null}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel ticks>
          <PanelHeader code="10.1" title="AI provider & model" />
          <div className="space-y-4 p-4">
            <div>
              <Label htmlFor="prov">AI provider (used everywhere in the app)</Label>
              <Select id="prov" value={prefs.llm_provider || "deterministic"} onChange={(e) => setPrefs({ ...prefs, llm_provider: e.target.value, llm_model: d.providers[e.target.value].models[0] })}>
                {Object.entries(d.providers).map(([k, p]) => <option key={k} value={k}>{p.label}{p.requires_key && !hasKey(k) ? " — key required" : ""}</option>)}
              </Select>
            </div>
            {prefs.llm_provider === "ollama" && (
              <div>
                <Label htmlFor="ohost">Ollama server</Label>
                <Select id="ohost" value={prefs.ollama_host || "cloud"} onChange={(e) => setPrefs({ ...prefs, ollama_host: e.target.value })}>
                  <option value="cloud">Ollama Cloud API (ollama.com, needs your API key)</option>
                  <option value="local">Local Ollama (127.0.0.1:11434, no key)</option>
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor="model">Model</Label>
              {provider.free_model ? (
                <>
                  <Input id="model" list="model-suggestions" value={prefs.llm_model || provider.models[0]} onChange={(e) => setPrefs({ ...prefs, llm_model: e.target.value.trim() })} placeholder="e.g. gpt-oss:120b" />
                  <datalist id="model-suggestions">{provider.models.map((m) => <option key={m} value={m} />)}</datalist>
                </>
              ) : (
                <Select id="model" value={prefs.llm_model || provider.models[0]} onChange={(e) => setPrefs({ ...prefs, llm_model: e.target.value })} disabled={prefs.llm_provider === "deterministic"}>
                  {provider.models.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              )}
            </div>
            {prefs.llm_provider === "ollama" && (prefs.ollama_host || "cloud") === "cloud" && !hasKey("ollama") && <Notice tone="caution">Add your Ollama API key on the right. It is stored encrypted in the database and survives server restarts.</Notice>}
            {provider.requires_key && !hasKey(prefs.llm_provider) && <Notice tone="caution">No API key stored for this provider; extraction will fall back to the deterministic rule-based extractor.</Notice>}
            {prefs.llm_provider !== "deterministic" && (
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={testLlm} loading={busy === "test"}>Save &amp; test connection</Button>
                {test && <span className={test.ok ? "text-[13.5px] text-holds" : "text-[13.5px] text-fail"}>{test.ok ? "✓ " : "✗ "}{test.detail}</span>}
              </div>
            )}
            <p className="text-[13px] leading-relaxed text-ink-4">LLM outputs are validated against a Pydantic schema; any claim whose text cannot be traced back to the proposal is discarded and logged.</p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader code="10.2" title="API key management" />
          <div className="p-4">
            {d.api_keys.length ? (
              <ul className="mb-4 divide-y divide-line rounded-[var(--radius-sm)] border border-line">
                {d.api_keys.map((k) => (
                  <li key={k.id} className="flex items-center gap-3 px-3 py-2.5">
                    <KeyRound className="h-4 w-4 text-ink-4" />
                    <div className="flex-1">
                      <div className="text-[14px] text-ink">{d.providers[k.provider]?.label || k.provider} <span className="font-mono text-ink-3">{k.masked}</span></div>
                      <div className="text-[12.5px] text-ink-4">{k.label || "unlabelled"} · added {ago(k.created_at)}</div>
                    </div>
                    <Button size="icon" variant="ghost" aria-label="Delete key" onClick={() => delKey(k.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </li>
                ))}
              </ul>
            ) : <p className="mb-4 text-[13.5px] text-ink-4">No keys stored.</p>}
            <form onSubmit={addKey} className="grid grid-cols-[130px_1fr] gap-2">
              <Select aria-label="Key provider" value={key.provider} onChange={(e) => setKey({ ...key, provider: e.target.value })}>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama</option>
              </Select>
              <Input type="password" autoComplete="off" placeholder="API key" aria-label="API key" value={key.api_key} onChange={(e) => setKey({ ...key, api_key: e.target.value })} />
              <Input placeholder="Label (optional)" aria-label="Key label" className="col-span-2" value={key.label} onChange={(e) => setKey({ ...key, label: e.target.value })} />
              <Button type="submit" variant="outline" className="col-span-2" loading={busy === "key"} disabled={key.api_key.length < 10}><Lock className="h-4 w-4" /> Store encrypted</Button>
            </form>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-4">Keys are stored encrypted in the database (Fernet, derived from the server secret), so they persist across server restarts. They are never returned to the browser and are only decrypted server-side at call time. Storing a key replaces the previous one for that provider.</p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader code="10.3" title="Investigation defaults & preferences" />
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="fn">Display name</Label><Input id="fn" value={prefs.full_name || ""} onChange={(e) => setPrefs({ ...prefs, full_name: e.target.value })} /></div>
              <div><Label>Email</Label><Input value={d.user.email} disabled /></div>
              <div><Label htmlFor="db">Default budget / method</Label><Input id="db" type="number" min={200} max={20000} className="font-mono" value={prefs.default_budget ?? 2000} onChange={(e) => setPrefs({ ...prefs, default_budget: Number(e.target.value) })} /></div>
              <div><Label htmlFor="dl">Default λ</Label><Input id="dl" type="number" step={0.5} min={0.01} className="font-mono" value={prefs.default_lambda ?? 4} onChange={(e) => setPrefs({ ...prefs, default_lambda: Number(e.target.value) })} /></div>
            </div>
            <div>
              <Label>Default methods</Label>
              <div className="flex flex-wrap gap-4">
                {(["mpfs", "random", "de", "nsga2"] as MethodKey[]).map((m) => {
                  const on = (prefs.default_methods || []).includes(m);
                  return <label key={m} className="flex items-center gap-2 text-[14px] text-ink-2"><input type="checkbox" className="accent-[#22d3ee]" checked={on} onChange={() => setPrefs({ ...prefs, default_methods: on ? prefs.default_methods.filter((x: string) => x !== m) : [...(prefs.default_methods || []), m] })} />{m.toUpperCase()}</label>;
                })}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="primary" onClick={savePrefs} loading={busy === "prefs"}>Save preferences</Button>
              {saved && <span className="inline-flex items-center gap-1 text-[13.5px] text-holds"><Check className="h-4 w-4" /> Saved</span>}
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader code="10.4" title="Usage monitoring" />
          {usage.loading && !usage.data ? <LoadingBlock rows={4} /> : usage.data && (
            <div className="p-4">
              <dl>
                <KV k="Investigations owned" v={usage.data.compute.investigations} />
                <KV k="Optimisation runs" v={usage.data.compute.optimisation_runs} />
                <KV k="Model evaluations (optimisation)" v={fmt(usage.data.compute.model_evaluations, 0)} />
                <KV k="Optimisation compute time" v={`${usage.data.compute.optimisation_seconds.toFixed(1)} s`} />
              </dl>
              <div className="mt-4 text-[12px] text-ink-4">LLM usage</div>
              {usage.data.llm.length ? (
                <dl className="mt-1">{usage.data.llm.map((l) => <KV key={l.provider + l.model} k={<span className="inline-flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" />{l.provider} · {l.model}</span>} v={`${l.calls} calls · ${fmt(l.input_tokens, 0)} in / ${fmt(l.output_tokens, 0)} out`} />)}</dl>
              ) : <p className="mt-1 text-[13.5px] text-ink-4">No LLM calls — deterministic extraction only.</p>}
            </div>
          )}
        </Panel>
      </div>

      <Panel className="mt-5">
        <PanelHeader code="10.5" title="Audit log · your recent actions" />
        {usage.data?.audit.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead><tr className="border-b border-line text-left text-[11.5px] uppercase tracking-[0.1em] text-ink-4"><th className="px-4 py-2 font-medium">When</th><th className="px-4 py-2 font-medium">Action</th><th className="px-4 py-2 font-medium">Resource</th><th className="px-4 py-2 font-medium">IP</th></tr></thead>
              <tbody>
                {usage.data.audit.map((a, i) => (
                  <tr key={i} className="border-b border-line/50">
                    <td className="px-4 py-1.5 text-ink-3">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="px-4 py-1.5"><Badge tone={a.action.includes("fail") || a.action.includes("delete") ? "caution" : "muted"}>{a.action}</Badge></td>
                    <td className="px-4 py-1.5 font-mono text-[12.5px] text-ink-3">{a.resource_type}{a.resource_id && ` · ${a.resource_id.slice(0, 8)}`}</td>
                    <td className="px-4 py-1.5 font-mono text-[12.5px] text-ink-4">{a.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="p-4 text-[13.5px] text-ink-4">No audit entries.</p>}
      </Panel>
    </div>
  );
}
