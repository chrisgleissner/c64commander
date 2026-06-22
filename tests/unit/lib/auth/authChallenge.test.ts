/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const defaultSnapshot = () => ({
  selectedDeviceId: "dev-c64u",
  devices: [
    { id: "dev-c64u", name: "Living Room C64U", host: "192.168.1.167" },
    { id: "dev-u64", name: "Studio U64", host: "192.168.1.13" },
  ],
});

let snapshot: ReturnType<typeof defaultSnapshot> = defaultSnapshot();
let snapshotError: Error | null = null;

vi.mock("@/lib/savedDevices/store", () => ({
  getSavedDevicesSnapshot: () => {
    if (snapshotError) throw snapshotError;
    return snapshot;
  },
}));

const addLog = vi.fn();
vi.mock("@/lib/logging", () => ({
  addLog: (...args: unknown[]) => addLog(...args),
}));

import {
  dismissAuthChallenge,
  getAuthChallengeRetry,
  getAuthChallengeSnapshot,
  notifyAuthRequired,
  notifyAuthSatisfied,
  resetAuthChallengeForTests,
  resolveAuthChallenge,
  setAuthChallengeError,
  setAuthChallengeStatus,
  subscribeAuthChallenge,
} from "@/lib/auth/authChallenge";

describe("authChallenge store", () => {
  beforeEach(() => {
    snapshot = defaultSnapshot();
    snapshotError = null;
    addLog.mockClear();
    resetAuthChallengeForTests();
  });

  it("opens a single challenge and resolves device identity from the selected device", () => {
    notifyAuthRequired();
    const challenge = getAuthChallengeSnapshot();
    expect(challenge).not.toBeNull();
    expect(challenge?.deviceId).toBe("dev-c64u");
    expect(challenge?.deviceLabel).toBe("Living Room C64U");
    expect(challenge?.host).toBe("192.168.1.167");
    expect(challenge?.status).toBe("prompting");
  });

  it("attributes to the device the call hit (host match), not just the selected device", () => {
    notifyAuthRequired({ host: "192.168.1.13" });
    const challenge = getAuthChallengeSnapshot();
    expect(challenge?.deviceId).toBe("dev-u64");
    expect(challenge?.deviceLabel).toBe("Studio U64");
  });

  it("is single-flight: a burst of Forbidden responses raises exactly one popup", () => {
    const listener = vi.fn();
    subscribeAuthChallenge(listener);
    notifyAuthRequired({ host: "192.168.1.167" });
    notifyAuthRequired({ host: "192.168.1.167" });
    notifyAuthRequired({ host: "192.168.1.13" });
    // Only the first notify changed state and emitted.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getAuthChallengeSnapshot()?.deviceId).toBe("dev-c64u");
  });

  it("coalesces a retry closure onto an already-open challenge", () => {
    const retry = vi.fn();
    notifyAuthRequired({ host: "192.168.1.167" });
    expect(getAuthChallengeRetry()).toBeNull();
    notifyAuthRequired({ host: "192.168.1.167", retry });
    expect(getAuthChallengeRetry()).toBe(retry);
  });

  it("re-prompts on error without closing, incrementing the attempt count", () => {
    notifyAuthRequired();
    setAuthChallengeError("wrong password");
    const challenge = getAuthChallengeSnapshot();
    expect(challenge?.status).toBe("error");
    expect(challenge?.errorMessage).toBe("wrong password");
    expect(challenge?.attemptCount).toBe(1);
  });

  it("resolve and dismiss both close the challenge and clear any retry", () => {
    const retry = vi.fn();
    notifyAuthRequired({ retry });
    resolveAuthChallenge();
    expect(getAuthChallengeSnapshot()).toBeNull();
    expect(getAuthChallengeRetry()).toBeNull();

    notifyAuthRequired({ retry });
    dismissAuthChallenge();
    expect(getAuthChallengeSnapshot()).toBeNull();
    expect(getAuthChallengeRetry()).toBeNull();
  });

  it("falls back to the selected device for an unmatched host (live client host always matches in practice)", () => {
    notifyAuthRequired({ host: "10.0.0.99" });
    const challenge = getAuthChallengeSnapshot();
    expect(challenge?.deviceId).toBe("dev-c64u");
    expect(challenge?.deviceLabel).toBe("Living Room C64U");
    expect(challenge?.host).toBe("10.0.0.99");
  });

  it("uses the host as a generic label when no devices are saved", () => {
    snapshot = { selectedDeviceId: "", devices: [] };
    notifyAuthRequired({ host: "10.0.0.99" });
    const challenge = getAuthChallengeSnapshot();
    expect(challenge?.deviceId).toBeNull();
    expect(challenge?.deviceLabel).toBe("10.0.0.99");
  });

  it("uses 'this device' when neither host nor saved devices are available", () => {
    snapshot = { selectedDeviceId: "", devices: [] };
    notifyAuthRequired();
    expect(getAuthChallengeSnapshot()?.deviceLabel).toBe("this device");
  });

  it("auto-closes the challenge when the same host becomes reachable (success)", () => {
    notifyAuthRequired({ host: "192.168.1.167" });
    notifyAuthSatisfied("192.168.1.167");
    expect(getAuthChallengeSnapshot()).toBeNull();
  });

  it("keeps the challenge open when a DIFFERENT host becomes reachable", () => {
    notifyAuthRequired({ host: "192.168.1.167" });
    notifyAuthSatisfied("192.168.1.13");
    expect(getAuthChallengeSnapshot()).not.toBeNull();
  });

  it("auto-closes even after a transient failure left the popup in an error state", () => {
    notifyAuthRequired({ host: "192.168.1.167" });
    setAuthChallengeError("Saved the password, but the device didn't respond — it may be busy. Try again.");
    expect(getAuthChallengeSnapshot()?.status).toBe("error");
    notifyAuthSatisfied("192.168.1.167");
    expect(getAuthChallengeSnapshot()).toBeNull();
  });

  it("notifyAuthSatisfied is a no-op when no challenge is open", () => {
    const listener = vi.fn();
    subscribeAuthChallenge(listener);
    notifyAuthSatisfied("192.168.1.167");
    expect(listener).not.toHaveBeenCalled();
    expect(getAuthChallengeSnapshot()).toBeNull();
  });

  it("still opens the popup with a generic label when device-identity resolution throws", () => {
    snapshotError = new Error("store boom");
    notifyAuthRequired({ host: "192.168.1.167" });
    const challenge = getAuthChallengeSnapshot();
    expect(challenge).not.toBeNull();
    // Host survives; label falls back to the host since the saved-device lookup failed.
    expect(challenge?.host).toBe("192.168.1.167");
    expect(challenge?.deviceLabel).toBe("192.168.1.167");
    expect(addLog).toHaveBeenCalledWith(
      "debug",
      "Auth challenge identity resolution failed; using generic label",
      expect.objectContaining({ error: "store boom" }),
    );
  });

  it("falls back to a stringified message when identity resolution throws a non-Error", () => {
    snapshotError = "not-an-error-object" as unknown as Error;
    notifyAuthRequired();
    expect(getAuthChallengeSnapshot()?.deviceLabel).toBe("this device");
    expect(addLog).toHaveBeenCalledWith(
      "debug",
      "Auth challenge identity resolution failed; using generic label",
      expect.objectContaining({ error: "not-an-error-object" }),
    );
  });

  it("setAuthChallengeStatus updates the status of an open challenge", () => {
    const listener = vi.fn();
    notifyAuthRequired({ host: "192.168.1.167" });
    subscribeAuthChallenge(listener);
    setAuthChallengeStatus("submitting");
    expect(getAuthChallengeSnapshot()?.status).toBe("submitting");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("setAuthChallengeStatus is a no-op when no challenge is open", () => {
    const listener = vi.fn();
    subscribeAuthChallenge(listener);
    setAuthChallengeStatus("submitting");
    expect(listener).not.toHaveBeenCalled();
    expect(getAuthChallengeSnapshot()).toBeNull();
  });

  it("setAuthChallengeError is a no-op when no challenge is open", () => {
    const listener = vi.fn();
    subscribeAuthChallenge(listener);
    setAuthChallengeError("wrong password");
    expect(listener).not.toHaveBeenCalled();
    expect(getAuthChallengeSnapshot()).toBeNull();
  });

  it("resolveAuthChallenge is a no-op when nothing is open and no retry is pending", () => {
    const listener = vi.fn();
    subscribeAuthChallenge(listener);
    resolveAuthChallenge();
    expect(listener).not.toHaveBeenCalled();
    expect(getAuthChallengeSnapshot()).toBeNull();
  });

  it("dismissAuthChallenge is a no-op when nothing is open and no retry is pending", () => {
    const listener = vi.fn();
    subscribeAuthChallenge(listener);
    dismissAuthChallenge();
    expect(listener).not.toHaveBeenCalled();
    expect(getAuthChallengeSnapshot()).toBeNull();
  });

  it("unsubscribe stops a listener from receiving further notifications", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAuthChallenge(listener);
    unsubscribe();
    notifyAuthRequired({ host: "192.168.1.167" });
    expect(listener).not.toHaveBeenCalled();
  });
});
