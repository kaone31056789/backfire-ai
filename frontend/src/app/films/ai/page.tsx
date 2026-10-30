"use client";
import { AiReel } from "@/components/ai-uses";
import { useRecordMode } from "@/components/record-seed";

export default function AiFilmPage() {
  const { ready, record } = useRecordMode();
  if (!ready) return null;
  return <AiReel record={record} />;
}
