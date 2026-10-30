"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import type { Film } from "@/components/film-player";
import { useRecordMode } from "@/components/record-seed";
import { api } from "@/lib/api";

const FilmPlayer = dynamic(() => import("@/components/film-player").then((m) => m.FilmPlayer), { ssr: false });

/** Lab-style preview for a ready-made city (?city=riyadh|madrid|nairobi|mumbai|phoenix|delhi). Needs a signed-in user. */
const CITIES: Record<string, { title: string; name: string; lat: number; lon: number; cooling: number; survival: number }> = {
  riyadh: { title: "Green a desert city — Riyadh", name: "Riyadh", lat: 24.7136, lon: 46.6753, cooling: 0.7, survival: 0.6 },
  madrid: { title: "Shade a Mediterranean heat island — Madrid", name: "Madrid", lat: 40.4168, lon: -3.7038, cooling: 0.6, survival: 0.7 },
  nairobi: { title: "A city park in the rains — Nairobi", name: "Nairobi", lat: -1.2921, lon: 36.8219, cooling: 0.8, survival: 0.65 },
  mumbai: { title: "Monsoon school yards — Mumbai", name: "Mumbai", lat: 19.076, lon: 72.8777, cooling: 0.6, survival: 0.75 },
  phoenix: { title: "Tree-lined streets in a dry US city — Phoenix", name: "Phoenix", lat: 33.4484, lon: -112.074, cooling: 0.5, survival: 0.55 },
  delhi: { title: "Cool a hot city with trees — New Delhi", name: "New Delhi", lat: 28.6139, lon: 77.209, cooling: 0.5, survival: 0.5 },
};

export default function PreviewFilmPage() {
  const { ready, record, params } = useRecordMode();
  const [film, setFilm] = useState<Film | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const c = CITIES[params.get("city") || "riyadh"] || CITIES.riyadh;
    api<Film>("/scenario/preview", { body: { title: c.title, location_name: c.name, latitude: c.lat, longitude: c.lon,
      objectives: [{ metric: "cooling_c", operator: ">=", threshold: c.cooling }, { metric: "survival_rate", operator: ">=", threshold: c.survival }] } })
      .then((f) => { setFilm(f); (window as unknown as { __biome?: string }).__biome = f.biome?.key; })
      .catch(() => setError("Sign in first (the preview runs the model for your account)."));
  }, [ready, params]);
  if (error) return <div className="py-20 text-center text-white/60">{error}</div>;
  if (!film) return null;
  return <FilmPlayer film={film} record={record} />;
}
