/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { AnalyticPopup } from "@/components/diagnostics/AnalyticPopup";
import { Button } from "@/components/ui/button";
import {
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import {
  computeLatencyPercentiles,
  getLatencySamples,
  type EndpointClass,
  type LatencySample,
  type TransportFamily,
} from "@/lib/diagnostics/latencyTracker";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMemo, useState } from "react";
import { formatDiagnosticsTimestamp } from "@/lib/diagnostics/timeFormat";
import { BarChart2, Filter } from "lucide-react";

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

type FilterToggleProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

const FilterToggle = ({ label, checked, onChange }: FilterToggleProps) => (
  <label className="flex items-center gap-2 text-sm">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4" />
    <span>{label}</span>
  </label>
);

const FilterChip = ({ label }: { label: string }) => (
  <span className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] font-medium leading-5">
    {label}
  </span>
);

const endpointTransport = (endpoint: EndpointClass): TransportFamily =>
  endpoint === "FTP list" || endpoint === "FTP read" ? "FTP" : "REST";

const FilterEditorSurface = ({
  open,
  onOpenChange,
  filters,
  onFiltersChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
}) => {
  const updateTransports = (transport: TransportFamily, checked: boolean) => {
    const transports = new Set(filters.transports);
    if (checked) {
      transports.add(transport);
    } else {
      transports.delete(transport);
    }

    const endpoints = new Set(
      [...filters.endpoints].filter((endpoint) => transport !== endpointTransport(endpoint) || checked),
    );

    onFiltersChange({
      allCallTypes: false,
      transports,
      endpoints,
    });
  };

  const updateEndpoints = (endpoint: EndpointClass, checked: boolean) => {
    const endpoints = new Set(filters.endpoints);
    if (checked) {
      endpoints.add(endpoint);
    } else {
      endpoints.delete(endpoint);
    }

    onFiltersChange({
      allCallTypes: false,
      transports: new Set(filters.transports),
      endpoints,
    });
  };

  return (
    <AppSheet open={open} onOpenChange={onOpenChange}>
      <AppSheetContent
        className="z-[62] overflow-hidden p-0 sm:w-[min(100vw-2rem,24rem)]"
        data-testid="latency-filters-editor"
      >
        <AppSheetHeader className="px-4 py-[0.5625rem] pr-14">
          <AppSheetTitle className="text-base">Latency filters</AppSheetTitle>
          <AppSheetDescription className="sr-only">
            Filter latency samples by transport and endpoint class.
          </AppSheetDescription>
        </AppSheetHeader>
        <AppSheetBody className="px-4 py-4">
          <div className="space-y-5">
            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scope</p>
              <FilterToggle
                label="All call types"
                checked={filters.allCallTypes}
                onChange={(checked) => {
                  if (checked) {
                    onFiltersChange(defaultFilters());
                    return;
                  }
                  onFiltersChange({ ...filters, allCallTypes: false });
                }}
              />
            </section>

            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transport</p>
              {TRANSPORT_FAMILIES.map((transport) => (
                <FilterToggle
                  key={transport}
                  label={transport}
                  checked={filters.allCallTypes || filters.transports.has(transport)}
                  onChange={(checked) => updateTransports(transport, checked)}
                />
              ))}
            </section>

            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Endpoint</p>
              {ENDPOINT_CLASSES.map((endpoint) => (
                <FilterToggle
                  key={endpoint}
                  label={endpoint}
                  checked={filters.allCallTypes || filters.endpoints.has(endpoint)}
                  onChange={(checked) => updateEndpoints(endpoint, checked)}
                />
              ))}
            </section>

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => onFiltersChange(defaultFilters())}>
                Reset
              </Button>
            </div>
          </div>
        </AppSheetBody>
      </AppSheetContent>
    </AppSheet>
  );
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export function LatencyAnalysisPopup({ open, onClose }: Props) {
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const resetFilters = () => setFilters(defaultFilters());

  const activeFilterLabels = useMemo(() => {
    if (filters.allCallTypes) return [] as string[];
    return [...Array.from(filters.transports.values()), ...Array.from(filters.endpoints.values())];
  }, [filters]);

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

  return (
    <>
      <AnalyticPopup
        open={open}
        onClose={onClose}
        title="Latency"
        contentClassName={isEmpty ? "h-auto max-h-[min(72dvh,38rem)]" : undefined}
        data-testid="latency-analysis-popup"
      >
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div
            className="flex items-center gap-2 overflow-hidden rounded-full border border-border/70 bg-card px-3 py-2 text-xs"
            data-testid="latency-filter-bar"
          >
            <span className="shrink-0 font-semibold text-foreground">Filters</span>
            <span className="shrink-0 text-muted-foreground">·</span>
            <span className="shrink-0 text-muted-foreground" data-testid="latency-sample-count">
              {summary.sampleCount} sample{summary.sampleCount === 1 ? "" : "s"}
            </span>
            <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
              <div className="flex items-center gap-1 overflow-hidden">
                {activeFilterLabels.length === 0 ? <FilterChip label="All call types" /> : null}
                {activeFilterLabels.slice(0, 2).map((label) => (
                  <FilterChip key={label} label={label} />
                ))}
                {activeFilterLabels.length > 2 ? <FilterChip label={`+${activeFilterLabels.length - 2}`} /> : null}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setFiltersOpen(true)}
              data-testid="open-latency-filters"
            >
              <Filter className="h-4 w-4" />
            </Button>
          </div>

          <div
            className="mt-3 grid grid-cols-2 gap-3 rounded-2xl border border-border/70 bg-card p-3 text-sm sm:grid-cols-4"
            data-testid="latency-summary-metrics"
          >
            <div>
              <p className="text-xs text-muted-foreground">P50</p>
              <p className="font-mono font-semibold">{summary.p50}ms</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">P90</p>
              <p className="font-mono font-semibold">{summary.p90}ms</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">P99</p>
              <p className="font-mono font-semibold">{summary.p99}ms</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Samples</p>
              <p className="font-mono font-semibold">{summary.sampleCount}</p>
            </div>
          </div>

          {isEmpty ? (
            <div className="flex flex-1 items-center justify-center py-4">
              <div className="flex min-h-40 w-full max-w-xl flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/15 px-5 py-6 text-center">
                <BarChart2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {filters.allCallTypes ? "No latency samples yet" : "No latency samples match these filters"}
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
            <div
              className="mt-3 min-h-0 flex-1 rounded-2xl border border-border/70 bg-card p-3"
              data-testid="latency-chart-panel"
            >
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
                          <p className="mb-1 font-medium">
                            {typeof label === "string" ? formatDiagnosticsTimestamp(label) : label}
                          </p>
                          {payload.map((p) => (
                            <p key={p.name} style={{ color: p.color }}>
                              {p.name}: {p.value ?? "—"}ms
                            </p>
                          ))}
                          {payload[0]?.payload?.count != null ? (
                            <p className="mt-1 text-muted-foreground">
                              {(payload[0].payload as TimePoint).count} samples
                            </p>
                          ) : null}
                        </div>
                      );
                    }}
                  />
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
            </div>
          )}

          {!isEmpty && filteredSamples.length < 5 && (
            <p className="mt-2 shrink-0 text-xs text-muted-foreground">
              Percentile lines are based on limited samples.
            </p>
          )}
        </div>
      </AnalyticPopup>

      <FilterEditorSurface
        open={open && filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        onFiltersChange={setFilters}
      />
    </>
  );
}
