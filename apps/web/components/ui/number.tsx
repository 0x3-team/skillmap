"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import { useHydrationSafeReducedMotion } from "@/lib/hooks/use-hydration-safe-reduced-motion";

export function AnimatedNumber({
  value,
  suffix = "",
  prefix = "",
  decimals = 0,
  className
}: {
  value: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
  className?: string;
}) {
  const reduce = useHydrationSafeReducedMotion();
  const motionValue = useMotionValue(value);
  const finalValue = `${prefix}${value.toFixed(decimals)}${suffix}`;
  const rounded = useTransform(motionValue, (latest) => {
    const fixed = latest.toFixed(decimals);
    return `${prefix}${fixed}${suffix}`;
  });

  useEffect(() => {
    if (reduce) {
      motionValue.set(value);
      return;
    }

    const controls = animate(motionValue, value, {
      duration: 0.8,
      ease: [0.16, 1, 0.3, 1]
    });
    return () => controls.stop();
  }, [motionValue, reduce, value]);

  return (
    <span className={className}>
      <motion.span aria-hidden="true">{rounded}</motion.span>
      <span className="sr-only">{finalValue}</span>
    </span>
  );
}
