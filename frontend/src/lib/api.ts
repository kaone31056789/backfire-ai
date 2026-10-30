/** Same-origin API client. Auth lives in httpOnly cookies set by the backend; the
 *  X-Requested-With header is the CSRF guard the backend requires for cookie auth. */

export class ApiError extends Error {
  constructor(public status: number, message: string, public errors?: { field: string; message: string }[]) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "X-Requested-With": "backfire", "Content-Type": "application/json" },
      body: "{}",
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => setTimeout(() => (refreshing = null), 0));
  }
  return refreshing;
}

type Opts = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal; raw?: boolean };

export async function api<T = unknown>(path: string, opts: Opts = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "backfire" };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api${path}`, {
    method: opts.method || (body ? "POST" : "GET"),
    credentials: "include",
    headers,
    body,
    signal: opts.signal,
  });
  if (res.status === 401 && !retried && !path.startsWith("/auth/")) {
    if (await refresh()) return api<T>(path, opts, true);
    if (typeof window !== "undefined" && !location.pathname.startsWith("/login") && !location.pathname.startsWith("/register")) {
      location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    }
  }
  if (!res.ok) {
    let msg = res.statusText || "Request failed";
    let errors;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : msg;
      errors = j.errors;
      if (errors?.length) msg = `${msg}: ${errors.map((e: { field: string; message: string }) => `${e.field} — ${e.message}`).join("; ")}`;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg, errors);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function wsUrl(path: string): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  if (explicit) return explicit.replace(/\/$/, "") + path;
  const { protocol, hostname, host, port } = window.location;
  const scheme = protocol === "https:" ? "wss" : "ws";
  // Dev: Next on :3000 does not proxy WebSockets - talk to the API port directly.
  if (port === "3000") return `${scheme}://${hostname}:8000${path}`;
  return `${scheme}://${host}${path}`;
}

export async function download(path: string, filename: string) {
  const res = await api<Response>(path, { raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
