"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import type { Film } from "@/components/film-player";
import { useRecordMode } from "@/components/record-seed";
import { api } from "@/lib/api";

const FilmPlayer = dynamic(() => import("@/components/film-player").then((m) => m.FilmPlayer), { ssr: false });

/** The demo investigation's film: as planned → the breaking change → a safer design. */
export default function SimulationFilmPage() {
  const { ready, record, params } = useRecordMode();
  const [film, setFilm] = useState<Film | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const id = params.get("id");
    api<Film>(id ? `/investigations/${id}/film` : "/public/film").then(setFilm).catch(() => setError(true));
  }, [ready, params]);
  if (error) return <div className="py-20 text-center text-white/60">No film available yet.</div>;
  if (!film) return null;
  return <FilmPlayer film={film} record={record} />;
}
