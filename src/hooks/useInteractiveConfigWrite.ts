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
import { createLatestIntentWriteLane } from "@/lib/deviceInteraction/latestIntentWriteLane";
import type { LatestIntentWriteLane } from "@/lib/deviceInteraction/latestIntentWriteLane";
import { useC64UpdateConfigBatch } from "@/hooks/useC64Connection";
import { reportUserError } from "@/lib/uiErrors";

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
  /** Send one or more item updates to the device immediately. */
  write: (updates: Record<string, string | number>) => void;
  /** Whether a write is currently in-flight. */
  isPending: boolean;
}

/**
 * Reusable hook for interactive config writes that bypass the global write
 * queue. Follows the same pattern as the Play page volume slider (Approach D):
 * - `immediate: true` — request fires in ≤ 50 ms, no queue wait.
 * - `skipInvalidation: true` — no React Query refetch per write; a single
 *   debounced reconciliation refetch fires after the last write settles.
 * - `LatestIntentWriteLane` — coalesces rapid writes; only the latest intent
 *   is sent to the device.
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
      beforeRun: () => waitForMachineTransitionsToSettle(),
      run: async (updates) => {
        const endBurst = beginInteractiveWriteBurst();
        try {
          await mutateRef.current({
            category: categoryRef.current,
            updates,
            immediate: true,
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
    (updates: Record<string, string | number>) => {
      setIsPending(true);
      void laneRef
        .current!.schedule(updates)
        .then(() => {
          setIsPending(false);
        })
        .catch((error: unknown) => {
          setIsPending(false);
          reportUserError({
            operation: `INTERACTIVE_WRITE_${categoryRef.current.toUpperCase().replace(/\s+/g, "_")}`,
            title: "Update failed",
            description: (error as Error).message ?? "Unknown error",
            error,
            context: { category: categoryRef.current, updates },
            retry: () => write(updates),
          });
        });
      scheduleReconciliation();
    },
    [scheduleReconciliation],
  );

  return { write, isPending };
}
