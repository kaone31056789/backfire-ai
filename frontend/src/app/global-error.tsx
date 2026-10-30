"use client";
import { useEffect } from "react";

/**
 * Last-resort error boundary. The most common cause in practice is version skew: the
 * server was rebuilt while a tab still runs the previous build, so freshly loaded code
 * chunks don't match. Reloading once picks up the new build; a guard prevents loops.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const skew = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module/i.test(error.message);
  useEffect(() => {
    if (!skew) return; // a real bug: show it instead of hiding it behind a reload
    try {
      const key = "bf-auto-reload";
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last > 30_000) {
        sessionStorage.setItem(key, String(Date.now()));
        window.location.reload();
      }
    } catch {
      /* storage blocked: fall back to the manual button */
    }
  }, [error, skew]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#05070c", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 44 }}>🔄</div>
          <h1 style={{ fontSize: 24, margin: "12px 0 6px" }}>{skew ? "BACKFIRE was updated" : "Something went wrong"}</h1>
          <p style={{ color: "rgba(255,255,255,.6)", margin: "0 0 18px" }}>{skew ? "Reloading to the latest version…" : error.message}</p>
          <button onClick={() => window.location.reload()} style={{ background: "#fff", color: "#000", border: 0, borderRadius: 999, padding: "10px 20px", fontWeight: 600, cursor: "pointer" }}>Reload now</button>
          <button onClick={reset} style={{ marginLeft: 8, background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.25)", borderRadius: 999, padding: "10px 20px", cursor: "pointer" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
