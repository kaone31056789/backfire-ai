"use client";
import { createContext, useContext } from "react";

import type { Investigation } from "@/lib/types";

export interface InvCtx {
  inv: Investigation;
  reload: () => void;
  /** Bumps whenever a workflow finishes, so pages can refetch their data. */
  version: number;
  start: (kind: "analyse" | "run-backfire") => Promise<void>;
  busy: string | null;
}

export const InvestigationContext = createContext<InvCtx | null>(null);

export function useInvestigation(): InvCtx {
  const c = useContext(InvestigationContext);
  if (!c) throw new Error("useInvestigation must be used inside an investigation layout");
  return c;
}
