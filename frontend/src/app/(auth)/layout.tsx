import { Crosshair, Microscope, ShieldCheck } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden"><div className="aurora" /></div>
      <div className="pointer-events-none absolute inset-0 lab-grid" />
      <div className="relative mx-auto grid min-h-screen max-w-6xl grid-cols-1 items-center gap-14 px-6 py-12 lg:grid-cols-[1.15fr_1fr]">
        <section className="hidden lg:block">
          <div className="inline-flex items-center gap-2 rounded-full border border-line-2 bg-panel/70 py-1 pl-2 pr-3 text-[13px] text-ink-2 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-holds shadow-[0_0_8px_var(--color-holds)]" /> Adversarial climate intervention falsification
          </div>
          <h1 className="mt-6 text-[54px] font-semibold leading-[1.02] tracking-[-0.035em] text-ink">
            Find the smallest plausible change that <em>breaks a climate promise.</em>
          </h1>
          <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-ink-3">
            Instead of asking whether an intervention will work, BACKFIRE searches documented scientific bounds for the
            minimum perturbation that falsifies its claimed benefit — then an independent agent tries to reproduce it.
          </p>
          <BoundaryIllustration />
          <ul className="mt-8 grid max-w-lg grid-cols-3 gap-3">
            {[
              [Microscope, "Evidence-grounded", "OpenAlex, Crossref, NASA POWER"],
              [Crosshair, "MPFS search", "benchmarked vs DE & NSGA-II"],
              [ShieldCheck, "Verified", "independent re-evaluation"],
            ].map(([Icon, t, s]) => {
              const I = Icon as typeof Microscope;
              return (
                <li key={t as string} className="rounded-[var(--radius-md)] border border-line bg-panel/60 p-3.5 backdrop-blur">
                  <I className="h-4 w-4 text-holds" />
                  <div className="mt-2 text-[13.5px] font-medium text-ink">{t as string}</div>
                  <div className="mt-0.5 text-[12.5px] leading-snug text-ink-4">{s as string}</div>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="w-full max-w-md justify-self-center lg:justify-self-end">{children}</section>
      </div>
    </div>
  );
}

/** Decorative schematic of a success region, its boundary and a minimum-distance counterexample. */
function BoundaryIllustration() {
  return (
    <figure className="mt-9 max-w-lg rounded-[var(--radius-lg)] border border-line bg-panel/50 p-4 backdrop-blur">
      <svg viewBox="0 0 480 170" className="w-full" aria-hidden>
        <defs>
          <linearGradient id="succ" x1="0" x2="1">
            <stop offset="0" stopColor="#3ee6a8" stopOpacity="0.22" />
            <stop offset="1" stopColor="#4cc9f0" stopOpacity="0.08" />
          </linearGradient>
          <pattern id="dots" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="#2a2f3a" /></pattern>
        </defs>
        <rect width="480" height="170" fill="url(#dots)" />
        <path d="M0,170 L0,40 C80,30 140,90 210,70 C290,48 330,120 480,95 L480,170 Z" fill="url(#succ)" />
        <path d="M0,40 C80,30 140,90 210,70 C290,48 330,120 480,95" fill="none" stroke="#eef1f5" strokeWidth="1.4" strokeDasharray="4 4" opacity="0.7" />
        <circle cx="150" cy="128" r="5" fill="#0b0d11" stroke="#b4bcc8" strokeWidth="1.5" />
        <text x="160" y="146" fill="#8590a0" fontSize="11" fontFamily="var(--font-geist)">nominal scenario</text>
        <line x1="150" y1="128" x2="186" y2="76" stroke="#ff7a8a" strokeWidth="1.6" />
        <circle cx="186" cy="76" r="5" fill="#ff7a8a" />
        <text x="196" y="62" fill="#ff7a8a" fontSize="11" fontFamily="var(--font-geist)">minimum plausible failure</text>
        <text x="16" y="160" fill="#3ee6a8" fontSize="11" fontFamily="var(--font-geist)">claim holds (B ≥ 0)</text>
        <text x="330" y="40" fill="#8590a0" fontSize="11" fontFamily="var(--font-geist)">claim fails (B &lt; 0)</text>
      </svg>
      <figcaption className="mt-2 text-[12px] text-ink-4">Schematic illustration — not data.</figcaption>
    </figure>
  );
}
