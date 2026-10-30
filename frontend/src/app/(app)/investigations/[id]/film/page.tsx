"use client";
import { useInvestigation } from "@/components/investigation-context";
import { FilmPlayer, type Film } from "@/components/film-player";
import { ErrorState, LoadingBlock, Panel } from "@/components/ui/primitives";
import { useApi } from "@/lib/hooks";

export default function FilmPage() {
  const { inv } = useInvestigation();
  const { data, error, loading, reload } = useApi<Film>(`/investigations/${inv.id}/film`);

  if (loading && !data) return <Panel><LoadingBlock rows={6} /></Panel>;
  if (error) return <ErrorState error={error} onRetry={() => reload()} />;
  if (!data) return null;
  if (data.scenes.length < 2)
    return <Panel className="p-10 text-center text-[15px] text-white/70">Run BACKFIRE first — the film needs the computed breaking scenario to tell its story.</Panel>;
  return <FilmPlayer film={data} />;
}
