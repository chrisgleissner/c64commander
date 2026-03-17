/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

let overlayActive = false;
let traceOverrideDepth = 0;
let suppressionPrimeUntilMs = 0;
let suppressionPrimeTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(active: boolean) => void>();
const suppressionListeners = new Set<(active: boolean) => void>();

const isSuppressionPrimed = () => suppressionPrimeUntilMs > Date.now();
const isSuppressionArmed = () => overlayActive || isSuppressionPrimed();

const notifySuppressionListeners = () => {
  const active = isSuppressionArmed();
  suppressionListeners.forEach((listener) => listener(active));
};

const clearSuppressionPrimeTimer = () => {
  if (suppressionPrimeTimer === null) return;
  clearTimeout(suppressionPrimeTimer);
  suppressionPrimeTimer = null;
};

const scheduleSuppressionPrimeExpiry = () => {
  clearSuppressionPrimeTimer();
  if (!isSuppressionPrimed()) return;
  const delayMs = Math.max(0, suppressionPrimeUntilMs - Date.now());
  suppressionPrimeTimer = setTimeout(() => {
    suppressionPrimeTimer = null;
    notifySuppressionListeners();
  }, delayMs);
};

export const primeDiagnosticsOverlaySuppression = (windowMs = 500) => {
  suppressionPrimeUntilMs = Math.max(suppressionPrimeUntilMs, Date.now() + Math.max(0, windowMs));
  scheduleSuppressionPrimeExpiry();
  notifySuppressionListeners();
};

export const setDiagnosticsOverlayActive = (active: boolean) => {
  clearSuppressionPrimeTimer();
  suppressionPrimeUntilMs = 0;
  if (overlayActive === active) return;
  overlayActive = active;
  listeners.forEach((listener) => listener(overlayActive));
  notifySuppressionListeners();
};

export const isDiagnosticsOverlayActive = () => overlayActive;
export const isDiagnosticsOverlaySuppressionArmed = () => isSuppressionArmed();

export const withDiagnosticsTraceOverride = async <T>(fn: () => Promise<T> | T): Promise<T> => {
  traceOverrideDepth += 1;
  try {
    return await fn();
  } finally {
    traceOverrideDepth = Math.max(0, traceOverrideDepth - 1);
  }
};

export const isDiagnosticsTraceOverrideActive = () => traceOverrideDepth > 0;

export const shouldSuppressDiagnosticsSideEffects = () => isSuppressionArmed() && traceOverrideDepth === 0;

export const subscribeDiagnosticsOverlay = (listener: (active: boolean) => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const subscribeDiagnosticsSuppression = (listener: (active: boolean) => void) => {
  suppressionListeners.add(listener);
  return () => suppressionListeners.delete(listener);
};

export const resetDiagnosticsOverlayState = () => {
  overlayActive = false;
  traceOverrideDepth = 0;
  suppressionPrimeUntilMs = 0;
  clearSuppressionPrimeTimer();
  listeners.clear();
  suppressionListeners.clear();
};
