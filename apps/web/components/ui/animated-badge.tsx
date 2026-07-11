"use client";

import {
  AlertTriangle,
  Check,
  Circle,
  Info,
  LoaderCircle,
  X,
  type LucideIcon
} from "lucide-react";
import {
  AnimatePresence,
  motion,
  type HTMLMotionProps
} from "motion/react";
import type { ReactNode } from "react";
import { EASE_OUT } from "@/lib/ease";
import { useHydrationSafeReducedMotion } from "@/lib/hooks/use-hydration-safe-reduced-motion";
import { cn } from "@/lib/utils";

export type AnimatedBadgeStatus =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "loading";
export type AnimatedBadgeSize = "sm" | "md";

export interface AnimatedBadgeProps
  extends Omit<HTMLMotionProps<"span">, "children"> {
  status?: AnimatedBadgeStatus;
  tone?: AnimatedBadgeStatus;
  size?: AnimatedBadgeSize;
  children?: ReactNode;
  icon?: ReactNode;
  showIcon?: boolean;
  pulse?: boolean;
  contentKey?: string | number;
}

const statusClass: Record<AnimatedBadgeStatus, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-primary/30 bg-primary/10 text-primary",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  loading: "border-primary/30 bg-primary/10 text-primary"
};

const sizeClass: Record<AnimatedBadgeSize, string> = {
  sm: "h-6 gap-1.5 px-2 text-[11px]",
  md: "h-8 gap-2 px-3 text-xs"
};

const iconClass: Record<AnimatedBadgeSize, string> = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5"
};

const icons: Record<AnimatedBadgeStatus, LucideIcon> = {
  neutral: Circle,
  info: Info,
  success: Check,
  warning: AlertTriangle,
  danger: X,
  loading: LoaderCircle
};

export function AnimatedBadge({
  children,
  tone,
  status,
  size = "sm",
  icon,
  showIcon = true,
  pulse,
  contentKey,
  className,
  ...rest
}: AnimatedBadgeProps) {
  const reduce = useHydrationSafeReducedMotion();
  const resolvedStatus = status ?? tone ?? "neutral";
  const Icon = icons[resolvedStatus];
  const key =
    contentKey ??
    (typeof children === "string" || typeof children === "number"
      ? children
      : resolvedStatus);
  const shouldPulse = pulse ?? resolvedStatus === "loading";

  return (
    <motion.span
      layout={!reduce}
      transition={
        reduce
          ? { duration: 0 }
          : { type: "spring", stiffness: 420, damping: 30, mass: 0.7 }
      }
      className={cn(
        "relative inline-flex max-w-full shrink-0 items-center overflow-hidden whitespace-nowrap rounded-full border font-semibold leading-none tabular-nums transition-colors",
        statusClass[resolvedStatus],
        sizeClass[size],
        className
      )}
      {...rest}
    >
      {shouldPulse && !reduce ? (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-current opacity-10"
          animate={{ scale: [0.96, 1.08, 0.96], opacity: [0.08, 0.14, 0.08] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : null}
      {showIcon ? (
        <span className="relative z-10 inline-flex shrink-0 overflow-hidden">
          <AnimatePresence mode={reduce ? "sync" : "popLayout"} initial={false}>
            <motion.span
              key={resolvedStatus}
              initial={reduce ? false : { opacity: 0, y: 8, filter: "blur(6px)" }}
              animate={
                reduce
                  ? { opacity: 1 }
                  : { opacity: 1, y: 0, filter: "blur(0px)" }
              }
              exit={
                reduce
                  ? { opacity: 0 }
                  : { opacity: 0, y: -8, filter: "blur(6px)" }
              }
              transition={reduce ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT }}
              className="inline-flex"
            >
              {resolvedStatus === "loading" && !reduce && !icon ? (
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="inline-flex"
                >
                  <Icon className={iconClass[size]} />
                </motion.span>
              ) : (
                (icon ?? <Icon className={iconClass[size]} />)
              )}
            </motion.span>
          </AnimatePresence>
        </span>
      ) : null}
      {children != null ? (
        <span className="relative z-10 inline-flex min-w-0 overflow-hidden">
          <AnimatePresence mode={reduce ? "sync" : "popLayout"} initial={false}>
            <motion.span
              key={key}
              initial={reduce ? false : { opacity: 0, y: 8, filter: "blur(6px)" }}
              animate={
                reduce
                  ? { opacity: 1 }
                  : { opacity: 1, y: 0, filter: "blur(0px)" }
              }
              exit={
                reduce
                  ? { opacity: 0 }
                  : { opacity: 0, y: -8, filter: "blur(6px)" }
              }
              transition={reduce ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT }}
              className="truncate"
            >
              {children}
            </motion.span>
          </AnimatePresence>
        </span>
      ) : null}
    </motion.span>
  );
}
