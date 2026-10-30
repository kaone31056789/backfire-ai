"use client";
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { ExternalLink, Network } from "lucide-react";
import { useMemo, useState } from "react";

import { CausalStory } from "@/components/causal-story";
import { useInvestigation } from "@/components/investigation-context";
import { Badge, EmptyState, ErrorState, LoadingBlock, Meter, Notice, Panel, PanelHeader, Tabs } from "@/components/ui/primitives";
import { cn } from "@/lib/format";
import { useApi } from "@/lib/hooks";

type GEdge = { id: string; source: string; target: string; sign: string; mechanism: string; basis: string; in_model: boolean; confidence: number; uncertainty: string; references: string[]; evidence_ids: string[]; contradicting_ids: string[] } & Record<string, unknown>;
interface GNode { key: string; label: string; kind: string; parameter_name: string | null; description: string; x: number; y: number }
interface Graph { id: string; name: string; description: string; is_alternative: boolean; analysis: { acyclic: boolean; n_nodes: number; n_edges: number; confounding: { treatment: string; outcome: string; common_causes: string[]; directed_paths: string[]; n_paths: number }[]; note: string }; nodes: GNode[]; edges: GEdge[] }
interface Resp { graphs: Graph[]; passages: Record<string, { text: string; stance: string; source_title: string; doi: string | null; year: number | null }>; references: Record<string, { citation: string; doi: string | null; url: string | null }> }

const KIND_STYLE: Record<string, { border: string; label: string; dot: string }> = {
  environment: { border: "#22d3ee", label: "Environment · x", dot: "bg-signal" },
  intervention: { border: "#a5b4fc", label: "Intervention · θ", dot: "bg-violet" },
  intermediate: { border: "#44516a", label: "Intermediate", dot: "bg-ink-4" },
  outcome: { border: "#34d399", label: "Outcome", dot: "bg-holds" },
};
const BASIS_TONE: Record<string, "holds" | "signal" | "caution" | "violet" | "muted"> = { equation: "holds", literature: "signal", engineering: "violet", assumption: "caution", hypothesis: "muted" };

function VarNode({ data, selected }: NodeProps<Node<{ n: GNode; dim: boolean }>>) {
  const s = KIND_STYLE[data.n.kind];
  return (
    <div className={cn("w-[170px] rounded-[4px] border bg-panel px-2.5 py-2 transition-opacity", data.dim && "opacity-30")} style={{ borderColor: selected ? "#e6edf7" : s.border + "88", boxShadow: selected ? `0 0 0 1px ${s.border}` : undefined }}>
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-ink-4" />
      <div className="flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
        <span className="font-mono text-[9px] uppercase tracking-wider text-ink-4">{data.n.kind}</span>
      </div>
      <div className="mt-0.5 text-[13px] font-medium leading-tight text-ink">{data.n.label}</div>
      {data.n.parameter_name && <div className="mt-0.5 font-mono text-[9.5px] text-ink-4">{data.n.parameter_name}</div>}
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-ink-4" />
    </div>
  );
}
const nodeTypes = { v: VarNode };

export default function CausalPage() {
  const { inv, version } = useInvestigation();
  const { data, error, loading, reload } = useApi<Resp>(`/investigations/${inv.id}/causal-graph`, [version, inv.stage]);
  const [alt, setAlt] = useState<"model" | "alt">("model");
  const [view, setView] = useState<"simple" | "expert">("simple");
  const [sel, setSel] = useState<{ type: "edge"; e: GEdge } | { type: "node"; n: GNode } | null>(null);
  const graph = data?.graphs.find((g) => g.is_alternative === (alt === "alt"));

  const { nodes, edges } = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };
    const focus = sel?.type === "node" ? sel.n.key : null;
    const linked = new Set<string>();
    if (focus) graph.edges.forEach((e) => (e.source === focus || e.target === focus) && (linked.add(e.source), linked.add(e.target)));
    const nodes: Node[] = graph.nodes.map((n) => ({ id: n.key, type: "v", position: { x: n.x, y: n.y }, data: { n, dim: !!focus && !linked.has(n.key) } }));
    const edges: Edge[] = graph.edges.map((e) => {
      const color = e.sign === "-" ? "#fb7185" : e.sign === "+" ? "#34d399" : "#fbbf24";
      const isSel = sel?.type === "edge" && sel.e.id === e.id;
      const dim = focus && !(e.source === focus || e.target === focus);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        animated: !e.in_model,
        style: { stroke: color, strokeOpacity: dim ? 0.12 : isSel ? 1 : 0.35 + e.confidence * 0.55, strokeWidth: isSel ? 2.6 : 0.8 + e.confidence * 1.6, strokeDasharray: e.basis === "assumption" ? "5 4" : e.basis === "hypothesis" ? "2 4" : undefined },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        label: isSel ? e.sign : undefined,
        data: e,
      };
    });
    return { nodes, edges };
  }, [graph, sel]);

  if (loading && !data) return <Panel><LoadingBlock rows={8} /></Panel>;
  if (error) return <ErrorState error={error} onRetry={() => reload()} />;
  if (!data?.graphs.length || !graph) return <Panel><EmptyState icon={Network} title="No causal graph yet" body="The Causal Analysis Agent builds the graph during analysis." /></Panel>;

  const header = (
    <div className="hud flex flex-wrap items-center justify-between gap-3 rounded-3xl p-5">
      <div>
        <div className="text-[20px] font-semibold tracking-[-0.02em] text-white">How one thing leads to another 🔗</div>
        <div className="mt-0.5 max-w-2xl text-[14px] text-white/60">Every arrow is a cause-and-effect link the simulator computes. Green arrows: more of one gives more of the other. Red arrows: more of one gives less of the other.</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Tabs value={view} onChange={(v) => { setView(v); setSel(null); }} items={[{ value: "simple", label: "Simple story" }, { value: "expert", label: "Expert graph" }]} />
        <Tabs value={alt} onChange={(v) => { setAlt(v); setSel(null); }} items={[{ value: "model", label: "In the model" }, { value: "alt", label: "+ Untested ideas" }]} />
      </div>
    </div>
  );

  if (view === "simple")
    return (
      <div className="space-y-5">
        {header}
        <div className="hud rounded-3xl p-5"><CausalStory key={graph.id} nodes={graph.nodes} edges={graph.edges} /></div>
      </div>
    );

  return (
    <div className="space-y-5">
    {header}
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
      <Panel ticks className="overflow-hidden">
        <PanelHeader code="04" title={graph.name}>
          <span className="text-[12.5px] text-ink-4">{alt === "alt" ? "with alternative hypotheses" : "implemented model"}</span>
        </PanelHeader>
        <div className="h-[640px] bg-void/40">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            minZoom={0.3}
            nodesConnectable={false}
            onEdgeClick={(_, e) => setSel({ type: "edge", e: e.data as unknown as GEdge })}
            onNodeClick={(_, n) => setSel({ type: "node", n: (n.data as { n: GNode }).n })}
            onPaneClick={() => setSel(null)}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#18243a" gap={24} size={1} />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap pannable zoomable nodeColor={(n) => KIND_STYLE[(n.data as { n: GNode }).n.kind]?.border || "#44516a"} maskColor="rgba(4,6,10,0.7)" />
          </ReactFlow>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-4 py-2.5 text-[12.5px] text-ink-3">
          {Object.entries(KIND_STYLE).map(([k, s]) => <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />{s.label}</span>)}
          <span className="inline-flex items-center gap-1.5"><span className="h-px w-5 bg-holds" /> increases</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-px w-5 bg-fail" /> decreases</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t border-dashed border-ink-3" /> assumption</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t border-dotted border-ink-3" /> hypothesis (not in model)</span>
          <span>line weight ∝ confidence</span>
        </div>
      </Panel>

      <div className="space-y-5">
        <Panel>
          <PanelHeader code="DET" title={sel ? (sel.type === "edge" ? "Relationship" : "Variable") : "Select an edge or node"} />
          {!sel && <p className="p-4 text-[13.5px] leading-relaxed text-ink-3">Click a directed edge to see its mechanism, basis, confidence and the evidence attached to it. Click a variable to highlight its neighbourhood.</p>}
          {sel?.type === "node" && (
            <div className="space-y-2 p-4 text-[14px]">
              <div className="font-display text-xl">{sel.n.label}</div>
              <Badge tone="muted">{sel.n.kind}</Badge>
              <p className="text-ink-2">{sel.n.description}</p>
              {sel.n.parameter_name && <p className="font-mono text-[13px] text-signal/80">parameter: {sel.n.parameter_name}</p>}
            </div>
          )}
          {sel?.type === "edge" && <EdgeDetail e={sel.e} graph={graph} data={data} />}
        </Panel>
        <Panel>
          <PanelHeader code="DAG" title="Structural analysis (NetworkX)" />
          <div className="space-y-3 p-4 text-[13.5px]">
            <div className="flex gap-4 font-mono text-[13px] text-ink-2">
              <span>{graph.analysis.n_nodes} nodes</span><span>{graph.analysis.n_edges} edges</span>
              <span className={graph.analysis.acyclic ? "text-holds" : "text-fail"}>{graph.analysis.acyclic ? "acyclic ✓" : "cycle detected"}</span>
            </div>
            {graph.analysis.confounding.map((c) => (
              <div key={c.treatment + c.outcome} className="rounded-[3px] border border-line bg-abyss/60 p-2.5">
                <div className="font-mono text-[13px] text-ink">{c.treatment} → {c.outcome}</div>
                <div className="mt-1 text-[13px] text-ink-3">{c.n_paths} directed path(s)</div>
                <div className={cn("mt-1 text-[13px]", c.common_causes.length ? "text-caution" : "text-ink-4")}>
                  {c.common_causes.length ? `Common causes (confounders): ${c.common_causes.join(", ")}` : "No structural confounders in this graph"}
                </div>
              </div>
            ))}
            <p className="text-[12.5px] leading-relaxed text-ink-4">{graph.analysis.note}</p>
          </div>
        </Panel>
        <Notice tone="signal">Edges of basis <b>literature</b> rest mainly on observational studies: they encode an association whose causal effect size is not identified. Only <b>equation</b> edges are standard physical relationships.</Notice>
      </div>
    </div>
    </div>
  );
}

function EdgeDetail({ e, graph, data }: { e: GEdge; graph: Graph; data: Resp }) {
  const label = (k: string) => graph.nodes.find((n) => n.key === k)?.label || k;
  return (
    <div className="space-y-3.5 p-4">
      <div className="text-[14px] text-ink">
        {label(e.source)} <span className={e.sign === "-" ? "text-fail" : "text-holds"}>{e.sign === "-" ? "⊸ decreases" : "→ increases"}</span> {label(e.target)}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={BASIS_TONE[e.basis]}>{e.basis}</Badge>
        <Badge tone={e.in_model ? "holds" : "muted"}>{e.in_model ? "implemented in model" : "not in model"}</Badge>
      </div>
      <p className="text-[14px] leading-relaxed text-ink-2">{e.mechanism}</p>
      <div>
        <div className="flex justify-between text-[12.5px] text-ink-4"><span>Confidence (heuristic)</span><span className="font-mono">{e.confidence.toFixed(2)}</span></div>
        <Meter value={e.confidence} tone={e.confidence > 0.7 ? "holds" : e.confidence > 0.45 ? "signal" : "caution"} className="mt-1" />
      </div>
      <p className="text-[13px] leading-relaxed text-caution/90">{e.uncertainty}</p>
      {e.references.length > 0 && (
        <div>
          <div className="mb-1 text-[12px] text-ink-4">References</div>
          <ul className="space-y-1.5">
            {e.references.map((r) => {
              const ref = data.references[r];
              return (
                <li key={r} className="text-[13px] leading-snug text-ink-3">
                  {ref?.citation || r}{" "}
                  {(ref?.doi || ref?.url) && <a className="inline-flex items-center gap-0.5 text-signal/80 hover:text-signal" href={ref.doi ? `https://doi.org/${ref.doi}` : ref.url!} target="_blank" rel="noreferrer noopener">link <ExternalLink className="h-3 w-3" /></a>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {[["Retrieved supporting / related passages", e.evidence_ids, "holds"], ["Heuristically contradicting passages", e.contradicting_ids, "fail"]].map(([t, ids, tone]) =>
        (ids as string[]).length ? (
          <div key={t as string}>
            <div className="mb-1 text-[12px] text-ink-4">{t as string}</div>
            <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {(ids as string[]).map((id) => {
                const p = data.passages[id];
                if (!p) return null;
                return (
                  <li key={id} className={cn("border-l-2 pl-2.5 text-[13px] leading-relaxed", tone === "fail" ? "border-fail/50" : "border-holds/40")}>
                    <span className="text-ink-2">“{p.text}”</span>
                    <div className="text-[12px] text-ink-4">{p.source_title} {p.year && `(${p.year})`}</div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}
