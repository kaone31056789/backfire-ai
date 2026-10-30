import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="text-center">
        <div className="font-mono text-2xs uppercase tracking-[0.3em] text-ink-4">Error 404</div>
        <h1 className="mt-3 font-display text-5xl">No such page</h1>
        <p className="mt-3 text-ink-3">The resource does not exist or you do not have access to it.</p>
        <Link href="/dashboard" className="mt-6 inline-block text-signal hover:underline">Return to the dashboard</Link>
      </div>
    </div>
  );
}
