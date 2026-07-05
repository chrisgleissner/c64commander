/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  beginInteractiveWriteBurst,
  waitForMachineTransitionsToSettle,
} from "@/lib/deviceInteraction/deviceActivityGate";
import { loadDeviceSafetyConfig } from "@/lib/config/deviceSafetySettings";
import { createLatestIntentWriteLane } from "@/lib/deviceInteraction/latestIntentWriteLane";
import type { LatestIntentWriteLane } from "@/lib/deviceInteraction/latestIntentWriteLane";
import { useC64UpdateConfigBatch } from "@/hooks/useC64Connection";
import { getSelectedSavedDeviceProductFamilySync } from "@/lib/savedDevices/store";
import { reportUserError } from "@/lib/uiErrors";
import { addLog } from "@/lib/logging";

const INTERACTIVE_WRITE_QUIET_MS = 400;

const waitForInteractiveWriteQuietUntil = async (quietUntilMs: number) => {
  const waitMs = Math.max(0, quietUntilMs - Date.now());
  if (waitMs <= 0) return;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, waitMs);
  });
};

export interface InteractiveWriteOptions {
  /** Config category name, e.g. "Audio Mixer", "LED Strip Settings". */
  category: string;
  /**
   * Query key prefixes to invalidate during reconciliation.
   * Defaults to `["c64-config-items", category]`.
   */
  reconcileQueryKeys?: string[][];
  /** Delay before the reconciliation refetch fires. Default: 250 ms. */
  reconciliationDelayMs?: number;
}

export interface InteractiveWriteResult {
  /** Queue one or more item updates for safe device propagation. */
  write: (updates: Record<string, string | number>) => Promise<void>;
  /** Whether a write is currently in-flight. */
  isPending: boolean;
}

/**
 * Reusable hook for interactive config writes. It keeps local controls
 * responsive while routing device traffic through the safety queue:
 * - `skipInvalidation: true` — no React Query refetch per write; a single
 *   debounced reconciliation refetch fires after the last write settles.
 * - `LatestIntentWriteLane` plus a short quiet window — coalesces rapid
 *   writes before the first device call; only the latest intent is sent.
 * - `waitForMachineTransitionsToSettle` — gates writes during resets/reboots.
 */
export function useInteractiveConfigWrite({
  category,
  reconcileQueryKeys,
  reconciliationDelayMs = 250,
}: InteractiveWriteOptions): InteractiveWriteResult {
  const queryClient = useQueryClient();
  const updateConfigBatch = useC64UpdateConfigBatch();
  const [isPending, setIsPending] = useState(false);
  const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // In-flight write counter, not a boolean: two overlapping write() calls on
  // this lane (e.g. two SID sliders committed in quick succession) used to
  // share one writeBurstActiveRef/isPending flag, so whichever call settled
  // FIRST reset it to false while the second was still in flight - isPending
  // read false during an active write, and a third write starting right then
  // saw burst=false, skipping the 400ms coalescing quiet window entirely.
  // See HARD9-087.
  const pendingCountRef = useRef(0);
  const quietUntilRef = useRef(0);

  // Stable resolved query key sets for reconciliation.
  const effectiveReconcileKeys = reconcileQueryKeys ?? [["c64-config-items", category]];

  // The write lane is created once on mount and lives for the component
  // lifetime. It is not recreated when category or other options change.
  const laneRef = useRef<LatestIntentWriteLane<Record<string, string | number>> | null>(null);

  // Keep a ref to the latest batch mutator so the lane's run closure always
  // sees the current mutateAsync without needing recreation.
  const mutateRef = useRef(updateConfigBatch.mutateAsync);
  useEffect(() => {
    mutateRef.current = updateConfigBatch.mutateAsync;
  });

  // Keep a ref to the latest category and reconcile keys so the lane closure
  // stays current without recreation.
  const categoryRef = useRef(category);
  useEffect(() => {
    categoryRef.current = category;
  });
  const reconcileKeysRef = useRef(effectiveReconcileKeys);
  useEffect(() => {
    reconcileKeysRef.current = effectiveReconcileKeys;
  });

  if (!laneRef.current) {
    laneRef.current = createLatestIntentWriteLane<Record<string, string | number>>({
      beforeRun: async () => {
        await waitForMachineTransitionsToSettle();
        await waitForInteractiveWriteQuietUntil(quietUntilRef.current);
      },
      // This lane is shared by every control in the category (e.g. all 8 SID
      // sliders). Merge instead of replace so committing item A's write while
      // item B's write is still pending combines both into one batch, instead
      // of silently discarding item B's intent. See HARD9-016.
      merge: (previous, next) => ({ ...previous, ...next }),
      run: async (updates) => {
        const safety = loadDeviceSafetyConfig();
        const endBurst = beginInteractiveWriteBurst(safety.configsCooldownMs);
        try {
          const productFamily = getSelectedSavedDeviceProductFamilySync();
          addLog("debug", "Interactive config write sending latest intent", {
            category: categoryRef.current,
            updates,
            productFamily,
            skipInvalidation: true,
            quietMs: INTERACTIVE_WRITE_QUIET_MS,
            backgroundReadCooldownMs: safety.configsCooldownMs,
          });
          await mutateRef.current({
            category: categoryRef.current,
            updates,
            skipInvalidation: true,
          });
        } finally {
          endBurst();
        }
      },
    });
  }

  const scheduleReconciliation = useCallback(() => {
    if (reconcileTimer.current !== null) {
      clearTimeout(reconcileTimer.current);
    }
    reconcileTimer.current = setTimeout(() => {
      reconcileTimer.current = null;
      for (const queryKey of reconcileKeysRef.current) {
        void queryClient.invalidateQueries({ queryKey });
      }
    }, reconciliationDelayMs);
  }, [queryClient, reconciliationDelayMs]);

  // Clean up the reconciliation timer on unmount.
  useEffect(() => {
    return () => {
      if (reconcileTimer.current !== null) {
        clearTimeout(reconcileTimer.current);
      }
    };
  }, []);

  const write = useCallback(
    async (updates: Record<string, string | number>) => {
      const isBurst = pendingCountRef.current > 0;
      pendingCountRef.current += 1;
      setIsPending(true);
      if (isBurst) {
        quietUntilRef.current = Date.now() + INTERACTIVE_WRITE_QUIET_MS;
      } else {
        quietUntilRef.current = 0;
      }
      addLog("debug", "Interactive config write queued", {
        category: categoryRef.current,
        updates,
        priority: "user",
        coalescing: "latest-intent",
      });
      try {
        await laneRef.current!.schedule(updates);
      } catch (error: unknown) {
        reportUserError({
          operation: `INTERACTIVE_WRITE_${categoryRef.current.toUpperCase().replace(/\s+/g, "_")}`,
          title: "Update failed",
          description: error instanceof Error ? error.message : String(error),
          error,
          context: { category: categoryRef.current, updates },
          retry: () => {
            void write(updates);
          },
        });
        throw error;
      } finally {
        pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
        if (pendingCountRef.current === 0) {
          setIsPending(false);
        }
        scheduleReconciliation();
      }
    },
    [scheduleReconciliation],
  );

  return { write, isPending };
}
