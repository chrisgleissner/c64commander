/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSyncExternalStore } from "react";
import type {
    HealthCheckProbeRecord,
    HealthCheckProbeType,
    HealthCheckRunResult,
} from "@/lib/diagnostics/healthCheckEngine";

export type HealthCheckStateSnapshot = {
    running: boolean;
    liveProbes: Partial<Record<HealthCheckProbeType, HealthCheckProbeRecord>> | null;
    latestResult: HealthCheckRunResult | null;
};

let snapshot: HealthCheckStateSnapshot = {
    running: false,
    liveProbes: null,
    latestResult: null,
};

const listeners = new Set<() => void>();

const emit = () => {
    listeners.forEach((listener) => listener());
};

export const getHealthCheckStateSnapshot = () => snapshot;

export const subscribeHealthCheckState = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const setHealthCheckStateSnapshot = (next: Partial<HealthCheckStateSnapshot>) => {
    snapshot = {
        ...snapshot,
        ...next,
    };
    emit();
};

export const resetHealthCheckStateSnapshot = () => {
    snapshot = {
        running: false,
        liveProbes: null,
        latestResult: null,
    };
    emit();
};

export const useHealthCheckState = () =>
    useSyncExternalStore(subscribeHealthCheckState, getHealthCheckStateSnapshot, getHealthCheckStateSnapshot);
