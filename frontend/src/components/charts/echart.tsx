"use client";
import dynamic from "next/dynamic";
import type { EChartsOption } from "echarts";

import { Skeleton } from "@/components/ui/primitives";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });

export const C = {
  ink: "#e6edf7",
  ink2: "#a9b6cc",
  ink3: "#6b7a94",
  ink4: "#44516a",
  line: "#18243a",
  line2: "#223150",
  panel: "#0a101c",
  holds: "#34d399",
  signal: "#22d3ee",
  fail: "#fb7185",
  caution: "#fbbf24",
  violet: "#a5b4fc",
};

const mono = "IBM Plex Mono, ui-monospace, monospace";

export const axisBase = {
  axisLine: { lineStyle: { color: C.line2 } },
  axisTick: { lineStyle: { color: C.line2 } },
  axisLabel: { color: C.ink3, fontFamily: mono, fontSize: 10.5 },
  splitLine: { lineStyle: { color: C.line, type: [2, 3] as number[] } },
  nameTextStyle: { color: C.ink3, fontSize: 11, fontFamily: "var(--font-hanken), sans-serif" },
};

export const tooltipBase = {
  backgroundColor: "#0d1524",
  borderColor: C.line2,
  borderWidth: 1,
  textStyle: { color: C.ink, fontSize: 12, fontFamily: mono },
  extraCssText: "border-radius:4px;box-shadow:0 10px 30px rgba(0,0,0,.5)",
};

export function EChart({ option, height = 280, className, onEvents }: { option: EChartsOption; height?: number | string; className?: string; onEvents?: Record<string, (p: unknown) => void> }) {
  return (
    <div className={className} style={{ height }}>
      <ReactECharts
        option={{ backgroundColor: "transparent", animationDuration: 500, textStyle: { fontFamily: mono }, ...option }}
        style={{ height: "100%", width: "100%" }}
        notMerge
        lazyUpdate
        opts={{ renderer: "canvas" }}
        onEvents={onEvents}
      />
    </div>
  );
}
