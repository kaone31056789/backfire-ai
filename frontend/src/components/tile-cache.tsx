"use client";
import { useEffect } from "react";

/** Registers the map-tile service worker (persistent, cache-first tile storage). */
export function TileCache() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/tile-sw.js", { scope: "/" }).catch(() => {});
    }
  }, []);
  return null;
}
