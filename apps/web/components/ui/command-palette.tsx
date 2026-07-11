"use client";

import { Search, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EASE_OUT, SPRING_PANEL } from "@/lib/ease";
import { useHydrationSafeReducedMotion } from "@/lib/hooks/use-hydration-safe-reduced-motion";
import { cn } from "@/lib/utils";

export type CommandItem = {
  id: string;
  label: string;
  group?: string;
  hint?: string;
  keywords?: string[];
  icon?: LucideIcon;
  badge?: ReactNode;
  onSelect: () => void;
};

export function CommandPalette({
  items,
  open,
  onOpenChange,
  shortcut = "k",
  placeholder = "Search commands, skills, traces..."
}: {
  items: CommandItem[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  shortcut?: string;
  placeholder?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [mounted, setMounted] = useState(false);
  const reduce = useHydrationSafeReducedMotion();
  const reactId = useId();
  const instanceId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const listboxId = `command-list-${instanceId}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const optionRefs = useRef(new Map<number, HTMLButtonElement>());
  const isOpen = open ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange]
  );
  const setOpenRef = useRef(setOpen);

  useEffect(() => {
    setOpenRef.current = setOpen;
  }, [setOpen]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === shortcut) {
        event.preventDefault();
        setOpenRef.current(!isOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, shortcut]);

  useEffect(() => {
    if (!mounted || !isOpen) return;

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
        setOpenRef.current(false);
        return;
      }

      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");

      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const focused = document.activeElement;
      if (event.shiftKey && (focused === first || !panel.contains(focused))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (focused === last || !panel.contains(focused))) {
        event.preventDefault();
        first.focus();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    const frame = requestAnimationFrame(() => {
      setQuery("");
      setActive(0);
      inputRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      for (const { element, inert } of previousInert) element.inert = inert;
      const opener = openerRef.current;
      if (opener?.isConnected) requestAnimationFrame(() => opener.focus());
    };
  }, [isOpen, mounted]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [item.label, item.group, ...(item.keywords ?? [])]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [items, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const item of filtered) {
      const group = item.group ?? "Results";
      map.set(group, [...(map.get(group) ?? []), item]);
    }
    return [...map.entries()];
  }, [filtered]);

  const orderedItems = useMemo(
    () => grouped.flatMap(([, groupItems]) => groupItems),
    [grouped]
  );
  const safeActive = orderedItems.length === 0 ? 0 : Math.min(active, orderedItems.length - 1);

  useEffect(() => {
    if (!isOpen) return;
    optionRefs.current.get(safeActive)?.scrollIntoView?.({ block: "nearest" });
  }, [isOpen, orderedItems, safeActive]);

  if (!mounted) return null;

  let index = 0;

  return createPortal(
    isOpen ? (
        <div ref={rootRef} className="fixed inset-0 z-[80]">
          <motion.button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-0 bg-slate-950/20 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduce ? { duration: 0 } : undefined}
            onClick={() => setOpen(false)}
          />
          <div className="pointer-events-none absolute inset-0 flex items-start justify-center px-4 pt-[16vh]">
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Command palette"
              tabIndex={-1}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              transition={reduce ? { duration: 0 } : SPRING_PANEL}
              className="pointer-events-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  if (orderedItems.length > 0) {
                    setActive((value) => (value + 1) % orderedItems.length);
                  }
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  if (orderedItems.length > 0) {
                    setActive((value) => (value - 1 + orderedItems.length) % orderedItems.length);
                  }
                }
                if (event.key === "Home") {
                  event.preventDefault();
                  if (orderedItems.length > 0) setActive(0);
                }
                if (event.key === "End") {
                  event.preventDefault();
                  if (orderedItems.length > 0) setActive(orderedItems.length - 1);
                }
                if (event.key === "Enter") {
                  const item = orderedItems[safeActive];
                  if (item) {
                    event.preventDefault();
                    setOpen(false);
                    item.onSelect();
                  }
                }
              }}
            >
              <div className="flex items-center gap-3 border-b border-border px-4">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  ref={inputRef}
                  type="search"
                  role="combobox"
                  aria-label="Search commands"
                  aria-autocomplete="list"
                  aria-expanded="true"
                  aria-controls={listboxId}
                  aria-activedescendant={
                    orderedItems[safeActive]
                      ? `${listboxId}-option-${safeActive}-${orderedItems[safeActive].id.replace(/[^a-zA-Z0-9_-]/g, "-")}`
                      : undefined
                  }
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActive(0);
                  }}
                  placeholder={placeholder}
                  className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  ESC
                </kbd>
              </div>
              <div id={listboxId} role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
                {filtered.length === 0 ? (
                  <div role="status" className="p-8 text-center text-sm text-muted-foreground">
                    No matching skills or actions.
                  </div>
                ) : (
                  grouped.map(([group, list]) => (
                    <div
                      key={group}
                      role="group"
                      aria-labelledby={`${listboxId}-group-${group.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                      className="mb-2 last:mb-0"
                    >
                      <div
                        id={`${listboxId}-group-${group.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                        className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
                      >
                        {group}
                      </div>
                      {list.map((item) => {
                        const currentIndex = index++;
                        const activeRow = safeActive === currentIndex;
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.id}
                            ref={(node) => {
                              if (node) optionRefs.current.set(currentIndex, node);
                              else optionRefs.current.delete(currentIndex);
                            }}
                            id={`${listboxId}-option-${currentIndex}-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                            type="button"
                            role="option"
                            aria-selected={activeRow}
                            tabIndex={-1}
                            onMouseEnter={() => setActive(currentIndex)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setOpen(false);
                              item.onSelect();
                            }}
                            className={cn(
                              "relative isolate flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                              activeRow ? "text-foreground" : "text-muted-foreground"
                            )}
                          >
                            {activeRow ? (
                              <motion.span
                                layoutId={`command-active-${instanceId}`}
                                className="absolute inset-0 -z-10 rounded-lg bg-primary/[0.07]"
                                transition={reduce ? { duration: 0 } : { duration: 0.16, ease: EASE_OUT }}
                              />
                            ) : null}
                            {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {item.badge}
                            {item.hint ? (
                              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px]">
                                {item.hint}
                              </kbd>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        </div>
      ) : null,
    document.body
  );
}
