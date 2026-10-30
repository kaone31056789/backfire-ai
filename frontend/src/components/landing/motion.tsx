"use client";
import { animate, motion, useInView, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useRef } from "react";

/** Words rise and un-blur one after another. The heading itself (not the clipped
 *  words) is observed, otherwise clipped words never "enter" the viewport. */
export function KineticTitle({ text, className, delay = 0, accent }: { text: string; className?: string; delay?: number; accent?: string[] }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });
  const words = text.split(" ");
  return (
    <h1 ref={ref} className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden pb-[0.12em] align-bottom">
          <motion.span
            aria-hidden
            className={`inline-block ${accent?.includes(w.replace(/[.,]/g, "")) || accent?.includes(w) ? "font-serif font-normal italic text-[#ff7a4d]" : ""}`}
            initial={{ y: "110%", opacity: 0 }}
            animate={inView ? { y: "0%", opacity: 1 } : undefined}
            transition={{ duration: 0.9, delay: delay + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
          >
            {w}&nbsp;
          </motion.span>
        </span>
      ))}
    </h1>
  );
}

/** Fades content up when it scrolls into view. */
export function Reveal({ children, delay = 0, className, y = 28 }: { children: React.ReactNode; delay?: number; className?: string; y?: number }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.25 }} transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}

/** Number that counts up when visible. */
export function Counter({ value, format = (v) => v.toFixed(0), className }: { value: number; format?: (v: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    if (!inView) return;
    const c = animate(mv, value, { duration: 1.8, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [inView, value, mv]);
  return <motion.span ref={ref} className={className}>{text}</motion.span>;
}

/** Infinite horizontal marquee. */
export function Marquee({ items }: { items: string[] }) {
  return (
    <div className="relative flex overflow-hidden py-6 [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
      {[0, 1].map((k) => (
        <motion.div key={k} className="flex shrink-0 items-center gap-12 pr-12" animate={{ x: ["0%", "-100%"] }} transition={{ duration: 38, ease: "linear", repeat: Infinity }}>
          {items.map((t) => (
            <span key={t + k} className="flex items-center gap-12 whitespace-nowrap text-[22px] font-medium tracking-[-0.01em] text-white/45">
              {t} <span className="h-1.5 w-1.5 rounded-full bg-[#ff5b2e]" />
            </span>
          ))}
        </motion.div>
      ))}
    </div>
  );
}
