/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type DeviceFailureState = {
  errorStreak: number;
  backoffUntilMs: number;
  circuitUntilMs: number;
  /** The one user request let through an open circuit to see whether the device is back. */
  userCircuitProbe: Promise<unknown> | null;
};

export type FailurePolicy = {
  backoffBaseMs: number;
  backoffFactor: number;
  backoffMaxMs: number;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMs: number;
};

const freshState = (): DeviceFailureState => ({
  errorStreak: 0,
  backoffUntilMs: 0,
  circuitUntilMs: 0,
  userCircuitProbe: null,
});

export const computeBackoffMs = (policy: FailurePolicy, streak: number) => {
  if (policy.backoffBaseMs <= 0 || policy.backoffMaxMs <= 0 || streak <= 0) return 0;
  const factor = Math.max(1, policy.backoffFactor);
  return Math.min(policy.backoffMaxMs, Math.round(policy.backoffBaseMs * Math.pow(factor, streak - 1)));
};

/**
 * Failure streak, backoff and circuit breaker, one set per device scope (the scope that picks the lane). A device
 * that keeps failing must not slow another device's requests, and another device answering must not close its
 * circuit.
 */
export class PerDeviceFailureState {
  private readonly states = new Map<string, DeviceFailureState>();

  forDevice(deviceScope: string): DeviceFailureState {
    const state = this.states.get(deviceScope) ?? freshState();
    this.states.set(deviceScope, state);
    return state;
  }

  /** Adds a failure of `weight` and returns whether the device's circuit is open afterwards. */
  recordFailure(deviceScope: string, weight: number, policy: FailurePolicy, nowMs = Date.now()): boolean {
    const state = this.forDevice(deviceScope);
    state.errorStreak += weight;
    const backoffMs = computeBackoffMs(policy, state.errorStreak);
    if (backoffMs > 0) state.backoffUntilMs = Math.max(state.backoffUntilMs, nowMs + backoffMs);
    if (policy.circuitBreakerThreshold <= 0 || state.errorStreak < policy.circuitBreakerThreshold) return false;
    state.circuitUntilMs = Math.max(state.circuitUntilMs, nowMs + policy.circuitBreakerCooldownMs);
    return true;
  }

  reset(deviceScope: string): void {
    Object.assign(this.forDevice(deviceScope), freshState());
  }

  clear(): void {
    this.states.clear();
  }
}
