/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// §12 — Latency analysis nested analytic popup.
// Shows P50/P90/P99 over time with checkbox-based scope filters.

import { AnalyticPopup } from "@/components/diagnostics/AnalyticPopup";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  classifyEndpoint,
  computeLatencyPercentiles,
  getLatencySamples,
  type EndpointClass,
  type LatencySample,
  type TransportFamily,
} from "@/lib/diagnostics/latencyTracker";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatDiagnosticsTimestamp } from "@/lib/diagnostics/timeFormat";
import { BarChart2 } from "lucide-react";

// §12.7 — Checkbox order per spec
const TRANSPORT_FAMILIES: TransportFamily[] = ["REST", "FTP"];
const ENDPOINT_CLASSES: EndpointClass[] = [
  "Info",
  "Configs (full tree)",
  "Config items",
  "Drives",
  "Machine control",
  "FTP list",
  "FTP read",
  "Other",
];

type FilterState = {
  allCallTypes: boolean;
  transports: Set<TransportFamily>;
  endpoints: Set<EndpointClass>;
};

const defaultFilters = (): FilterState => ({
  allCallTypes: true,
  transports: new Set(),
  endpoints: new Set(),
});

const TIME_BUCKET_MS = 30_000; // 30s buckets

type TimePoint = {
  time: string;
  p50: number | null;
  p90: number | null;
  p99: number | null;
  count: number;
};

const exactPercentile = (sorted: number[], pct: number): number | null => {
  if (sorted.length === 0) return null;
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
};

const buildTimePoints = (samples: Readonly<LatencySample[]>): TimePoint[] => {
  if (samples.length === 0) return [];

  const buckets = new Map<number, number[]>();
  for (const s of samples) {
    const bucket = Math.floor(s.timestampMs / TIME_BUCKET_MS) * TIME_BUCKET_MS;
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket)!.push(s.durationMs);
  }

  const result: TimePoint[] = [];
  for (const [bucketMs, durations] of Array.from(buckets.entries()).sort(([a], [b]) => a - b)) {
    const sorted = [...durations].sort((a, b) => a - b);
    result.push({
      time: new Date(bucketMs).toISOString(),
      p50: exactPercentile(sorted, 50),
      p90: exactPercentile(sorted, 90),
      p99: exactPercentile(sorted, 99),
      count: sorted.length,
    });
  }
  return result;
};

type CheckboxRowProps = {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  indent?: boolean;
};

const CheckboxRow = ({ id, label, checked, onChange, disabled, indent }: CheckboxRowProps) => (
  <div className={cn("flex items-center gap-2", indent && "ml-4")}>
    <Checkbox
      id={id}
      checked={checked}
      onCheckedChange={(v) => onChange(Boolean(v))}
      disabled={disabled}
      className="h-3.5 w-3.5"
    />
    <Label htmlFor={id} className="text-xs cursor-pointer select-none">
      {label}
    </Label>
  </div>
);

type Props = {
  open: boolean;
  onClose: () => void;
};

export function LatencyAnalysisPopup({ open, onClose }: Props) {
  const [filters, setFilters] = useState<FilterState>(defaultFilters);

  const applyFilters = useCallback((update: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...update }));
  }, []);

  const handleAllCallTypes = useCallback(
    (checked: boolean) => {
      if (!checked) {
        // Must keep at least one — keep all families enabled instead
        applyFilters({ allCallTypes: false, transports: new Set(TRANSPORT_FAMILIES), endpoints: new Set() });
        return;
      }
      applyFilters({ allCallTypes: true, transports: new Set(), endpoints: new Set() });
    },
    [applyFilters],
  );

  const handleTransportToggle = useCallback((family: TransportFamily, checked: boolean) => {
    setFilters((prev) => {
      const next = new Set(prev.transports);
      if (checked) {
        next.add(family);
      } else {
        next.delete(family);
        // §12.8 — prevent unchecking last transport when allCallTypes is off
        if (!prev.allCallTypes && next.size === 0 && prev.endpoints.size === 0) {
          return prev; // disallow
        }
      }
      return { ...prev, allCallTypes: false, transports: next };
    });
  }, []);

  const handleEndpointToggle = useCallback((ep: EndpointClass, checked: boolean) => {
    setFilters((prev) => {
      const next = new Set(prev.endpoints);
      if (checked) {
        next.add(ep);
      } else {
        next.delete(ep);
        if (!prev.allCallTypes && prev.transports.size === 0 && next.size === 0) {
          return prev; // disallow last uncheck
        }
      }
      return { ...prev, allCallTypes: false, endpoints: next };
    });
  }, []);

  const resetFilters = useCallback(() => setFilters(defaultFilters()), []);

  // Build filtered samples
  const filteredSamples = useMemo(() => {
    if (filters.allCallTypes) return getLatencySamples();
    const options: Parameters<typeof getLatencySamples>[0] = {};
    if (filters.transports.size > 0) options.transports = filters.transports;
    if (filters.endpoints.size > 0) options.endpoints = filters.endpoints;
    return getLatencySamples(options);
  }, [filters]);

  const timePoints = useMemo(() => buildTimePoints(filteredSamples), [filteredSamples]);

  const summary = useMemo(() => {
    if (filters.allCallTypes) return computeLatencyPercentiles();
    const options: Parameters<typeof computeLatencyPercentiles>[0] = {};
    if (filters.transports.size > 0) options.transports = filters.transports;
    if (filters.endpoints.size > 0) options.endpoints = filters.endpoints;
    return computeLatencyPercentiles(options);
  }, [filters]);

  const isEmpty = filteredSamples.length === 0;

  // §12.6 — Is a given transport implied by checked endpoints
  const isTransportChecked = (t: TransportFamily) => {
    if (filters.allCallTypes) return true;
    if (filters.transports.has(t)) return true;
    // endpoint implies its parent transport
    if (t === "REST") {
      return (
        filters.endpoints.has("Info") ||
        filters.endpoints.has("Configs (full tree)") ||
        filters.endpoints.has("Config items") ||
        filters.endpoints.has("Drives") ||
        filters.endpoints.has("Machine control")
      );
    }
    return filters.endpoints.has("FTP list") || filters.endpoints.has("FTP read");
  };

  return (
    <AnalyticPopup
      open={open}
      onClose={onClose}
      title="Latency analysis"
      description="Request latency over time for the current diagnostics session."
      contentClassName={isEmpty ? "h-auto max-h-[min(72dvh,38rem)]" : undefined}
      data-testid="latency-analysis-popup"
    >
      <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
        {/* §12.7 — Filter panel */}
        <aside className="shrink-0 border-b sm:border-b-0 sm:border-r border-border p-3 space-y-2 sm:w-44 sm:overflow-y-auto">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filters</p>
          <CheckboxRow
            id="filter-all"
            label="All call types"
            checked={filters.allCallTypes}
            onChange={handleAllCallTypes}
          />
          <div className="border-t border-border pt-1.5 space-y-1.5">
            {TRANSPORT_FAMILIES.map((t) => (
              <CheckboxRow
                key={t}
                id={`filter-transport-${t}`}
                label={t}
                checked={isTransportChecked(t)}
                onChange={(c) => handleTransportToggle(t, c)}
                disabled={filters.allCallTypes}
                indent
              />
            ))}
          </div>
          <div className="border-t border-border pt-1.5 space-y-1.5">
            {ENDPOINT_CLASSES.map((ep) => (
              <CheckboxRow
                key={ep}
                id={`filter-ep-${ep}`}
                label={ep}
                checked={
                  filters.allCallTypes ||
                  filters.endpoints.has(ep) ||
                  (ep.startsWith("FTP")
                    ? filters.transports.has("FTP")
                    : ["Info", "Configs (full tree)", "Config items", "Drives", "Machine control"].includes(ep)
                      ? filters.transports.has("REST")
                      : false)
                }
                onChange={(c) => handleEndpointToggle(ep, c)}
                disabled={filters.allCallTypes}
                indent
              />
            ))}
          </div>
          {!filters.allCallTypes && (
            <Button size="sm" variant="ghost" onClick={resetFilters} className="w-full text-xs">
              Reset filters
            </Button>
          )}
        </aside>

        {/* Chart area */}
        <div className="flex flex-1 min-h-0 flex-col p-3">
          {/* Summary row */}
          <div className="flex items-center gap-4 mb-3 shrink-0">
            <div className="text-xs">
              <span className="text-muted-foreground">P50 </span>
              <span className="font-mono font-semibold">{summary.p50}ms</span>
            </div>
            <div className="text-xs">
              <span className="text-muted-foreground">P90 </span>
              <span className="font-mono font-semibold">{summary.p90}ms</span>
            </div>
            <div className="text-xs">
              <span className="text-muted-foreground">P99 </span>
              <span className="font-mono font-semibold">{summary.p99}ms</span>
            </div>
            <div className="text-xs text-muted-foreground ml-auto">
              {summary.sampleCount} sample{summary.sampleCount !== 1 ? "s" : ""}
            </div>
          </div>

          {/* §12.10 — Empty state */}
          {isEmpty ? (
            <div className="flex flex-1 items-center justify-center py-2">
              <div className="flex min-h-40 w-full max-w-xl flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/15 px-5 py-6 text-center">
                <BarChart2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {filters.allCallTypes ? "No latency samples yet" : "No latency samples match these filters"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {filters.allCallTypes
                      ? "Run a health check or keep using the app to populate the chart."
                      : "Widen the selected call types to bring latency history back into view."}
                  </p>
                </div>
                {!filters.allCallTypes && (
                  <Button size="sm" variant="outline" onClick={resetFilters}>
                    Reset filters
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={timePoints} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis
                  dataKey="time"
                  tickFormatter={(v: string) => {
                    const d = new Date(v);
                    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
                  }}
                  tick={{ fontSize: 10 }}
                  className="text-muted-foreground"
                />
                <YAxis unit="ms" tick={{ fontSize: 10 }} width={48} className="text-muted-foreground" />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded border bg-popover px-2 py-1.5 text-xs shadow-md">
                        <p className="font-medium mb-1">
                          {typeof label === "string" ? formatDiagnosticsTimestamp(label) : label}
                        </p>
                        {payload.map((p) => (
                          <p key={p.name} style={{ color: p.color }}>
                            {p.name}: {p.value ?? "—"}ms
                          </p>
                        ))}
                        {payload[0]?.payload?.count != null && (
                          <p className="text-muted-foreground mt-1">
                            {(payload[0].payload as TimePoint).count} samples
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                {/* §12.5 — Distinct stroke patterns as secondary carriers */}
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="p50"
                  name="P50"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="p90"
                  name="P90"
                  stroke="hsl(var(--chart-2, 160 60% 45%))"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="p99"
                  name="P99"
                  stroke="hsl(var(--destructive))"
                  strokeWidth={2}
                  strokeDasharray="2 2"
                  dot={false}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}

          {/* Sparse annotation */}
          {!isEmpty && filteredSamples.length < 5 && (
            <p className="text-xs text-muted-foreground mt-2 shrink-0">
              Percentile lines are based on limited samples.
            </p>
          )}
        </div>
      </div>
    </AnalyticPopup>
  );
}
