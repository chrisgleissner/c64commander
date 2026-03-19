/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// §7 / §8 — Connection actions region inside the diagnostics overlay summary.
// Provides Retry connection (direct action) and Switch device (inline disclosure).

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ConnectivityState } from "@/lib/diagnostics/healthModel";
import { getRecentTargets, type RecentTarget } from "@/lib/diagnostics/recentTargets";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, RefreshCw, Wifi } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type ConnectionActionsCallbacks = {
  /** Called to trigger a reconnect attempt. Resolves when done. */
  onRetryConnection: () => Promise<{ success: boolean; message: string }>;
  /**
   * Called to validate then switch to a new target.
   * Resolves with success=true if the switch succeeded.
   */
  onSwitchDevice: (host: string, port: number) => Promise<{ success: boolean; message: string }>;
};

type BusyState =
  | { type: "idle" }
  | { type: "retrying" }
  | { type: "switching" }
  | { type: "done"; success: boolean; message: string; action: "retry" | "switch" };

type Props = {
  connectivity: ConnectivityState;
  currentHost: string;
  callbacks: ConnectionActionsCallbacks;
  /** Whether to start expanded (recovery-first mode per §6.3) */
  defaultExpanded?: boolean;
};

const DEFAULT_PORT = 80;

/** §7.2 — Whether Retry connection should be visible */
const shouldShowRetry = (connectivity: ConnectivityState): boolean =>
  connectivity === "Offline" || connectivity === "Not yet connected" || connectivity === "Demo";

/** §7.2 — Whether the region should expand by default */
export const isRecoveryFirstState = (connectivity: ConnectivityState, hadRecentFailure?: boolean): boolean =>
  connectivity === "Offline" ||
  connectivity === "Not yet connected" ||
  (connectivity === "Demo" && Boolean(hadRecentFailure)) ||
  Boolean(hadRecentFailure);

export function ConnectionActionsRegion({ connectivity, currentHost, callbacks, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [hostInput, setHostInput] = useState(currentHost);
  const [portInput, setPortInput] = useState(String(DEFAULT_PORT));
  const [busy, setBusy] = useState<BusyState>({ type: "idle" });
  const [recentTargets, setRecentTargets] = useState<RecentTarget[]>([]);
  const retryButtonRef = useRef<HTMLButtonElement>(null);

  // §8.2 — Load recent targets on open
  useEffect(() => {
    if (expanded) {
      setRecentTargets(getRecentTargets());
    }
  }, [expanded]);

  // §8.2 — Prefill host from currentHost when switcher opens
  useEffect(() => {
    if (switcherOpen) {
      setHostInput(currentHost);
      setPortInput(String(DEFAULT_PORT));
    }
  }, [switcherOpen, currentHost]);

  const isBusy = busy.type === "retrying" || busy.type === "switching";

  const handleRetry = useCallback(async () => {
    if (isBusy) return;
    setBusy({ type: "retrying" });
    try {
      const result = await callbacks.onRetryConnection();
      setBusy({ type: "done", success: result.success, message: result.message, action: "retry" });
    } catch (error) {
      setBusy({
        type: "done",
        success: false,
        message: (error as Error).message,
        action: "retry",
      });
    }
  }, [isBusy, callbacks]);

  const handleConnect = useCallback(
    async (host: string, portStr: string) => {
      if (isBusy) return;
      const normalizedHost = host.trim();
      const port = parseInt(portStr, 10);
      const resolvedPort = Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT;
      if (!normalizedHost) return;
      setBusy({ type: "switching" });
      try {
        const result = await callbacks.onSwitchDevice(normalizedHost, resolvedPort);
        setBusy({
          type: "done",
          success: result.success,
          message: result.message,
          action: "switch",
        });
        if (result.success) {
          setSwitcherOpen(false);
        }
      } catch (error) {
        setBusy({
          type: "done",
          success: false,
          message: (error as Error).message,
          action: "switch",
        });
      }
    },
    [isBusy, callbacks],
  );

  const showRetry = shouldShowRetry(connectivity);
  const feedbackMessage =
    busy.type === "retrying"
      ? "Connecting…"
      : busy.type === "switching"
        ? "Connecting…"
        : busy.type === "done"
          ? busy.message
          : null;
  const feedbackIsError = busy.type === "done" && !busy.success;
  const feedbackIsSuccess = busy.type === "done" && busy.success;

  return (
    <div className="mt-2 space-y-1" data-testid="connection-actions-region">
      {/* §7 — Collapsed summary row (compact) */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={expanded}
        data-testid="connection-actions-toggle"
      >
        <span className="flex items-center gap-1.5">
          <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Connection actions</span>
        </span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <div className="space-y-2 pl-1" data-testid="connection-actions-expanded">
          {/* §8.1 — Retry connection */}
          {showRetry && (
            <div className="flex items-center gap-2">
              <Button
                ref={retryButtonRef}
                size="sm"
                variant="outline"
                onClick={() => void handleRetry()}
                disabled={isBusy}
                data-testid="retry-connection-action"
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5 mr-1.5", busy.type === "retrying" && "animate-spin")}
                  aria-hidden="true"
                />
                Retry connection
              </Button>
              <span className="text-xs text-muted-foreground font-mono truncate">{currentHost}</span>
            </div>
          )}

          {/* §8.2 — Switch device inline disclosure */}
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setSwitcherOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              aria-expanded={switcherOpen}
              disabled={isBusy}
              data-testid="switch-device-toggle"
            >
              <span className="font-medium">Switch device</span>
              {switcherOpen ? (
                <ChevronUp className="h-3 w-3 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
              )}
            </button>

            {switcherOpen && (
              <div className="space-y-2 rounded border border-border p-2" data-testid="switch-device-form">
                {/* §8.2 — Host and port inputs */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <label className="sr-only" htmlFor="switch-device-host">
                      Host
                    </label>
                    <Input
                      id="switch-device-host"
                      type="text"
                      placeholder="hostname or IP"
                      value={hostInput}
                      onChange={(e) => setHostInput(e.target.value)}
                      disabled={isBusy}
                      className="h-7 text-xs font-mono"
                      data-testid="switch-device-host-input"
                    />
                  </div>
                  <div className="w-16 shrink-0">
                    <label className="sr-only" htmlFor="switch-device-port">
                      Port
                    </label>
                    <Input
                      id="switch-device-port"
                      type="number"
                      placeholder="80"
                      value={portInput}
                      onChange={(e) => setPortInput(e.target.value)}
                      disabled={isBusy}
                      className="h-7 text-xs font-mono"
                      data-testid="switch-device-port-input"
                    />
                  </div>
                </div>

                {/* §8.2 — Recent targets */}
                {recentTargets.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-muted-foreground">Recent:</span>
                    {recentTargets.map((t) => (
                      <button
                        key={t.host}
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setHostInput(t.host);
                          void handleConnect(t.host, String(DEFAULT_PORT));
                        }}
                        className="px-2 py-0.5 text-xs font-mono rounded border border-border hover:border-primary/60 transition-colors disabled:opacity-50"
                        data-testid={`recent-target-${t.host}`}
                      >
                        {t.modelLabel ? `${t.host} · ${t.modelLabel}` : t.host}
                      </button>
                    ))}
                  </div>
                )}

                {/* §8.2 — Actions */}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => void handleConnect(hostInput, portInput)}
                    disabled={isBusy || !hostInput.trim()}
                    data-testid="switch-device-connect"
                  >
                    {busy.type === "switching" ? "Connecting…" : "Connect"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSwitcherOpen(false)}
                    disabled={isBusy}
                    data-testid="switch-device-cancel"
                  >
                    Cancel
                  </Button>
                </div>

                {/* §8.3 — Settings link for advanced editing */}
                <p className="text-xs text-muted-foreground">
                  <a
                    href="/settings"
                    className="underline hover:text-foreground transition-colors"
                    data-testid="open-connection-settings"
                  >
                    Open connection settings
                  </a>
                </p>
              </div>
            )}
          </div>

          {/* §7.3 — Inline feedback (progress / success / failure) */}
          {feedbackMessage && (
            <p
              className={cn(
                "text-xs px-1",
                feedbackIsError && "text-destructive",
                feedbackIsSuccess && "text-success",
                !feedbackIsError && !feedbackIsSuccess && "text-muted-foreground",
              )}
              data-testid="connection-feedback-message"
              aria-live="polite"
            >
              {feedbackMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
