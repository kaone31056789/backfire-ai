import type { StyleSpecification } from "maplibre-gl";

/** Real-Earth 3D style: Sentinel-2 cloudless satellite mosaic, Mapzen/AWS terrain,
 *  OpenFreeMap (OpenStreetMap) 3D buildings, globe projection and atmosphere. */
export const ATTRIBUTION =
  '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by EOX (Copernicus Sentinel data 2016) · ' +
  'Terrain: Mapzen/AWS Open Data · Buildings: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export function earthStyle({ buildings = true, terrain = true }: { buildings?: boolean; terrain?: boolean } = {}): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    projection: { type: "globe" },
    transition: { duration: 1600, delay: 0 },
    sky: {
      "sky-color": "#04060b",
      "horizon-color": "#1d3b5a",
      "fog-color": "#0b1424",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.4,
      "fog-ground-blend": 0.6,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 6, 0.7, 10, 0],
    },
    sources: {
      satellite: {
        type: "raster",
        tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"],
        tileSize: 256,
        maxzoom: 15,
        attribution: ATTRIBUTION,
      },
      ...(terrain
        ? {
            dem: {
              type: "raster-dem",
              tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
              encoding: "terrarium",
              tileSize: 256,
              maxzoom: 14,
            },
          }
        : {}),
      ...(buildings ? { osm: { type: "vector", url: "https://tiles.openfreemap.org/planet" } } : {}),
    },
    layers: [
      { id: "space", type: "background", paint: { "background-color": "#02040a" } },
      { id: "satellite", type: "raster", source: "satellite", paint: { "raster-saturation": -0.15, "raster-contrast": 0.08, "raster-brightness-max": 0.92 } },
      ...(buildings
        ? [
            {
              id: "buildings-3d",
              type: "fill-extrusion" as const,
              source: "osm",
              "source-layer": "building",
              minzoom: 14,
              paint: {
                "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 6], 0, "#d8d2c4", 30, "#efe9dc", 120, "#ffffff"],
                "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, ["coalesce", ["get", "render_height"], 6]],
                "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
                "fill-extrusion-opacity": 0.82,
              },
            },
          ]
        : []),
    ] as StyleSpecification["layers"],
  };
  // terrain is switched on only near city zoom (see syncTerrain): at globe scale it is invisible but costly
  return style;
}

/** A circle polygon (GeoJSON ring) of `radiusM` metres around lon/lat - used for 3D site columns and rings. */
export function circle(lon: number, lat: number, radiusM: number, steps = 48): [number, number][] {
  const out: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return out;
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Pixel ratio that renders the map at (at most) 720p: 1280x720 drawing buffer. */
export function hd720(el: HTMLElement): number {
  const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
  return Math.max(0.5, Math.min(window.devicePixelRatio || 1, 1280 / w, 720 / h));
}

/** Enable 3D terrain only when it is visible (zoom >= 9); avoids downloading DEM tiles at globe scale. */
export function syncTerrain(m: import("maplibre-gl").Map) {
  if (!m.getSource("dem")) return;
  const z = m.getZoom();
  const want = z >= 9 && z <= 13.5; // terrain matters for hills at regional zoom; at street level buildings dominate
  const has = !!m.getTerrain();
  if (want && !has) m.setTerrain({ source: "dem", exaggeration: 1.3 });
  else if (!want && has) m.setTerrain(null);
}

/** Map pulse markers are plain DOM nodes animated by CSS (no per-frame style updates). */
export function pulseNode(color: string, size = 12): HTMLDivElement {
  const n = document.createElement("div");
  n.className = "bf-pulse";
  n.style.setProperty("--c", color);
  n.style.setProperty("--s", `${size}px`);
  return n;
}

/** Map options that keep tiles around: big in-memory cache, and in-flight requests are NOT
 *  cancelled during camera moves (scroll-driven flights would otherwise re-request tiles). */
export const CACHE_OPTIONS = {
  maxTileCacheSize: 3000,
  maxTileCacheZoomLevels: 6,
  refreshExpiredTiles: false,
  cancelPendingTileRequestsWhileZooming: false,
} as const;

function tileXY(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

/** Fetch the tiles along a camera path in the background so the service worker caches them
 *  before the user scrolls there. Low priority, a few requests at a time. */
export async function prewarmTiles(path: { lon: number; lat: number; zoom: number }[], vectorTemplate?: string) {
  const urls = new Set<string>();
  for (const k of path) {
    const z = Math.max(1, Math.round(k.zoom));
    const r = z >= 13 ? 2 : 1;
    const [cx, cy] = tileXY(k.lon, k.lat, z);
    const n = 2 ** z;
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++) {
        const x = (cx + dx + n) % n, y = Math.min(n - 1, Math.max(0, cy + dy));
        const zs = Math.min(z, 15);
        urls.add(`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${zs}/${y >> (z - zs)}/${x >> (z - zs)}.jpg`);
        if (z >= 9) {
          const zd = Math.min(z, 14);
          urls.add(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zd}/${x >> (z - zd)}/${y >> (z - zd)}.png`);
        }
        if (z >= 13 && vectorTemplate) {
          const zv = Math.min(z, 14);
          urls.add(vectorTemplate.replace("{z}", String(zv)).replace("{x}", String(x >> (z - zv))).replace("{y}", String(y >> (z - zv))));
        }
      }
  }
  const list = [...urls];
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const u = list[i++];
      try {
        await fetch(u, { mode: "cors", priority: "low" } as RequestInit);
      } catch {
        /* offline or blocked: the map will simply fetch on demand */
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}
