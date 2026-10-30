"use client";
/**
 * "How the engine calculates" - a one-minute 3D explainer film.
 * Six stations along a track; the camera glides from one to the next while captions explain
 * the step in plain words and show the maths. Every number shown comes from the demo
 * investigation (GET /api/public/showcase and /api/public/film); the 3D props are illustrations.
 */
import { Html, Sparkles } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { AnimatePresence, motion } from "framer-motion";
import { Expand, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import type { Film } from "@/components/film-player";
import type { AgentStory } from "@/components/landing/agent-constellation";
import type { Landscape } from "@/components/three/failure-landscape";
import { cn } from "@/lib/format";

export interface EngineFacts {
  title: string;
  location: string;
  criteria: { metric: string; threshold: number }[];
  agents: AgentStory | null;
  dStar: number | null;
  changes: { label: string; from: number; to: number; unit: string }[];
  pFail: number | null;
  landscape: Landscape | null;
  film: Film | null;
}

const CH = 9; // seconds per chapter
const GAP = 44; // distance between stations
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
type Clock = React.MutableRefObject<{ t: number }>;
const chapterOf = (t: number) => Math.max(0, Math.min(5, Math.floor(t / CH)));
const progressIn = (t: number, i: number) => Math.max(0, Math.min(1, (t - i * CH) / CH));
/** Seeded generator so particle layouts are identical on every run (needed for recording). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ease = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
const label = (bg: string, fg = "#fff"): React.CSSProperties => ({ font: "700 12px var(--font-geist)", color: fg, background: bg, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap", pointerEvents: "none" });

/** A 3D label that is only shown during its chapter (and optionally from a moment within it).
 *  drei's <Html> ignores parent visibility, so labels fade via their own opacity instead. */
function Tag({ clock, at, when, position, children }: { clock: Clock; at: number; when?: (p: number) => boolean; position: [number, number, number]; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFrame(() => {
    if (!ref.current) return;
    const t = clock.current.t;
    const o = chapterOf(t) === at && (!when || when(progressIn(t, at))) ? "1" : "0";
    if (ref.current.style.opacity !== o) ref.current.style.opacity = o;
  });
  return (
    <Html center position={position} zIndexRange={[10, 0]}>
      <div ref={ref} style={{ opacity: 0, transition: "opacity .45s ease" }}>{children}</div>
    </Html>
  );
}

/* ------------------------------------------------------------------ station 0: the promise */
function PromiseStation({ clock, facts }: { clock: Clock; facts: EngineFacts }) {
  const lines = useRef<(THREE.Mesh | null)[]>([]);
  const chips = useRef<(THREE.Group | null)[]>([]);
  const paper = useRef<THREE.Group>(null);
  const targets = facts.criteria.slice(0, 2);
  useFrame(({ clock: c }) => {
    const p = progressIn(clock.current.t, 0);
    if (paper.current) paper.current.rotation.y = -0.25 + Math.sin(c.elapsedTime * 0.6) * 0.06;
    lines.current.forEach((m, i) => {
      if (!m) return;
      const hot = (i === 3 && p > 0.22) || (i === 5 && p > 0.4);
      (m.material as THREE.MeshStandardMaterial).color.set(hot ? "#ff5b2e" : "#c9ccd2");
    });
    chips.current.forEach((g, i) => {
      if (!g) return;
      const k = ease((p - 0.5 - i * 0.12) * 3);
      g.position.set(-0.5 + k * 6.5, (i === 0 ? 1.1 : -0.3) + k * (i === 0 ? 0.8 : 0.3), 0.3 + k * 1.2);
      g.scale.setScalar(0.4 + k * 0.6);
      g.visible = p > 0.48;
    });
  });
  return (
    <group position={[0, 3, 0]}>
      <group ref={paper}>
        <mesh castShadow>
          <boxGeometry args={[5, 6.6, 0.08]} />
          <meshStandardMaterial color="#f4f1ea" />
        </mesh>
        {Array.from({ length: 10 }, (_, i) => (
          <mesh key={i} ref={(m) => { lines.current[i] = m; }} position={[-0.2 + (i % 3) * 0.12, 2.5 - i * 0.55, 0.06]}>
            <boxGeometry args={[i === 0 ? 2.6 : 3.8 - (i % 3) * 0.4, i === 0 ? 0.26 : 0.13, 0.02]} />
            <meshStandardMaterial color="#c9ccd2" />
          </mesh>
        ))}
      </group>
      {targets.map((c, i) => (
        <group key={c.metric} ref={(g) => { chips.current[i] = g; }} visible={false}>
          <mesh>
            <boxGeometry args={[3.6, 0.9, 0.3]} />
            <meshStandardMaterial color="#1b1f27" emissive="#ff5b2e" emissiveIntensity={0.25} />
          </mesh>
          <Tag clock={clock} at={0} when={(p) => p > 0.5} position={[0, 0, 0.2]}>
            <div style={label("#ff5b2e")}>{c.metric === "survival_rate" ? `🌳 trees alive ≥ ${Math.round(c.threshold * 100)}%` : c.metric === "cooling_c" ? `🌡️ cooling ≥ ${c.threshold} °C` : `${c.metric} ${c.threshold}`}</div>
          </Tag>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ station 1: the real weather */
function Weather({ clock, facts }: { clock: Clock; facts: EngineFacts }) {
  const m = facts.film?.scenes[0]?.monthly;
  const rain = m?.rain_mm ?? Array(12).fill(40);
  const tmax = m?.tmax_c ?? Array(12).fill(32);
  const bars = useRef<(THREE.Mesh | null)[]>([]);
  const globe = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    const p = progressIn(clock.current.t, 1);
    if (globe.current) globe.current.rotation.y += dt * 0.4;
    bars.current.forEach((b, i) => {
      if (!b) return;
      const k = ease((p - 0.15 - (i % 12) * 0.03) * 3);
      const h = i < 12 ? Math.max(0.05, rain[i] / 45) : Math.max(0.05, (tmax[i - 12] - 5) / 7);
      b.scale.y = Math.max(0.001, k * h);
      b.position.y = (k * h) / 2;
    });
  });
  return (
    <group position={[GAP, 0, 0]}>
      <mesh ref={globe} position={[0, 2.6, -1]} castShadow>
        <sphereGeometry args={[2, 32, 32]} />
        <meshStandardMaterial color="#2b6cb0" emissive="#0b2a55" emissiveIntensity={0.4} wireframe={false} />
      </mesh>
      <mesh position={[0, 2.6, -1]}>
        <sphereGeometry args={[2.03, 16, 12]} />
        <meshBasicMaterial color="#7fd1ff" wireframe transparent opacity={0.25} />
      </mesh>
      <mesh position={[0.9, 4.2, 0.3]}>
        <coneGeometry args={[0.18, 0.5, 12]} />
        <meshStandardMaterial color="#ff5b2e" emissive="#ff5b2e" emissiveIntensity={0.6} />
      </mesh>
      <Tag clock={clock} at={1} position={[0.9, 4.85, 0.3]}><div style={label("#ff5b2e")}>📍 {facts.location}</div></Tag>
      {Array.from({ length: 24 }, (_, i) => {
        const month = i % 12;
        const x = (month - 5.5) * 0.85;
        const z = i < 12 ? 2.4 : 3.2;
        return (
          <mesh key={i} ref={(b) => { bars.current[i] = b; }} position={[x, 0, z]} castShadow>
            <boxGeometry args={[0.32, 1, 0.32]} />
            <meshStandardMaterial color={i < 12 ? "#4aa8ff" : "#ff8a3d"} emissive={i < 12 ? "#1d5fa8" : "#a84a10"} emissiveIntensity={0.35} />
          </mesh>
        );
      })}
      {MONTHS.map((mn, i) => i % 2 === 0 && (
        <Tag key={mn} clock={clock} at={1} position={[(i - 5.5) * 0.85, -0.35, 3.9]}><div style={{ ...label("rgba(0,0,0,.55)"), fontSize: 10 }}>{mn}</div></Tag>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ station 2: the mini-world bucket */
function Bucket({ clock, facts }: { clock: Clock; facts: EngineFacts }) {
  const sc = facts.film?.scenes[0];
  const water = useRef<THREE.Mesh>(null);
  const crown = useRef<THREE.Mesh>(null);
  const tree = useRef<THREE.Group>(null);
  const drops = useRef<THREE.Points>(null);
  const vapour = useRef<THREE.Points>(null);
  const N = 260;
  const dropPos = useMemo(() => { const r = rng(21); const a = new Float32Array(N * 3); for (let i = 0; i < N; i++) a.set([(r() - 0.5) * 2.4, r() * 6, (r() - 0.5) * 2.4], i * 3); return a; }, []);
  const vapPos = useMemo(() => { const r = rng(22); const a = new Float32Array(N * 3); for (let i = 0; i < N; i++) a.set([(r() - 0.5) * 2, 3 + r() * 4, (r() - 0.5) * 2], i * 3); return a; }, []);
  const ok = useMemo(() => new THREE.Color("#3f9b4f"), []);
  const dry = useMemo(() => new THREE.Color("#c99a3b"), []);
  useFrame((_, dt) => {
    const p = progressIn(clock.current.t, 2);
    const mf = p * 24; // two simulated years in this chapter
    const month = Math.floor(mf) % 12;
    const stress = sc?.monthly.stress[month] ?? 0.3;
    const rain = sc?.monthly.rain_mm[month] ?? 30;
    const heat = sc?.monthly.tmax_c[month] ?? 32;
    if (tree.current) tree.current.rotation.z = Math.sin(clock.current.t * 1.4) * 0.03;
    if (water.current) {
      const lvl = 0.15 + (1 - stress) * 0.8;
      water.current.scale.y += (lvl - water.current.scale.y) * Math.min(1, dt * 3);
      water.current.position.y = 0.1 + (water.current.scale.y * 3) / 2;
    }
    if (crown.current) (crown.current.material as THREE.MeshStandardMaterial).color.copy(ok).lerp(dry, Math.min(1, stress * 1.5));
    const step = (pts: THREE.Points | null, dir: number, speed: number, share: number, lo: number, hi: number) => {
      if (!pts) return;
      const pos = pts.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < N; i++) {
        let y = pos.getY(i) + dir * dt * speed;
        if (y < lo) y = hi; if (y > hi) y = lo;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      pts.geometry.setDrawRange(0, Math.floor(N * share));
    };
    step(drops.current, -1, 5, p > 0 && p < 1 ? Math.min(1, rain / 120) : 0, 0.3, 6.5);
    step(vapour.current, 1, 1.6, p > 0 && p < 1 ? Math.min(1, Math.max(0, (heat - 20) / 25)) : 0, 3.2, 7.5);
  });
  return (
    <group position={[GAP * 2, 0, 0]}>
      {/* soil-water bucket */}
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[1.4, 1.4, 3.2, 32, 1, true]} />
        <meshStandardMaterial color="#9fd8ff" transparent opacity={0.18} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={water} position={[0, 1.3, 0]} scale={[1, 0.7, 1]}>
        <cylinderGeometry args={[1.32, 1.32, 3, 32]} />
        <meshStandardMaterial color="#2f8ff0" emissive="#0d4f9a" emissiveIntensity={0.4} transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[1.45, 1.45, 0.1, 32]} />
        <meshStandardMaterial color="#6b4a2f" />
      </mesh>
      <points ref={drops}>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[dropPos, 3]} /></bufferGeometry>
        <pointsMaterial color="#9fd8ff" size={0.09} transparent opacity={0.9} />
      </points>
      <points ref={vapour} position={[3.6, 0, 0]}>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[vapPos, 3]} /></bufferGeometry>
        <pointsMaterial color="#ffd0a0" size={0.12} transparent opacity={0.5} />
      </points>
      <Tag clock={clock} at={2} position={[0, 3.9, 0]}><div style={label("#2f8ff0")}>🪣 water in the soil</div></Tag>
      {/* tree that drinks from it */}
      <group ref={tree} position={[3.6, 0, 0]}>
        <mesh position={[0, 1.2, 0]} castShadow>
          <cylinderGeometry args={[0.16, 0.24, 2.4, 8]} />
          <meshStandardMaterial color="#6b4a2f" />
        </mesh>
        <mesh ref={crown} position={[0, 3, 0]} castShadow>
          <icosahedronGeometry args={[1.25, 1]} />
          <meshStandardMaterial color="#3f9b4f" />
        </mesh>
      </group>
      <Tag clock={clock} at={2} position={[3.6, 4.7, 0]}><div style={label("#c9772b")}>☀️ thirst pulls water out</div></Tag>
    </group>
  );
}

/* ------------------------------------------------------------------ station 3: what matters most */
function Sensitivity({ clock, facts }: { clock: Clock; facts: EngineFacts }) {
  const rows = facts.agents?.sensitivity ?? [];
  const bars = useRef<(THREE.Mesh | null)[]>([]);
  const cloud = useRef<THREE.Points>(null);
  const N = 500;
  const pts = useMemo(() => { const r = rng(23); const a = new Float32Array(N * 3); for (let i = 0; i < N; i++) a.set([(r() - 0.5) * 9, 0.3 + r() * 5, -2 - r() * 3], i * 3); return a; }, []);
  useFrame((_, dt) => {
    const p = progressIn(clock.current.t, 3);
    if (cloud.current) { cloud.current.rotation.y += dt * 0.15; cloud.current.geometry.setDrawRange(0, Math.floor(N * Math.min(1, p * 2.5))); }
    bars.current.forEach((b, i) => {
      if (!b) return;
      const h = 0.2 + (rows[i]?.index ?? 0) * 12;
      const k = ease((p - 0.35 - i * 0.1) * 3);
      b.scale.y = Math.max(0.001, k * h);
      b.position.y = (k * h) / 2;
    });
  });
  return (
    <group position={[GAP * 3, 0, 0]}>
      <points ref={cloud}>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[pts, 3]} /></bufferGeometry>
        <pointsMaterial color="#cfd6ff" size={0.07} transparent opacity={0.6} />
      </points>
      {rows.map((r, i) => (
        <group key={r.parameter}>
          <mesh ref={(b) => { bars.current[i] = b; }} position={[(i - 1) * 2.6, 0, 1]} castShadow>
            <boxGeometry args={[1.4, 1, 1.4]} />
            <meshStandardMaterial color={["#ff5b2e", "#f5b84a", "#a78bfa"][i]} emissive={["#a8300f", "#8a5d10", "#4b3a9a"][i]} emissiveIntensity={0.35} />
          </mesh>
            <Tag clock={clock} at={3} when={(p) => ease((p - 0.35 - i * 0.1) * 3) > 0.92} position={[(i - 1) * 2.6, 0.2 + r.index * 12 + 0.55, 1]}><div style={{ ...label("rgba(0,0,0,.72)"), border: `1px solid ${["#ff5b2e", "#f5b84a", "#a78bfa"][i]}` }}>{r.parameter} · {r.index.toFixed(2)}</div></Tag>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ station 4: hunting the breaking point */
const SEEKERS = [
  { name: "🦊 MPFS", color: "#ff5b2e" },
  { name: "🐝 NSGA-II", color: "#f5b84a" },
  { name: "🦋 Evolution", color: "#a78bfa" },
  { name: "🎲 Random", color: "#9aa3b2" },
];

function Hunt({ clock, facts }: { clock: Clock; facts: EngineFacts }) {
  const L = facts.landscape;
  const SIZE = 10;
  const ny = L?.z.length ?? 24, nx = L?.z[0]?.length ?? 24;
  const B = (i: number, j: number) => (L ? L.z[j][i] : 0.35 - Math.hypot(i / nx - 0.25, j / ny - 0.25));
  const Y = (b: number) => Math.max(-0.7, Math.min(0.9, b * 1.3));
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(SIZE, SIZE, nx - 1, ny - 1);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const hold = new THREE.Color("#5ff0b8"), holdLo = new THREE.Color("#1f8a62"), fail = new THREE.Color("#ff6a3d"), deep = new THREE.Color("#6a1a0c");
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = (ny - 1 - j) * nx + i;
        const b = B(i, j);
        pos.setY(k, Y(b));
        const c = b >= 0 ? holdLo.clone().lerp(hold, Math.min(1, b * 2)) : fail.clone().lerp(deep, Math.min(1, -b * 3));
        col.set([c.r, c.g, c.b], k * 3);
      }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L]);
  // world <-> grid helpers (row j = 0 sits at +z after the plane is laid flat)
  const hAt = (x: number, z: number) => {
    const i = Math.max(0, Math.min(nx - 1, Math.round((x / SIZE + 0.5) * (nx - 1))));
    const j = Math.max(0, Math.min(ny - 1, Math.round((0.5 - z / SIZE) * (ny - 1))));
    return Y(B(i, j));
  };
  const toW = (pt?: [number, number] | null): [number, number] => {
    if (!L || !pt) return [-SIZE * 0.2, SIZE * 0.2];
    const xs = L.x.values, ys = L.y.values;
    const u = (pt[0] - xs[0]) / (xs[xs.length - 1] - xs[0]), v = (pt[1] - ys[0]) / (ys[ys.length - 1] - ys[0]);
    return [(u - 0.5) * SIZE, -(v - 0.5) * SIZE];
  };
  const start = toW(L?.nominal);
  const goal: [number, number] = L?.point ? toW(L.point) : [SIZE * 0.25, -SIZE * 0.25];

  // the edge (B = 0) and the best "holds" / "fails" spots for the ground labels
  const { edge, holdSpot, failSpot } = useMemo(() => {
    const pts: [number, number][] = [];
    let hi = { b: -1e9, x: 0, z: 0 }, lo = { b: 1e9, x: 0, z: 0 };
    const wx = (i: number) => (i / (nx - 1) - 0.5) * SIZE, wz = (j: number) => (0.5 - j / (ny - 1)) * SIZE;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const b = B(i, j);
        if (i > 1 && j > 1 && i < nx - 2 && j < ny - 2) {
          if (b > hi.b) hi = { b, x: wx(i), z: wz(j) };
          if (b < lo.b) lo = { b, x: wx(i), z: wz(j) };
        }
        if (i + 1 < nx) { const c = B(i + 1, j); if ((b >= 0) !== (c >= 0)) { const f = b / (b - c); pts.push([wx(i + f), wz(j)]); } }
        if (j + 1 < ny) { const c = B(i, j + 1); if ((b >= 0) !== (c >= 0)) { const f = b / (b - c); pts.push([wx(i), wz(j + f)]); } }
      }
    return { edge: pts, holdSpot: hi, failSpot: lo };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L]);
  const edgeRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = edgeRef.current;
    if (!m) return;
    const d = new THREE.Object3D();
    edge.forEach(([x, z], i) => { d.position.set(x, 0.06, z); d.updateMatrix(); m.setMatrixAt(i, d.matrix); });
    m.count = edge.length;
    m.instanceMatrix.needsUpdate = true;
  }, [edge]);

  // illustrative search paths: each searcher zig-zags from the plan towards the edge; MPFS ends on the closest point
  const paths = useMemo(() => SEEKERS.map((_, k) => {
    const end: [number, number] = k === 0 ? goal : [goal[0] + Math.cos(1.3 + k * 1.9) * (0.9 + k * 0.55), goal[1] + Math.sin(1.3 + k * 1.9) * (0.9 + k * 0.55)];
    return Array.from({ length: 8 }, (_, s) => {
      const f = (s + 1) / 8;
      const wob = Math.sin(s * 2.1 + k) * (1 - f) * (k === 3 ? 2.2 : 1.1);
      return [start[0] + (end[0] - start[0]) * f + wob, start[1] + (end[1] - start[1]) * f - wob * 0.6] as [number, number];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [L]);
  const seekers = useRef<(THREE.Group | null)[]>([]);
  const prints = useRef<(THREE.Mesh | null)[]>([]);
  const star = useRef<THREE.Group>(null);
  const dline = useRef<THREE.Group>(null);
  const edgeLbl = useRef<THREE.Group>(null);
  useFrame(({ clock: c }) => {
    const p = progressIn(clock.current.t, 4);
    const q = Math.min(0.999, Math.max(0, (p - 0.12) / 0.6)) * 8; // walking phase: 12% → 72% of the chapter
    seekers.current.forEach((g, k) => {
      if (!g) return;
      const sIdx = Math.floor(q), f = q - sIdx;
      const a = sIdx === 0 ? start : paths[k][sIdx - 1], b = paths[k][Math.min(7, sIdx)];
      const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
      g.position.set(x, Math.max(hAt(x, z), 0) + 0.3 + Math.sin(f * Math.PI) * 0.45, z);
    });
    prints.current.forEach((m, n) => {
      if (!m) return;
      m.visible = Math.floor(n % 8) < Math.floor(q);
    });
    if (edgeRef.current) (edgeRef.current.material as THREE.MeshBasicMaterial).opacity = Math.min(1, p * 4) * (0.6 + Math.sin(c.elapsedTime * 3) * 0.3);
    if (edgeLbl.current) edgeLbl.current.visible = p > 0.05;
    if (star.current) { star.current.visible = p > 0.74; star.current.rotation.y = c.elapsedTime * 1.5; }
    if (dline.current) dline.current.visible = p > 0.8;
  });
  const mid: [number, number] = [(start[0] + goal[0]) / 2, (start[1] + goal[1]) / 2];
  const lineGeo = useMemo(() => {
    const pts = Array.from({ length: 21 }, (_, i) => { const f = i / 20; const x = start[0] + (goal[0] - start[0]) * f, z = start[1] + (goal[1] - start[1]) * f; return new THREE.Vector3(x, Math.max(hAt(x, z), 0) + 0.12, z); });
    return new THREE.BufferGeometry().setFromPoints(pts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L]);
  const lineObj = useMemo(() => { const l = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: "#ffd23f", dashSize: 0.25, gapSize: 0.15 })); l.computeLineDistances(); return l; }, [lineGeo]);
  const edgeSpot = edge[Math.floor(edge.length / 2)] || [0, 0];

  return (
    <group position={[GAP * 4, 0.3, 0]}>
      <mesh geometry={geo} castShadow receiveShadow>
        <meshStandardMaterial vertexColors />
      </mesh>
      <instancedMesh ref={edgeRef} args={[undefined, undefined, Math.max(1, edge.length)]}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshBasicMaterial color="#fff3b0" transparent opacity={0} />
      </instancedMesh>
      <Tag clock={clock} at={4} position={[holdSpot.x, Y(holdSpot.b) + 0.5, holdSpot.z]}><div style={label("#3ee6a8", "#05271b")}>✅ promise holds</div></Tag>
      <Tag clock={clock} at={4} position={[failSpot.x, 0.6, failSpot.z]}><div style={label("#ff5b2e")}>❌ promise fails</div></Tag>
      <group ref={edgeLbl} visible={false}>
        <Tag clock={clock} at={4} when={(p) => p > 0.05} position={[edgeSpot[0], 0.9, edgeSpot[1]]}><div style={label("rgba(255,243,176,.95)", "#3d2a00")}>the edge</div></Tag>
      </group>
      <mesh position={[start[0], Math.max(hAt(...start), 0) + 0.6, start[1]]}>
        <cylinderGeometry args={[0.04, 0.04, 1.2, 8]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <Tag clock={clock} at={4} position={[start[0], Math.max(hAt(...start), 0) + 1.45, start[1]]}><div style={label("#ffffff", "#0b0d11")}>🏁 the plan</div></Tag>
      {SEEKERS.map((sk, k) => (
        <group key={sk.name}>
          <group ref={(g) => { seekers.current[k] = g; }}>
            <mesh castShadow>
              <sphereGeometry args={[0.24, 20, 20]} />
              <meshStandardMaterial color={sk.color} emissive={sk.color} emissiveIntensity={0.35} />
            </mesh>
            <Tag clock={clock} at={4} position={[0, 0.5, 0]}><div style={{ ...label(sk.color, k === 3 ? "#0b0d11" : "#fff"), fontSize: 10.5 }}>{sk.name}</div></Tag>
          </group>
          {paths[k].map(([x, z], s) => (
            <mesh key={s} ref={(m) => { prints.current[k * 8 + s] = m; }} position={[x, Math.max(hAt(x, z), 0) + 0.04, z]} visible={false}>
              <cylinderGeometry args={[0.08, 0.08, 0.03, 10]} />
              <meshBasicMaterial color={sk.color} />
            </mesh>
          ))}
        </group>
      ))}
      <group ref={dline} visible={false}>
        <primitive object={lineObj} />
        <Tag clock={clock} at={4} when={(p) => p > 0.8} position={[mid[0], Math.max(hAt(...mid), 0) + 0.7, mid[1]]}><div style={label("#ffd23f", "#3d2a00")}>smallest change{facts.dStar !== null ? ` · d* = ${facts.dStar.toFixed(2)}` : ""}</div></Tag>
      </group>
      <group ref={star} position={[goal[0], Math.max(hAt(...goal), 0) + 0.9, goal[1]]} visible={false}>
        <mesh>
          <octahedronGeometry args={[0.38, 0]} />
          <meshStandardMaterial color="#ffd23f" emissive="#ffb300" emissiveIntensity={0.9} />
        </mesh>
        <Sparkles count={30} scale={2} size={4} color="#ffd23f" />
        <Tag clock={clock} at={4} when={(p) => p > 0.74} position={[0, 0.8, 0]}><div style={label("#ffd23f", "#3d2a00")}>⭐ breaking point</div></Tag>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ station 5: double-check & verdict */
function Verdict({ clock, facts }: { clock: Clock; facts: EngineFacts }) {
  const n = Math.max(1, Math.min(10, facts.agents?.verification.checked ?? 6));
  const ok = facts.agents?.verification.verified ?? n;
  const cubes = useRef<(THREE.Mesh | null)[]>([]);
  const shield = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const p = progressIn(clock.current.t, 5);
    cubes.current.forEach((c, i) => {
      if (!c) return;
      const k = ease((p - 0.08 - i * 0.05) * 4);
      c.rotation.x = Math.PI * (1 - k);
      c.position.y = 0.6 + Math.sin(k * Math.PI) * 0.8;
    });
    if (shield.current) {
      const k = ease((p - 0.5) * 3);
      shield.current.scale.setScalar(0.001 + k);
      shield.current.rotation.y += dt * 0.8;
    }
  });
  return (
    <group position={[GAP * 5, 0, 0]}>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} ref={(c) => { cubes.current[i] = c; }} position={[(i - (n - 1) / 2) * 1.05, 0.6, 2.2]} castShadow>
          <boxGeometry args={[0.8, 0.8, 0.8]} />
          <meshStandardMaterial color={i < ok ? "#3ee6a8" : "#ff5b2e"} emissive={i < ok ? "#0f6b4b" : "#7a1a0a"} emissiveIntensity={0.4} />
        </mesh>
      ))}
      <group ref={shield} position={[0, 3.3, -0.5]}>
        <mesh>
          <cylinderGeometry args={[1.5, 1.5, 0.35, 6]} />
          <meshStandardMaterial color="#1b1f27" />
        </mesh>
        <mesh rotation-x={Math.PI / 2} position={[0, 0, 0]}>
          <torusGeometry args={[1.55, 0.09, 12, 6]} />
          <meshStandardMaterial color="#3ee6a8" emissive="#3ee6a8" emissiveIntensity={0.8} />
        </mesh>
        <Sparkles count={40} scale={4} size={3} color="#3ee6a8" />
      </group>
    </group>
  );
}

function Rig({ clock }: { clock: Clock }) {
  const { camera } = useThree();
  const look = useMemo(() => new THREE.Vector3(), []);
  const want = useMemo(() => new THREE.Vector3(), []);
  const aim = useMemo(() => new THREE.Vector3(), []);
  // per-station framing: [radius, height, aim height]; the aim sits left of / below the subject so the
  // subject lands in the upper-right of the frame, clear of the caption box
  const SHOT: [number, number, number][] = [[16, 6, 2.6], [14, 6.5, 0.8], [13, 6, 0.9], [14, 6.5, 0.9], [13.5, 10.5, -1.6], [13, 6, 0.8]];
  useFrame((_, dt) => {
    const t = clock.current.t;
    const i = chapterOf(t);
    const p = progressIn(t, i);
    const sx = i * GAP;
    const [r, h, ay] = SHOT[i];
    const s = p * p * (3 - 2 * p); // smoothstep: slow in, slow out
    const ang = -0.32 + s * 0.5; // gentle orbit across the chapter
    want.set(sx - 2.6 + Math.sin(ang) * r, h - s * 0.8, Math.cos(ang) * r - s * 1.2);
    camera.position.lerp(want, Math.min(1, dt * 1.6));
    aim.set(sx - 2.6, ay, 0);
    look.lerp(aim, Math.min(1, dt * 2));
    camera.lookAt(look);
  });
  return null;
}

const CHAPTERS = (f: EngineFacts) => {
  const a = f.agents;
  const cool = f.criteria.find((c) => c.metric === "cooling_c")?.threshold;
  const surv = f.criteria.find((c) => c.metric === "survival_rate")?.threshold;
  const sc = f.film?.scenes[0];
  return [
    { title: "The promise", kid: `A city says: “plant these trees and it gets cooler.” The AI reads the plan and writes down exactly what was promised.`,
      math: `claim → { metric, ≥, threshold }   ·   ${cool !== undefined ? `cooling ≥ ${cool} °C` : ""}${surv !== undefined ? `   ·   survival ≥ ${Math.round(surv * 100)}%` : ""}` },
    { title: "The real weather", kid: `We download 30 years of real weather for ${f.location} from NASA: rain (blue) and heat (orange) for every month.`,
      math: a ? `NASA POWER · ${a.climate.annual_rain_mm} mm rain/yr · hottest: ${a.climate.hottest_month} ${a.climate.hottest_tmax_c} °C · ${a.evidence.sources} scientific sources` : "NASA POWER monthly climatology" },
    { title: "The mini-world, day by day", kid: "Every day, rain and watering fill the soil like a bucket, and heat makes the trees thirsty and empties it. Empty bucket = stressed trees; stressed trees die faster.",
      math: `ET₀ (FAO-56) → thirst = Ks·Kd·Kmc·ET₀ → soil += rain + irrigation − thirst → stress → survival = (1 − m)¹⁰${sc ? `  ·  as planned: ${(sc.metrics.survival_rate * 100).toFixed(0)}% alive, ${sc.metrics.cooling_c.toFixed(2)} °C cooler` : ""}` },
    { title: "What matters most?", kid: "We run thousands of random futures and measure which uncertain things change the result the most.",
      math: a?.sensitivity.length ? `Sobol total index: ${a.sensitivity.map((s) => `${s.parameter} ${s.index.toFixed(2)}`).join(" · ")}` : "Sobol sensitivity indices (SALib)" },
    { title: "Hunting the breaking point", kid: "Green ground = the promise holds, red sea = it fails. Four search methods race from the plan to find the closest edge of the red sea.",
      math: `min ‖Δx‖ subject to “promise fails”${a ? `  ·  ${a.optimisation.evaluations.toLocaleString("en-GB")} simulations` : ""}${f.dStar !== null ? `  ·  d* = ${f.dStar.toFixed(2)}` : ""}${f.changes.length ? `  ·  ${f.changes.slice(0, 2).map((c) => `${c.label.toLowerCase()} ${fmt(c.from)}→${fmt(c.to)}`).join(", ")}` : ""}` },
    { title: "Double-check & verdict", kid: "A separate checker re-runs every breaking point from scratch. Then we tell you how often the promise fails and which design is safer.",
      math: `${a ? `verified ${a.verification.verified}/${a.verification.checked}` : "independent re-computation"}${f.pFail !== null ? `  ·  fails in ${Math.round(f.pFail * 100)}% of plausible futures` : ""}${a?.alternatives ? `  ·  safer design: ${a.alternatives.design} → fails ${Math.round(a.alternatives.failure_probability * 100)}%` : ""}` },
  ];
};
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toPrecision(2));

export function EngineFilm({ facts, autoPlay = true, record = false }: { facts: EngineFacts; autoPlay?: boolean; record?: boolean }) {
  const clock = useRef({ t: 0 });
  const [playing, setPlaying] = useState(autoPlay);
  const [t, setT] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const total = CH * 6;
  const chapters = useMemo(() => CHAPTERS(facts), [facts]);

  useEffect(() => {
    let raf = 0, last = performance.now(), lastUi = 0;
    const loop = (now: number) => {
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); // rAF time can precede performance.now()
      last = now;
      if (playing) clock.current.t = Math.min(total - 0.001, clock.current.t + dt);
      if (clock.current.t >= total - 0.001) {
        setPlaying(false);
        (window as unknown as { __filmDone?: boolean }).__filmDone = true; // recording hook
      }
      if (now - lastUi > 100) { lastUi = now; setT(clock.current.t); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  const i = chapterOf(t);
  const C = chapters[i];
  const seek = (s: number) => { clock.current.t = s; setT(s); setPlaying(true); };
  useEffect(() => {
    (window as unknown as { __filmStarted?: number }).__filmStarted = performance.now();
  }, []);

  return (
    <div className="space-y-3">
      <div ref={box} className={record ? "fixed inset-0 overflow-hidden bg-[#070b14]" : "relative aspect-video w-full overflow-hidden rounded-3xl border border-white/10 bg-[#070b14] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"}>
        <Canvas shadows="soft" camera={{ position: [0, 6, 14], fov: 42 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }}>
          <color attach="background" args={["#0a1120"]} />
          <fog attach="fog" args={["#0a1120", 22, 60]} />
          <ambientLight intensity={0.5} />
          <hemisphereLight args={["#bcd7ff", "#1a1410", 0.6]} />
          <directionalLight castShadow position={[30, 22, 14]} intensity={1.7} shadow-mapSize={[1024, 1024]} shadow-camera-left={-120} shadow-camera-right={260} shadow-camera-top={30} shadow-camera-bottom={-30} />
          <mesh rotation-x={-Math.PI / 2} position={[GAP * 2.5, 0, 0]} receiveShadow>
            <planeGeometry args={[GAP * 8, 60]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
          {/* the track linking the stations */}
          <mesh rotation-x={-Math.PI / 2} position={[GAP * 2.5, 0.01, 5.5]}>
            <planeGeometry args={[GAP * 5 + 8, 0.12]} />
            <meshBasicMaterial color="#ff5b2e" transparent opacity={0.5} />
          </mesh>
          <Sparkles count={120} scale={[GAP * 6, 10, 30]} position={[GAP * 2.5, 6, -4]} size={2} speed={0.25} opacity={0.4} />
          {[0, 1, 2, 3, 4, 5].map((k) => (
            <mesh key={k} rotation-x={-Math.PI / 2} position={[k * GAP, 0.02, 0]}>
              <ringGeometry args={[7.6, 7.75, 72]} />
              <meshBasicMaterial color="#ff5b2e" transparent opacity={0.35} />
            </mesh>
          ))}
          <PromiseStation clock={clock} facts={facts} />
          <Weather clock={clock} facts={facts} />
          <Bucket clock={clock} facts={facts} />
          <Sensitivity clock={clock} facts={facts} />
          <Hunt clock={clock} facts={facts} />
          <Verdict clock={clock} facts={facts} />
          <Rig clock={clock} />
        </Canvas>

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_60%,rgba(0,0,0,0.5)_100%)]" />
        {/* chapter caption */}
        <AnimatePresence mode="wait">
          <motion.div key={i} className="pointer-events-none absolute bottom-[4%] left-[3%] z-30 w-[min(560px,46%)]" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.45 }}>
            <div className="max-w-3xl rounded-2xl bg-black/70 p-4 md:p-5">
              <div className="text-[11.5px] font-medium uppercase tracking-[0.22em] text-[#ff7a4d]">Step {i + 1} of 6</div>
              <div className="mt-1 text-[clamp(18px,2.2vw,28px)] font-semibold tracking-[-0.02em] text-white">{C.title}</div>
              <p className="mt-1 text-[clamp(13px,1.25vw,16px)] leading-relaxed text-white/80">{C.kid}</p>
              <div className="mt-2 border-t border-white/10 pt-2 font-mono text-[clamp(10.5px,0.95vw,12.5px)] leading-relaxed text-[#9fe3c6]">{C.math}</div>
            </div>
          </motion.div>
        </AnimatePresence>
        <div className="pointer-events-none absolute right-[2.5%] top-[4%] z-30 rounded-full bg-black/60 px-3 py-1 text-[12px] text-white/70">How BACKFIRE calculates · {facts.location}</div>
      </div>

      {!record && <div className="hud flex flex-wrap items-center gap-3 rounded-2xl p-3">
        <button onClick={() => (t >= total - 0.01 ? seek(0) : setPlaying((p) => !p))} className="grid h-10 w-10 place-items-center rounded-xl bg-white text-black" aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-black" />}</button>
        <button onClick={() => seek(0)} className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20" aria-label="Restart"><RotateCcw className="h-4 w-4" /></button>
        <div className="flex min-w-[220px] flex-1 flex-wrap gap-1.5">
          {chapters.map((c, k) => (
            <button key={c.title} onClick={() => seek(k * CH + 0.01)} className={cn("relative overflow-hidden rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors", k === i ? "bg-white/15 text-white" : "text-white/55 hover:text-white")}>
              {k + 1}. {c.title}
              {k === i && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#ff5b2e]" style={{ width: `${progressIn(t, k) * 100}%` }} />}
            </button>
          ))}
        </div>
        <button onClick={() => box.current?.requestFullscreen?.()} className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20" aria-label="Full screen"><Expand className="h-4 w-4" /></button>
      </div>}
    </div>
  );
}
