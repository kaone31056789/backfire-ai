"use client";
import { motion } from "framer-motion";
import { Crosshair, MapPin, Microscope, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { canWrite, useAuth } from "@/components/auth";
import { Copilot } from "@/components/copilot";
import { InvestigationContext } from "@/components/investigation-context";
import { STATUS_TONE } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Badge, Dialog, ErrorState, LoadingBlock, Notice, Tip } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn, shortId } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Investigation } from "@/lib/types";

const TABS = [
  { seg: "overview", label: "Overview" },
  { seg: "film", label: "▶ Simulation film" },
  { seg: "claims", label: "Claims" },
  { seg: "causal", label: "Causal graph" },
  { seg: "engine", label: "Adversarial engine" },
  { seg: "boundary", label: "Failure boundary" },
  { seg: "alternatives", label: "Alternatives" },
  { seg: "evidence", label: "Evidence" },
  { seg: "certificate", label: "Certificate" },
];

export default function InvestigationLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const path = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const { data: inv, error, loading, reload } = useApi<Investigation>(`/investigations/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [version, setVersion] = useState(0);
  const wasRunning = useRef(false);

  const running = !!inv && (inv.running || inv.status === "running" || inv.status === "analysing");
  useEffect(() => {
    if (!running) {
      if (wasRunning.current) setVersion((v) => v + 1);
      wasRunning.current = false;
      return;
    }
    wasRunning.current = true;
    const t = setInterval(() => reload(true), 2000);
    return () => clearInterval(t);
  }, [running, reload]);

  async function start(kind: "analyse" | "run-backfire") {
    setBusy(kind);
    setActionError(null);
    try {
      await api(`/investigations/${id}/${kind}`, { method: "POST" });
      await reload(true);
      router.push(`/investigations/${id}/engine`);
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    try {
      await api(`/investigations/${id}`, { method: "DELETE" });
      router.replace("/dashboard");
    } catch (e) {
      setActionError(e);
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  if (loading && !inv) return <LoadingBlock rows={6} />;
  if (error || !inv) return <ErrorState error={error || "Investigation not found"} onRetry={() => reload()} />;

  const writable = canWrite(user);
  const analysed = ["analysed", "completed"].includes(inv.status) || inv.counts.evidence_sources > 0;

  return (
    <InvestigationContext.Provider value={{ inv, reload: () => reload(true), version, start, busy }}>
      <div className="mb-7">
        <div className="hud flex flex-col gap-5 rounded-3xl p-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={running ? "signal" : STATUS_TONE[inv.status]} dot>{running ? `Running · ${inv.stage.replace(/_/g, " ")}` : inv.status}</Badge>
              {inv.climatology && (
                <Tip text={inv.climatology.source}>
                  <Badge tone={inv.climatology.synthetic ? "caution" : "muted"}>{inv.climatology.synthetic ? "Synthetic climate" : "NASA POWER climate"}</Badge>
                </Tip>
              )}
              <span className="font-mono text-[12px] text-ink-4">#{shortId(inv.id)}</span>
            </div>
            <h1 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.025em] text-ink md:text-[34px]">{inv.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-ink-3">
              <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-ink-4" />{inv.location_name || "Unnamed site"}{inv.country && `, ${inv.country}`}</span>
              <span className="font-mono text-[13px] text-ink-4">{inv.latitude.toFixed(2)}°, {inv.longitude.toFixed(2)}°</span>
              <span className="text-ink-4">Urban afforestation under water stress</span>
            </div>
          </div>
          {writable && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => start("analyse")} loading={busy === "analyse"} disabled={running}>
                <Microscope className="h-4 w-4" /> {analysed ? "Re-analyse" : "Analyse"}
              </Button>
              <Button variant="primary" onClick={() => start("run-backfire")} loading={busy === "run-backfire"} disabled={running}>
                <Crosshair className="h-4 w-4" /> {inv.status === "completed" ? "Re-run BACKFIRE" : "Run BACKFIRE"}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} aria-label="Delete investigation" disabled={running}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        {actionError ? <div className="mt-4"><ErrorState error={actionError} compact /></div> : null}
        {inv.status === "failed" && inv.error && <Notice tone="fail" className="mt-4">The last workflow halted: {inv.error}. Open the Adversarial engine log for details.</Notice>}

        <nav className="hud mt-6 flex gap-1 overflow-x-auto rounded-2xl p-1.5" aria-label="Investigation sections">
          {TABS.map((t) => {
            const href = `/investigations/${id}/${t.seg}`;
            const active = path.startsWith(href);
            return (
              <Link key={t.seg} href={href} className={cn("relative shrink-0 rounded-[var(--radius-sm)] px-3.5 py-2 text-[14px] font-medium transition-colors", active ? "text-ink" : "text-ink-3 hover:text-ink-2")}>
                {active && <motion.span layoutId="inv-tab" className="absolute inset-0 rounded-[var(--radius-sm)] border border-line-2 bg-raise shadow-sm" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} />}
                <span className="relative">{t.label}</span>
                {t.seg === "engine" && running && <span className="relative ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-signal pulse-dot" />}
              </Link>
            );
          })}
        </nav>
        {running && <div className="mt-2 h-[2px] w-full overflow-hidden rounded-full bg-line"><div className="h-full w-full scan" /></div>}
      </div>
      {children}
      <Copilot invId={inv.id} title={inv.title} />
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete investigation?">
        <p className="text-[14.5px] leading-relaxed text-ink-2">
          This permanently removes <b>{inv.title}</b> with its claims, evidence, runs, counterexamples and certificates. The action is audit-logged and cannot be undone.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" onClick={remove} loading={busy === "delete"}>Delete permanently</Button>
        </div>
      </Dialog>
    </InvestigationContext.Provider>
  );
}
