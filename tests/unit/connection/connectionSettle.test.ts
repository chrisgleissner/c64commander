/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const manager = vi.hoisted(() => ({
  state: "DISCOVERING" as string,
  listeners: new Set<() => void>(),
}));

vi.mock("@/lib/connection/connectionManager", () => ({
  getConnectionSnapshot: () => ({ state: manager.state }),
  subscribeConnection: (listener: () => void) => {
    manager.listeners.add(listener);
    return () => manager.listeners.delete(listener);
  },
}));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));

import { addLog } from "@/lib/logging";
import {
  DISCOVERY_SETTLE_TIMEOUT_MS,
  isDiscoveryPending,
  waitForDiscoveryToSettle,
} from "@/lib/connection/connectionSettle";

const changeState = (state: string) => {
  manager.state = state;
  [...manager.listeners].forEach((listener) => listener());
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(addLog).mockClear();
  manager.listeners.clear();
  manager.state = "DISCOVERING";
});
afterEach(() => vi.useRealTimers());

describe("isDiscoveryPending", () => {
  it.each([
    ["UNKNOWN", true],
    ["DISCOVERING", true],
    ["REAL_CONNECTED", false],
    ["DEMO_ACTIVE", false],
    ["OFFLINE_NO_DEMO", false],
  ])("%s: %s", (state, pending) => {
    expect(isDiscoveryPending(state as never)).toBe(pending);
  });
});

describe("waitForDiscoveryToSettle", () => {
  it("answers at once, without listening, when discovery is not pending", async () => {
    manager.state = "REAL_CONNECTED";

    expect(await waitForDiscoveryToSettle()).toBe("settled");

    expect(manager.listeners.size).toBe(0);
  });

  it.each(["REAL_CONNECTED", "OFFLINE_NO_DEMO", "DEMO_ACTIVE"])("answers when discovery ends as %s", async (ending) => {
    const waiting = waitForDiscoveryToSettle();
    await vi.advanceTimersByTimeAsync(300);
    changeState("DISCOVERING");
    changeState(ending);

    expect(await waiting).toBe("settled");
    expect(manager.listeners.size).toBe(0);
  });

  it("keeps waiting through the states that are still discovery", async () => {
    manager.state = "UNKNOWN";
    let answer: string | null = null;
    void waitForDiscoveryToSettle().then((result) => (answer = result));

    changeState("DISCOVERING");
    await vi.advanceTimersByTimeAsync(100);

    expect(answer).toBeNull();
  });

  it("gives up at the bound, logs it, and stops listening", async () => {
    const waiting = waitForDiscoveryToSettle();

    await vi.advanceTimersByTimeAsync(DISCOVERY_SETTLE_TIMEOUT_MS);

    expect(await waiting).toBe("timeout");
    expect(manager.listeners.size).toBe(0);
    expect(addLog).toHaveBeenCalledWith("info", "Connection discovery did not settle in time for a ROM decision", {
      waitedMs: DISCOVERY_SETTLE_TIMEOUT_MS,
      state: "DISCOVERING",
    });
  });

  it("does not let a late state change answer twice", async () => {
    const waiting = waitForDiscoveryToSettle(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await waiting).toBe("timeout");

    expect(() => changeState("REAL_CONNECTED")).not.toThrow();
  });
});
