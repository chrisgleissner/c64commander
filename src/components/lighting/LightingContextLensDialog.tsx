/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import {
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { Badge } from "@/components/ui/badge";
import { useLightingStudio } from "@/hooks/useLightingStudio";
import { buildLightingContextSignals } from "@/lib/lighting/contextLensSignals";

export function LightingContextLensDialog() {
  const {
    contextLensOpen,
    closeContextLens,
    resolved,
    studioState,
    connectionSentinelState,
    circadianState,
    playbackContext,
    manualLockEnabled,
    previewState,
  } = useLightingStudio();

  const signals = React.useMemo(
    () =>
      buildLightingContextSignals({
        studioState,
        activeProfile: resolved.activeProfile,
        connectionState: connectionSentinelState,
        circadian: circadianState,
        playbackContext,
        manualLockEnabled,
        previewActive: previewState !== null,
      }),
    [
      circadianState,
      connectionSentinelState,
      manualLockEnabled,
      playbackContext,
      previewState,
      resolved.activeProfile,
      studioState,
    ],
  );

  return (
    <AppSheet open={contextLensOpen} onOpenChange={(open) => (open ? undefined : closeContextLens())}>
      <AppSheetContent
        className="overflow-hidden p-0 sm:w-[min(100vw-2rem,36rem)]"
        data-testid="lighting-context-lens-sheet"
      >
        <AppSheetHeader>
          <AppSheetTitle>Context Lens</AppSheetTitle>
          <AppSheetDescription>Which rule owns each lighting surface, and the signals behind it.</AppSheetDescription>
        </AppSheetHeader>
        <AppSheetBody className="space-y-3 px-4 py-3 sm:px-5">
          {resolved.contextLens.map((entry) => (
            <div
              key={`${entry.surface}-${entry.owner}`}
              className="rounded-lg border border-border/60 px-3 py-2"
              data-testid={`lighting-context-lens-${entry.surface}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <p className="text-sm font-medium">{entry.surface === "case" ? "Case" : "Keys"}</p>
                <Badge variant="secondary" className="text-xs">
                  {entry.label}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{entry.detail}</p>
            </div>
          ))}
          {resolved.contextLens.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No resolver data available.</p>
          ) : null}
          <section aria-labelledby="lighting-context-lens-signals-title" data-testid="lighting-context-lens-signals">
            <h3 id="lighting-context-lens-signals-title" className="mb-1 text-sm font-semibold">
              Signals
            </h3>
            <dl className="divide-y divide-border/60 rounded-lg border border-border/60">
              {signals.map((signal) => (
                <div
                  key={signal.id}
                  className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-xs"
                  data-testid={`lighting-context-signal-${signal.id}`}
                >
                  <dt className="shrink-0 text-muted-foreground">{signal.label}</dt>
                  <dd className="min-w-0 text-right font-medium">{signal.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </AppSheetBody>
      </AppSheetContent>
    </AppSheet>
  );
}
