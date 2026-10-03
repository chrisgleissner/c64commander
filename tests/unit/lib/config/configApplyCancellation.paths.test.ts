/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TelnetSessionApi } from "@/lib/telnet/telnetTypes";

const logs = vi.hoisted(() => ({ addLog: vi.fn() }));
vi.mock("@/lib/logging", () => logs);

import {
  cancelActiveConfigApply,
  CONFIG_APPLY_MENU_EXIT_TIMEOUT_MS,
  ConfigApplyCancelledError,
  createCancellableTelnetSession,
  leaveDeviceMenu,
  raceConfigApplyCancellation,
  runCancellableConfigApply,
  throwIfConfigApplyCancelled,
} from "@/lib/config/configApplyCancellation";

const sessionStub = () =>
  ({
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    isConnected: vi.fn(() => true),
    sendKey: vi.fn(async () => undefined),
    sendRaw: vi.fn(async () => undefined),
    readScreen: vi.fn(async () => ({ cells: [], menus: [], screenType: "unknown" })),
  }) as unknown as TelnetSessionApi & Record<string, ReturnType<typeof vi.fn>>;

describe("settings-file apply cancellation", () => {
  beforeEach(() => logs.addLog.mockReset());
  afterEach(() => vi.useRealTimers());

  it("throws only once the signal has aborted", () => {
    const controller = new AbortController();
    expect(() => throwIfConfigApplyCancelled(undefined, "step")).not.toThrow();
    expect(() => throwIfConfigApplyCancelled(controller.signal, "step")).not.toThrow();
    controller.abort();
    expect(() => throwIfConfigApplyCancelled(controller.signal, "FTP read")).toThrow(
      "Applying the settings file was canceled by Stop (at FTP read)",
    );
  });

  it("runs a step directly when there is no signal to race", async () => {
    await expect(raceConfigApplyCancellation(undefined, "step", async () => 42)).resolves.toBe(42);
  });

  it("logs the outcome of a step that Stop abandoned once it finally settles", async () => {
    const controller = new AbortController();
    let failStep: (error: Error) => void = () => undefined;
    const step = raceConfigApplyCancellation(
      controller.signal,
      "FTP write",
      () => new Promise<void>((_, reject) => (failStep = reject)),
    );

    controller.abort();
    await expect(step).rejects.toBeInstanceOf(ConfigApplyCancelledError);
    failStep(new Error("socket closed"));
    await vi.waitFor(() =>
      expect(logs.addLog).toHaveBeenCalledWith(
        "warn",
        "A settings-file step failed after Stop cancelled it",
        expect.objectContaining({ step: "FTP write", error: "socket closed" }),
      ),
    );
  });

  it("passes connection calls straight through and races raw input against Stop", async () => {
    const session = sessionStub();
    const controller = new AbortController();
    const cancellable = createCancellableTelnetSession(session, controller.signal);

    await cancellable.connect("c64u", 23, "pw");
    await cancellable.disconnect();
    expect(cancellable.isConnected()).toBe(true);
    await cancellable.sendRaw("RUN\r");
    controller.abort();

    expect(session.connect).toHaveBeenCalledWith("c64u", 23, "pw");
    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(session.sendRaw).toHaveBeenCalledWith("RUN\r");
    await expect((async () => cancellable.sendRaw("LIST\r"))()).rejects.toBeInstanceOf(ConfigApplyCancelledError);
    expect(session.sendRaw).toHaveBeenCalledTimes(1);
  });

  it("gives up leaving the menu after its bound and logs a warning", async () => {
    vi.useFakeTimers();
    const session = sessionStub();
    session.sendKey.mockImplementation(() => new Promise(() => undefined));

    const leaving = leaveDeviceMenu(session, "test");
    await vi.advanceTimersByTimeAsync(CONFIG_APPLY_MENU_EXIT_TIMEOUT_MS + 1);
    await leaving;

    expect(logs.addLog).toHaveBeenCalledWith(
      "warn",
      "Could not leave the device menu after an interrupted settings-file apply",
      expect.objectContaining({ reason: "test", error: expect.stringContaining("took over") }),
    );
  });

  it("keeps a newer apply cancellable when an older one finishes after it started", async () => {
    let finishFirst: () => void = () => undefined;
    const first = runCancellableConfigApply(() => new Promise<void>((resolve) => (finishFirst = resolve)));
    let secondSignal: AbortSignal | undefined;
    const second = runCancellableConfigApply(
      (signal) =>
        new Promise<void>((_, reject) => {
          secondSignal = signal;
          signal.addEventListener("abort", () => reject(new ConfigApplyCancelledError("second")));
        }),
    );

    finishFirst();
    await first;
    await cancelActiveConfigApply();

    expect(secondSignal?.aborted).toBe(true);
    await expect(second).rejects.toBeInstanceOf(ConfigApplyCancelledError);
  });
});
