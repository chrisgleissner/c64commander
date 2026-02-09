/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

let overlayActive = false;
let traceOverrideDepth = 0;
const listeners = new Set<(active: boolean) => void>();

export const setDiagnosticsOverlayActive = (active: boolean) => {
    if (overlayActive === active) return;
    overlayActive = active;
    listeners.forEach((listener) => listener(overlayActive));
};

export const isDiagnosticsOverlayActive = () => overlayActive;

export const withDiagnosticsTraceOverride = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    traceOverrideDepth += 1;
    try {
        return await fn();
    } finally {
        traceOverrideDepth = Math.max(0, traceOverrideDepth - 1);
    }
};

export const isDiagnosticsTraceOverrideActive = () => traceOverrideDepth > 0;

export const shouldSuppressDiagnosticsSideEffects = () =>
    overlayActive && traceOverrideDepth === 0;

export const subscribeDiagnosticsOverlay = (listener: (active: boolean) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const resetDiagnosticsOverlayState = () => {
    overlayActive = false;
    traceOverrideDepth = 0;
    listeners.clear();
};
