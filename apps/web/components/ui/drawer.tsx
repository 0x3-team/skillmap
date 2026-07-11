"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SPRING_PANEL } from "@/lib/ease";
import { Button } from "@/components/ui/button";
import { useHydrationSafeReducedMotion } from "@/lib/hooks/use-hydration-safe-reduced-motion";
import { cn } from "@/lib/utils";

export function Drawer({
  open,
  onOpenChange,
  title,
  children,
  side = "right",
  className
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  side?: "right" | "left";
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const reduce = useHydrationSafeReducedMotion();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (!mounted || !open) return;

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = rootRef.current;
    if (!root) return;
    const background = Array.from(document.body.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== root && !element.contains(root)
    );
    const previousInert = background.map((element) => ({ element, inert: element.inert }));
    for (const element of background) element.inert = true;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onOpenChangeRef.current(false);
        return;
      }

      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");

      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    const frame = requestAnimationFrame(() => (closeRef.current ?? panelRef.current)?.focus());

    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
      for (const { element, inert } of previousInert) element.inert = inert;
      const opener = openerRef.current;
      if (opener?.isConnected) requestAnimationFrame(() => opener.focus());
    };
  }, [mounted, open]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div ref={rootRef} className="fixed inset-0 z-50">
          <motion.button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-0 bg-slate-950/20 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduce ? { duration: 0 } : undefined}
            onClick={() => onOpenChange(false)}
          />
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { x: side === "right" ? "100%" : "-100%" }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: side === "right" ? "100%" : "-100%" }}
            transition={reduce ? { duration: 0 } : SPRING_PANEL}
            className={cn(
              "absolute top-0 h-full w-full max-w-md overflow-y-auto border-border bg-card p-5 shadow-2xl",
              side === "right" ? "right-0 border-l" : "left-0 border-r",
              className
            )}
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 id={titleId} className="text-lg font-semibold text-foreground">
                {title}
              </h2>
              <Button
                ref={closeRef}
                type="button"
                variant="ghost"
                className="h-9 w-9 px-0"
                aria-label="Close drawer"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {children}
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
