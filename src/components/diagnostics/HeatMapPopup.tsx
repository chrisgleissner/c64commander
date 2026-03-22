/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// §15.2–15.8 — Shared heat map popup.
// One popup per variant (REST / FTP / CONFIG). Supports Count and Latency metric modes.
// Accessibility: numeric values + text labels, no color-only encoding.

import { AnalyticPopup } from "@/components/diagnostics/AnalyticPopup";
import {
  buildConfigHeatMap,
  buildFtpHeatMap,
  buildRestHeatMap,
  getCellMetricValue,
  getMatrixMaxMetric,
  type HeatMapCell,
  type HeatMapMatrix,
  type HeatMapMetricMode,
  type HeatMapVariant,
} from "@/lib/diagnostics/heatMapData";
import type { TraceEvent } from "@/lib/tracing/types";
import { cn } from "@/lib/utils";
import { useState, type CSSProperties } from "react";

const VARIANT_TITLES: Record<HeatMapVariant, string> = {
  REST: "REST activity",
  FTP: "FTP activity",
  CONFIG: "Config activity",
};

const VARIANT_DESCRIPTIONS: Record<HeatMapVariant, string> = {
  REST: "REST call count and latency by endpoint family.",
  FTP: "FTP operation count and latency by operation type.",
  CONFIG: "Config access count and latency by category and item.",
};

type CellDetailState = {
  cell: HeatMapCell;
} | null;

type Props = {
  open: boolean;
  onClose: () => void;
  variant: HeatMapVariant;
  traceEvents: TraceEvent[];
};

const metricIntensity = (value: number, max: number): number => {
  if (max === 0 || value === 0) return 0;
  return Math.min(1, value / max);
};

const legendSteps = Array.from({ length: 10 }, (_, index) => (index + 1) / 10);

const interpolate = (from: number, to: number, intensity: number) => from + (to - from) * intensity;

const heatCellStyle = (intensity: number): CSSProperties => {
  if (intensity <= 0) {
    return {
      backgroundColor: "hsl(var(--muted) / 0.4)",
      borderColor: "hsl(var(--border) / 0.65)",
      color: "hsl(var(--muted-foreground))",
    };
  }

  const hue = interpolate(196, 12, intensity);
  const saturation = interpolate(82, 88, intensity);
  const lightness = interpolate(96, 38, intensity);

  return {
    backgroundColor: `hsl(${hue} ${saturation}% ${lightness}%)`,
    borderColor: `hsl(${hue} ${Math.min(96, saturation + 4)}% ${Math.max(24, lightness - 12)}%)`,
    color: lightness < 58 ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
  };
};

const MetricToggle = ({ mode, onChange }: { mode: HeatMapMetricMode; onChange: (m: HeatMapMetricMode) => void }) => (
  <div className="flex items-center gap-1" role="group" aria-label="Heat metric mode">
    {(["Count", "Latency"] as HeatMapMetricMode[]).map((m) => (
      <button
        key={m}
        type="button"
        onClick={() => onChange(m)}
        aria-pressed={mode === m}
        className={cn(
          "px-2.5 py-0.5 text-xs font-medium rounded border transition-colors",
          mode === m
            ? "border-primary bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:border-primary/40",
        )}
        data-testid={`heat-metric-${m.toLowerCase()}`}
      >
        {m}
      </button>
    ))}
  </div>
);

function CellDetail({ cell, mode, onClose }: { cell: HeatMapCell; mode: HeatMapMetricMode; onClose: () => void }) {
  const p90 = (() => {
    const s = cell.latenciesMs;
    if (s.length === 0) return null;
    const idx = Math.ceil(0.9 * s.length) - 1;
    return s[Math.max(0, Math.min(idx, s.length - 1))];
  })();
  const p50 = (() => {
    const s = cell.latenciesMs;
    if (s.length === 0) return null;
    const idx = Math.ceil(0.5 * s.length) - 1;
    return s[Math.max(0, Math.min(idx, s.length - 1))];
  })();
  const p99 = (() => {
    const s = cell.latenciesMs;
    if (s.length === 0) return null;
    const idx = Math.ceil(0.99 * s.length) - 1;
    return s[Math.max(0, Math.min(idx, s.length - 1))];
  })();

  const failRate = cell.callCount > 0 ? Math.round((cell.failCount / cell.callCount) * 100) : 0;

  return (
    <div
      className="absolute inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur-sm p-3 space-y-2"
      data-testid="heat-cell-detail"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">
          {cell.rowGroup} / {cell.columnItem}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
          aria-label="Close cell detail"
        >
          ✕
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1 text-xs">
        <span className="text-muted-foreground">Mode</span>
        <span>{mode}</span>
        <span className="text-muted-foreground">Calls</span>
        <span className="font-mono">{cell.callCount}</span>
        <span className="text-muted-foreground">Failures</span>
        <span className="font-mono">
          {cell.failCount} ({failRate}%)
        </span>
        {cell.readCount + cell.writeCount > 0 && (
          <>
            <span className="text-muted-foreground">Reads / writes</span>
            <span className="font-mono">
              {cell.readCount} / {cell.writeCount}
            </span>
          </>
        )}
        {p50 != null && (
          <>
            <span className="text-muted-foreground">P50</span>
            <span className="font-mono">{p50}ms</span>
          </>
        )}
        {p90 != null && (
          <>
            <span className="text-muted-foreground">P90</span>
            <span className="font-mono">{p90}ms</span>
          </>
        )}
        {p99 != null && (
          <>
            <span className="text-muted-foreground">P99</span>
            <span className="font-mono">{p99}ms</span>
          </>
        )}
      </div>
    </div>
  );
}

export function HeatMapPopup({ open, onClose, variant, traceEvents }: Props) {
  const [mode, setMode] = useState<HeatMapMetricMode>("Count");
  const [cellDetail, setCellDetail] = useState<CellDetailState>(null);

  const matrix: HeatMapMatrix = (() => {
    switch (variant) {
      case "REST":
        return buildRestHeatMap(traceEvents);
      case "FTP":
        return buildFtpHeatMap(traceEvents);
      case "CONFIG":
        return buildConfigHeatMap(traceEvents);
    }
  })();

  const maxMetric = getMatrixMaxMetric(matrix, mode);
  const isEmpty = matrix.rowGroups.length === 0;

  return (
    <AnalyticPopup
      open={open}
      onClose={onClose}
      title={VARIANT_TITLES[variant]}
      description={VARIANT_DESCRIPTIONS[variant]}
      contentClassName="w-[min(96vw,72rem)] h-[min(88dvh,52rem)]"
      data-testid={`heat-map-popup-${variant.toLowerCase()}`}
    >
      <div className="flex flex-1 min-h-0 flex-col p-3 relative">
        <div className="mb-3 space-y-1 rounded-lg border border-border/60 bg-background/70 p-3 text-xs">
          <p className="font-medium text-foreground">Purpose: Shows concentrated {VARIANT_TITLES[variant]} by area.</p>
          <p className="text-muted-foreground">
            Interpretation: Brighter cells indicate where activity or latency is concentrated enough to investigate.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 mb-3 shrink-0">
          <MetricToggle mode={mode} onChange={setMode} />
          <span className="text-xs text-muted-foreground">
            {mode === "Count" ? "Color encodes call count" : "Color encodes p90 latency"}
          </span>
        </div>

        <div className="mb-3 shrink-0 rounded-xl border border-border/70 bg-muted/20 px-3 py-2">
          <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <span>Low signal</span>
            <span>High signal</span>
          </div>
          <div className="mt-2 grid grid-cols-10 gap-1" data-testid="heat-map-legend">
            {legendSteps.map((step) => (
              <div
                key={step}
                className="flex h-7 items-center justify-center rounded-md border text-[10px] font-semibold"
                style={heatCellStyle(step)}
              >
                {Math.round(step * 100)}
              </div>
            ))}
          </div>
        </div>

        {isEmpty ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            No {variant} activity recorded in this session.
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <table
              className="w-full table-fixed border-separate border-spacing-1 text-xs"
              aria-label={`${variant} heat map`}
            >
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 w-[9.5rem] rounded-md bg-background px-2 pb-1 text-left font-normal text-muted-foreground sm:w-[10.5rem]">
                    Group
                  </th>
                  {matrix.columnItems.map((col) => (
                    <th
                      key={col}
                      className="rounded-md bg-background px-0.5 pb-1 font-normal text-muted-foreground"
                      style={{ writingMode: "vertical-lr", textOrientation: "mixed", transform: "rotate(180deg)" }}
                      title={col}
                    >
                      <span className="block max-h-[6rem] overflow-hidden text-[10px] tracking-[0.08em]">{col}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rowGroups.map((rowGroup) => (
                  <tr key={rowGroup}>
                    <td className="sticky left-0 z-10 rounded-md border border-border/60 bg-background px-2 py-1.5 font-medium leading-tight text-muted-foreground whitespace-normal break-words">
                      {rowGroup}
                    </td>
                    {matrix.columnItems.map((col) => {
                      const cell = matrix.cells[rowGroup]?.[col];
                      const value = cell ? getCellMetricValue(cell, mode) : 0;
                      const intensity = metricIntensity(value, maxMetric);
                      const label = cell
                        ? `${cell.rowGroup} ${cell.columnItem}: ${mode === "Count" ? `${value} calls` : `${value}ms p90`}`
                        : `${rowGroup} ${col}: no data`;
                      return (
                        <td
                          key={col}
                          className={cn(
                            "h-9 rounded-md border px-1 py-0.5 text-center transition-transform duration-150",
                            "hover:scale-[1.02] hover:ring-1 hover:ring-primary/70",
                          )}
                          style={heatCellStyle(intensity)}
                          title={cell ? `${cell.rowGroup}/${cell.columnItem}: ${value}` : "—"}
                          data-testid={`heat-cell-${rowGroup}-${col}`}
                        >
                          <button
                            type="button"
                            className="flex h-full w-full cursor-pointer items-center justify-center rounded-[inherit] font-mono text-[11px] font-semibold focus:outline-none focus:ring-2 focus:ring-primary/70"
                            onClick={() => cell && setCellDetail({ cell })}
                            title={cell ? `${cell.rowGroup}/${cell.columnItem}: ${value}` : "—"}
                            aria-label={label}
                            disabled={!cell}
                          >
                            {value > 0 ? value : ""}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* §15.8 — Cell detail overlay (stays inside popup) */}
        {cellDetail && <CellDetail cell={cellDetail.cell} mode={mode} onClose={() => setCellDetail(null)} />}
      </div>
    </AnalyticPopup>
  );
}
