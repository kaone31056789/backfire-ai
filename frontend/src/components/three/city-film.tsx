"use client";
/**
 * Cinematic 3D simulation film of an urban-forest scenario.
 *
 * Every moving visual is driven by model output (film payload):
 *  - trees alive in year t   -> the model's survival curve (1 - m)^t
 *  - leaf colour each month  -> FAO-56 water-stress (1 - Ks) for that month
 *  - rain particles          -> monthly precipitation
 *  - sprinkler sprays        -> monthly irrigation delivered
 *  - sun height / heat haze  -> monthly maximum temperature
 * The staging (city block, building style, tree species, hills) is chosen from the site's
 * climate class (biome) so each place looks like itself; it is illustration, not model input.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface FilmScene {
  key: "plan" | "break" | "better";
  title: string;
  subtitle: string;
  narration: string;
  changes: { label: string; from: number; to: number; unit: string }[];
  survival_by_year: number[];
  annual_mortality: number;
  monthly: { stress: number[]; irrigation_mm: number[]; rain_mm: number[]; tmax_c: number[] };
  metrics: { cooling_c: number; survival_rate: number; water_stress_index: number; irrigation_m3_ha: number; effective_canopy: number };
  success: boolean;
  binding: string;
  binding_metric: string;
  break_year: number | null;
  tree_density: number;
  species_factor: number;
}

export type BiomeKey = "desert" | "semi_arid" | "mediterranean" | "monsoon" | "humid";
export interface Biome { key: BiomeKey; label: string; why: string; annual_rain_mm: number; hottest_tmax_c: number }

/** Shared playhead, written by the player, read by the 3D scene every frame. */
export interface Playhead {
  scene: number;
  phase: "intro" | "title" | "play" | "end";
  /** 0..1 within the phase */
  p: number;
  /** continuous time in years within the play phase (0..horizon) */
  years: number;
}

type Shape = "palm" | "umbrella" | "round" | "cypress" | "lush";
interface Theme {
  ground: string; road: string; kerb: string;
  buildings: string[]; roof: string | null; tall: number;
  grassWet: string; grassDry: string; leaf: string; trunk: string;
  tree: Shape; tree2: Shape; mix: number; // share of trees using tree2
  sky: string; ground2: string; hills: string; dunes: boolean;
}

export const THEMES: Record<BiomeKey, Theme> = {
  desert: { ground: "#cdb48a", road: "#4b4741", kerb: "#d9c7a5", buildings: ["#e6cfa6", "#dcc095", "#d2b282", "#ead9b8", "#c9a678"], roof: null, tall: 10,
    grassWet: "#8f9a55", grassDry: "#d0b47c", leaf: "#5b8f3a", trunk: "#7a5a3a", tree: "palm", tree2: "umbrella", mix: 0.3,
    sky: "#f2d9ae", ground2: "#e0c48f", hills: "#dcb983", dunes: true },
  semi_arid: { ground: "#a39274", road: "#3f3d3a", kerb: "#bfb39c", buildings: ["#e3d7c3", "#d8c8ab", "#cbb894", "#efe6d6", "#d1bea0"], roof: null, tall: 14,
    grassWet: "#7f8f45", grassDry: "#b8a066", leaf: "#678f3c", trunk: "#5e4632", tree: "umbrella", tree2: "round", mix: 0.35,
    sky: "#d6dde0", ground2: "#a99878", hills: "#9f8a64", dunes: false },
  mediterranean: { ground: "#8f8a80", road: "#3b3c3f", kerb: "#c9c2b4", buildings: ["#f3eee4", "#efe1c2", "#e8d2a8", "#f6f1e7", "#e9d9bd"], roof: "#c0603a", tall: 9,
    grassWet: "#6f8f42", grassDry: "#b59f62", leaf: "#6f8a4f", trunk: "#5a4a3a", tree: "round", tree2: "cypress", mix: 0.32,
    sky: "#a9cdeb", ground2: "#8d9a6a", hills: "#7c8a5a", dunes: false },
  monsoon: { ground: "#6f6b63", road: "#34363a", kerb: "#b5ada0", buildings: ["#d8d0c4", "#c9d3d6", "#e2c9b8", "#d6d9c4", "#e8dccb"], roof: null, tall: 22,
    grassWet: "#4f8f3f", grassDry: "#a8955a", leaf: "#3f9b4f", trunk: "#5a4130", tree: "lush", tree2: "palm", mix: 0.15,
    sky: "#b9c9d6", ground2: "#5f7a4a", hills: "#4f6f42", dunes: false },
  humid: { ground: "#5f6a5a", road: "#303235", kerb: "#aab0a4", buildings: ["#e8e0d0", "#f0d7b8", "#bcd7d0", "#e3e8d8", "#f2e4c8"], roof: "#9a4a3a", tall: 16,
    grassWet: "#3f8a3a", grassDry: "#8f9a55", leaf: "#2f8f45", trunk: "#4e3a2a", tree: "lush", tree2: "palm", mix: 0.28,
    sky: "#a8c6dc", ground2: "#3f6f3f", hills: "#3a6a3c", dunes: false },
};

const PARK = 34;
const N_TREES = 140;
const ROAD = PARK / 2 + 3.5;
const TRUNK_H: Record<Shape, number> = { palm: 2.6, umbrella: 1.5, round: 1.15, cypress: 0.55, lush: 1.2 };

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Low-poly crown geometries ("assets"), origin at the top of the trunk. */
function crownGeometry(shape: Shape): THREE.BufferGeometry {
  if (shape === "palm") {
    const fronds: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) {
      const f = new THREE.BoxGeometry(0.34, 0.05, 1.9);
      f.translate(0, 0, 0.95);
      f.rotateX(0.5 + (i % 2) * 0.15);
      f.rotateY((i / 8) * Math.PI * 2);
      fronds.push(f);
    }
    const nut = new THREE.IcosahedronGeometry(0.22, 0).toNonIndexed();
    const g = mergeGeometries(fronds.map((f) => f.toNonIndexed()).concat(nut))!;
    return g;
  }
  if (shape === "umbrella") {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.scale(1.55, 0.42, 1.55);
    g.translate(0, 0.25, 0);
    return g;
  }
  if (shape === "cypress") {
    const g = new THREE.ConeGeometry(0.5, 2.9, 7);
    g.translate(0, 1.4, 0);
    return g;
  }
  if (shape === "lush") {
    const parts = [[0, 0.55, 0, 0.95], [0.6, 0.35, 0.25, 0.7], [-0.55, 0.4, -0.3, 0.72], [0.1, 1.05, 0.35, 0.6], [-0.2, 0.3, 0.6, 0.6]].map(([x, y, z, r]) => {
      const p = new THREE.IcosahedronGeometry(r, 1);
      p.translate(x, y, z);
      return p;
    });
    return mergeGeometries(parts)!;
  }
  const g = new THREE.IcosahedronGeometry(1, 1);
  g.translate(0, 0.7, 0);
  return g;
}

function City({ theme }: { theme: Theme }) {
  const { buildings, windows } = useMemo(() => {
    const r = rng(7);
    const list: { x: number; z: number; w: number; d: number; h: number; c: string }[] = [];
    const ring = PARK / 2 + 9;
    for (let side = 0; side < 4; side++)
      for (let k = -3; k <= 3; k++) {
        const along = k * 8 + (r() - 0.5) * 2;
        const out = ring + 4 + r() * 6;
        const w = 5 + r() * 2.5, d = 5 + r() * 3, h = 3.5 + Math.pow(r(), 1.6) * theme.tall;
        const [x, z] = side === 0 ? [along, -out] : side === 1 ? [out, along] : side === 2 ? [along, out] : [-out, along];
        list.push({ x, z, w, d, h, c: theme.buildings[Math.floor(r() * theme.buildings.length)] });
      }
    const cv = document.createElement("canvas");
    cv.width = 64;
    cv.height = 128;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 64, 128);
    g.fillStyle = "#8fa6bd";
    for (let y = 6; y < 128; y += 14) for (let x = 6; x < 64; x += 14) g.fillRect(x, y, 8, 8);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return { buildings: list, windows: tex };
  }, [theme]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[320, 320]} />
        <meshStandardMaterial color={theme.ground} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[PARK + 14, PARK + 14]} />
        <meshStandardMaterial color={theme.road} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, s * ROAD]}>
            <planeGeometry args={[PARK + 14, 0.22]} />
            <meshBasicMaterial color="#e8d36b" />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[s * ROAD, 0.01, 0]}>
            <planeGeometry args={[0.22, PARK + 14]} />
            <meshBasicMaterial color="#e8d36b" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.12, 0]} receiveShadow>
        <boxGeometry args={[PARK + 1.2, 0.24, PARK + 1.2]} />
        <meshStandardMaterial color={theme.kerb} />
      </mesh>
      {buildings.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]}>
          <mesh position={[0, b.h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial color={b.c} map={windows} />
          </mesh>
          {theme.roof ? (
            <mesh position={[0, b.h + 1.1, 0]} rotation-y={Math.PI / 4} castShadow>
              <coneGeometry args={[Math.max(b.w, b.d) * 0.74, 2.2, 4]} />
              <meshStandardMaterial color={theme.roof} />
            </mesh>
          ) : (
            <mesh position={[0, b.h + 0.18, 0]}>
              <boxGeometry args={[b.w * 0.92, 0.36, b.d * 0.92]} />
              <meshStandardMaterial color={b.c} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

/** Distant landscape: dunes in deserts, hills elsewhere. */
function Horizon({ theme }: { theme: Theme }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => {
    const r = rng(11);
    return Array.from({ length: 26 }, (_, i) => {
      const a = (i / 26) * Math.PI * 2 + r() * 0.2;
      const rad = 105 + r() * 50;
      return { x: Math.cos(a) * rad, z: Math.sin(a) * rad, sx: 22 + r() * 22, sy: theme.dunes ? 4 + r() * 5 : 9 + r() * 16, sz: 18 + r() * 16, rot: r() * Math.PI };
    });
  }, [theme]);
  useEffect(() => {
    if (!ref.current) return;
    const d = new THREE.Object3D();
    items.forEach((it, i) => {
      d.position.set(it.x, 0, it.z);
      d.rotation.set(0, it.rot, 0);
      d.scale.set(it.sx, it.sy, it.sz);
      d.updateMatrix();
      ref.current!.setMatrixAt(i, d.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  }, [items]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} receiveShadow>
      <sphereGeometry args={[1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
      <meshStandardMaterial color={theme.hills} />
    </instancedMesh>
  );
}

/** A little life: cars circling the block. */
function Traffic() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const cars = useMemo(() => {
    const r = rng(5);
    const colors = ["#e4572e", "#f3f3f3", "#2e86de", "#222831", "#f6c90e", "#8e8e8e", "#3cb371", "#c0392b", "#ececec", "#1b1b1b"];
    return colors.map((c, i) => ({ s: (i / colors.length) * 4 + r() * 0.2, lane: i % 2 ? 1.1 : -1.1, v: (i % 2 ? 1 : -1) * (0.05 + r() * 0.03), c }));
  }, []);
  const d = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  useFrame((_, dt) => {
    if (!ref.current) return;
    cars.forEach((car, i) => {
      car.s = (((car.s + car.v * dt * 4) % 4) + 4) % 4;
      const seg = Math.floor(car.s), f = car.s - seg, R = ROAD + car.lane, L = -R + f * 2 * R;
      const [x, z, rot] = seg === 0 ? [L, -R, 0] : seg === 1 ? [R, L, Math.PI / 2] : seg === 2 ? [-L, R, 0] : [-R, -L, Math.PI / 2];
      d.position.set(x, 0.42, z);
      d.rotation.set(0, rot, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      ref.current!.setMatrixAt(i, d.matrix);
      col.set(car.c);
      ref.current!.setColorAt(i, col);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, cars.length]} castShadow>
      <boxGeometry args={[1.7, 0.62, 0.85]} />
      <meshStandardMaterial />
    </instancedMesh>
  );
}

function Park({ scene, play, theme }: { scene: FilmScene; play: React.MutableRefObject<Playhead>; theme: Theme }) {
  const grass = useRef<THREE.MeshStandardMaterial>(null);
  const trunks = useRef<THREE.InstancedMesh>(null);
  const crownA = useRef<THREE.InstancedMesh>(null);
  const crownB = useRef<THREE.InstancedMesh>(null);
  const geoA = useMemo(() => crownGeometry(theme.tree), [theme]);
  const geoB = useMemo(() => crownGeometry(theme.tree2), [theme]);
  const trees = useMemo(() => {
    const r = rng(42);
    const out: { x: number; z: number; u: number; s: number; rot: number; fall: number; b: boolean }[] = [];
    const cols = 12;
    for (let i = 0; i < N_TREES; i++) {
      const gx = (i % cols) / (cols - 1) - 0.5, gz = Math.floor(i / cols) / (Math.ceil(N_TREES / cols) - 1) - 0.5;
      out.push({ x: gx * (PARK - 4) + (r() - 0.5) * 1.6, z: gz * (PARK - 4) + (r() - 0.5) * 1.6, u: r(), s: 0.8 + r() * 0.45, rot: r() * Math.PI * 2, fall: r() * Math.PI * 2, b: r() < theme.mix });
    }
    return out;
  }, [theme]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const leafOk = useMemo(() => new THREE.Color(theme.leaf), [theme]);
  const leafStress = useMemo(() => new THREE.Color("#c9a13b"), []);
  const leafDry = useMemo(() => new THREE.Color("#8a5a2b"), []);
  const gWet = useMemo(() => new THREE.Color(theme.grassWet), [theme]);
  const gDry = useMemo(() => new THREE.Color(theme.grassDry), [theme]);
  const zero = useMemo(() => new THREE.Matrix4().makeScale(0, 0, 0), []);
  const last = useRef("");

  useFrame(() => {
    const ph = play.current;
    const H = scene.survival_by_year.length - 1;
    const yrs = ph.phase === "intro" || ph.phase === "title" ? 0 : ph.phase === "end" ? H : ph.years;
    const month = Math.min(11, Math.floor((yrs % 1) * 12));
    const yi = Math.min(H, Math.floor(yrs));
    const key = `${theme.tree}-${scene.key}-${yi}-${month}-${ph.phase}-${Math.round(ph.p * 20)}`;
    if (key === last.current || !trunks.current || !crownA.current || !crownB.current) return;
    last.current = key;
    const s0 = scene.survival_by_year[yi], s1 = scene.survival_by_year[Math.min(H, yi + 1)];
    const survival = s0 + (s1 - s0) * (yrs - yi);
    const stress = scene.monthly.stress[month] ?? 0;
    const planting = ph.phase === "title" ? ph.p : 1;
    const growth = 0.45 + 0.55 * Math.min(1, yrs / 6);
    trees.forEach((t, i) => {
      const alive = t.u < survival; // the first trees to die are those with the highest u
      const shape = t.b ? theme.tree2 : theme.tree;
      const th = TRUNK_H[shape];
      const appear = Math.min(1, Math.max(0, planting * 1.4 - (i / N_TREES) * 0.4));
      const g = t.s * growth * appear;
      dummy.position.set(t.x, 0.24, t.z);
      if (!alive) {
        dummy.rotation.set(Math.PI / 2.2, t.fall, 0); // fallen trunk
        dummy.scale.set(0.9, th * 0.7 * t.s * growth, 0.9);
      } else {
        dummy.rotation.set(0, t.rot, 0);
        dummy.scale.set(shape === "palm" ? 0.7 : 1, th * g, shape === "palm" ? 0.7 : 1);
      }
      dummy.updateMatrix();
      trunks.current!.setMatrixAt(i, dummy.matrix);
      color.set(alive ? theme.trunk : "#4a4743");
      trunks.current!.setColorAt(i, color);

      dummy.rotation.set(0, t.rot, 0);
      dummy.position.set(t.x, 0.24 + 1.6 * th * g - 0.05, t.z);
      const cs = alive ? 1.2 * g : 0;
      dummy.scale.set(cs, cs, cs);
      dummy.updateMatrix();
      crownA.current!.setMatrixAt(i, t.b ? zero : dummy.matrix);
      crownB.current!.setMatrixAt(i, t.b ? dummy.matrix : zero);
      const local = Math.min(1, stress * (0.7 + t.u * 0.6)); // some trees feel drought earlier
      color.copy(leafOk).lerp(local > 0.5 ? leafDry : leafStress, Math.min(1, local * 1.6));
      (t.b ? crownB : crownA).current!.setColorAt(i, color);
    });
    trunks.current.instanceMatrix.needsUpdate = true;
    for (const c of [crownA.current, crownB.current]) {
      c.instanceMatrix.needsUpdate = true;
      if (c.instanceColor) c.instanceColor.needsUpdate = true;
    }
    if (trunks.current.instanceColor) trunks.current.instanceColor.needsUpdate = true;
    if (grass.current) grass.current.color.copy(gWet).lerp(gDry, Math.min(1, stress * 1.3));
  });

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.245, 0]} receiveShadow>
        <planeGeometry args={[PARK, PARK]} />
        <meshStandardMaterial ref={grass} color={theme.grassWet} />
      </mesh>
      <instancedMesh ref={trunks} args={[undefined, undefined, N_TREES]} castShadow>
        <cylinderGeometry args={[0.12, 0.18, 1.6, 6]} />
        <meshStandardMaterial />
      </instancedMesh>
      <instancedMesh ref={crownA} args={[geoA, undefined, N_TREES]} castShadow>
        <meshStandardMaterial roughness={0.8} flatShading />
      </instancedMesh>
      <instancedMesh ref={crownB} args={[geoB, undefined, N_TREES]} castShadow>
        <meshStandardMaterial roughness={0.8} flatShading />
      </instancedMesh>
    </group>
  );
}

/** Drifting clouds (decoration). */
function Clouds() {
  const g = useRef<THREE.Group>(null);
  const clouds = useMemo(() => {
    const r = rng(17);
    return Array.from({ length: 8 }, () => ({ x: (r() - 0.5) * 240, y: 46 + r() * 16, z: (r() - 0.5) * 200, s: 4 + r() * 4, v: 1.2 + r() * 1.6,
      puffs: Array.from({ length: 5 }, () => [(r() - 0.5) * 3.2, (r() - 0.5) * 0.8, (r() - 0.5) * 1.6, 0.8 + r() * 0.7]) }));
  }, []);
  useFrame((_, dt) => {
    g.current?.children.forEach((c, i) => {
      c.position.x += clouds[i].v * dt;
      if (c.position.x > 130) c.position.x = -130;
    });
  });
  return (
    <group ref={g}>
      {clouds.map((c, i) => (
        <group key={i} position={[c.x, c.y, c.z]} scale={c.s}>
          {c.puffs.map(([x, y, z, r], k) => (
            <mesh key={k} position={[x, y, z]}>
              <icosahedronGeometry args={[r, 1]} />
              <meshStandardMaterial color="#ffffff" transparent opacity={0.88} roughness={1} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** A small flock circling the block, wings flapping (decoration). */
function Birds() {
  const birds = useRef<(THREE.Group | null)[]>([]);
  const cfg = useMemo(() => Array.from({ length: 9 }, (_, i) => ({ a: (i / 9) * 0.9, r: 44 + (i % 3) * 3, h: 30 + (i % 4) * 1.6, ph: i * 0.7 })), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    birds.current.forEach((b, i) => {
      if (!b) return;
      const c = cfg[i], ang = t * 0.12 + c.a;
      b.position.set(Math.cos(ang) * c.r, c.h + Math.sin(t * 0.8 + c.ph) * 1.2, Math.sin(ang) * c.r);
      b.rotation.y = -ang;
      const flap = Math.sin(t * 9 + c.ph) * 0.6;
      (b.children[0] as THREE.Mesh).rotation.x = flap;
      (b.children[1] as THREE.Mesh).rotation.x = -flap;
    });
  });
  return (
    <group>
      {cfg.map((_, i) => (
        <group key={i} ref={(g) => { birds.current[i] = g; }}>
          {[1, -1].map((side) => (
            <mesh key={side} position={[0, 0, side * 0.45]}>
              <boxGeometry args={[0.35, 0.04, 0.9]} />
              <meshStandardMaterial color="#2b2b30" />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** People strolling around the park on the pavement (decoration). */
function Pedestrians() {
  const ref = useRef<(THREE.Group | null)[]>([]);
  const people = useMemo(() => {
    const r = rng(23);
    const shirts = ["#e4572e", "#2e86de", "#f6c90e", "#3cb371", "#ffffff", "#9b59b6", "#e67e22", "#1abc9c"];
    return Array.from({ length: 14 }, (_, i) => ({ s: r() * 4, v: (r() < 0.5 ? 1 : -1) * (0.035 + r() * 0.02), c: shirts[i % shirts.length], ph: r() * 6 }));
  }, []);
  useFrame(({ clock }, dt) => {
    const R = PARK / 2 + 1.6;
    ref.current.forEach((g, i) => {
      if (!g) return;
      const p = people[i];
      p.s = (((p.s + p.v * dt) % 4) + 4) % 4;
      const seg = Math.floor(p.s), f = p.s - seg, L = -R + f * 2 * R;
      const [x, z] = seg === 0 ? [L, -R] : seg === 1 ? [R, L] : seg === 2 ? [-L, R] : [-R, -L];
      g.position.set(x, 0.25 + Math.abs(Math.sin(clock.elapsedTime * 6 + p.ph)) * 0.08, z);
      g.rotation.y = (seg % 2 ? 0 : Math.PI / 2) + (p.v < 0 ? Math.PI : 0);
    });
  });
  return (
    <group>
      {people.map((p, i) => (
        <group key={i} ref={(g) => { ref.current[i] = g; }}>
          <mesh position={[0, 0.55, 0]} castShadow>
            <capsuleGeometry args={[0.2, 0.55, 4, 8]} />
            <meshStandardMaterial color={p.c} />
          </mesh>
          <mesh position={[0, 1.15, 0]} castShadow>
            <sphereGeometry args={[0.17, 10, 10]} />
            <meshStandardMaterial color="#c68e6a" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Leaves drifting down over the park; more of them in months of high model drought stress. */
function FallingLeaves({ scene, play }: { scene: FilmScene; play: React.MutableRefObject<Playhead> }) {
  const N = 420;
  const pts = useRef<THREE.Points>(null);
  const seed = useMemo(() => {
    const r = rng(31);
    return Array.from({ length: N }, () => ({ x: (r() - 0.5) * (PARK - 4), z: (r() - 0.5) * (PARK - 4), y: r() * 4, sp: 0.6 + r() * 0.8, ph: r() * 6 }));
  }, []);
  const pos = useMemo(() => new Float32Array(N * 3), []);
  useFrame(({ clock }, dt) => {
    const ph = play.current;
    const yrs = ph.phase === "play" ? ph.years : 0;
    const month = Math.min(11, Math.floor((yrs % 1) * 12));
    const stress = ph.phase === "play" ? scene.monthly.stress[month] ?? 0 : 0;
    const t = clock.elapsedTime;
    seed.forEach((l, i) => {
      l.y -= l.sp * dt;
      if (l.y < 0.3) l.y = 3 + (i % 7) * 0.2;
      pos.set([l.x + Math.sin(t * 1.5 + l.ph) * 0.5, l.y, l.z + Math.cos(t * 1.2 + l.ph) * 0.5], i * 3);
    });
    if (pts.current) {
      pts.current.geometry.attributes.position.needsUpdate = true;
      pts.current.geometry.setDrawRange(0, Math.floor(N * Math.min(1, stress * 1.4)));
    }
  });
  return (
    <points ref={pts}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[pos, 3]} /></bufferGeometry>
      <pointsMaterial color="#c9822f" size={0.22} transparent opacity={0.9} depthWrite={false} />
    </points>
  );
}

function Weather({ scene, play, theme }: { scene: FilmScene; play: React.MutableRefObject<Playhead>; theme: Theme }) {
  const rain = useRef<THREE.Points>(null);
  const spray = useRef<THREE.Points>(null);
  const sun = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.DirectionalLight>(null);
  const { scene: three } = useThree();
  const RAIN = 2400;
  const rainPos = useMemo(() => {
    const r = rng(3);
    const a = new Float32Array(RAIN * 3);
    for (let i = 0; i < RAIN; i++) a.set([(r() - 0.5) * 80, r() * 40, (r() - 0.5) * 80], i * 3);
    return a;
  }, []);
  const SPRAY = 900;
  const sprayPos = useMemo(() => new Float32Array(SPRAY * 3), []);
  const sprayVel = useMemo(() => {
    const r = rng(9);
    return Array.from({ length: SPRAY }, () => ({ x: (r() - 0.5) * (PARK - 4), z: (r() - 0.5) * (PARK - 4), a: r() * Math.PI * 2, life: r() }));
  }, []);
  const fog = useMemo(() => new THREE.Fog(theme.sky, 70, 230), [theme]);
  const sky = useMemo(() => new THREE.Color(), []);
  const base = useMemo(() => new THREE.Color(theme.sky), [theme]);
  const hot = useMemo(() => new THREE.Color("#ecc596"), []);
  const storm = useMemo(() => new THREE.Color("#7d8a99"), []);

  useFrame((_, dt) => {
    const ph = play.current;
    const H = scene.survival_by_year.length - 1;
    const yrs = ph.phase === "play" ? ph.years : ph.phase === "end" ? H : 0;
    const mf = (yrs % 1) * 12;
    const month = Math.min(11, Math.floor(mf));
    const playing = ph.phase === "play";
    const rainMm = scene.monthly.rain_mm[month] ?? 0;
    const irr = scene.monthly.irrigation_mm[month] ?? 0;
    const tmax = scene.monthly.tmax_c[month] ?? 30;
    const heat = Math.min(1, Math.max(0, (tmax - 28) / 16));

    if (rain.current) {
      const share = playing ? Math.min(1, rainMm / 160) : 0;
      const pos = rain.current.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < RAIN; i++) {
        let y = pos.getY(i) - dt * 38;
        if (y < 0) y += 40;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      (rain.current.material as THREE.PointsMaterial).opacity = 0.55 * share;
      rain.current.geometry.setDrawRange(0, Math.floor(RAIN * share));
    }
    if (spray.current) {
      const on = playing && irr > 4;
      sprayVel.forEach((s, i) => {
        s.life = (s.life + dt * 1.4) % 1;
        const rr = s.life * 2.2;
        sprayPos.set([s.x + Math.cos(s.a) * rr, 0.3 + Math.sin(s.life * Math.PI) * 1.4, s.z + Math.sin(s.a) * rr], i * 3);
      });
      spray.current.geometry.attributes.position.needsUpdate = true;
      (spray.current.material as THREE.PointsMaterial).opacity = on ? Math.min(0.85, irr / 40) : 0;
    }
    const season = Math.sin(((mf - 2) / 12) * Math.PI * 2);
    const elev = 0.55 + 0.35 * season;
    if (sun.current) sun.current.position.set(-70, 25 + elev * 55, -90);
    if (light.current) {
      light.current.position.set(-30, 25 + elev * 40, -20);
      light.current.intensity = 1.6 + heat * 1.1;
      light.current.color.set(heat > 0.6 ? "#ffe9c7" : "#fff6e8");
    }
    sky.copy(base).lerp(hot, heat * 0.55).lerp(storm, Math.min(1, rainMm / 240));
    three.background = sky;
    fog.color.copy(sky);
    fog.near = 80 - heat * 35;
    three.fog = fog;
  });

  return (
    <group>
      <ambientLight intensity={0.45} />
      <hemisphereLight args={[theme.sky, theme.ground2, 0.75]} />
      <directionalLight ref={light} castShadow position={[-30, 50, -20]} intensity={1.8} shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} shadow-camera-left={-45} shadow-camera-right={45} shadow-camera-top={45} shadow-camera-bottom={-45} />
      <mesh ref={sun}>
        <sphereGeometry args={[5, 24, 24]} />
        <meshBasicMaterial color="#fff4c2" fog={false} />
      </mesh>
      <points ref={rain}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[rainPos, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#cfe6ff" size={0.18} transparent opacity={0} depthWrite={false} />
      </points>
      <points ref={spray}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[sprayPos, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#7cc8ff" size={0.22} transparent opacity={0} depthWrite={false} />
      </points>
    </group>
  );
}

function CameraRig({ play, breakYear }: { play: React.MutableRefObject<Playhead>; breakYear: number | null }) {
  const { camera } = useThree();
  const target = useMemo(() => new THREE.Vector3(), []);
  const want = useMemo(() => new THREE.Vector3(), []);
  const centre = useMemo(() => new THREE.Vector3(0, 1.5, 0), []);
  // Buildings stand on a ring 30–42 units out (up to ~26 units tall). Outside that ring the camera
  // stays high enough to look over them; during the story it stays inside the ring, above the park,
  // so it can never pass through a wall.
  useFrame((_, dt) => {
    const ph = play.current;
    const e = (x: number) => x * x * (3 - 2 * x); // smoothstep
    let ang: number, rad: number, h: number;
    if (ph.phase === "intro") {
      const k = e(ph.p);
      ang = -0.7 + k * 0.5; rad = 120 - k * 70; h = 95 - k * 45; // drone descent from far above the city
    } else if (ph.phase === "title") {
      const k = e(ph.p);
      ang = -0.2 + k * 0.3; rad = 50 - k * 27; h = 50 - k * 22; // glide over the rooftops into the courtyard
    } else if (ph.phase === "play") {
      const near = breakYear !== null ? Math.max(0, 1 - Math.abs(ph.years - breakYear) / 1.2) : 0; // push in at the breaking moment
      ang = 0.1 + ph.p * Math.PI * 0.9; rad = 23 - ph.p * 3 - near * 6; h = 27 - ph.p * 6 - near * 7;
    } else {
      const k = e(ph.p);
      ang = 0.1 + Math.PI * 0.9 + k * 0.3; rad = 20 + k * 3; h = 21 + k * 24; // crane up to reveal the result
    }
    want.set(Math.cos(ang) * rad, h, Math.sin(ang) * rad);
    camera.position.lerp(want, Math.min(1, dt * 1.6));
    target.lerp(centre, Math.min(1, dt * 2));
    camera.lookAt(target);
  });
  return null;
}

export function CityFilm({ scene, play, biome }: { scene: FilmScene; play: React.MutableRefObject<Playhead>; biome?: BiomeKey }) {
  const theme = THEMES[biome && THEMES[biome] ? biome : "monsoon"];
  return (
    <Canvas shadows="soft" camera={{ position: [90, 90, 60], fov: 44, near: 0.5, far: 700 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }}>
      <City theme={theme} />
      <Horizon theme={theme} />
      <Traffic />
      <Pedestrians />
      <Clouds />
      <Birds />
      <FallingLeaves scene={scene} play={play} />
      <Park scene={scene} play={play} theme={theme} />
      <Weather scene={scene} play={play} theme={theme} />
      <CameraRig play={play} breakYear={scene.break_year} />
    </Canvas>
  );
}
