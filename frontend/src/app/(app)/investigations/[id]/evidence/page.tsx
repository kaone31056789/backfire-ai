"use client";
import { BookOpen, ChevronDown, ExternalLink, Leaf, Search, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useState } from "react";

import { useInvestigation } from "@/components/investigation-context";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, ErrorState, Input, LoadingBlock, Meter, Notice, Panel, PanelHeader, Select, type Tone } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { EvidenceSource } from "@/lib/types";

interface Resp { sources: EvidenceSource[]; contradictions: { topic: string; supporting: string[]; contradicting: string[] }[]; topics: Record<string, string>; stance_method: string }
interface Hit { score: number; id: string; text: string; topic: string; stance: string; source: { title: string; doi: string | null; year: number | null } }

const TYPE: Record<string, { tone: Tone; label: string }> = {
  peer_reviewed: { tone: "holds", label: "peer-reviewed" },
  government_report: { tone: "signal", label: "government / agency" },
  technical_guide: { tone: "signal", label: "technical guide" },
  assessment_report: { tone: "violet", label: "assessment report" },
  preprint: { tone: "caution", label: "preprint" },
  other: { tone: "muted", label: "other" },
};
const STANCE: Record<string, Tone> = { supports: "holds", contradicts: "fail", neutral: "muted" };

export default function EvidencePage() {
  const { inv, version } = useInvestigation();
  const { data, error, loading, reload } = useApi<Resp>(`/investigations/${inv.id}/evidence`, [version, inv.stage]);
  const [type, setType] = useState("all");
  const [stance, setStance] = useState("all");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return setHits(null);
    setSearching(true);
    try {
      setHits(await api<Hit[]>(`/investigations/${inv.id}/evidence/search?q=${encodeURIComponent(q.trim())}`));
    } finally {
      setSearching(false);
    }
  }

  if (loading && !data) return <Panel><LoadingBlock rows={8} /></Panel>;
  if (error) return <ErrorState error={error} onRetry={() => reload()} />;
  if (!data?.sources.length) return <Panel><EmptyState icon={BookOpen} title="No evidence retrieved" body="The Evidence Research Agent queries OpenAlex, resolves registry DOIs via Crossref and retrieves NASA POWER climatology during analysis." /></Panel>;

  const passageById = Object.fromEntries(data.sources.flatMap((s) => s.passages.map((p) => [p.id, { ...p, source: s }])));
  const filtered = data.sources.filter((s) => (type === "all" || s.source_type === type) && (stance === "all" || s.passages.some((p) => p.stance === stance)));
  const counts = data.sources.reduce<Record<string, number>>((a, s) => ((a[s.source_type] = (a[s.source_type] || 0) + 1), a), {});

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_400px]">
      <div className="space-y-5">
        <Panel ticks>
          <PanelHeader code="08.1" title={`Sources · ${filtered.length} of ${data.sources.length}`}>
            <Select aria-label="Source type" className="h-7 w-40 text-[13px]" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">All types</option>
              {Object.entries(counts).map(([k, n]) => <option key={k} value={k}>{TYPE[k]?.label || k} ({n})</option>)}
            </Select>
            <Select aria-label="Stance" className="h-7 w-40 text-[13px]" value={stance} onChange={(e) => setStance(e.target.value)}>
              <option value="all">Any stance</option>
              <option value="supports">Has supporting</option>
              <option value="contradicts">Has contradicting</option>
            </Select>
          </PanelHeader>
          <ul className="divide-y divide-line/70">
            {filtered.map((s) => {
              const isOpen = open === s.id;
              return (
                <li key={s.id}>
                  <button className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-raise/25" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
                    <ChevronDown className={cn("mt-1 h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform", isOpen && "rotate-180")} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14.5px] leading-snug text-ink">{s.title}</div>
                      <div className="mt-1 text-[13px] text-ink-3">
                        {s.authors.slice(0, 3).join(", ")}{s.authors.length > 3 && " et al."}{s.year && ` · ${s.year}`}{s.venue && ` · ${s.venue}`}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge tone={TYPE[s.source_type]?.tone || "muted"}>{TYPE[s.source_type]?.label || s.source_type}</Badge>
                        <Badge tone="muted">{s.provider}</Badge>
                        {s.doi && (s.doi_verified ? <Badge tone="holds"><ShieldCheck className="h-3 w-3" /> DOI resolved</Badge> : <Badge tone="caution"><ShieldQuestion className="h-3 w-3" /> DOI unverified</Badge>)}
                        {s.passages.map((p) => p.stance).filter((v, i, a) => a.indexOf(v) === i && v !== "neutral").map((st) => <Badge key={st} tone={STANCE[st]}>{st}</Badge>)}
                        {s.cited_by !== null && <span className="font-mono text-[12px] text-ink-4">cited {s.cited_by}×</span>}
                      </div>
                    </div>
                    {s.quality.score !== undefined && (
                      <div className="w-20 shrink-0 text-right">
                        <div className="font-mono text-[12.5px] text-ink-3">q {s.quality.score.toFixed(2)}</div>
                        <Meter value={s.quality.score} className="mt-1" tone={s.quality.score > 0.7 ? "holds" : "caution"} />
                      </div>
                    )}
                  </button>
                  {isOpen && (
                    <div className="space-y-3 border-t border-line/50 bg-void/30 px-11 py-3.5">
                      {s.passages.length > 0 && (
                        <div>
                          <div className="mb-1.5 text-[12px] text-ink-4">Extracted passages</div>
                          <ul className="space-y-2">
                            {s.passages.map((p) => (
                              <li key={p.id} className={cn("border-l-2 pl-3 text-[13.5px] leading-relaxed text-ink-2", p.stance === "contradicts" ? "border-fail/60" : p.stance === "supports" ? "border-holds/50" : "border-line-2")}>
                                “{p.text}”
                                <div className="mt-0.5 font-mono text-[11.5px] text-ink-4">{p.topic.replace(/_/g, " ")} · {p.stance} · relevance {p.relevance.toFixed(2)}</div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {s.abstract && (
                        <details>
                          <summary className="cursor-pointer text-[13px] text-ink-3">Abstract</summary>
                          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">{s.abstract}</p>
                        </details>
                      )}
                      {s.limitations.length > 0 && (
                        <ul className="space-y-0.5 text-[13px] text-caution/85">
                          {s.limitations.map((l) => <li key={l}>⚑ {l}</li>)}
                        </ul>
                      )}
                      <div className="flex flex-wrap gap-3 text-[13px]">
                        {s.url && <a className="inline-flex items-center gap-1 text-signal hover:underline" href={s.url} target="_blank" rel="noreferrer noopener">{s.doi ? `doi:${s.doi}` : "source"} <ExternalLink className="h-3 w-3" /></a>}
                        {s.query && <span className="text-ink-4">query: “{s.query}”</span>}
                        <span className="text-ink-4">retrieved {new Date(s.retrieved_at).toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel>
          <PanelHeader code="08.2" title="Semantic passage search" />
          <form onSubmit={search} className="flex gap-2 p-4 pb-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. drought mortality of street trees" aria-label="Search passages" />
            <Button type="submit" variant="outline" loading={searching} aria-label="Search"><Search className="h-4 w-4" /></Button>
          </form>
          {hits && (
            <ul className="max-h-80 space-y-2.5 overflow-y-auto px-4 pb-4">
              {hits.length ? hits.map((h) => (
                <li key={h.id} className="text-[13px] leading-relaxed">
                  <div className="flex items-center gap-1.5"><span className="font-mono text-[12px] text-signal">{h.score.toFixed(3)}</span><Badge tone={STANCE[h.stance]}>{h.stance}</Badge></div>
                  <p className="mt-0.5 text-ink-2">“{h.text}”</p>
                  <div className="text-[12px] text-ink-4">{h.source.title} {h.source.year && `(${h.source.year})`}</div>
                </li>
              )) : <li className="text-[13px] text-ink-4">No matching passages.</li>}
            </ul>
          )}
          <p className="border-t border-line px-4 py-2 text-[12px] text-ink-4">Hashed n-gram embeddings; pgvector cosine search on PostgreSQL.</p>
        </Panel>

        <Panel>
          <PanelHeader code="08.3" title={`Contradictory findings · ${data.contradictions.length} topic(s)`} />
          {data.contradictions.length ? (
            <div className="divide-y divide-line/70">
              {data.contradictions.map((c) => (
                <div key={c.topic} className="space-y-2 p-4">
                  <div className="text-[13.5px] font-medium capitalize text-ink">{c.topic.replace(/_/g, " ")}</div>
                  {[...c.supporting.slice(0, 2).map((id) => ["supports", id]), ...c.contradicting.slice(0, 2).map((id) => ["contradicts", id])].map(([st, id]) => {
                    const p = passageById[id];
                    return p ? (
                      <div key={id} className={cn("border-l-2 pl-2.5 text-[13px] leading-relaxed text-ink-2", st === "supports" ? "border-holds/50" : "border-fail/60")}>
                        “{p.text}” <span className="text-ink-4">— {p.source.title.slice(0, 70)}{p.source.title.length > 70 && "…"}</span>
                      </div>
                    ) : null;
                  })}
                </div>
              ))}
            </div>
          ) : <p className="p-4 text-[13.5px] text-ink-4">No topic has both supporting and contradicting passages.</p>}
        </Panel>

        <GbifCheck lat={inv.latitude} lon={inv.longitude} />
        <Notice tone="caution">Stance labels use a {data.stance_method}. A retrieved paper is a lead to read, not proof of a claim.</Notice>
      </div>
    </div>
  );
}

function GbifCheck({ lat, lon }: { lat: number; lon: number }) {
  const [name, setName] = useState("");
  const [res, setRes] = useState<{ matched_name: string | null; match_type: string; occurrences_nearby: number; radius_deg: number; note: string } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setRes(await api(`/evidence/gbif?name=${encodeURIComponent(name.trim())}&lat=${lat}&lon=${lon}`));
    } catch (x) {
      setErr(x);
      setRes(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader code="GBIF" title="Species presence near site" />
      <form onSubmit={go} className="flex gap-2 p-4 pb-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Scientific name, e.g. Azadirachta indica" aria-label="Scientific name" pattern="[A-Za-z][A-Za-z .\-]+" />
        <Button type="submit" variant="outline" loading={busy} disabled={name.trim().length < 3}><Leaf className="h-4 w-4" /></Button>
      </form>
      {err ? <div className="px-4 pb-3"><ErrorState error={err} compact /></div> : null}
      {res && (
        <div className="px-4 pb-4 text-[13.5px]">
          <div className="text-ink">{res.matched_name || "No taxonomic match"} <span className="font-mono text-[12px] text-ink-4">{res.match_type}</span></div>
          <div className="mt-1 font-mono text-ink-2">{res.occurrences_nearby.toLocaleString()} occurrence records within ±{res.radius_deg}°</div>
          <p className="mt-1.5 text-[12.5px] text-ink-4">{res.note}</p>
        </div>
      )}
    </Panel>
  );
}
