"use client";
import { useEffect } from "react";

/** Page-level error boundary: keeps the 3D world and navigation alive if one page fails. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const skew = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module/i.test(error.message);
  useEffect(() => {
    if (!skew) return;
    try {
      const key = "bf-auto-reload";
      if (Date.now() - Number(sessionStorage.getItem(key) || 0) > 30_000) {
        sessionStorage.setItem(key, String(Date.now()));
        window.location.reload();
      }
    } catch {
      /* ignore */
    }
  }, [skew]);

  return (
    <div className="hud mx-auto mt-10 max-w-lg rounded-3xl p-8 text-center">
      <div className="text-[40px]">{skew ? "🔄" : "😕"}</div>
      <h2 className="mt-2 text-[22px] font-semibold text-white">{skew ? "A new version is available" : "This page hit a problem"}</h2>
      <p className="mt-2 text-[14.5px] text-white/60">{skew ? "Reloading to the latest version…" : error.message}</p>
      <div className="mt-5 flex justify-center gap-2">
        <button onClick={() => window.location.reload()} className="rounded-full bg-white px-5 py-2.5 text-[14px] font-semibold text-black">Reload</button>
        {!skew && <button onClick={reset} className="rounded-full border border-white/20 px-5 py-2.5 text-[14px] text-white">Try again</button>}
      </div>
    </div>
  );
}
