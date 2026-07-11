"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useHydrationSafeReducedMotion } from "@/lib/hooks/use-hydration-safe-reduced-motion";
import { cn } from "@/lib/utils";

export type ExpandableActionBarItem = {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
};

export function ExpandableActionBar({
  items,
  className
}: {
  items: ExpandableActionBarItem[];
  className?: string;
}) {
  const reduce = useHydrationSafeReducedMotion();

  return (
    <motion.div
      layout
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-card/95 p-1.5 shadow-2xl backdrop-blur",
        className
      )}
    >
      {items.map((item) => (
        <motion.button
          key={item.id}
          type="button"
          onClick={item.onClick}
          whileTap={reduce ? undefined : { scale: 0.96 }}
          transition={SPRING_LAYOUT}
          className="group inline-flex h-8 min-w-8 items-center justify-center overflow-hidden rounded-full px-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-primary/8 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          title={item.label}
        >
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
            {item.icon}
          </span>
          <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:ml-2 group-hover:max-w-32 group-focus-visible:ml-2 group-focus-visible:max-w-32">
            {item.label}
          </span>
        </motion.button>
      ))}
    </motion.div>
  );
}
