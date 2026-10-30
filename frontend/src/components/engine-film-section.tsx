"use client";
/**
 * "How the engine calculates" — now the motion-graphics workflow film (the earlier 3D station film
 * was retired). Kept as a thin wrapper so existing pages (/architecture, /films/engine) need no change.
 */
import { WorkflowMotionSection } from "@/components/workflow-motion";

export function EngineFilmSection({ record = false }: { record?: boolean }) {
  return <WorkflowMotionSection record={record} />;
}
