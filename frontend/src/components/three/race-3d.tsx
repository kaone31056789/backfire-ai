"use client";
/**
 * Animated 3D benchmark race. The landscape is a real 2-D practice course (height =
 * net benefit B: green plateau = safe, red canyon = failure). Each explorer replays
 * the exact sequence of tries its algorithm made (GET /benchmarks/race).
 * Trees, rocks, sky and the island base are decoration; positions and colours of the
 * terrain, footprints, flags and the star come from the data.
 */
import { Html, OrbitControls, Sparkles } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export interface RaceData {
  course: string;
  grid: { n: number; z: number[][] };
  true_point: [number, number];
  true_distance: number;
  budget: number;
  racers: { key: string; method: string; tries: [number, number, boolean][]; best: number[] | null; best_distance: number | null }[];
}

export const RACER_STYLE: Record<string, { color: string; name: string; emoji: string }> = {
  mpfs: { color: "#ff5b2e", name: "MPFS", emoji: "🦊" },
  nsga2: { color: "#f5b84a", name: "NSGA-II", emoji: "🐝" },
  de: { color: "#a78bfa", name: "Evolution", emoji: "🦋" },
  random: { color: "#9aa3b2", name: "Random", emoji: "🎲" },
};

/** Per-course look: sky, light and plateau colours (decoration only). */
const LOOK: Record<string, { sky: string; fog: string; sun: string; safe: string; safeHi: string; base: string; glow: string }> = {
  straight: { sky: "#1b2b44", fog: "#1b2b44", sun: "#fff3d6", safe: "#4fbf6a", safeHi: "#b5ef94", base: "#4a3a2c", glow: "#ff4a1c" },
  pit: { sky: "#231a3a", fog: "#231a3a", sun: "#ffd9f0", safe: "#59b08a", safeHi: "#bfe8c4", base: "#3c3346", glow: "#ff3355" },
  decoy: { sky: "#3a1f1c", fog: "#3a1f1c", sun: "#ffc98a", safe: "#6fbf5a", safeHi: "#e2ef9a", base: "#5a3a24", glow: "#ff6a00" },
};

const S = 6; // half-size of the course in world units
const toWorld = (u: number, v: number): [number, number] => [u * S, -v * S];

function heightAt(z: number[][], n: number, u: number, v: number) {
  const fx = ((u + 1) / 2) * (n - 1), fy = ((v + 1) / 2) * (n - 1);
  const i = Math.max(0, Math.min(n - 1, Math.round(fx))), j = Math.max(0, Math.min(n - 1, Math.round(fy)));
  return terrainY(z[j][i]);
}
function terrainY(b: number) {
  return b >= 0 ? 0.35 + Math.min(b, 0.8) * 0.5 : -1.3 * Math.min(1, -b * 5);
}
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function Terrain({ data, look }: { data: RaceData; look: (typeof LOOK)[string] }) {
  const geo = useMemo(() => {
    const n = data.grid.n;
    const g = new THREE.PlaneGeometry(S * 2, S * 2, n - 1, n - 1);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const safe = new THREE.Color(look.safe), safeHi = new THREE.Color(look.safeHi), fail = new THREE.Color("#ff6a3d"), deep = new THREE.Color("#7a1a10");
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = (n - 1 - j) * n + i;
        const b = data.grid.z[j][i];
        pos.setY(k, terrainY(b));
        const c = b >= 0 ? safe.clone().lerp(safeHi, Math.min(1, b * 1.4)) : fail.clone().lerp(deep, Math.min(1, -b * 4));
        col.set([c.r, c.g, c.b], k * 3);
      }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, [data, look]);
  const lava = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (lava.current) lava.current.emissiveIntensity = 0.9 + Math.sin(clock.elapsedTime * 2.2) * 0.35;
  });
  return (
    <group>
      <mesh geometry={geo} receiveShadow castShadow>
        <meshStandardMaterial vertexColors />
      </mesh>
      {/* glowing floor of the failure canyon */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -1.15, 0]}>
        <planeGeometry args={[S * 2 - 0.05, S * 2 - 0.05]} />
        <meshStandardMaterial ref={lava} color="#3a0800" emissive={look.glow} emissiveIntensity={1} />
      </mesh>
      {/* the island base: makes the course read like a diorama */}
      <mesh position={[0, -2.05, 0]} receiveShadow>
        <boxGeometry args={[S * 2 + 0.04, 1.8, S * 2 + 0.04]} />
        <meshStandardMaterial color={look.base} />
      </mesh>
      <mesh position={[0, -3.3, 0]}>
        <cylinderGeometry args={[S * 1.05, S * 0.35, 1.2, 8]} />
        <meshStandardMaterial color={look.base} />
      </mesh>
    </group>
  );
}

/** Low-poly trees and rocks scattered on the safe plateau. */
function Scenery({ data }: { data: RaceData }) {
  const crowns = useRef<THREE.InstancedMesh>(null);
  const trunks = useRef<THREE.InstancedMesh>(null);
  const rocks = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => {
    const r = rng(data.course.length * 977 + 13);
    const out: { x: number; y: number; z: number; s: number; rock: boolean }[] = [];
    for (let k = 0; k < 400 && out.length < 34; k++) {
      const u = r() * 2 - 1, v = r() * 2 - 1;
      if (Math.hypot(u, v) < 0.25 || Math.max(Math.abs(u), Math.abs(v)) > 0.93) continue;
      const n = data.grid.n;
      const b = data.grid.z[Math.round(((v + 1) / 2) * (n - 1))][Math.round(((u + 1) / 2) * (n - 1))];
      if (b < 0.12) continue; // keep away from the canyon edge
      const [x, z] = toWorld(u, v);
      out.push({ x, y: terrainY(b), z, s: 0.6 + r() * 0.6, rock: r() < 0.3 });
    }
    return out;
  }, [data]);
  useEffect(() => {
    const d = new THREE.Object3D();
    let t = 0, q = 0;
    spots.forEach((p) => {
      if (p.rock) {
        d.position.set(p.x, p.y + 0.06, p.z);
        d.rotation.set(p.s, p.s * 3, 0);
        d.scale.setScalar(0.18 * p.s);
        d.updateMatrix();
        rocks.current?.setMatrixAt(q++, d.matrix);
      } else {
        d.rotation.set(0, 0, 0);
        d.position.set(p.x, p.y + 0.18 * p.s, p.z);
        d.scale.setScalar(p.s);
        d.updateMatrix();
        trunks.current?.setMatrixAt(t, d.matrix);
        d.position.set(p.x, p.y + 0.5 * p.s, p.z);
        d.updateMatrix();
        crowns.current?.setMatrixAt(t++, d.matrix);
      }
    });
    for (const m of [crowns.current, trunks.current]) if (m) { m.count = t; m.instanceMatrix.needsUpdate = true; }
    if (rocks.current) { rocks.current.count = q; rocks.current.instanceMatrix.needsUpdate = true; }
  }, [spots]);
  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, undefined, 40]} castShadow>
        <cylinderGeometry args={[0.035, 0.05, 0.36, 5]} />
        <meshStandardMaterial color="#6b4a2f" />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[undefined, undefined, 40]} castShadow>
        <coneGeometry args={[0.2, 0.55, 7]} />
        <meshStandardMaterial color="#2f8a4a" />
      </instancedMesh>
      <instancedMesh ref={rocks} args={[undefined, undefined, 40]} castShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#9a9488" />
      </instancedMesh>
    </group>
  );
}

/** Confetti that rains over the course once every explorer has used its budget. */
function Confetti({ clock, rate, budget }: { clock: React.MutableRefObject<number>; rate: number; budget: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const N = 160;
  const bits = useMemo(() => {
    const r = rng(99);
    return Array.from({ length: N }, () => ({ x: (r() - 0.5) * 12, z: (r() - 0.5) * 12, y0: 6 + r() * 6, v: 1.2 + r() * 1.6, spin: r() * 6, c: ["#ff5b2e", "#ffd23f", "#3ee6a8", "#5aa9ff", "#a78bfa"][Math.floor(r() * 5)] }));
  }, []);
  const d = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  useEffect(() => {
    bits.forEach((b, i) => ref.current?.setColorAt(i, col.set(b.c)));
    if (ref.current?.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [bits, col]);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const since = clock.current - budget / rate; // seconds since the finish
    m.visible = since > 0 && since < 9;
    if (!m.visible) return;
    bits.forEach((b, i) => {
      d.position.set(b.x + Math.sin(since * 2 + b.spin) * 0.3, b.y0 - ((since * b.v) % (b.y0 + 2)), b.z);
      d.rotation.set(since * b.spin, since * 2, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, N]} visible={false}>
      <planeGeometry args={[0.16, 0.08]} />
      <meshBasicMaterial side={THREE.DoubleSide} />
    </instancedMesh>
  );
}

function StartFlag() {
  const flag = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (flag.current) flag.current.rotation.y = Math.sin(clock.elapsedTime * 3) * 0.25;
  });
  return (
    <group position={[0, 0.4, 0]}>
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 1.8, 8]} />
        <meshStandardMaterial color="#e8e8e8" />
      </mesh>
      <mesh ref={flag} position={[0.35, 1.55, 0]}>
        <boxGeometry args={[0.7, 0.42, 0.03]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <Html position={[0, 2.2, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div style={{ font: "700 12px var(--font-geist)", color: "#0b0d11", background: "#fff", padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>Start</div>
      </Html>
    </group>
  );
}

function GoldStar({ data, clock, rate }: { data: RaceData; clock: React.MutableRefObject<number>; rate: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const burst = useRef<THREE.Group>(null);
  const [x, z] = toWorld(data.true_point[0], data.true_point[1]);
  const y = heightAt(data.grid.z, data.grid.n, data.true_point[0], data.true_point[1]) + 1.1;
  useFrame(({ clock: c }) => {
    if (ref.current) {
      ref.current.rotation.y = c.elapsedTime * 1.6;
      ref.current.position.y = y + Math.sin(c.elapsedTime * 2.2) * 0.12;
    }
    if (burst.current) burst.current.visible = clock.current * rate >= data.budget; // celebration at the finish
  });
  return (
    <group position={[x, 0, z]}>
      <mesh ref={ref}>
        <octahedronGeometry args={[0.32, 0]} />
        <meshStandardMaterial color="#ffd23f" emissive="#ffb300" emissiveIntensity={0.8} />
      </mesh>
      <pointLight position={[0, y, 0]} color="#ffd23f" intensity={6} distance={4} />
      <group ref={burst} visible={false}>
        <Sparkles count={60} scale={[2.4, 2.4, 2.4]} position={[0, y, 0]} size={5} speed={1.2} color="#ffd23f" />
      </group>
      <Html position={[0, y + 0.75, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div style={{ font: "700 12px var(--font-geist)", color: "#3d2a00", background: "#ffd23f", padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap", boxShadow: "0 6px 18px rgba(255,200,0,.35)" }}>⭐ The answer</div>
      </Html>
    </group>
  );
}

function Explorer({ racer, data, clock, rate }: { racer: RaceData["racers"][number]; data: RaceData; clock: React.MutableRefObject<number>; rate: number }) {
  const body = useRef<THREE.Group>(null);
  const prints = useRef<THREE.InstancedMesh>(null);
  const pin = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const pop = useRef<HTMLDivElement>(null);
  const st = RACER_STYLE[racer.key];
  const pts = useMemo(() => racer.tries.map(([u, v, f]) => { const [x, z] = toWorld(u, v); return { x, z, y: heightAt(data.grid.z, data.grid.n, u, v), f, d: Math.hypot(u, v) }; }), [racer, data]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const failColor = useMemo(() => new THREE.Color("#ff2e1a"), []);
  const okColor = useMemo(() => new THREE.Color(st.color), [st.color]);
  const shown = useRef(-1);
  const trail = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(pts.map((q) => new THREE.Vector3(q.x, q.y + 0.08, q.z)));
    g.setDrawRange(0, 0);
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color: st.color, transparent: true, opacity: 0.55 }));
  }, [pts, st.color]);
  const bestIdx = useRef(-1);
  const ringT = useRef(9);
  const popT = useRef(9);

  useEffect(() => {
    shown.current = -1;
    bestIdx.current = -1;
  }, [pts]);

  useFrame((_, dt) => {
    const t = clock.current * rate;
    const i = Math.min(pts.length - 1, Math.floor(t));
    const f = Math.min(1, t - Math.floor(t));
    const a = pts[Math.max(0, i)], b = pts[Math.min(pts.length - 1, i + 1)];
    if (body.current && a) {
      const done = t >= pts.length - 1;
      const k = done ? 0 : f;
      const x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k;
      const hop = done ? Math.abs(Math.sin(clock.current * 4)) * 0.15 : Math.sin(k * Math.PI) * 0.9;
      body.current.position.set(x, Math.max(a.y, b.y) + 0.32 + hop, z);
      body.current.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      const squash = 1 - Math.sin(k * Math.PI) * 0.12;
      body.current.scale.set(1 / squash, squash, 1 / squash);
    }
    if (i < shown.current) {
      // replay / course change: clear footprints
      shown.current = -1;
      bestIdx.current = -1;
      if (prints.current) prints.current.count = 0;
      trail.geometry.setDrawRange(0, 0);
    }
    if (prints.current && i !== shown.current) {
      for (let q = shown.current + 1; q <= i; q++) {
        const p = pts[q];
        dummy.position.set(p.x, p.y + 0.03, p.z);
        dummy.scale.setScalar(p.f ? 1.6 : 1);
        dummy.updateMatrix();
        prints.current.setMatrixAt(q, dummy.matrix);
        prints.current.setColorAt(q, p.f ? failColor : okColor);
        if (p.f && (bestIdx.current < 0 || p.d < pts[bestIdx.current].d)) {
          bestIdx.current = q;
          popT.current = 0; // a new closest failure: celebrate
        }
      }
      prints.current.count = i + 1;
      trail.geometry.setDrawRange(0, i + 1);
      prints.current.instanceMatrix.needsUpdate = true;
      if (prints.current.instanceColor) prints.current.instanceColor.needsUpdate = true;
      shown.current = i;
      ringT.current = 0; // landing puff
      if (ring.current) ring.current.position.set(pts[i].x, pts[i].y + 0.05, pts[i].z);
      const best = bestIdx.current;
      if (pin.current) {
        pin.current.visible = best >= 0;
        if (best >= 0) pin.current.position.set(pts[best].x, pts[best].y, pts[best].z);
      }
    }
    ringT.current += dt;
    if (ring.current) {
      const r = ringT.current;
      ring.current.scale.setScalar(0.4 + r * 2.4);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.55 - r * 1.3);
    }
    popT.current += dt;
    if (pop.current) {
      const p = popT.current;
      pop.current.style.opacity = String(p < 1.4 ? Math.min(1, (1.4 - p) * 2) : 0);
      pop.current.style.transform = `translateY(${-p * 14}px) scale(${p < 0.15 ? 0.6 + p * 2.6 : 1})`;
    }
  });

  return (
    <group>
      <primitive object={trail} />
      <instancedMesh ref={prints} args={[undefined, undefined, Math.max(1, pts.length)]}>
        <cylinderGeometry args={[0.06, 0.06, 0.03, 10]} />
        <meshBasicMaterial transparent opacity={0.85} />
      </instancedMesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.18, 0.24, 24]} />
        <meshBasicMaterial color={st.color} transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={pin} visible={false}>
        <mesh position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 1, 6]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0.17, 0.88, 0]}>
          <boxGeometry args={[0.34, 0.22, 0.02]} />
          <meshStandardMaterial color={st.color} />
        </mesh>
      </group>
      <group ref={body}>
        <mesh castShadow>
          <sphereGeometry args={[0.3, 24, 24]} />
          <meshStandardMaterial color={st.color} />
        </mesh>
        {[-0.11, 0.11].map((ex) => (
          <group key={ex} position={[ex, 0.08, 0.25]}>
            <mesh><sphereGeometry args={[0.075, 12, 12]} /><meshStandardMaterial color="#ffffff" /></mesh>
            <mesh position={[0, 0, 0.055]}><sphereGeometry args={[0.035, 10, 10]} /><meshBasicMaterial color="#111" /></mesh>
          </group>
        ))}
        <Html position={[0, 0.62, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <div ref={pop} style={{ opacity: 0, font: "800 11px var(--font-geist)", color: "#fff", background: "#ff2e1a", padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap" }}>Found a closer one!</div>
            <div style={{ font: "700 11px var(--font-geist)", color: "#fff", background: st.color, padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap" }}>{st.emoji} {st.name}</div>
          </div>
        </Html>
      </group>
    </group>
  );
}

export function Race3D({ data, clock, rate, height = 520 }: { data: RaceData; clock: React.MutableRefObject<number>; rate: number; height?: number }) {
  const look = LOOK[data.course] || LOOK.straight;
  return (
    <div style={{ height }} className="w-full">
      <Canvas shadows="soft" camera={{ position: [0, 11, 13.5], fov: 42 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }}>
        <color attach="background" args={[look.sky]} />
        <fog attach="fog" args={[look.fog, 22, 44]} />
        <ambientLight intensity={0.55} />
        <directionalLight castShadow position={[6, 12, 6]} intensity={1.9} color={look.sun} shadow-mapSize={[1024, 1024]} shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={9} shadow-camera-bottom={-9} />
        <hemisphereLight args={["#cfe8ff", look.base, 0.6]} />
        <Sparkles count={80} scale={[22, 8, 22]} position={[0, 4, 0]} size={2} speed={0.3} opacity={0.5} color="#ffffff" />
        <Terrain data={data} look={look} />
        <Scenery data={data} />
        <StartFlag />
        <GoldStar data={data} clock={clock} rate={rate} />
        <Confetti clock={clock} rate={rate} budget={data.budget} />
        {data.racers.map((r) => <Explorer key={r.key} racer={r} data={data} clock={clock} rate={rate} />)}
        <OrbitControls enablePan={false} minDistance={8} maxDistance={26} maxPolarAngle={Math.PI / 2.3} target={[0, -0.3, 0]} enableDamping autoRotate autoRotateSpeed={0.35} />
      </Canvas>
    </div>
  );
}
