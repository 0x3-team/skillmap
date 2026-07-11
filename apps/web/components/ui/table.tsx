"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface TableColumn<T> {
  key: string;
  header: string;
  width?: string;
  align?: "left" | "right" | "center";
  cell?: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
}

export function DataTable<T>({
  data,
  columns,
  getRowId,
  selectedRowIds = [],
  onSelectionChange,
  onRowOpen,
  height = 390,
  rowHeight = 54,
  className,
  emptyState = "No rows"
}: {
  data: T[];
  columns: TableColumn<T>[];
  getRowId: (row: T) => string;
  selectedRowIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onRowOpen?: (row: T) => void;
  height?: number;
  rowHeight?: number;
  className?: string;
  emptyState?: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(
    null
  );
  const selected = useMemo(() => new Set(selectedRowIds), [selectedRowIds]);
  const selectionEnabled = typeof onSelectionChange === "function";
  const columnCount = columns.length + (selectionEnabled ? 1 : 0);

  const sortedData = useMemo(() => {
    if (!sort) return data;
    const column = columns.find((item) => item.key === sort.key);
    if (!column) return data;
    return [...data].sort((a, b) => {
      const left = column.sortValue
        ? column.sortValue(a)
        : String((a as Record<string, unknown>)[column.key] ?? "");
      const right = column.sortValue
        ? column.sortValue(b)
        : String((b as Record<string, unknown>)[column.key] ?? "");
      const order =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      return sort.direction === "asc" ? order : -order;
    });
  }, [columns, data, sort]);

  // TanStack Virtual intentionally returns imperative helpers; this table keeps
  // them local and does not pass them into memoized child components.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: sortedData.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8
  });

  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange?.([...next]);
  };

  return (
    <div className={cn("min-w-0 overflow-hidden rounded-xl border border-border bg-card", className)}>
      <div ref={parentRef} style={{ height }} className="overflow-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]">
            <tr>
              {selectionEnabled ? (
                <th className="w-11 px-3 py-3 text-left">
                  <span className="sr-only">Select</span>
                </th>
              ) : null}
              {columns.map((column) => {
                const active = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    aria-sort={
                      active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                    }
                    style={column.width ? { width: column.width } : undefined}
                    className={cn(
                      "px-3 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground",
                      column.align === "right" && "text-right",
                      column.align === "center" && "text-center"
                    )}
                  >
                    <button
                      type="button"
                      aria-label={`Sort by ${column.header}${
                        active
                          ? sort.direction === "asc"
                            ? ", currently ascending"
                            : ", currently descending"
                          : ""
                      }`}
                      onClick={() =>
                        setSort((current) =>
                          current?.key === column.key
                            ? {
                                key: column.key,
                                direction: current.direction === "asc" ? "desc" : "asc"
                              }
                            : { key: column.key, direction: "asc" }
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {column.header}
                      {active ? (
                        sort.direction === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedData.length === 0 ? (
              <tr>
                <td
                  colSpan={columnCount}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  {emptyState}
                </td>
              </tr>
            ) : (
              <>
                {virtualizer.getVirtualItems().length > 0 ? (
                  <tr style={{ height: virtualizer.getVirtualItems()[0].start }}>
                    <td colSpan={columnCount} />
                  </tr>
                ) : null}
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const row = sortedData[virtualRow.index];
                  const id = getRowId(row);
                  const isSelected = selectionEnabled && selected.has(id);
                  return (
                    <tr
                      key={id}
                      style={{ height: rowHeight }}
                      className={cn(
                        "border-b border-border/70 transition-colors hover:bg-muted/50",
                        isSelected && "bg-primary/5"
                      )}
                    >
                      {selectionEnabled ? (
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            aria-label={`Select ${id}`}
                            onChange={() => toggleRow(id)}
                            className="h-4 w-4 rounded border-border accent-cyan-700"
                          />
                        </td>
                      ) : null}
                      {columns.map((column, index) => (
                        <td
                          key={column.key}
                          className={cn(
                            "max-w-[260px] truncate px-3 py-2 text-foreground",
                            column.align === "right" && "text-right tabular-nums",
                            column.align === "center" && "text-center"
                          )}
                        >
                          {index === 0 && onRowOpen ? (
                            <button
                              type="button"
                              onClick={() => onRowOpen(row)}
                              className="max-w-full truncate text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            >
                              {column.cell
                                ? column.cell(row)
                                : String((row as Record<string, unknown>)[column.key] ?? "")}
                            </button>
                          ) : (
                            <span className="block max-w-full truncate">
                              {column.cell
                                ? column.cell(row)
                                : String((row as Record<string, unknown>)[column.key] ?? "")}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {virtualizer.getVirtualItems().length > 0 ? (
                  <tr
                    style={{
                      height:
                        virtualizer.getTotalSize() -
                        virtualizer.getVirtualItems()[virtualizer.getVirtualItems().length - 1]
                          .end
                    }}
                  >
                    <td colSpan={columnCount} />
                  </tr>
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
