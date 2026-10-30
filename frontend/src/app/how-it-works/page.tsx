"use client";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Logo } from "@/components/auth-form";
import { AiReel, AiUses } from "@/components/ai-uses";
import { WorkflowMotionSection } from "@/components/workflow-motion";

const STEPS = [
  { emoji: "📜", title: "Read the promise", kid: "Someone says: “Plant these trees and the city gets cooler.” We write down exactly what they promised.", tech: "Claim Extraction Agent: the language model (Ollama / Claude / GPT) or a rule-based reader turns text into measurable targets — e.g. cooling ≥ 0.5 °C, survival ≥ 50 %." },
  { emoji: "🔎", title: "Gather the facts", kid: "We look up how hot and rainy that city really is, and what scientists found about trees and heat.", tech: "Evidence Research Agent: NASA POWER climate for the exact coordinates, OpenAlex papers, Crossref-verified DOIs." },
  { emoji: "🧪", title: "Build a mini-world", kid: "We build a pretend city block on the computer and let 10 years pass: sun, rain, thirsty trees, watering.", tech: "A daily water-balance model (FAO-56): evaporation, soil moisture, drought stress, tree deaths and the cooling that survives." },
  { emoji: "🔨", title: "Try to break it", kid: "Then we play “what if?”: a bit hotter, a bit less water, slightly weaker trees… and find the smallest change that breaks the promise.", tech: "MPFS (our search method) plus three well-known methods race to find the minimum plausible failure. Thousands of futures are simulated." },
  { emoji: "✅", title: "Double-check and fix", kid: "A separate checker repeats the experiment to be sure. Then we try better plans — different trees, smarter watering — and show which ones survive.", tech: "Independent Verification Agent re-computes every result; the Alternatives agent re-tests designs under the same harsh future; a signed certificate is produced." },
];

const QA = [
  {
    q: "Couldn’t ChatGPT just answer this?",
    a: "A chatbot can give an opinion, but it can’t compute what happens to 250 trees per hectare in New Delhi’s real climate over 10 years — and it will happily invent numbers. BACKFIRE runs a physics-based simulation thousands of times, searches systematically for the weakest point, and has a second agent independently re-compute the result. Language models are only allowed to read and write text; every number is computed, and the system rejects any AI sentence containing a number the simulation didn’t produce.",
  },
  {
    q: "Is the simulation real or made up?",
    a: "The building blocks are standard, published science: FAO-56 Penman-Monteith evapotranspiration (the UN’s method for crop water use), WUCOLS landscape water coefficients, real NASA POWER climate for the site, and street-tree survival rates from a peer-reviewed meta-analysis. Where science doesn’t give a number (e.g. exactly how drought raises tree death), we mark it as an uncalibrated assumption — the app shows these in orange, and the results tell you which ones matter most.",
  },
  {
    q: "What is actually new here?",
    a: "Most tools ask “does this plan work on average?”. BACKFIRE asks the opposite: “what is the smallest realistic change that makes it fail?” — a falsification approach. Our search method, MPFS, is designed for exactly that question. We don’t just claim it’s better: the Benchmarks page races it against random search, differential evolution and NSGA-II on problems with known answers. In our tests it hit the true weakest point (within 5 %) in about 88 % of runs versus 33–38 % for the established methods — and the page lets you re-run that race yourself.",
  },
  {
    q: "Why should I trust the numbers?",
    a: "Three reasons. (1) Every counterexample is re-computed from scratch by an independent verification agent that is not allowed to approve its own results. (2) Every run records its random seed, model version and a hash of the full configuration, so anyone can reproduce it. (3) We show uncertainty honestly: e.g. “fails in 60 % of futures (95 % confidence 58–63 %)”, not a single magic number.",
  },
  {
    q: "Isn’t the model too simple for a real city?",
    a: "It’s deliberately transparent rather than a black box, and we say clearly that it’s an exploratory simulation that needs local calibration before real decisions. The point isn’t to predict the exact temperature; it’s to reveal which assumptions a promise depends on, so planners know what to measure and where the plan is fragile.",
  },
  {
    q: "If the simulation finds a failure, is the project bad?",
    a: "No. A failure means: “under these plausible conditions, the promised benefit is not delivered by this model.” That is useful — it tells you what could go wrong and how much margin you have. The Alternatives step then shows designs that survive the same harsh conditions, like a low-water species class or drip irrigation.",
  },
  {
    q: "What happens if the AI hallucinates?",
    a: "It can’t change the results. Claims the AI extracts must be found in the source text or they are discarded; Copilot answers and film narration are checked so every number appears in the computed facts — otherwise the AI’s answer is replaced by a grounded one. Without any AI key, the whole system still works using rule-based readers.",
  },
  {
    q: "Who would use this, and what’s the impact?",
    a: "City governments, climate funds and NGOs deciding which green projects to finance. Tree-planting programmes often fail quietly when trees die of drought. Stress-testing the promise before spending the budget helps money go to plans that will actually keep cities cool.",
  },
  {
    q: "Does it only work for trees?",
    a: "The first case study is urban trees under water stress. The engine — claims → model → minimum-failure search → verification — is general. A new intervention (cool roofs, wetlands, irrigation schemes) needs its own model and parameter registry; the agents, search, verification and reporting stay the same.",
  },
  {
    q: "Is the data and my API key safe?",
    a: "Passwords are hashed with bcrypt, API keys are encrypted in the database and never sent back to the browser, outbound requests are restricted to an allow-list of research APIs, uploaded PDFs are parsed in an isolated process, and every action is audit-logged.",
  },
];

export default function HowItWorks() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="min-h-screen bg-[#05070c] text-white">
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
          <Link href="/" className="flex items-center gap-2.5"><Logo size={28} /><span className="font-semibold">BACKFIRE<span className="text-[#ff5b2e]"> AI</span></span></Link>
          <div className="flex-1" />
          <Link href="/architecture" className="rounded-full px-3 py-2 text-[14px] text-white/70 hover:text-white">3D architecture</Link>
          <Link href="/dashboard" className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[14px] font-semibold text-black"><ArrowLeft className="h-4 w-4" /> Back to the app</Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24">
        <section className="pt-20 text-center">
          <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 200, damping: 14 }} className="text-[64px]">🌍🔨🌳</motion.div>
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mx-auto mt-4 max-w-4xl text-[44px] font-semibold leading-[1.05] tracking-[-0.035em] md:text-[64px]">
            A crash test for <span className="font-serif font-normal italic text-[#ff7a4d]">green promises</span>.
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="mx-auto mt-6 max-w-2xl text-[19px] leading-relaxed text-white/70">
            Car makers crash-test cars before people drive them. BACKFIRE crash-tests climate plans before cities spend money on them:
            it imagines thousands of possible futures and finds the <b className="text-white">smallest realistic change that would make the plan fail</b> — so you can fix it first.
          </motion.p>
        </section>

        <section className="mt-20">
          <h2 className="text-[32px] font-semibold tracking-[-0.03em]">Watch the full workflow</h2>
          <p className="mt-2 max-w-2xl text-[16px] text-white/60">One real investigation through all eight stages, with the actual numbers it produced.</p>
          <div className="mt-6"><WorkflowMotionSection /></div>
        </section>

        <section className="mt-24">
          <h2 className="text-[32px] font-semibold tracking-[-0.03em]">How it works, in 5 steps</h2>
          <div className="mt-8 space-y-4">
            {STEPS.map((s, i) => (
              <motion.div key={s.title} initial={{ opacity: 0, x: i % 2 ? 40 : -40 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: 0.4 }} transition={{ type: "spring", stiffness: 120, damping: 20 }}
                className="grid grid-cols-[72px_1fr] gap-5 rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:grid-cols-[96px_1fr_1fr]">
                <motion.div className="grid h-[72px] w-[72px] place-items-center rounded-3xl bg-white/[0.06] text-[38px] md:h-24 md:w-24 md:text-[48px]" whileHover={{ rotate: [0, -8, 8, 0], scale: 1.08 }}>{s.emoji}</motion.div>
                <div>
                  <div className="text-[13px] font-medium uppercase tracking-[0.16em] text-[#ff7a4d]">Step {i + 1}</div>
                  <div className="mt-1 text-[22px] font-semibold">{s.title}</div>
                  <p className="mt-2 text-[16px] leading-relaxed text-white/75">{s.kid}</p>
                </div>
                <p className="col-span-2 rounded-2xl bg-black/30 p-4 text-[14px] leading-relaxed text-white/55 md:col-span-1">🔬 <b className="text-white/80">Under the hood:</b> {s.tech}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="mt-24">
          <h2 className="text-[32px] font-semibold tracking-[-0.03em]">Where the AI is used</h2>
          <p className="mt-2 max-w-2xl text-[16px] text-white/60">AI reads, writes, searches and coordinates. It never invents a result: every number comes from the simulation. Pick a card to watch it work.</p>
          <div className="mt-6"><AiReel /></div>
          <div className="mt-8"><AiUses /></div>
        </section>

        <section className="mt-24">
          <h2 className="text-[32px] font-semibold tracking-[-0.03em]">Questions judges ask</h2>
          <p className="mt-2 text-[16px] text-white/60">Short, honest answers.</p>
          <div className="mt-8 space-y-2.5">
            {QA.map((item, i) => (
              <div key={item.q} className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
                <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-4 p-5 text-left">
                  <span className="text-[17px] font-semibold">{item.q}</span>
                  <ChevronDown className={`h-5 w-5 shrink-0 text-white/50 transition-transform ${open === i ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence initial={false}>
                  {open === i && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 30 }}>
                      <p className="px-5 pb-5 text-[15.5px] leading-relaxed text-white/70">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
