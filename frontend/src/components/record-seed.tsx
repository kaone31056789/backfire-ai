"use client";
/**
 * Recording mode (?record=1). Evaluated when this module loads, before any film renders:
 * Math.random becomes a seeded generator so every particle layout is identical on every run,
 * and the page is marked so the site chrome can hide itself.
 */
import { useEffect, useState } from "react";

if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("record") === "1") {
  let seed = 1234567;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  document.documentElement.dataset.record = "1";
}

export function RecordSeed() {
  return null;
}

/** Reads the query once on the client: { ready, record, params }. */
export function useRecordMode() {
  const [state, setState] = useState<{ ready: boolean; record: boolean; params: URLSearchParams }>({ ready: false, record: false, params: new URLSearchParams() });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setState({ ready: true, record: params.get("record") === "1", params });
  }, []);
  return state;
}
