"use client";
import { TourPlayer } from "@/components/architecture-tour";
import { useRecordMode } from "@/components/record-seed";

export default function ArchitectureFilmPage() {
  const { ready, record } = useRecordMode();
  if (!ready) return null;
  return <TourPlayer record={record} />;
}
