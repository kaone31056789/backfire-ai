"use client";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { cn } from "@/lib/format";

interface Answer { answer: string; mode: "llm" | "grounded"; model: string; used_facts: string[]; note: string | null }
interface Msg { role: "user" | "ai"; text: string; meta?: Answer }

const SUGGESTIONS = ["Why does this promise break?", "Which assumption matters most?", "What should we change?", "How reliable is this?", "What evidence did you use?"];

/** Floating AI Copilot: answers questions about one investigation from its computed facts. */
export function Copilot({ invId, title }: { invId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setQ("");
    setBusy(true);
    try {
      // never leave the user on "Thinking…": give up after 70 s with a clear message
      const a = await Promise.race([
        api<Answer>(`/investigations/${invId}/assistant`, { body: { question } }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("The AI took too long to answer. Please ask again — the grounded engine will reply if the model is still busy.")), 70_000)),
      ]);
      setMsgs((m) => [...m, { role: "ai", text: a.answer, meta: a }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "ai", text: e instanceof Error ? e.message : "Something went wrong." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <motion.button
        onClick={() => setOpen(true)}
        className="pe-auto fixed bottom-6 right-6 z-50 flex h-14 items-center gap-2.5 rounded-full bg-gradient-to-r from-[#ff5b2e] to-[#ff8a5b] pl-4 pr-5 text-[15px] font-semibold text-white shadow-[0_12px_40px_-8px_rgba(255,91,46,0.7)]"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.4 }}
        aria-label="Ask the AI copilot"
      >
        <Sparkles className="h-5 w-5" /> Ask AI
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div className="pe-auto fixed inset-0 z-[60] bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.aside
              className="hud pe-auto fixed bottom-4 right-4 top-4 z-[61] flex w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[28px]"
              initial={{ x: 480, opacity: 0.6 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 480, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
            >
              <div className="flex items-center gap-3 border-b border-white/10 p-5">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-[#ff5b2e] to-[#ff9a6b]"><Sparkles className="h-5 w-5 text-white" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[16px] font-semibold text-white">BACKFIRE Copilot</div>
                  <div className="truncate text-[12.5px] text-white/50">Answers from {title}&apos;s computed results</div>
                </div>
                <button onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white/70 hover:bg-white/20" aria-label="Close"><X className="h-4 w-4" /></button>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                {msgs.length === 0 && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <p className="text-[14.5px] leading-relaxed text-white/70">Ask me anything about this investigation. I only use numbers the simulation actually computed — I won&apos;t make anything up.</p>
                    <div className="mt-4 flex flex-col gap-2">
                      {SUGGESTIONS.map((s, i) => (
                        <motion.button key={s} onClick={() => ask(s)} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.05 }} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-left text-[14px] text-white/85 hover:bg-white/[0.09]">{s}</motion.button>
                      ))}
                    </div>
                  </motion.div>
                )}
                {msgs.map((m, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 26 }} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[88%] rounded-3xl px-4 py-3 text-[14.5px] leading-relaxed", m.role === "user" ? "rounded-br-lg bg-white text-black" : "rounded-bl-lg bg-white/[0.08] text-white")}>
                      {m.text}
                      {m.meta && (
                        <div className="mt-2 border-t border-white/10 pt-2 text-[11.5px] text-white/45">
                          {m.meta.mode === "llm" ? `✨ ${m.meta.model}` : "Grounded engine (connect Ollama in Settings for AI wording)"} · facts: {m.meta.used_facts.join(", ") || "—"}
                          {m.meta.note && <div className="mt-1 text-[#f5b84a]">{m.meta.note}</div>}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
                {busy && <div className="flex items-center gap-2 text-[13px] text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Thinking with the real numbers…</div>}
                <div ref={end} />
              </div>

              <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex items-center gap-2 border-t border-white/10 p-4">
                <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={600} placeholder="Ask a question…" className="h-12 flex-1 rounded-full border border-white/10 bg-black/30 px-5 text-[14.5px] text-white placeholder:text-white/35 focus:border-[#ff5b2e]/60 focus:outline-none" />
                <button type="submit" disabled={!q.trim() || busy} className="grid h-12 w-12 place-items-center rounded-full bg-[#ff5b2e] text-white disabled:opacity-40" aria-label="Send"><ArrowUp className="h-5 w-5" /></button>
              </form>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
