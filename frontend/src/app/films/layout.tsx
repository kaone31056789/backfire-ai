import Link from "next/link";

import { RecordSeed } from "@/components/record-seed";

/** Standalone film pages. With ?record=1 the page shows only the film, full-screen, for video export. */
export default function FilmsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-white">
      <RecordSeed />
      <div className="films-chrome mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4 text-[14px]">
        <Link href="/" className="font-semibold">BACKFIRE<span className="text-[#ff5b2e]"> AI</span> · Films</Link>
        <nav className="flex gap-4 text-white/60">
          <Link href="/films/engine" className="hover:text-white">Engine</Link>
          <Link href="/films/architecture" className="hover:text-white">Architecture</Link>
          <Link href="/films/simulation" className="hover:text-white">Simulation</Link>
          <Link href="/films/preview?city=riyadh" className="hover:text-white">Previews</Link>
          <Link href="/films/race" className="hover:text-white">Race</Link>
          <Link href="/films/ai" className="hover:text-white">AI</Link>
        </nav>
      </div>
      <div className="mx-auto max-w-[1400px] px-6 pb-16">{children}</div>
    </div>
  );
}
