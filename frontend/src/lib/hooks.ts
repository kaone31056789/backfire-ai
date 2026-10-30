"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, wsUrl } from "./api";
import type { AgentEvent } from "./types";

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const ctrl = useRef<AbortController | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!path) return;
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const d = await api<T>(path, { signal: c.signal });
        if (!c.signal.aborted) setData(d);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) setError(e);
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, ...deps],
  );

  useEffect(() => {
    load();
    return () => ctrl.current?.abort();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

/** Live agent events: WebSocket with ticket auth, falling back to polling. */
export function useInvestigationEvents(invId: string, enabled = true) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [mode, setMode] = useState<"connecting" | "live" | "polling" | "idle">("connecting");
  const last = useRef(0);

  const merge = useCallback((incoming: AgentEvent[]) => {
    if (!incoming.length) return;
    setEvents((prev) => {
      const seen = new Set(prev.map((e) => e.seq));
      const add = incoming.filter((e) => !seen.has(e.seq));
      if (!add.length) return prev;
      const next = [...prev, ...add].sort((a, b) => a.seq - b.seq);
      last.current = next[next.length - 1].seq;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const startPolling = () => {
      if (poll || closed) return;
      setMode("polling");
      const tick = () => api<AgentEvent[]>(`/investigations/${invId}/events?after=${last.current}`).then(merge).catch(() => {});
      tick();
      poll = setInterval(tick, 1500);
    };

    (async () => {
      try {
        const initial = await api<AgentEvent[]>(`/investigations/${invId}/events?after=0&limit=2000`);
        merge(initial);
        const { ticket } = await api<{ ticket: string }>("/ws-ticket", { body: { investigation_id: invId } });
        if (closed) return;
        ws = new WebSocket(wsUrl(`/api/ws/investigations/${invId}?ticket=${encodeURIComponent(ticket)}&after=${last.current}`));
        const fallback = setTimeout(() => ws?.readyState !== WebSocket.OPEN && startPolling(), 3000);
        ws.onopen = () => {
          clearTimeout(fallback);
          setMode("live");
        };
        ws.onmessage = (m) => merge([JSON.parse(m.data)]);
        ws.onerror = () => startPolling();
        ws.onclose = () => !closed && startPolling();
      } catch {
        startPolling();
      }
    })();
    return () => {
      closed = true;
      ws?.close();
      if (poll) clearInterval(poll);
      setMode("idle");
    };
  }, [invId, enabled, merge]);

  return { events, mode };
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
