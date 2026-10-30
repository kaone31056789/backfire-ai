/* BACKFIRE map tile cache: cache-first for satellite, terrain and building tiles.
   Tiles are immutable imagery/geometry, so serving them from disk is safe and makes
   revisits and scroll-driven camera moves instant. */
const CACHE = "backfire-tiles-v1";
const MAX_ENTRIES = 4000;
const TILE_HOSTS = ["tiles.maps.eox.at", "tiles.openfreemap.org", "s3.amazonaws.com"];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("backfire-tiles-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

let writes = 0;
async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_ENTRIES) await Promise.all(keys.slice(0, keys.length - MAX_ENTRIES).map((k) => cache.delete(k)));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (!TILE_HOSTS.includes(url.hostname)) return;
  if (url.hostname === "s3.amazonaws.com" && !url.pathname.startsWith("/elevation-tiles-prod/")) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req.url);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && (res.type === "cors" || res.type === "basic")) {
        cache.put(req.url, res.clone());
        if (++writes % 200 === 0) trim(cache);
      }
      return res;
    }),
  );
});
