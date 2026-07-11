"use client";

import { Check, Loader2, X } from "lucide-react";
import {
  AnimatePresence,
  motion,
  type HTMLMotionProps
} from "motion/react";
import { forwardRef, type PointerEvent, type ReactNode, useRef, useState } from "react";
import { EASE_OUT, SPRING_PRESS } from "@/lib/ease";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { useHydrationSafeReducedMotion } from "@/lib/hooks/use-hydration-safe-reduced-motion";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  rightIcon?: ReactNode;
  pressScale?: number;
  ripple?: boolean;
  children?: ReactNode;
}

type Ripple = { id: number; x: number; y: number; size: number };

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "border-primary bg-primary text-primary-foreground shadow-lift hover:bg-primary/90",
  secondary:
    "border-border bg-card text-foreground shadow-sm hover:border-primary/35 hover:bg-accent/70",
  ghost:
    "border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
  outline:
    "border-border bg-transparent text-foreground hover:border-primary/35 hover:bg-accent/70",
  danger:
    "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15"
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-full px-3 text-xs",
  md: "h-10 gap-2 rounded-full px-4 text-sm",
  lg: "h-12 gap-2 rounded-full px-5 text-base",
  icon: "h-9 w-9 rounded-lg px-0"
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = "primary",
    size = "md",
    icon,
    rightIcon,
    pressScale = 0.94,
    ripple = false,
    children,
    onPointerDown,
    ...props
  },
  ref
) {
  const reduce = useHydrationSafeReducedMotion();
  const canHover = useHoverCapable();
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextId = useRef(0);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (ripple && !reduce) {
      const rect = event.currentTarget.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2;
      setRipples((current) => [
        ...current,
        {
          id: nextId.current++,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          size
        }
      ]);
    }
    onPointerDown?.(event);
  };

  return (
    <motion.button
      ref={ref}
      type="button"
      whileTap={reduce || props.disabled ? undefined : { scale: pressScale }}
      whileHover={reduce || !canHover || props.disabled ? undefined : { scale: 1.015 }}
      transition={SPRING_PRESS}
      onPointerDown={handlePointerDown}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden border font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-55",
        variantClass[variant],
        sizeClass[size],
        className
      )}
      {...props}
    >
      {ripple && !reduce ? (
        <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
          <AnimatePresence>
            {ripples.map((rippleItem) => (
              <motion.span
                key={rippleItem.id}
                className="absolute rounded-full bg-current"
                style={{
                  left: rippleItem.x,
                  top: rippleItem.y,
                  width: rippleItem.size,
                  height: rippleItem.size,
                  x: "-50%",
                  y: "-50%"
                }}
                initial={{ scale: 0, opacity: 0.22 }}
                animate={{ scale: 1, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.1, ease: EASE_OUT }}
                onAnimationComplete={() =>
                  setRipples((current) =>
                    current.filter((item) => item.id !== rippleItem.id)
                  )
                }
              />
            ))}
          </AnimatePresence>
        </span>
      ) : null}
      {icon ? <span className="relative z-10 inline-flex shrink-0">{icon}</span> : null}
      {children ? <span className="relative z-10 truncate">{children}</span> : null}
      {rightIcon ? (
        <span className="relative z-10 inline-flex shrink-0">{rightIcon}</span>
      ) : null}
    </motion.button>
  );
});

export type ButtonState = "idle" | "loading" | "success" | "error";

export interface StatefulButtonProps extends ButtonProps {
  state?: ButtonState;
  loadingLabel?: ReactNode;
  successLabel?: string;
  errorLabel?: string;
}

export function StatefulButton({
  state = "idle",
  loadingLabel = "Working",
  successLabel = "Done",
  errorLabel = "Failed",
  children,
  icon,
  disabled,
  ...props
}: StatefulButtonProps) {
  const label =
    state === "loading"
      ? loadingLabel
      : state === "success"
        ? successLabel
        : state === "error"
          ? errorLabel
          : children;
  const stateIcon =
    state === "loading" ? (
      <Loader2 className="h-4 w-4 animate-spin" />
    ) : state === "success" ? (
      <Check className="h-4 w-4" />
    ) : state === "error" ? (
      <X className="h-4 w-4" />
    ) : (
      icon
    );

  return (
    <Button
      icon={stateIcon}
      disabled={disabled || state === "loading"}
      {...props}
    >
      {label}
    </Button>
  );
}
