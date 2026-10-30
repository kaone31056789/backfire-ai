"use client";
import { motion } from "framer-motion";

/** Re-mounted by Next on every navigation: each page glides in over the 3D world.
 *  Only opacity/translate are animated - a CSS filter would turn this wrapper into the
 *  containing block for `position: fixed` children (Mission control, Copilot). */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 220, damping: 28 }}>
      {children}
    </motion.div>
  );
}
