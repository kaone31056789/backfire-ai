"use client";
/**
 * Interactive 3D map of BACKFIRE's backend. Blocks are real components (file paths listed in
 * the info panel); glowing packets travel along the links that are active in the current tour
 * step. Click any block to read what it does in plain words and in technical terms.
 */
import { Html, OrbitControls, RoundedBox, Sparkles } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export interface ArchNode {
  id: string; emoji: string; label: string; group: "you" | "web" | "api" | "brain" | "agent" | "science" | "memory" | "world";
  pos: [number, number, number]; size?: [number, number, number];
  simple: string; tech: string; files: string[];
}
export interface ArchEdge { from: string; to: string }

export const GROUP_COLOR: Record<ArchNode["group"], string> = {
  you: "#e2e8f0", web: "#60a5fa", api: "#f5b84a", brain: "#ff5b2e", agent: "#ff8a5b", science: "#a78bfa", memory: "#3ee6a8", world: "#22d3ee",
};

const AGENT_RING: [string, string, string][] = [
  ["claims", "📜", "Claim reader"], ["evidence", "📚", "Evidence finder"], ["causal", "🔗", "Cause-and-effect"], ["sensitivity", "🎯", "Weak-spot finder"],
  ["optimisation", "🔨", "Breaking-point hunter"], ["verification", "🛡️", "Independent checker"], ["alternatives", "🌱", "Better-design finder"], ["report", "📄", "Report writer"],
];
const AGENT_TEXT: Record<string, [string, string]> = {
  claims: ["Reads the plan and writes down exactly what was promised, as numbers.", "app/agents/claims.py · LLM structured output (Pydantic schema) or rule-based regex reader; quotes must be traceable to the source."],
  evidence: ["Looks up the real local weather and what scientists have published.", "app/services/evidence.py · NASA POWER climatology, OpenAlex search, Crossref DOI check, GBIF occurrences, passage embeddings."],
  causal: ["Draws the cause-and-effect map and attaches evidence to each arrow.", "app/agents/causal.py · NetworkX DAG, acyclicity and confounder analysis, evidence linking per edge."],
  sensitivity: ["Finds which uncertain things matter most.", "app/science/analysis.py · SALib Sobol indices (Saltelli sampling) and one-at-a-time stress tests."],
  optimisation: ["Hunts for the smallest realistic change that breaks the promise.", "app/science/mpfs.py + baselines.py · MPFS vs random search, differential evolution (SciPy), NSGA-II (pymoo); same budget & seed."],
  verification: ["Re-does every breaking point from scratch to be sure.", "app/science/verification.py · fresh model instance, config hash check, robustness probe, FAO-56 ET₀ cross-check."],
  alternatives: ["Tries safer designs in the same harsh future.", "app/agents/workflow.py (alternatives node) · species classes, irrigation strategies, Monte Carlo failure probability with Wilson 95% CI."],
  report: ["Writes the final certificate anyone can re-check.", "app/services/report.py + pdf_worker.py · ReportLab PDF + JSON, SHA-256 content hash, seeds and versions."],
};

export const NODES: ArchNode[] = [
  { id: "browser", emoji: "🧑‍💻", label: "You (browser)", group: "you", pos: [-17, 0, 0], simple: "You type a plan or pick a situation and press Run.", tech: "Any modern browser. Auth is an httpOnly JWT cookie; every write sends the CSRF header X-Requested-With.", files: [] },
  { id: "web", emoji: "🖥️", label: "Website", group: "web", pos: [-11.5, 0, 0], simple: "The pages you see: the 3D globe, the lab, films and charts.", tech: "Next.js 15 (App Router), React 19, Tailwind v4, three.js / React Three Fiber, MapLibre GL, ECharts, React Flow. A service worker caches map tiles.", files: ["frontend/src/app/*", "frontend/src/components/*"] },
  { id: "api", emoji: "🚪", label: "Front door (API)", group: "api", pos: [-6, 0, 0], simple: "Checks who you are, blocks bad requests and hands the job on.", tech: "FastAPI + Pydantic v2. Guards: JWT auth & roles (admin/analyst/viewer), CSRF header, rate limiting (memory/Redis), SSRF allow-list for outgoing calls, audit log.", files: ["backend/app/main.py", "backend/app/api/*.py", "backend/app/core/security.py"] },
  { id: "worker", emoji: "⚙️", label: "Job runner", group: "api", pos: [-6, 0, 5.5], simple: "Runs the long work in the background so the page never freezes, and streams live updates back.", tech: "Thread-pool worker (2 workers) runs the workflow; agent events are stored and pushed over a WebSocket (/ws/investigations/{id}, 60-second ticket).", files: ["backend/app/services/worker.py", "backend/app/services/events.py"] },
  { id: "orch", emoji: "🎼", label: "Conductor", group: "brain", pos: [1.5, 0, 0], size: [2.6, 1.3, 2.6], simple: "Decides which agent works next, retries if something fails, and stops loops.", tech: "LangGraph StateGraph over 8 agent nodes with per-agent timeouts, retries and a loop guard; every run is an AgentExecution row.", files: ["backend/app/agents/workflow.py"] },
  ...AGENT_RING.map(([id, emoji, label], i): ArchNode => {
    const a = (i / AGENT_RING.length) * Math.PI * 2 - Math.PI / 2;
    return { id, emoji, label, group: "agent", pos: [1.5 + Math.cos(a) * 4.3, 0, Math.sin(a) * 4.3], size: [1.5, 0.8, 1.5], simple: AGENT_TEXT[id][0], tech: AGENT_TEXT[id][1], files: [] };
  }),
  { id: "science", emoji: "🧪", label: "Science engine", group: "science", pos: [9.5, 0, -1.5], size: [2.6, 1.6, 2.6], simple: "The mini-world: simulates 10 years of weather, water and trees, thousands of times.", tech: "FAO-56 Penman-Monteith ET₀, WUCOLS landscape coefficient, daily soil-water bucket with Ks stress, survival (1−m)^H, saturating cooling. NumPy-vectorised.", files: ["backend/app/science/model.py", "backend/app/science/problem.py", "backend/app/science/mpfs.py"] },
  { id: "db", emoji: "🗄️", label: "Database", group: "memory", pos: [9.5, 0, 5.5], size: [2.6, 1.6, 2.6], simple: "Remembers everything: plans, evidence, every simulation, results and your saved AI keys (locked).", tech: "SQLAlchemy 2 + Alembic. SQLite locally; PostgreSQL + PostGIS + pgvector in production. API keys encrypted with Fernet.", files: ["backend/app/models.py", "backend/alembic/"] },
  { id: "pdf", emoji: "🔏", label: "Certificate", group: "memory", pos: [4.5, 0, 8.5], simple: "A signed report you can download and anyone can re-check.", tech: "PDF + JSON with SHA-256 hash, seeds, model version and limitations.", files: ["backend/app/services/report.py"] },
  { id: "llm", emoji: "🤖", label: "Language model", group: "world", pos: [16, 0, -7], simple: "Reads and writes text only. It never makes the numbers.", tech: "Ollama Cloud / local Ollama, Anthropic Claude or OpenAI, chosen in Settings. Every reply must match a JSON schema; any number not computed by the engine is rejected.", files: ["backend/app/agents/providers.py"] },
  { id: "nasa", emoji: "🛰️", label: "NASA POWER", group: "world", pos: [16, 0, -3.5], simple: "30 years of real weather for the exact place.", tech: "power.larc.nasa.gov climatology: T2M, T2M_RANGE, RH2M, PRECTOTCORR.", files: [] },
  { id: "openalex", emoji: "📚", label: "OpenAlex", group: "world", pos: [16, 0, 0], simple: "A giant library of scientific papers.", tech: "api.openalex.org works search with abstracts (inverted index).", files: [] },
  { id: "crossref", emoji: "🔖", label: "Crossref", group: "world", pos: [16, 0, 3.5], simple: "Checks that every cited paper really exists.", tech: "api.crossref.org DOI resolution.", files: [] },
  { id: "gbif", emoji: "🌿", label: "GBIF", group: "world", pos: [16, 0, 7], simple: "Checks the tree species actually grow near the site.", tech: "api.gbif.org occurrence counts in a bounding box.", files: [] },
];

export const EDGES: ArchEdge[] = [
  { from: "browser", to: "web" }, { from: "web", to: "api" }, { from: "api", to: "worker" }, { from: "worker", to: "orch" },
  ...AGENT_RING.map(([id]) => ({ from: "orch", to: id })),
  { from: "claims", to: "llm" }, { from: "evidence", to: "nasa" }, { from: "evidence", to: "openalex" }, { from: "evidence", to: "crossref" }, { from: "evidence", to: "gbif" },
  { from: "sensitivity", to: "science" }, { from: "optimisation", to: "science" }, { from: "verification", to: "science" }, { from: "alternatives", to: "science" },
  { from: "causal", to: "db" }, { from: "report", to: "pdf" }, { from: "report", to: "db" }, { from: "api", to: "db" }, { from: "worker", to: "browser" },
];

const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
const ekey = (e: ArchEdge) => `${e.from}>${e.to}`;

function curve(e: ArchEdge) {
  const a = new THREE.Vector3(...byId[e.from].pos).setY(0.5), b = new THREE.Vector3(...byId[e.to].pos).setY(0.5);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y = 0.6 + a.distanceTo(b) * 0.22;
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}

function Link({ e, active }: { e: ArchEdge; active: boolean }) {
  const c = useMemo(() => curve(e), [e]);
  const geo = useMemo(() => new THREE.TubeGeometry(c, 40, active ? 0.05 : 0.025, 6, false), [c, active]);
  const packets = useRef<(THREE.Mesh | null)[]>([]);
  const color = GROUP_COLOR[byId[e.from].group];
  useFrame(({ clock }) => {
    packets.current.forEach((m, i) => {
      if (!m) return;
      m.visible = active;
      if (!active) return;
      const t = (clock.elapsedTime * 0.45 + i / 3) % 1;
      m.position.copy(c.getPoint(t));
    });
  });
  return (
    <group>
      <mesh geometry={geo}>
        <meshBasicMaterial color={active ? color : "#ffffff"} transparent opacity={active ? 0.9 : 0.12} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(m) => { packets.current[i] = m; }} visible={false}>
          <sphereGeometry args={[0.13, 12, 12]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}

function Block({ n, on, selected, onPick }: { n: ArchNode; on: boolean; selected: boolean; onPick: (id: string) => void }) {
  const g = useRef<THREE.Group>(null);
  const [w, h, d] = n.size || [2, 1, 2];
  const color = GROUP_COLOR[n.group];
  useFrame(({ clock }, dt) => {
    if (!g.current) return;
    const target = on ? 0.25 + Math.sin(clock.elapsedTime * 2 + n.pos[0]) * 0.08 : 0;
    g.current.position.y += (target - g.current.position.y) * Math.min(1, dt * 5);
    const s = selected ? 1.12 : 1;
    g.current.scale.lerp(new THREE.Vector3(s, s, s), Math.min(1, dt * 6));
  });
  return (
    <group position={[n.pos[0], 0, n.pos[2]]}>
      <group ref={g}>
        <RoundedBox args={[w, h, d]} radius={0.18} smoothness={3} position={[0, h / 2, 0]} castShadow receiveShadow
          onClick={(ev) => { ev.stopPropagation(); onPick(n.id); }}
          onPointerOver={(ev) => { ev.stopPropagation(); document.body.style.cursor = "pointer"; }}
          onPointerOut={() => { document.body.style.cursor = ""; }}>
          <meshStandardMaterial color={on ? color : "#273042"} emissive={on ? color : "#000000"} emissiveIntensity={on ? 0.35 : 0} transparent opacity={on ? 1 : 0.55} />
        </RoundedBox>
        <Html center position={[0, h + 0.75, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, font: "600 12px var(--font-geist)", color: on ? "#0b0d11" : "#e5e7eb", background: on ? color : "rgba(10,14,22,.8)", border: `1px solid ${color}66`, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap", opacity: on ? 1 : 0.75 }}>
            <span style={{ fontSize: 14 }}>{n.emoji}</span>{n.label}
          </div>
        </Html>
      </group>
    </group>
  );
}

function CameraTo({ focus }: { focus: [number, number, number] | null }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.Camera; controls: { target: THREE.Vector3; update: () => void } | null };
  const wantPos = useMemo(() => new THREE.Vector3(), []);
  const wantTarget = useMemo(() => new THREE.Vector3(), []);
  const moving = useRef(0);
  const last = useRef<string>("");
  useFrame((_, dt) => {
    const key = focus ? focus.join(",") : "home";
    if (key !== last.current) { last.current = key; moving.current = 2.2; }
    if (moving.current <= 0 || !controls) return; // after the glide the user can orbit freely
    moving.current -= dt;
    if (focus) {
      // medium shot: the active block sits upper-right, clear of the caption in the lower-left
      wantTarget.set(focus[0] - 3.2, 0, focus[2] + 2.2);
      wantPos.set(focus[0] - 1.5, 13, focus[2] + 17);
    } else {
      wantTarget.set(1, 0, 1);
      wantPos.set(0, 20, 22);
    }
    const k = Math.min(1, dt * 2.2);
    controls.target.lerp(wantTarget, k);
    camera.position.lerp(wantPos, k);
    controls.update();
  });
  return null;
}

export function Architecture3D({ activeNodes, activeEdges, selected, onPick, focus, height = 620, fill = false }: {
  activeNodes: Set<string> | null; activeEdges: Set<string> | null; selected: string | null; onPick: (id: string | null) => void; focus: [number, number, number] | null; height?: number; fill?: boolean;
}) {
  return (
    <div style={fill ? { height: "100%" } : { height }} className="h-full w-full">
      <Canvas shadows="soft" camera={{ position: [0, 20, 22], fov: 42 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }} onPointerMissed={() => onPick(null)}>
        <color attach="background" args={["#080c16"]} />
        <fog attach="fog" args={["#080c16", 32, 70]} />
        <ambientLight intensity={0.5} />
        <hemisphereLight args={["#bcd7ff", "#121018", 0.6]} />
        <directionalLight castShadow position={[8, 18, 10]} intensity={1.5} shadow-mapSize={[1024, 1024]} shadow-camera-left={-24} shadow-camera-right={24} shadow-camera-top={16} shadow-camera-bottom={-16} />
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[80, 50]} />
          <meshStandardMaterial color="#0d1322" />
        </mesh>
        <gridHelper args={[80, 40, "#1c2740", "#141c30"]} position={[0, 0.01, 0]} />
        {/* zone pads */}
        {[
          { x: 1.5, z: 0, r: 6.6, c: "#ff5b2e" },
          { x: 16, z: 0, r: 0, c: "#22d3ee" },
        ].map((p, i) => p.r ? (
          <mesh key={i} rotation-x={-Math.PI / 2} position={[p.x, 0.02, p.z]}>
            <ringGeometry args={[p.r - 0.06, p.r, 64]} />
            <meshBasicMaterial color={p.c} transparent opacity={0.35} />
          </mesh>
        ) : null)}
        <mesh rotation-x={-Math.PI / 2} position={[16, 0.02, 0]}>
          <planeGeometry args={[4, 17.5]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.06} />
        </mesh>
        <Html position={[16, 0.1, -9.6]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}><div style={{ font: "600 11px var(--font-geist)", color: "#22d3ee", letterSpacing: ".18em" }}>OUTSIDE WORLD</div></Html>
        <Html position={[1.5, 0.1, -7.2]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}><div style={{ font: "600 11px var(--font-geist)", color: "#ff7a4d", letterSpacing: ".18em" }}>8 AI AGENTS</div></Html>
        <Sparkles count={90} scale={[60, 8, 36]} position={[0, 4, 0]} size={2} speed={0.25} opacity={0.35} />
        {EDGES.map((e) => <Link key={ekey(e)} e={e} active={!activeEdges || activeEdges.has(ekey(e))} />)}
        {NODES.map((n) => <Block key={n.id} n={n} on={!activeNodes || activeNodes.has(n.id)} selected={selected === n.id} onPick={onPick} />)}
        <CameraTo focus={focus} />
        <OrbitControls makeDefault enablePan={false} minDistance={10} maxDistance={48} maxPolarAngle={Math.PI / 2.25} target={[1, 0, 1]} enableDamping />
      </Canvas>
    </div>
  );
}
