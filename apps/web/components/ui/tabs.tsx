"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useHydrationSafeReducedMotion } from "@/lib/hooks/use-hydration-safe-reduced-motion";
import { cn } from "@/lib/utils";

export interface TabItem {
  id: string;
  label: ReactNode;
  count?: number;
}

export function Tabs({
  items,
  value,
  onChange,
  className,
  idPrefix = "tabs",
  ariaLabel = "Sections"
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  idPrefix?: string;
  ariaLabel?: string;
}) {
  const reduce = useHydrationSafeReducedMotion();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const domId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "-");
  const moveFocus = (index: number) => {
    if (items.length === 0) return;
    const nextIndex = (index + items.length) % items.length;
    const next = items[nextIndex];
    onChange(next.id);
    const button = tabRefs.current[nextIndex];
    button?.focus();
    button?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      className={cn(
        "flex w-full min-w-0 max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1",
        className
      )}
    >
      {items.map((item, index) => {
        const active = item.id === value;
        const itemId = domId(item.id);
        return (
          <button
            key={item.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            id={`${idPrefix}-tab-${itemId}`}
            role="tab"
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${itemId}`}
            tabIndex={active ? 0 : -1}
            type="button"
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                moveFocus(index + 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                moveFocus(index - 1);
              } else if (event.key === "Home") {
                event.preventDefault();
                moveFocus(0);
              } else if (event.key === "End") {
                event.preventDefault();
                moveFocus(items.length - 1);
              }
            }}
            className={cn(
              "relative isolate flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {active ? (
              <motion.span
                layoutId={`${idPrefix}-active`}
                className="absolute inset-0 -z-10 rounded-lg bg-primary/[0.08]"
                transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
              />
            ) : null}
            <span>{item.label}</span>
            {item.count !== undefined ? (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none">
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
