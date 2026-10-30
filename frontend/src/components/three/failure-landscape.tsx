"use client";
/**
 * 3D failure landscape - a readable scientific figure:
 *  - surface height  = net benefit B of the intervention at each (x, y) scenario
 *  - colour           = green where the claim holds (B >= 0), red where it fails
 *  - white line       = the breaking line B = 0, traced with marching squares
 *  - translucent plane = the failure "water level" at B = 0
 *  - pins             = nominal scenario and the smallest breaking change
 */
import { Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";

export interface Landscape {
  x: { name: string; label: string; unit: string; values: number[] };
  y: { name: string; label: string; unit: string; values: number[] };
  z: number[][]; // net benefit B, rows = y, cols = x
  point?: [number, number] | null;
  nominal?: [number, number] | null;
}

const SIZE = 10;
const HEIGHT = 2.2;
const HOLD_HI = new THREE.Color("#5ff0b8");
const HOLD_LO = new THREE.Color("#1b6b52");
const FAIL_LO = new THREE.Color("#ff7a52");
const FAIL_HI = new THREE.Color("#7a1a14");

const fmtV = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3));

function buildGeometry(data: Landscape) {
  const nx = data.x.values.length;
  const ny = data.y.values.length;
  const flat = data.z.flat();
  const zmax = Math.max(0.05, ...flat.map(Math.abs));
  const g = new THREE.PlaneGeometry(SIZE, SIZE, nx - 1, ny - 1);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const target = new Float32Array(pos.count);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = (ny - 1 - j) * nx + i; // plane rows run +z -> -z; row j=0 is the low end of y
      const b = data.z[j][i];
      target[k] = (b / zmax) * HEIGHT;
      const t = Math.min(1, Math.abs(b) / zmax);
      const c = b >= 0 ? HOLD_LO.clone().lerp(HOLD_HI, 0.25 + 0.75 * t) : FAIL_LO.clone().lerp(FAIL_HI, 0.15 + 0.85 * t);
      colors.set([c.r, c.g, c.b], k * 3);
    }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  // marching squares on B = 0 -> breaking-line segments lying at the water level
  const wx = (i: number) => (i / (nx - 1) - 0.5) * SIZE;
  const wz = (j: number) => (0.5 - j / (ny - 1)) * SIZE;
  const seg: [number, number, number][] = [];
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const c = [data.z[j][i], data.z[j][i + 1], data.z[j + 1][i + 1], data.z[j + 1][i]];
      const p = [[wx(i), wz(j)], [wx(i + 1), wz(j)], [wx(i + 1), wz(j + 1)], [wx(i), wz(j + 1)]];
      const pts: [number, number, number][] = [];
      for (let e = 0; e < 4; e++) {
        const a = c[e], b = c[(e + 1) % 4];
        if ((a < 0) !== (b < 0)) {
          const t = a / (a - b);
          const [ax, az] = p[e], [bx, bz] = p[(e + 1) % 4];
          pts.push([ax + (bx - ax) * t, 0.03, az + (bz - az) * t]);
        }
      }
      if (pts.length >= 2) seg.push(pts[0], pts[1]);
      if (pts.length === 4) seg.push(pts[2], pts[3]);
    }
  return { geometry: g, target, segments: seg, bmin: Math.min(...flat), bmax: Math.max(...flat), failShare: flat.filter((v) => v < 0).length / Math.max(1, flat.length) };
}

function Surface({ geo, active }: { geo: ReturnType<typeof buildGeometry>; active: boolean }) {
  const { geometry, target, segments } = geo;
  const water = useRef<THREE.Mesh>(null);
  const progress = useRef(0);
  const [ready, setReady] = useState(false);

  useFrame((_, dt) => {
    const goal = active ? 1 : 0;
    if (Math.abs(goal - progress.current) < 0.002) return; // settled: no per-frame geometry work
    progress.current += (goal - progress.current) * Math.min(1, dt * 1.8);
    if (Math.abs(goal - progress.current) < 0.002) {
      progress.current = goal;
      setReady(goal === 1);
    }
    const p = progress.current;
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < target.length; k++) pos.setY(k, target[k] * p);
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    if (water.current) (water.current.material as THREE.MeshBasicMaterial).opacity = 0.16 * p;
  });

  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial vertexColors roughness={0.65} metalness={0.02} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.06} />
      </mesh>
      {/* failure water level: everything beneath this plane fails a criterion */}
      <mesh ref={water} rotation-x={-Math.PI / 2} position={[0, 0.001, 0]}>
        <planeGeometry args={[SIZE, SIZE]} />
        <meshBasicMaterial color="#ff5b2e" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {ready && segments.length > 1 && <Line points={segments} segments color="#ffffff" lineWidth={2.4} />}
    </group>
  );
}

function Pin({ data, value, color, label }: { data: Landscape; value: [number, number]; color: string; label: string }) {
  const x0 = data.x.values[0], x1 = data.x.values[data.x.values.length - 1];
  const y0 = data.y.values[0], y1 = data.y.values[data.y.values.length - 1];
  const px = ((value[0] - x0) / (x1 - x0 || 1) - 0.5) * SIZE;
  const pz = (0.5 - (value[1] - y0) / (y1 - y0 || 1)) * SIZE;
  const top = HEIGHT * 1.2;
  return (
    <group position={[px, 0, pz]}>
      <Line points={[[0, -HEIGHT, 0], [0, top, 0]]} color={color} lineWidth={1.5} transparent opacity={0.85} />
      <mesh position={[0, top, 0]}>
        <sphereGeometry args={[0.11, 24, 24]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Html zIndexRange={[12, 0]} position={[0, top + 0.38, 0]} center style={{ pointerEvents: "none" }}>
        <div style={{ whiteSpace: "nowrap", font: "600 11.5px var(--font-geist)", color: color === "#ffffff" ? "#0b0d11" : "#fff", background: color, padding: "3px 9px", borderRadius: 999, boxShadow: "0 4px 14px rgba(0,0,0,.4)" }}>{label}</div>
      </Html>
    </group>
  );
}

function AxisTicks({ data }: { data: Landscape }) {
  const xs = data.x.values, ys = data.y.values;
  const lab = { whiteSpace: "nowrap" as const, font: "500 11.5px var(--font-geist)", color: "rgba(255,255,255,.7)" };
  const val = { whiteSpace: "nowrap" as const, font: "500 10.5px var(--font-geist-mono)", color: "rgba(255,255,255,.45)" };
  const h = -HEIGHT - 0.05;
  const unit = (u: string) => (u && u !== "–" ? ` (${u})` : "");
  return (
    <group>
      <Line points={[[-SIZE / 2, h, SIZE / 2 + 0.3], [SIZE / 2, h, SIZE / 2 + 0.3]]} color="#8590a0" lineWidth={1} />
      <Html zIndexRange={[10, 0]} position={[-SIZE / 2, h, SIZE / 2 + 0.8]} center><div style={val}>{fmtV(xs[0])}</div></Html>
      <Html zIndexRange={[10, 0]} position={[SIZE / 2, h, SIZE / 2 + 0.8]} center><div style={val}>{fmtV(xs[xs.length - 1])}</div></Html>
      <Html zIndexRange={[10, 0]} position={[0, h, SIZE / 2 + 1.25]} center><div style={lab}>{data.x.label}{unit(data.x.unit)} →</div></Html>
      <Line points={[[-SIZE / 2 - 0.3, h, SIZE / 2], [-SIZE / 2 - 0.3, h, -SIZE / 2]]} color="#8590a0" lineWidth={1} />
      <Html zIndexRange={[10, 0]} position={[-SIZE / 2 - 0.9, h, SIZE / 2]} center><div style={val}>{fmtV(ys[0])}</div></Html>
      <Html zIndexRange={[10, 0]} position={[-SIZE / 2 - 0.9, h, -SIZE / 2]} center><div style={val}>{fmtV(ys[ys.length - 1])}</div></Html>
      <Html zIndexRange={[10, 0]} position={[-SIZE / 2 - 1.5, h, 0]} center><div style={lab}>{data.y.label}{unit(data.y.unit)} →</div></Html>
    </group>
  );
}

export function FailureLandscape({ data, active = true, height = 520, autoRotate = false, compact = false }: { data: Landscape; active?: boolean; height?: number | string; autoRotate?: boolean; compact?: boolean }) {
  const controls = useRef<{ reset: () => void } | null>(null);
  const [spin, setSpin] = useState(autoRotate);
  const geo = useMemo(() => buildGeometry(data), [data]);
  // small panels get a clean view: no legend, axis text or hint (they would overlap)
  const small = compact || (typeof height === "number" && height < 380);

  return (
    <div style={{ height }} className="relative w-full select-none">
      <Canvas camera={{ position: compact ? [10, 12, 12] : [11, 11, 14], fov: 34 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}>
        <ambientLight intensity={0.65} />
        <directionalLight position={[6, 12, 6]} intensity={1.5} />
        <directionalLight position={[-8, 5, -6]} intensity={0.45} color="#9ad4ff" />
        <Surface geo={geo} active={active} />
        {data.nominal && <Pin data={data} value={data.nominal} color="#ffffff" label={small ? "Now" : "Nominal"} />}
        {data.point && <Pin data={data} value={data.point} color="#ff5b2e" label={small ? "Breaks" : "Breaking point"} />}
        {!small && <AxisTicks data={data} />}
        <OrbitControls ref={controls as never} enablePan={false} minDistance={9} maxDistance={28} maxPolarAngle={Math.PI / 2.2} autoRotate={spin} autoRotateSpeed={0.5} enableDamping target={[0, -0.4, 0]} />
      </Canvas>

      {!small && (
        <div className="pointer-events-none absolute left-4 top-4 z-20 max-w-[270px] rounded-2xl border border-white/10 bg-black/75 p-3.5 text-[12px] leading-snug text-white/70">
          <div className="mb-2 text-[13px] font-semibold text-white">How to read this</div>
          <div className="flex items-center gap-2"><span className="h-2.5 w-5 shrink-0 rounded-sm bg-gradient-to-r from-[#1b6b52] to-[#5ff0b8]" /> Claim holds — higher is safer</div>
          <div className="mt-1 flex items-center gap-2"><span className="h-2.5 w-5 shrink-0 rounded-sm bg-gradient-to-r from-[#ff7a52] to-[#7a1a14]" /> Claim fails — deeper is worse</div>
          <div className="mt-1 flex items-center gap-2"><span className="h-[3px] w-5 shrink-0 rounded bg-white" /> Breaking line, where B = 0</div>
          <div className="mt-2 border-t border-white/10 pt-2 font-mono text-[11px] text-white/50">B from {geo.bmin.toFixed(2)} to +{geo.bmax.toFixed(2)} · {Math.round(geo.failShare * 100)}% of this slice fails</div>
        </div>
      )}
      <div className="absolute bottom-3 right-3 flex gap-1.5">
        <button onClick={() => setSpin((s) => !s)} aria-label={spin ? "Pause rotation" : "Auto-rotate"} className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-black/70 text-white/70 transition-colors hover:text-white">
          {spin ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button onClick={() => controls.current?.reset()} aria-label="Reset view" className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-black/70 text-white/70 transition-colors hover:text-white">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      {small && (
        <div className="pointer-events-none absolute left-3 top-3 z-20 flex gap-2 text-[11px] text-white/70">
          <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5"><span className="h-2 w-2 rounded-full bg-[#5ff0b8]" /> holds</span>
          <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5"><span className="h-2 w-2 rounded-full bg-[#ff7a52]" /> fails</span>
        </div>
      )}
      {!small && <div className="pointer-events-none absolute bottom-4 left-4 text-[11.5px] text-white/40">Drag to orbit · scroll to zoom · every grid point is a full model run</div>}
    </div>
  );
}
