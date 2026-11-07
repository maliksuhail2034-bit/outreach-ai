"use client";

import { useEffect } from "react";

import { staffHeartbeatAction } from "@/app/console/session-actions";

const HEARTBEAT_MS = 2 * 60_000;
const ACTIVE_WINDOW_MS = 5 * 60_000;

// Keeps the staff member's work session open while they're actually using
// the console: every 2 minutes, but only if the tab is visible and there was
// mouse, keyboard, scroll or touch input in the last 5 minutes. A tab left
// open and untouched stops counting (the session closes after 15 idle
// minutes on the server).
export function ConsolePresence() {
  useEffect(() => {
    let lastInput = Date.now();
    const markActive = () => {
      lastInput = Date.now();
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart", "mousemove"] as const;
    for (const event of events) window.addEventListener(event, markActive, { passive: true });

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() - lastInput > ACTIVE_WINDOW_MS) return;
      staffHeartbeatAction().catch(() => undefined);
    }, HEARTBEAT_MS);

    return () => {
      window.clearInterval(timer);
      for (const event of events) window.removeEventListener(event, markActive);
    };
  }, []);

  return null;
}
