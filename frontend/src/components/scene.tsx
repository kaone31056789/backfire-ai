"use client";
/**
 * The persistent 3D world behind the whole app.
 *
 * One MapLibre Earth is created once in the app layout and never unmounted, so moving
 * between pages never reloads the map: the camera simply flies to the view each route
 * asks for. Pages can override the view (Mission control selection), register a
 * click-to-pick handler (Intervention lab) and set how strongly the world is dimmed
 * behind their content.
 */
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { WorldMap, type MapPoint, type SceneView } from "@/components/world-map";
import { useApi } from "@/lib/hooks";
import type { InvestigationSummary } from "@/lib/types";

interface SceneCtx {
  investigations: InvestigationSummary[];
  /** temporarily take control of the camera (null = route default) */
  setOverride: (v: SceneView | null) => void;
  setSelectHandler: (fn: ((id: string | null) => void) | null) => void;
  setPickHandler: (fn: ((lat: number, lon: number) => void) | null) => void;
  setPicked: (p: { lat: number; lon: number } | null) => void;
  setDimOverride: (d: number | null) => void;
  refresh: () => void;
}

const Ctx = createContext<SceneCtx | null>(null);
export const useScene = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useScene must be used inside SceneProvider");
  return c;
};

/** Camera angle per investigation section — every page is a different shot of the same city. */
const SECTION_SHOTS: Record<string, { zoom: number; pitch: number; bearing: number; orbit?: boolean } | "globe"> = {
  overview: { zoom: 15, pitch: 66, bearing: -25, orbit: true },
  film: { zoom: 15.2, pitch: 70, bearing: 10, orbit: true },
  claims: { zoom: 12.6, pitch: 48, bearing: 25, orbit: true },
  causal: { zoom: 11, pitch: 38, bearing: -60, orbit: true },
  engine: { zoom: 14.6, pitch: 72, bearing: 60, orbit: true },
  boundary: { zoom: 16, pitch: 76, bearing: 120, orbit: true },
  alternatives: { zoom: 13.6, pitch: 56, bearing: -120, orbit: true },
  evidence: "globe",
  certificate: { zoom: 11.8, pitch: 0, bearing: 0 },
};
const SECTION_DIM: Record<string, number> = { film: 0.85, overview: 0.1, claims: 0.5, causal: 0.55, engine: 0.5, boundary: 0.45, alternatives: 0.5, evidence: 0.5, certificate: 0.6 };

const TONE = (i: InvestigationSummary): MapPoint["tone"] =>
  i.status === "completed" ? (i.mpfs_min_distance !== null ? "fail" : "holds") : i.status === "failed" ? "caution" : "signal";

export function SceneProvider({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const invs = useApi<InvestigationSummary[]>("/investigations?limit=100", [path.split("/")[1], path.split("/")[2]]);
  const [override, setOverride] = useState<SceneView | null>(null);
  const [dimOverride, setDimOverride] = useState<number | null>(null);
  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(null);
  const [pickOn, setPickOn] = useState(false);
  const selectRef = useRef<((id: string | null) => void) | null>(null);
  const pickRef = useRef<((lat: number, lon: number) => void) | null>(null);
  const list = useMemo(() => invs.data || [], [invs.data]);

  const points: MapPoint[] = useMemo(
    () =>
      list.map((i) => ({
        id: i.id,
        lat: i.latitude,
        lon: i.longitude,
        title: i.title,
        subtitle: [i.location_name, i.status].filter(Boolean).join(" · "),
        tone: TONE(i),
        href: `/investigations/${i.id}/overview`,
        weight: i.mpfs_min_distance !== null ? Math.max(0.15, 1 - Math.min(1, i.mpfs_min_distance)) : 0.2,
      })),
    [list],
  );

  // ------------------------------------------------------------------ camera director
  const seg = path.split("/");
  let routeView: SceneView = { kind: "globe" };
  let routeDim = 0.5;
  if (seg[1] === "investigations" && seg[2]) {
    const inv = list.find((i) => i.id === seg[2]);
    const shot = SECTION_SHOTS[seg[3] || "overview"] ?? SECTION_SHOTS.overview;
    routeDim = SECTION_DIM[seg[3] || "overview"] ?? 0.5;
    if (inv) routeView = shot === "globe" ? { kind: "globe", lon: inv.longitude, lat: inv.latitude, zoom: 2.6 } : { kind: "site", lon: inv.longitude, lat: inv.latitude, ...shot };
  } else if (seg[1] === "dashboard") {
    routeDim = 0;
  } else if (seg[1] === "lab") {
    routeDim = 0.35;
  } else {
    routeDim = 0.6;
  }
  const view = override ?? routeView;
  const dim = dimOverride ?? routeDim;

  const setSelectHandler = useCallback((fn: ((id: string | null) => void) | null) => (selectRef.current = fn), []);
  const setPickHandler = useCallback((fn: ((lat: number, lon: number) => void) | null) => {
    pickRef.current = fn;
    setPickOn(!!fn);
  }, []);
  // overrides belong to the page that set them: clear them when the route changes
  useEffect(() => {
    setOverride(null);
    setDimOverride(null);
  }, [path]);

  const ctx: SceneCtx = useMemo(
    () => ({ investigations: list, setOverride, setSelectHandler, setPickHandler, setPicked, setDimOverride, refresh: () => invs.reload(true) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, setSelectHandler, setPickHandler],
  );

  return (
    <Ctx.Provider value={ctx}>
      <div className="fixed inset-0 z-0">
        <WorldMap
          points={points}
          height="100%"
          view={view}
          controls="bottom-right"
          padding={{ left: 290 }}
          onSelect={(id) => (selectRef.current ? selectRef.current(id) : id && router.push(`/investigations/${id}/overview`))}
          onPick={pickOn ? (lat, lon) => pickRef.current?.(lat, lon) : undefined}
          picked={picked}
          className="absolute inset-0"
        />
        {/* readability veil: strength depends on the page */}
        <div className="pointer-events-none absolute inset-0 bg-[#02040a] transition-opacity duration-1000" style={{ opacity: dim }} />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.6)_100%)]" />
      </div>
      {children}
    </Ctx.Provider>
  );
}
