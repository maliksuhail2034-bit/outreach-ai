"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

// Some pages chain many sections at increasing delays (e.g. one detail page
// stacks ~20 sections at +0.05s each, reaching 1.3s for the last one) — a
// multi-second wait before below-the-fold content even starts to appear.
// Capping here (U4) shortens that tail for every FadeIn call site at once
// without touching each page's own delay math.
const MAX_STAGGER_DELAY = 0.3;

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(delay, MAX_STAGGER_DELAY), ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
