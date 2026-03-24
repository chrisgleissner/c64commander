/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// §15.1 — Config drift view: shows changed values grouped by category.
// Rendered as a secondary detail view inside the diagnostics overlay,
// or optionally escalated to a nested analytic popup for dense comparisons.

import { Button } from "@/components/ui/button";
import { computeConfigDrift, type ConfigDriftResult } from "@/lib/diagnostics/configDrift";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Props = {
  onBack: () => void;
};

type LoadState = "idle" | "loading" | "done" | "error";

export function ConfigDriftView({ onBack }: Props) {
  const [state, setState] = useState<LoadState>("idle");
  const [result, setResult] = useState<ConfigDriftResult | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const r = await computeConfigDrift();
      setResult(r);
      setState(r.error ? "error" : "done");
    } catch (error) {
      setResult({
        timestamp: new Date().toISOString(),
        driftItems: [],
        error: (error as Error).message,
      });
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Group drift items by category for display
  const grouped = result
    ? result.driftItems.reduce<Record<string, typeof result.driftItems>>((acc, item) => {
        if (!acc[item.category]) acc[item.category] = [];
        acc[item.category].push(item);
        return acc;
      }, {})
    : {};

  return (
    <div className="space-y-3" data-testid="config-drift-view">
      {/* Header with back */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={onBack}
          className="h-7 px-1.5 -ml-1.5"
          data-testid="config-drift-back"
          aria-label="Back"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-foreground">Config Drift</h3>
          <p className="text-xs text-muted-foreground">Compares runtime vs saved config.</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void load()}
          disabled={state === "loading"}
          className="ml-auto h-6 w-6 p-0"
          aria-label="Refresh"
          data-testid="config-drift-refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${state === "loading" ? "animate-spin" : ""}`} aria-hidden="true" />
        </Button>
      </div>

      {state === "loading" && (
        <p className="text-xs text-muted-foreground" data-testid="config-drift-loading">
          Comparing runtime and persisted config…
        </p>
      )}

      {state === "error" && (
        <p className="text-xs text-destructive" data-testid="config-drift-error">
          {result?.error ?? "Failed to compute config drift."}
        </p>
      )}

      {state === "done" && result && (
        <>
          {result.driftItems.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="config-drift-no-drift">
              No config drift detected. Runtime matches persisted config.
            </p>
          ) : (
            <div className="space-y-3" data-testid="config-drift-results">
              {Object.entries(grouped).map(([category, items]) => (
                <div key={category} className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground">{category}</p>
                  {items.map((item) => (
                    <div
                      key={`${item.category}/${item.item}`}
                      className="rounded border border-border px-2 py-1 text-xs space-y-0.5"
                    >
                      <p className="font-medium">{item.item}</p>
                      <div className="flex items-start gap-2 text-muted-foreground font-mono">
                        <span className="min-w-0 break-all">{item.persistedValue}</span>
                        <span className="shrink-0 pt-px">→</span>
                        <span className="min-w-0 break-all text-foreground">{item.runtimeValue}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
