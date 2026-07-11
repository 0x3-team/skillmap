"use client";

import { Check, Info, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { EASE_OUT } from "@/lib/ease";
import { useHydrationSafeReducedMotion } from "@/lib/hooks/use-hydration-safe-reduced-motion";
import { cn } from "@/lib/utils";

export type ToastStatus = "info" | "success" | "error";

export type Toast = {
  id: string;
  title: string;
  description?: string;
  status: ToastStatus;
};

export function useAnimatedToastStack() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      window.setTimeout(() => dismissToast(id), 3600);
      return id;
    },
    [dismissToast]
  );

  return useMemo(
    () => ({ toasts, showToast, dismissToast }),
    [dismissToast, showToast, toasts]
  );
}

const statusClass: Record<ToastStatus, string> = {
  info: "bg-cyan-50 text-cyan-700",
  success: "bg-emerald-50 text-emerald-700",
  error: "bg-rose-50 text-rose-700"
};

export function AnimatedToastStack({
  toasts,
  onDismiss
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  const reduce = useHydrationSafeReducedMotion();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <ol
      aria-live="polite"
      className="fixed bottom-5 right-5 z-[90] flex w-[calc(100vw-2rem)] max-w-sm flex-col-reverse gap-2"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = toast.status === "success" ? Check : toast.status === "error" ? X : Info;
          return (
            <motion.li
              key={toast.id}
              layout={!reduce}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={
                reduce
                  ? { opacity: 0, transition: { duration: 0 } }
                  : {
                      opacity: 0,
                      x: 24,
                      transition: { duration: 0.16, ease: EASE_OUT }
                    }
              }
              transition={reduce ? { duration: 0 } : undefined}
              className="rounded-2xl border border-border bg-card p-3 shadow-2xl"
            >
              <div className="flex gap-3">
                <span
                  className={cn(
                    "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                    statusClass[toast.status]
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{toast.title}</p>
                  {toast.description ? (
                    <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {toast.description}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label="Dismiss toast"
                  onClick={() => onDismiss(toast.id)}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>,
    document.body
  );
}
