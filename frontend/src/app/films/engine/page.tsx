"use client";
import { EngineFilmSection } from "@/components/engine-film-section";
import { useRecordMode } from "@/components/record-seed";

export default function EngineFilmPage() {
  const { ready, record } = useRecordMode();
  if (!ready) return null;
  return <EngineFilmSection record={record} />;
}
