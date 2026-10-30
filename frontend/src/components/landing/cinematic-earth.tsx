"use client";
import type { Map as MLMap } from "maplibre-gl";
import { useEffect, useRef } from "react";

import { CACHE_OPTIONS, circle, earthStyle, ease, hd720, lerp, prewarmTiles, pulseNode, syncTerrain } from "@/lib/earth";

export interface CameraKey {
  lon: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

/** Full-viewport satellite Earth whose camera is driven by a 0..(keys-1) scroll progress value. */
export function CinematicEarth({ keys, progressRef, site }: { keys: CameraKey[]; progressRef: React.MutableRefObject<number>; site: { lon: number; lat: number } }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    import("maplibre-gl").then((ml) => {
      if (disposed || !el.current) return;
      const k0 = keys[0];
      const m = new ml.Map({
        container: el.current,
        style: earthStyle({ buildings: true, terrain: true }),
        center: [k0.lon, k0.lat],
        zoom: k0.zoom,
        pitch: k0.pitch,
        bearing: k0.bearing,
        interactive: false,
        attributionControl: { compact: true },
        maxPitch: 80,
        fadeDuration: 0,
        pixelRatio: hd720(el.current),
        ...CACHE_OPTIONS,
      });
      map.current = m;
      m.on("load", () => {
        m.addSource("site-ring", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circle(site.lon, site.lat, 650)] } } });
        m.addLayer({ id: "site-zone", type: "fill-extrusion", source: "site-ring", paint: { "fill-extrusion-color": "#ff5b2e", "fill-extrusion-height": 0, "fill-extrusion-opacity": 0.22 } });
        m.addLayer({ id: "site-ring", type: "line", source: "site-ring", paint: { "line-color": "#ff5b2e", "line-width": 2.5, "line-opacity": 0 } });
        new ml.Marker({ element: pulseNode("#ff5b2e", 11) }).setLngLat([site.lon, site.lat]).addTo(m);
        loaded = true;
        // warm the cache along the whole camera path, so scrolling never waits on the network
        const src = m.getSource("osm") as unknown as { tiles?: string[] } | undefined;
        const warm = () => prewarmTiles(keys, src?.tiles?.[0]);
        if ("requestIdleCallback" in window) (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(warm);
        else setTimeout(warm, 1500);
      });
      m.once("idle", () => el.current?.classList.add("is-ready"));
      setTimeout(() => el.current?.classList.add("is-ready"), 2500);

      let spin = 0;
      let loaded = false;
      let lastNear = -1;
      let lastTerrainCheck = 0;
      const frame = (now: number) => {
        if (disposed) return;
        const p = Math.max(0, Math.min(keys.length - 1, progressRef.current));
        const i = Math.min(keys.length - 2, Math.floor(p));
        const f = ease(p - i);
        const a = keys[i], b = keys[i + 1];
        // idle drift of the globe in the opening shot, fading out as the story starts
        spin += 0.02 * Math.max(0, 1 - p * 1.5);
        m.jumpTo({
          center: [lerp(a.lon, b.lon, f) + (i === 0 ? spin * (1 - f) : 0), lerp(a.lat, b.lat, f)],
          zoom: lerp(a.zoom, b.zoom, f),
          pitch: lerp(a.pitch, b.pitch, f),
          bearing: lerp(a.bearing, b.bearing, f),
        });
        if (loaded) {
          // style work only when the value actually changes; terrain checked a few times a second
          const near = Math.round(Math.max(0, Math.min(1, (p - 2.2) / 0.8)) * 20) / 20;
          if (near !== lastNear) {
            lastNear = near;
            m.setPaintProperty("site-ring", "line-opacity", near);
            m.setPaintProperty("site-zone", "fill-extrusion-height", near * 220);
          }
          if (now - lastTerrainCheck > 300) {
            lastTerrainCheck = now;
            syncTerrain(m);
          }
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      map.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // MapLibre forces position:relative on its container, so the sized wrapper is separate
  return (
    <div className="absolute inset-0">
      <div ref={el} className="map-fade h-full w-full" />
    </div>
  );
}
