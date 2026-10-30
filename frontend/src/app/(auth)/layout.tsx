"use client";
import { motion } from "framer-motion";
import { Crosshair, Microscope, ShieldCheck } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";

import { Logo } from "@/components/auth-form";

const WorldMap = dynamic(() => import("@/components/world-map").then((m) => m.WorldMap), { ssr: false });

const ease = [0.22, 1, 0.36, 1] as const;

/** Sign-in / register: the same satellite globe, palette and HUD cards as the rest of the site. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05070c] text-white">
      {/* the live globe, slowly turning behind everything */}
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <WorldMap points={[]} height="100%" interactive={false} autoRotate controls="none" />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_70%_50%,transparent_0%,rgba(5,7,12,0.55)_45%,#05070c_85%)]" />
      <div className="pointer-events-none absolute -left-40 top-1/3 h-[520px] w-[520px] rounded-full bg-[#ff5b2e]/10 blur-[120px]" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 pt-7">
        <Link href="/" className="flex items-center gap-2.5"><Logo size={30} /><span className="text-[16px] font-semibold">BACKFIRE<span className="text-[#ff5b2e]"> AI</span></span></Link>
        <nav className="flex items-center gap-1 text-[14px] text-white/60">
          <Link href="/how-it-works" className="rounded-full px-3 py-1.5 hover:text-white">How it works</Link>
          <Link href="/architecture" className="hidden rounded-full px-3 py-1.5 hover:text-white sm:block">Architecture</Link>
        </nav>
      </header>

      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-80px)] max-w-6xl grid-cols-1 items-center gap-14 px-6 py-10 lg:grid-cols-[1.1fr_1fr]">
        <section className="hidden lg:block">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }} className="text-[13px] font-medium uppercase tracking-[0.2em] text-[#ff7a4d]">
            Climate promises, crash-tested
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.08, ease }} className="mt-5 text-[58px] font-semibold leading-[1.02] tracking-[-0.035em]">
            Every climate promise has a <span className="font-serif font-normal italic text-[#ff5b2e]">breaking point.</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.25 }} className="mt-6 max-w-lg text-[17px] leading-relaxed text-white/65">
            BACKFIRE simulates ten years of a city&apos;s real climate and searches thousands of futures for the smallest realistic change that breaks the promise — then an independent agent re-checks it.
          </motion.p>
          <ul className="mt-10 grid max-w-xl grid-cols-3 gap-3">
            {([
              [Microscope, "Real evidence", "NASA climate, peer-reviewed papers, verified DOIs"],
              [Crosshair, "Breaking-point search", "MPFS raced against classic methods"],
              [ShieldCheck, "Independently verified", "every result re-computed from scratch"],
            ] as const).map(([Icon, t, s], i) => (
              <motion.li key={t} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.35 + i * 0.08, ease }} className="hud rounded-2xl p-4">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#ff5b2e]/12 ring-1 ring-[#ff5b2e]/30"><Icon className="h-4.5 w-4.5 text-[#ff7a4d]" /></span>
                <div className="mt-3 text-[14px] font-semibold">{t}</div>
                <div className="mt-1 text-[12.5px] leading-snug text-white/50">{s}</div>
              </motion.li>
            ))}
          </ul>
        </section>
        <motion.section initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.7, delay: 0.1, ease }} className="w-full max-w-md justify-self-center lg:justify-self-end">
          {children}
        </motion.section>
      </div>
    </div>
  );
}
