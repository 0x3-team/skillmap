"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

/**
 * Keeps the server and first client render identical, then adopts the user's
 * motion preference after hydration. CSS already suppresses first-frame motion.
 */
export function useHydrationSafeReducedMotion() {
  const prefersReducedMotion = useReducedMotion();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setHydrated(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return hydrated && Boolean(prefersReducedMotion);
}
