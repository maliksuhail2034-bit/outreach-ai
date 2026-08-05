"use client";

import type { ComponentProps } from "react";
import { MotionConfig } from "framer-motion";

// Wraps the app in framer-motion's own reduced-motion handling (U2) —
// "user" mode reads prefers-reduced-motion and suppresses transform-driven
// motion (slide/scale) app-wide for every existing motion.* usage, while
// still allowing simple opacity fades, so every FadeIn/animation in the app
// respects the OS preference without each one needing its own check.
export function MotionProvider({ children, ...props }: ComponentProps<typeof MotionConfig>) {
  return <MotionConfig {...props}>{children}</MotionConfig>;
}
