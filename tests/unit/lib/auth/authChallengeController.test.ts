/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const snapshot = {
  selectedDeviceId: "dev-c64u",
  devices: [{ id: "dev-c64u", name: "Living Room C64U", host: "192.168.1.167" }],
};

vi.mock("@/lib/savedDevices/store", () => ({
  getSavedDevicesSnapshot: () => snapshot,
}));

const setPasswordForDevice = vi.fn(async () => {});
const setPassword = vi.fn(async () => {});
vi.mock("@/lib/secureStorage", () => ({
  setPasswordForDevice: (...args: unknown[]) => setPasswordForDevice(...args),
  setPassword: (...args: unknown[]) => setPassword(...args),
}));

const applyC64APIConfigFromStorage = vi.fn(async () => {});
vi.mock("@/lib/c64api", () => ({
  applyC64APIConfigFromStorage: () => applyC64APIConfigFromStorage(),
}));

const verifyCurrentConnectionTarget = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/connection/connectionManager", () => ({
  verifyCurrentConnectionTarget: () => verifyCurrentConnectionTarget(),
}));

const addLog = vi.fn();
vi.mock("@/lib/logging", () => ({
  addLog: (...args: unknown[]) => addLog(...args),
}));

import { submitAuthChallengePassword } from "@/lib/auth/authChallengeController";
import { getAuthChallengeSnapshot, notifyAuthRequired, resetAuthChallengeForTests } from "@/lib/auth/authChallenge";

const SECRET = "hunter2-network-pass";

const auth403 = () => Object.assign(new Error("HTTP 403: Forbidden"), { c64uHttpStatus: 403 });

describe("submitAuthChallengePassword", () => {
  beforeEach(() => {
    resetAuthChallengeForTests();
    setPasswordForDevice.mockClear();
    setPassword.mockClear();
    applyC64APIConfigFromStorage.mockClear();
    verifyCurrentConnectionTarget.mockReset();
    verifyCurrentConnectionTarget.mockResolvedValue({ ok: true });
    addLog.mockClear();
  });

  it("stores the password for the affected device, re-applies config, then re-probes", async () => {
    notifyAuthRequired({ host: "192.168.1.167" });
    const recovered = await submitAuthChallengePassword(SECRET);

    expect(recovered).toBe(true);
    expect(setPasswordForDevice).toHaveBeenCalledWith("dev-c64u", SECRET);
    expect(applyC64APIConfigFromStorage).toHaveBeenCalledTimes(1);
    expect(verifyCurrentConnectionTarget).toHaveBeenCalledTimes(1);
    // Recovered → challenge closed.
    expect(getAuthChallengeSnapshot()).toBeNull();
  });

  it("orders the recovery steps store → reapply → reprobe", async () => {
    const order: string[] = [];
    setPasswordForDevice.mockImplementation(async () => {
      order.push("store");
    });
    applyC64APIConfigFromStorage.mockImplementation(async () => {
      order.push("reapply");
    });
    verifyCurrentConnectionTarget.mockImplementation(async () => {
      order.push("reprobe");
      return { ok: true };
    });
    notifyAuthRequired({ host: "192.168.1.167" });
    await submitAuthChallengePassword(SECRET);
    expect(order).toEqual(["store", "reapply", "reprobe"]);
  });

  it("re-prompts on a wrong password (re-probe still Forbidden) and never closes the challenge", async () => {
    verifyCurrentConnectionTarget.mockResolvedValue({ ok: false, error: "HTTP 403: Forbidden" });
    notifyAuthRequired({ host: "192.168.1.167" });

    const recovered = await submitAuthChallengePassword("wrong-pass");

    expect(recovered).toBe(false);
    const challenge = getAuthChallengeSnapshot();
    expect(challenge).not.toBeNull();
    expect(challenge?.status).toBe("error");
    expect(challenge?.errorMessage).toMatch(/rejected that password/i);
    expect(challenge?.attemptCount).toBe(1);
  });

  it("does NOT claim a wrong password when the re-probe fails transiently (device dropped out)", async () => {
    // The C64U drops out intermittently; a non-403 failure must not be reported
    // as a rejected password.
    verifyCurrentConnectionTarget.mockResolvedValue({
      ok: false,
      error: "Device timed out. Check that it is powered on.",
    });
    notifyAuthRequired({ host: "192.168.1.167" });

    const recovered = await submitAuthChallengePassword("pwd");

    expect(recovered).toBe(false);
    const challenge = getAuthChallengeSnapshot();
    expect(challenge?.errorMessage).not.toMatch(/rejected that password/i);
    expect(challenge?.errorMessage).toMatch(/didn't respond|busy/i);
  });

  it("rejects an empty password without touching storage", async () => {
    notifyAuthRequired({ host: "192.168.1.167" });
    const recovered = await submitAuthChallengePassword("   ");
    expect(recovered).toBe(false);
    expect(setPasswordForDevice).not.toHaveBeenCalled();
    expect(getAuthChallengeSnapshot()?.errorMessage).toMatch(/enter the network password/i);
  });

  it("prefers a captured retry closure over a blind re-probe and treats its auth error as wrong password", async () => {
    const retry = vi.fn(async () => {
      throw auth403();
    });
    notifyAuthRequired({ host: "192.168.1.167", retry });

    const recovered = await submitAuthChallengePassword("still-wrong");

    expect(recovered).toBe(false);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(verifyCurrentConnectionTarget).not.toHaveBeenCalled();
    expect(getAuthChallengeSnapshot()?.errorMessage).toMatch(/rejected that password/i);
  });

  it("closes the challenge when the captured retry succeeds", async () => {
    const retry = vi.fn(async () => "ok");
    notifyAuthRequired({ host: "192.168.1.167", retry });
    const recovered = await submitAuthChallengePassword(SECRET);
    expect(recovered).toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(getAuthChallengeSnapshot()).toBeNull();
  });

  it("NEVER logs the password — not in any addLog payload on failure", async () => {
    verifyCurrentConnectionTarget.mockRejectedValue(new Error("network down"));
    notifyAuthRequired({ host: "192.168.1.167" });

    await submitAuthChallengePassword(SECRET);

    expect(addLog).toHaveBeenCalled();
    const serialized = JSON.stringify(addLog.mock.calls);
    expect(serialized).not.toContain(SECRET);
    // A non-auth failure surfaces a generic, non-leaking message.
    expect(getAuthChallengeSnapshot()?.errorMessage).toMatch(/couldn't apply the password/i);
  });

  it("is a no-op when no challenge is open", async () => {
    const recovered = await submitAuthChallengePassword(SECRET);
    expect(recovered).toBe(false);
    expect(setPasswordForDevice).not.toHaveBeenCalled();
  });
});
