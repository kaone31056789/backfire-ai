"use client";
import { AlertTriangle, Inbox, RotateCcw, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import * as React from "react";

import { cn } from "@/lib/format";
import { Button } from "./button";

/* ------------------------------------------------------------------ panels */
export function Panel({ className, ticks = false, ...p }: React.HTMLAttributes<HTMLDivElement> & { ticks?: boolean }) {
  return <div className={cn("frame", ticks && "frame-ticks", className)} {...p} />;
}

export function PanelHeader({ code, title, children, className }: { code?: string; title: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-line/80 px-5 py-3.5", className)}>
      <div className="flex items-center gap-2.5 min-w-0">
        <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
        {code && <span className="rounded-md bg-raise px-1.5 py-0.5 font-mono text-[11px] text-ink-4">{code}</span>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ page header */
export function PageHeader({ section, title, lede, actions }: { section: string; title: React.ReactNode; lede?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-5 pb-8 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-line-2 bg-panel/80 py-1 pl-2 pr-3 text-[12.5px] font-medium text-ink-2">
          <span className="h-1.5 w-1.5 rounded-full bg-holds shadow-[0_0_8px_var(--color-holds)]" />
          {section.replace(/^§\S+\s*·\s*/, "")}
        </div>
        <h1 className="font-display text-[32px] leading-[1.1] text-ink md:text-[40px]">{title}</h1>
        {lede && <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-ink-3">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ------------------------------------------------------------------ badge */
const TONES = {
  neutral: "text-ink-2 border-line-2 bg-raise/50",
  holds: "text-holds border-holds/30 bg-holds/8",
  fail: "text-fail border-fail/30 bg-fail/8",
  signal: "text-signal border-signal/30 bg-signal/8",
  caution: "text-caution border-caution/30 bg-caution/8",
  violet: "text-violet border-violet/30 bg-violet/8",
  muted: "text-ink-3 border-line bg-transparent",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", className, children, dot }: { tone?: Tone; className?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium first-letter:uppercase", TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ form controls */
export const Label = ({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn("mb-1.5 block text-[13px] font-medium text-ink-2", className)} {...p} />
);

const fieldCls =
  "w-full rounded-[var(--radius-sm)] border border-line-2 bg-abyss px-3 text-[14px] text-ink placeholder:text-ink-4 transition-[border-color,box-shadow] hover:border-ink-4/60 focus:border-holds/60 focus:outline-none focus:ring-4 focus:ring-holds/10 disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(fieldCls, "h-10", className)} {...p} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(fieldCls, "py-2.5 leading-relaxed min-h-28", className)} {...p} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn(fieldCls, "h-10 pr-8 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%226%22><path d=%22M0 0l5 6 5-6z%22 fill=%22%236b7a94%22/></svg>')] bg-no-repeat bg-[right_10px_center]", className)} {...p}>
    {children}
  </select>
));
Select.displayName = "Select";

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-40",
        checked ? "border-holds/50 bg-holds/30" : "border-line-2 bg-abyss",
      )}
    >
      <span className={cn("block h-3.5 w-3.5 rounded-full shadow transition-transform duration-200", checked ? "translate-x-[18px] bg-holds" : "translate-x-[2px] bg-ink-3")} />
    </button>
  );
}

/* ------------------------------------------------------------------ tabs */
export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("inline-flex items-center gap-0.5 rounded-[10px] border border-line bg-abyss p-1", className)}>
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            "relative h-7 rounded-[7px] px-3 text-[13px] font-medium transition-colors",
            value === it.value ? "text-ink" : "text-ink-3 hover:text-ink-2",
          )}
        >
          {value === it.value && <motion.span layoutId={`tab-${items.map((i) => i.value).join()}`} className="absolute inset-0 rounded-[7px] border border-line-2 bg-raise shadow-sm" transition={{ duration: 0.2 }} />}
          <span className="relative">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ dialog */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  React.useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-void/75 p-4 pt-[10vh] backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cn("frame frame-ticks w-full shadow-2xl shadow-black/60", wide ? "max-w-3xl" : "max-w-lg")}
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.7, 0.1, 1] }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
              <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ states */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("relative overflow-hidden rounded-[var(--radius-sm)] bg-raise/60", className)}><div className="absolute inset-0 scan opacity-40" /></div>;
}

export function LoadingBlock({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2.5 p-4", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn("h-4", i % 3 === 2 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, body, action }: { icon?: React.ElementType; title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="relative mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-line-2 bg-gradient-to-b from-raise to-panel shadow-[0_0_40px_-10px_var(--color-holds)]">
        <Icon className="h-6 w-6 text-holds" strokeWidth={1.6} />
      </div>
      <div className="text-[18px] font-semibold tracking-[-0.01em] text-ink">{title}</div>
      {body && <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-3">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-[var(--radius-md)] border border-fail/30 bg-fail/6 text-[13px]", compact ? "p-3" : "p-4 m-4")}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-fail" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-fail">Request failed</div>
        <div className="mt-0.5 text-ink-2 break-words">{msg}</div>
      </div>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          <RotateCcw className="h-3.5 w-3.5" /> Retry
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = "caution", children, className }: { tone?: "caution" | "signal" | "fail" | "holds"; children: React.ReactNode; className?: string }) {
  const map = { caution: "border-caution/25 bg-caution/6 text-caution", signal: "border-signal/25 bg-signal/6 text-signal", fail: "border-fail/25 bg-fail/6 text-fail", holds: "border-holds/25 bg-holds/6 text-holds" };
  return <div className={cn("rounded-[var(--radius-md)] border px-4 py-3 text-[13.5px] leading-relaxed [&_b]:font-semibold", map[tone], className)}>{children}</div>;
}

/* ------------------------------------------------------------------ data readouts */
export function Readout({ label, value, unit, tone, sub, className }: { label: string; value: React.ReactNode; unit?: string; tone?: "holds" | "fail" | "signal" | "caution"; sub?: React.ReactNode; className?: string }) {
  const color = tone === "holds" ? "text-holds" : tone === "fail" ? "text-fail" : tone === "signal" ? "text-signal" : tone === "caution" ? "text-caution" : "text-ink";
  return (
    <div className={cn("min-w-0", className)}>
      <div className="truncate text-[13px] text-ink-3">{label}</div>
      <div className={cn("mt-1.5 flex items-baseline gap-1 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular", color)}>
        <span className="truncate">{value}</span>
        {unit && <span className="text-[13px] font-normal text-ink-3">{unit}</span>}
      </div>
      {sub && <div className="mt-2 truncate text-[12.5px] text-ink-4">{sub}</div>}
    </div>
  );
}

export function Meter({ value, max = 1, tone = "signal", className }: { value: number; max?: number; tone?: "signal" | "holds" | "fail" | "caution"; className?: string }) {
  const w = Math.max(0, Math.min(1, value / max)) * 100;
  const c = { signal: "bg-signal", holds: "bg-holds", fail: "bg-fail", caution: "bg-caution" }[tone];
  return (
    <div className={cn("h-1.5 w-full rounded-full bg-line", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", c)} style={{ width: `${w}%` }} />
    </div>
  );
}

export function KV({ k, v, mono = true }: { k: React.ReactNode; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-1.5 last:border-0">
      <dt className="text-[13.5px] text-ink-3">{k}</dt>
      <dd className={cn("text-right text-[13.5px] text-ink-2", mono && "font-mono tabular")}>{v}</dd>
    </div>
  );
}

export function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 w-max max-w-64 -translate-x-1/2 rounded-[3px] border border-line-2 bg-panel-2 px-2 py-1 text-[11.5px] leading-snug text-ink-2 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {text}
      </span>
    </span>
  );
}
