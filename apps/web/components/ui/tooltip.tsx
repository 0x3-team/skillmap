"use client";

import { Info } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import {
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from "react";
import { EASE_OUT } from "@/lib/ease";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { useHydrationSafeReducedMotion } from "@/lib/hooks/use-hydration-safe-reduced-motion";
import { cn } from "@/lib/utils";

type Side = "top" | "right" | "bottom" | "left";

const wrapperClasses: Record<Side, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2"
};

const transformOrigin: Record<Side, string> = {
  top: "center bottom",
  bottom: "center top",
  left: "right center",
  right: "left center"
};

const offsetFrom: Record<Side, { x?: number; y?: number }> = {
  top: { y: 10 },
  bottom: { y: -10 },
  left: { x: 10 },
  right: { x: -10 }
};

function buildVariants(side: Side): Variants {
  const offset = offsetFrom[side];
  return {
    initial: {
      opacity: 0,
      scale: 0.86,
      filter: "blur(10px)",
      x: offset.x ?? 0,
      y: offset.y ?? 0
    },
    animate: {
      opacity: 1,
      scale: 1,
      filter: "blur(0px)",
      x: 0,
      y: 0,
      transition: {
        type: "spring",
        stiffness: 380,
        damping: 30,
        mass: 0.7,
        opacity: { duration: 0.22, ease: EASE_OUT },
        filter: { duration: 0.3, ease: EASE_OUT }
      }
    },
    exit: {
      opacity: 0,
      scale: 0.92,
      filter: "blur(6px)",
      x: (offset.x ?? 0) * 0.6,
      y: (offset.y ?? 0) * 0.6,
      transition: { duration: 0.14, ease: EASE_OUT }
    }
  };
}

export function Tooltip({
  label,
  content,
  children,
  side = "top",
  delay = 120,
  className,
  wrapperClassName
}: {
  label?: ReactNode;
  content?: ReactNode;
  children?: ReactElement;
  side?: Side;
  delay?: number;
  className?: string;
  wrapperClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const reduce = useHydrationSafeReducedMotion();
  const canHover = useHoverCapable();
  const resolvedContent = content ?? label;

  const showNow = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOpen(true);
  };

  const showOnHover = () => {
    if (!canHover) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOpen(false);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const fallback = (
    <button
      type="button"
      aria-label={typeof resolvedContent === "string" ? resolvedContent : "More information"}
      aria-describedby={id}
      aria-expanded={canHover ? undefined : open}
      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Info className="h-3.5 w-3.5" />
    </button>
  );

  const child = children ?? fallback;
  if (!isValidElement(child) || !resolvedContent) return child;

  const variants = reduce
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: 0.14, ease: EASE_OUT } },
        exit: { opacity: 0, transition: { duration: 0.1, ease: EASE_OUT } }
      }
    : buildVariants(side);

  return (
    <span
      ref={wrapperRef}
      className={cn("relative inline-flex align-middle", wrapperClassName)}
      aria-describedby={children ? id : undefined}
      onBlur={hide}
      onClick={(event) => {
        if (!event.defaultPrevented && !canHover) showNow();
      }}
      onFocus={showNow}
      onKeyDown={(event) => {
        if (event.key === "Escape") hide();
      }}
      onMouseEnter={showOnHover}
      onMouseLeave={() => {
        if (!wrapperRef.current?.contains(document.activeElement)) hide();
      }}
    >
      {child}
      <AnimatePresence mode="wait">
        {open ? (
          <span className={cn("pointer-events-none absolute z-50", wrapperClasses[side])}>
            <motion.span
              id={id}
              role="tooltip"
              variants={variants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ transformOrigin: transformOrigin[side] }}
              className={cn(
                "block max-w-[18rem] whitespace-normal rounded-lg border border-border bg-popover/95 px-3 py-2 text-xs font-medium leading-5 text-popover-foreground shadow-2xl backdrop-blur-xl",
                className
              )}
            >
              {resolvedContent}
            </motion.span>
          </span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
