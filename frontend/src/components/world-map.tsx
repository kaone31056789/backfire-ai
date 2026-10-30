"use client";
import type { GeoJSONSource, Map as MLMap, Marker, Popup } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import { CACHE_OPTIONS, circle, earthStyle, hd720, pulseNode, syncTerrain } from "@/lib/earth";

/** Declarative camera: the map flies to whichever view it is given. */
export type SceneView =
  | { kind: "globe"; lon?: number; lat?: number; zoom?: number }
  | { kind: "site"; lon: number; lat: number; zoom: number; pitch: number; bearing: number; orbit?: boolean };

export interface MapPoint {
  id: string;
  lat: number;
  lon: number;
  title: string;
  subtitle?: string;
  tone: "holds" | "fail" | "signal" | "muted" | "caution";
  href?: string;
  /** 0..1 - column height (e.g. failure risk) */
  weight?: number;
}

const TONE_HEX = { holds: "#3ee6a8", fail: "#ff5b2e", signal: "#4cc9f0", muted: "#9aa3b2", caution: "#f5b84a" };

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function columns(points: MapPoint[], radiusM: number) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((p) => ({
      type: "Feature" as const,
      properties: { id: p.id, color: TONE_HEX[p.tone], h: 120_000 + (p.weight ?? 0.5) * 900_000 },
      geometry: { type: "Polygon" as const, coordinates: [circle(p.lon, p.lat, radiusM)] },
    })),
  };
}

function dots(points: MapPoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((p) => ({ type: "Feature" as const, properties: { id: p.id, color: TONE_HEX[p.tone] }, geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] } })),
  };
}

/** Interactive 3D Earth: satellite globe, terrain, 3D buildings, animated site columns, cinematic fly-to. */
export function WorldMap({ points, height = 420, interactive = true, onPick, picked, autoRotate = true, className, focus, selectedId, onSelect, padding, view, controls = "top-right" }: {
  points: MapPoint[];
  height?: number | string;
  interactive?: boolean;
  onPick?: (lat: number, lon: number) => void;
  picked?: { lat: number; lon: number } | null;
  autoRotate?: boolean;
  className?: string;
  /** fly into this site on load and orbit slowly (cinematic site view) */
  focus?: { lat: number; lon: number } | null;
  /** controlled selection: the camera flies to the selected site and orbits; null returns to orbit view */
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** camera padding so floating panels don't cover the focus */
  padding?: { left?: number; right?: number; top?: number; bottom?: number };
  /** declarative camera view (persistent scene) */
  view?: SceneView;
  controls?: "top-right" | "bottom-right" | "none";
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const popup = useRef<Popup | null>(null);
  const pointsRef = useRef(points);
  const onPickRef = useRef(onPick);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const orbitToken = useRef(0);
  const userActive = useRef(false);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const markers = useRef<Marker[]>([]);
  const [failed, setFailed] = useState(false);
  pointsRef.current = points;
  onPickRef.current = onPick;

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    import("maplibre-gl")
      .then((ml) => {
        // fade in once the first imagery has rendered, so tiles never visibly pop in
        const reveal = () => !disposed && setVisible(true);
        setTimeout(reveal, 2500);
        if (disposed || !el.current) return;
        lib.current = ml;
        const m = new ml.Map({
          container: el.current,
          style: earthStyle({ buildings: true, terrain: true }),
          center: [40, 18],
          zoom: focus ? 1.6 : 1.7,
          pitch: 0,
          interactive,
          attributionControl: { compact: true },
          maxPitch: 80,
          pixelRatio: hd720(el.current),
          ...CACHE_OPTIONS,
        });
        map.current = m;
        m.once("idle", reveal);
        if (interactive && controls !== "none") m.addControl(new ml.NavigationControl({ visualizePitch: true }), controls);
        m.on("error", (e) => {
          // a single failed tile is not fatal; only report if the style itself cannot load
          if (!m.isStyleLoaded() && String(e?.error?.message || "").includes("style")) setFailed(true);
        });
        ["mousedown", "touchstart", "wheel", "dragstart"].forEach((ev) => m.on(ev as "mousedown", () => (userActive.current = true)));
        m.on("load", () => {
          m.addSource("sites", { type: "geojson", data: columns(pointsRef.current, 70_000) });
          m.addSource("site-dots", { type: "geojson", data: dots(pointsRef.current) });
          m.addLayer({ id: "site-dot", type: "circle", source: "site-dots", paint: { "circle-radius": 9, "circle-color": ["get", "color"], "circle-opacity": 0.01 } });
          m.addLayer({ id: "site-columns", type: "fill-extrusion", source: "sites", paint: { "fill-extrusion-color": ["get", "color"], "fill-extrusion-height": 0, "fill-extrusion-opacity": 0.85 } });
          // columns rise via a GPU-side style transition: set once, interpolated by MapLibre
          requestAnimationFrame(() => m.setPaintProperty("site-columns", "fill-extrusion-height", ["get", "h"]));
          syncTerrain(m);
          m.on("zoomend", () => syncTerrain(m));
          setReady(true);
          if (focus) {
            m.flyTo({ center: [focus.lon, focus.lat], zoom: 15, pitch: 68, bearing: -25, duration: 6500, curve: 1.7, essential: true });
            m.once("moveend", () => {
              const orbit = () => {
                if (disposed || userActive.current) return;
                m.easeTo({ bearing: m.getBearing() + 40, duration: 12000, easing: (t) => t });
                m.once("moveend", orbit);
              };
              orbit();
            });
          }

          // globe drifts until the user takes over (camera only, no style work per frame)
          const tick = () => {
            if (disposed) return;
            if (autoRotate && !userActive.current && !onPickRef.current && m.getZoom() < 3.2 && !m.isMoving()) {
              const c = m.getCenter();
              m.setCenter([c.lng + 0.035, c.lat]);
            }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        });
        const open = (e: { features?: { properties: Record<string, unknown> }[]; lngLat: { lng: number; lat: number } }) => {
          const id = e.features?.[0]?.properties?.id as string | undefined;
          const p = pointsRef.current.find((x) => x.id === id);
          if (!p) return;
          if (onSelectRef.current) {
            onSelectRef.current(p.id);
            return;
          }
          userActive.current = true;
          popup.current?.remove();
          popup.current = new ml.Popup({ offset: 14, closeButton: false, maxWidth: "280px" })
            .setLngLat([p.lon, p.lat])
            .setHTML(
              `<div style="font:600 14px var(--font-geist);color:#0b0d11">${esc(p.title)}</div>` +
                (p.subtitle ? `<div style="margin-top:3px;font:12px var(--font-geist);color:#5d6675">${esc(p.subtitle)}</div>` : "") +
                (p.href ? `<a href="${esc(p.href)}" style="display:inline-block;margin-top:8px;font:600 12.5px var(--font-geist);color:#e2461c">Open investigation →</a>` : ""),
            )
            .addTo(m);
          m.flyTo({ center: [p.lon, p.lat], zoom: 14.6, pitch: 66, bearing: -28, duration: 4200, essential: true, curve: 1.6 });
        };
        m.on("click", "site-dot", open);
        m.on("click", "site-columns", open);
        ["site-dot", "site-columns"].forEach((l) => {
          m.on("mouseenter", l, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", l, () => (m.getCanvas().style.cursor = ""));
        });
        m.on("click", (e) => {
          if (!onPickRef.current) return;
          const hit = m.queryRenderedFeatures(e.point, { layers: ["site-dot", "site-columns"] });
          if (!hit.length) onPickRef.current(Number(e.lngLat.lat.toFixed(4)), Number(e.lngLat.lng.toFixed(4)));
        });
      })
      .catch(() => setFailed(true));
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource("sites") as GeoJSONSource | undefined)?.setData(columns(points, 70_000));
    (m.getSource("site-dots") as GeoJSONSource | undefined)?.setData(dots(points));
    const ml = lib.current;
    if (!ml) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = points.map((p) => {
      const node = pulseNode(TONE_HEX[p.tone]);
      node.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (onSelectRef.current) onSelectRef.current(p.id);
        else m.flyTo({ center: [p.lon, p.lat], zoom: 14.6, pitch: 66, bearing: -28, duration: 4200, essential: true });
      });
      return new ml.Marker({ element: node }).setLngLat([p.lon, p.lat]).addTo(m);
    });
  }, [points, ready]);

  // declarative view: fly to the requested camera and (optionally) orbit there
  const viewKey = view ? JSON.stringify(view) : "";
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !view) return;
    const token = ++orbitToken.current;
    const pad = { top: padding?.top ?? 0, bottom: padding?.bottom ?? 0, left: padding?.left ?? 0, right: padding?.right ?? 0 };
    if (view.kind === "site") {
      userActive.current = true;
      m.flyTo({ center: [view.lon, view.lat], zoom: view.zoom, pitch: view.pitch, bearing: view.bearing, duration: 4200, curve: 1.5, padding: pad, essential: true });
      if (view.orbit) {
        m.once("moveend", () => {
          const orbit = () => {
            if (orbitToken.current !== token) return;
            m.easeTo({ bearing: m.getBearing() + 30, duration: 11000, easing: (t) => t, padding: pad });
            m.once("moveend", orbit);
          };
          orbit();
        });
      }
    } else {
      const c = m.getCenter();
      m.flyTo({ center: [view.lon ?? c.lng, view.lat ?? 18], zoom: view.zoom ?? 1.7, pitch: 0, bearing: 0, duration: 3600, padding: pad, essential: true });
      m.once("moveend", () => {
        if (orbitToken.current === token) userActive.current = false;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, ready]);

  // controlled selection: cinematic fly-in + slow orbit, or pull back to the globe
  const hadSelection = useRef(false);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || selectedId === undefined) return;
    const token = ++orbitToken.current;
    const p = points.find((x) => x.id === selectedId);
    if (p) {
      hadSelection.current = true;
      userActive.current = true;
      m.flyTo({ center: [p.lon, p.lat], zoom: 14.8, pitch: 66, bearing: -30, duration: 5200, curve: 1.6, padding: { top: padding?.top ?? 0, bottom: padding?.bottom ?? 0, left: padding?.left ?? 0, right: padding?.right ?? 0 }, essential: true });
      m.once("moveend", () => {
        const orbit = () => {
          if (orbitToken.current !== token) return;
          m.easeTo({ bearing: m.getBearing() + 30, duration: 10000, easing: (t) => t, padding: { top: padding?.top ?? 0, bottom: padding?.bottom ?? 0, left: padding?.left ?? 0, right: padding?.right ?? 0 } });
          m.once("moveend", orbit);
        };
        orbit();
      });
    } else if (hadSelection.current) {
      hadSelection.current = false;
      m.flyTo({ center: [m.getCenter().lng, 18], zoom: 1.7, pitch: 0, bearing: 0, duration: 3800, padding: { top: padding?.top ?? 0, bottom: padding?.bottom ?? 0, left: padding?.left ?? 0, right: padding?.right ?? 0 }, essential: true });
      m.once("moveend", () => (userActive.current = false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !picked) return;
    const src = m.getSource("pick") as GeoJSONSource | undefined;
    const data = { type: "FeatureCollection" as const, features: [{ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [picked.lon, picked.lat] } }] };
    if (src) src.setData(data);
    else {
      m.addSource("pick", { type: "geojson", data });
      m.addLayer({ id: "pick", type: "circle", source: "pick", paint: { "circle-radius": 9, "circle-color": "#ff5b2e", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } });
    }
    m.flyTo({ center: [picked.lon, picked.lat], zoom: Math.max(m.getZoom(), 3.4), duration: 1600 });
  }, [picked, ready]);

  return (
    <div className={className} style={{ height, position: "relative" }}>
      <div className="h-full w-full overflow-hidden rounded-[inherit] bg-[#02040a]">
        <div ref={el} className={`map-fade h-full w-full ${visible ? "is-ready" : ""}`} />
      </div>
      {!visible && !failed && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex items-center gap-2 text-[13px] text-white/60"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff5b2e]" /> Loading Earth…</div>
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-white/70">
          Map tiles could not be loaded. If you use an ad/tracker blocker (e.g. Brave Shields), allow tiles.maps.eox.at, tiles.openfreemap.org and s3.amazonaws.com for this site.
        </div>
      )}
    </div>
  );
}
