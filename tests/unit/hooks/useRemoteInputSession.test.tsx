/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMachineInputBatchMock = vi.fn(async () => ({ errors: [], keyboard: { inputs: [] }, joysticks: [] }));
const injectAutostartMock = vi.fn(async () => undefined);
const addErrorLogMock = vi.fn();

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ sendMachineInputBatch: sendMachineInputBatchMock }),
}));

vi.mock("@/lib/playback/autostart", () => ({
  injectAutostart: (...args: unknown[]) => injectAutostartMock(...args),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: (...args: unknown[]) => addErrorLogMock(...args),
  buildErrorLogDetails: (error: Error, context: Record<string, unknown>) => ({ error: error.message, ...context }),
}));

// The device-safeguard rate-limit (HARD12-017) is its own orthogonal concern
// with dedicated coverage in machineInputThrottle.test.ts; here it always
// resolves immediately so this file's coalescing/debounce timing assertions
// stay exact.
vi.mock("@/lib/remoteInput/machineInputThrottle", () => ({
  waitForMachineInputThrottle: async () => undefined,
}));

import { useRemoteInputSession } from "@/hooks/useRemoteInputSession";
import { resetKernalFallbackInjectionQueueForTests } from "@/lib/remoteInput/kernalFallbackInjector";
import {
  hasActiveInputRelease,
  releaseActiveRemoteInput,
  resetActiveInputReleaseForTests,
} from "@/lib/remoteInput/activeInputRelease";

const flushMicrotasks = async () => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

describe("useRemoteInputSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendMachineInputBatchMock.mockClear();
    injectAutostartMock.mockClear();
    addErrorLogMock.mockClear();
    resetKernalFallbackInjectionQueueForTests();
    resetActiveInputReleaseForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces rapid held-set changes within the debounce window into a single batch (device-safety)", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

    act(() => {
      result.current.setHeldJoystickInputs(new Set(["up"]));
      result.current.setHeldJoystickInputs(new Set(["up", "right"]));
      result.current.setHeldJoystickInputs(new Set(["up", "right", "fire"]));
    });

    expect(sendMachineInputBatchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });

    expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(1);
    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
      events: [{ kind: "joystick", port: 2, inputs: ["up", "right", "fire"], transition: "press" }],
    });
  });

  it("sends only the diff between consecutive flushes, not the full held set again", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

    act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    sendMachineInputBatchMock.mockClear();

    act(() => result.current.setHeldJoystickInputs(new Set(["right"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });

    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
      events: [
        { kind: "joystick", port: 2, inputs: ["right"], transition: "press" },
        { kind: "joystick", port: 2, inputs: ["up"], transition: "release" },
      ],
    });
  });

  it("does not send joystick events when the tier does not support machine:input", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));

    act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });

    expect(sendMachineInputBatchMock).not.toHaveBeenCalled();
  });

  it("routes typed characters through machine:input when full, and through the kernal fallback otherwise", async () => {
    const full = renderHook(() => useRemoteInputSession({ tier: "full" }));
    act(() => full.result.current.sendChar("a"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
      events: [{ kind: "keyboard", inputs: ["a"], transition: "tap" }],
    });

    const fallback = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));
    await act(async () => {
      fallback.result.current.sendChar("a");
    });
    expect(injectAutostartMock).toHaveBeenCalledWith(expect.anything(), new Uint8Array([0x41]));
  });

  it("sends an arbitrary keyboard chord directly on the full tier, including commodore/ctrl modifiers", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    act(() => result.current.sendKeyboardInputs(["a", "commodore"]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
      events: [{ kind: "keyboard", inputs: ["a", "commodore"], transition: "tap" }],
    });
  });

  it("drops a commodore/ctrl chord on the kernal-fallback tier instead of guessing (no ASCII equivalent)", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));
    await act(async () => {
      result.current.sendKeyboardInputs(["a", "commodore"]);
    });
    expect(injectAutostartMock).not.toHaveBeenCalled();
  });

  it("round-trips a plain shifted-letter chord through the kernal fallback char path", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));
    await act(async () => {
      result.current.sendKeyboardInputs(["a", "left_shift"]);
    });
    expect(injectAutostartMock).toHaveBeenCalledWith(expect.anything(), new Uint8Array([0x41]));
  });

  it("round-trips a shifted digit (the BASIC quote) through the kernal fallback char path (HARD15-003)", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));
    await act(async () => {
      result.current.sendKeyboardInputs(["2", "left_shift"]);
    });
    expect(injectAutostartMock).toHaveBeenCalledWith(expect.anything(), new Uint8Array([0x22]));
  });

  it("serializes concurrent kernal-fallback injections instead of racing them (HARD15-001)", async () => {
    let resolveFirst!: () => void;
    injectAutostartMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));

    act(() => result.current.sendChar("a"));
    await act(flushMicrotasks);
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);

    act(() => result.current.sendChar("b"));
    await act(flushMicrotasks);
    // The second injection must wait for the first to settle, not race it.
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);

    resolveFirst();
    await act(flushMicrotasks);

    expect(injectAutostartMock).toHaveBeenCalledTimes(2);
    expect(injectAutostartMock).toHaveBeenNthCalledWith(1, expect.anything(), new Uint8Array([0x41]));
    expect(injectAutostartMock).toHaveBeenNthCalledWith(2, expect.anything(), new Uint8Array([0x42]));
  });

  it("keeps the kernal-fallback injection queue alive after one injection fails (HARD15-001 error isolation)", async () => {
    injectAutostartMock.mockRejectedValueOnce(new Error("device offline"));
    const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));

    act(() => result.current.sendChar("a"));
    await act(flushMicrotasks);
    expect(result.current.connectionStatus).toBe("error");
    expect(addErrorLogMock).toHaveBeenCalledWith(
      "Remote input kernal-fallback char injection failed",
      expect.any(Object),
    );

    act(() => result.current.sendChar("b"));
    await act(flushMicrotasks);
    expect(injectAutostartMock).toHaveBeenCalledTimes(2);
    expect(injectAutostartMock).toHaveBeenNthCalledWith(2, expect.anything(), new Uint8Array([0x42]));
  });

  it("sends a release_all event and clears the held set on releaseAll (panic button / stuck-input safety)", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    sendMachineInputBatchMock.mockClear();

    act(() => result.current.releaseAll());

    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({ events: [{ kind: "release_all" }] });
    expect(result.current.heldJoystickInputs.size).toBe(0);
  });

  it("releases all held inputs when switching output mode", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    sendMachineInputBatchMock.mockClear();

    act(() => result.current.setOutputMode("type"));

    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({ events: [{ kind: "release_all" }] });
    expect(result.current.outputMode).toBe("type");
  });

  it("releases all held inputs when the tab/app is backgrounded", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    sendMachineInputBatchMock.mockClear();

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({ events: [{ kind: "release_all" }] });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("sends a best-effort release_all on unmount when inputs were held", async () => {
    const { result, unmount } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    act(() => result.current.setHeldJoystickInputs(new Set(["fire"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    sendMachineInputBatchMock.mockClear();

    unmount();

    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({ events: [{ kind: "release_all" }] });
  });

  it("does not send a release_all on unmount when nothing was held", async () => {
    const { unmount } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    unmount();
    expect(sendMachineInputBatchMock).not.toHaveBeenCalled();
  });

  it("registers itself as the active input release while mounted and unregisters on unmount (HARD13-001 residual E1)", () => {
    expect(hasActiveInputRelease()).toBe(false);
    const { unmount } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    expect(hasActiveInputRelease()).toBe(true);

    unmount();
    expect(hasActiveInputRelease()).toBe(false);
  });

  it("releases a relayed press via the active-input-release registry, awaited by a device switch (HARD13-001 residual E1)", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    sendMachineInputBatchMock.mockClear();

    await act(async () => {
      await releaseActiveRemoteInput();
    });

    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({ events: [{ kind: "release_all" }] });
    expect(result.current.heldJoystickInputs.size).toBe(0);
  });

  it("is a no-op via the active-input-release registry when nothing was relayed (HARD13-001 residual E1)", async () => {
    renderHook(() => useRemoteInputSession({ tier: "full" }));

    await act(async () => {
      await releaseActiveRemoteInput();
    });

    expect(sendMachineInputBatchMock).not.toHaveBeenCalled();
  });

  it("logs (not throws) when the best-effort release_all on unmount fails", async () => {
    const { result, unmount } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    act(() => result.current.setHeldJoystickInputs(new Set(["fire"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    sendMachineInputBatchMock.mockClear();
    sendMachineInputBatchMock.mockRejectedValueOnce(new Error("device offline"));

    expect(() => unmount()).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });

    expect(addErrorLogMock).toHaveBeenCalledWith("Remote input release-all on unmount failed", expect.any(Object));
  });

  it("routes cursor moves through machine:input when full, and through the kernal fallback otherwise", async () => {
    const full = renderHook(() => useRemoteInputSession({ tier: "full" }));
    act(() => full.result.current.sendCursor("down"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
      events: [{ kind: "keyboard", inputs: ["cursor_up_down"], transition: "tap" }],
    });

    const fallback = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));
    await act(async () => {
      fallback.result.current.sendCursor("down");
    });
    expect(injectAutostartMock).toHaveBeenCalledWith(expect.anything(), new Uint8Array([0x11]));
  });

  it("logs and reports an error status when the kernal-fallback cursor injection fails", async () => {
    injectAutostartMock.mockRejectedValueOnce(new Error("device offline"));
    const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));

    await act(async () => {
      result.current.sendCursor("up");
      await Promise.resolve();
    });

    expect(result.current.connectionStatus).toBe("error");
    expect(addErrorLogMock).toHaveBeenCalledWith(
      "Remote input kernal-fallback cursor injection failed",
      expect.any(Object),
    );
  });

  it("routes special keys through machine:input when full, and through the kernal fallback otherwise", async () => {
    const full = renderHook(() => useRemoteInputSession({ tier: "full" }));
    act(() => full.result.current.sendSpecialKey("f1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
      events: [{ kind: "keyboard", inputs: ["f1"], transition: "tap" }],
    });

    const fallback = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));
    await act(async () => {
      fallback.result.current.sendSpecialKey("f1");
    });
    expect(injectAutostartMock).toHaveBeenCalledWith(expect.anything(), new Uint8Array([0x85]));
  });

  it("dispatches the high-value shifted keys (CLR/INS/F2) as a single atomic tap chord", async () => {
    // These carry their own Shift inside one `tap` event, so the device presses
    // and releases both keys together — no separate Shift press, no stuck Shift.
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    const cases: Array<["clr" | "ins" | "f2", string[]]> = [
      ["clr", ["clr_home", "left_shift"]],
      ["ins", ["inst_del", "left_shift"]],
      ["f2", ["f1", "left_shift"]],
    ];
    for (const [key, inputs] of cases) {
      sendMachineInputBatchMock.mockClear();
      act(() => result.current.sendSpecialKey(key));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });
      expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
        events: [{ kind: "keyboard", inputs, transition: "tap" }],
      });
    }
  });

  it("drops RUN/STOP and RESTORE on the kernal-fallback tier (no kernal-buffer equivalent)", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));

    await act(async () => {
      result.current.sendSpecialKey("run_stop");
    });
    await act(async () => {
      result.current.sendSpecialKey("restore");
    });

    expect(injectAutostartMock).not.toHaveBeenCalled();
  });

  it("logs and reports an error status when the kernal-fallback special-key injection fails", async () => {
    injectAutostartMock.mockRejectedValueOnce(new Error("device offline"));
    const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));

    await act(async () => {
      result.current.sendSpecialKey("f1");
      await Promise.resolve();
    });

    expect(result.current.connectionStatus).toBe("error");
    expect(addErrorLogMock).toHaveBeenCalledWith(
      "Remote input kernal-fallback special-key injection failed",
      expect.any(Object),
    );
  });

  it("drops local held-set state and reports an error status when a send fails", async () => {
    sendMachineInputBatchMock.mockRejectedValueOnce(new Error("device offline"));
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

    act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });

    expect(result.current.connectionStatus).toBe("error");
    expect(addErrorLogMock).toHaveBeenCalledWith("Remote input batch send failed", expect.any(Object));
  });

  it("recovers a possibly-applied failed batch with one release_all (HARD15-007)", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

    act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
      events: [{ kind: "joystick", port: 2, inputs: ["up"], transition: "press" }],
    });
    sendMachineInputBatchMock.mockClear();

    sendMachineInputBatchMock.mockRejectedValueOnce(new Error("timeout"));
    act(() => result.current.setHeldJoystickInputs(new Set(["up", "right"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
      await flushMicrotasks();
    });

    // The failed batch may have actually landed on the device - a single
    // recovery release_all must follow, exactly once.
    expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(2);
    expect(sendMachineInputBatchMock).toHaveBeenLastCalledWith({ events: [{ kind: "release_all" }] });
    sendMachineInputBatchMock.mockClear();

    // The user's own subsequent release must not need to reach the device
    // again - the recovery release_all already got there.
    act(() => result.current.setHeldJoystickInputs(new Set()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    expect(sendMachineInputBatchMock).not.toHaveBeenCalled();
  });

  it("does not send a release_all when a typed-only batch fails with nothing relayed (HARD15-007 guard)", async () => {
    sendMachineInputBatchMock.mockRejectedValueOnce(new Error("timeout"));
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

    act(() => result.current.sendChar("a"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
      await flushMicrotasks();
    });

    expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(1);
    expect(result.current.connectionStatus).toBe("error");
  });

  it("does not loop when the recovery release_all's own batch fails (single-shot, no retry)", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

    act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    sendMachineInputBatchMock.mockClear();

    sendMachineInputBatchMock.mockRejectedValueOnce(new Error("device unreachable"));
    act(() => result.current.releaseAll());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await flushMicrotasks();
    });

    // releaseAll's own release_all batch failed - the recovery guard must
    // recognize it as already-a-release-all and not chase it with another.
    expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(1);
    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({ events: [{ kind: "release_all" }] });
  });

  it("releases held joystick inputs when the tier drops below full support", async () => {
    const { result, rerender } = renderHook(
      ({ tier }: { tier: "full" | "kernal-fallback" }) => useRemoteInputSession({ tier }),
      { initialProps: { tier: "full" } },
    );

    act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    sendMachineInputBatchMock.mockClear();

    rerender({ tier: "kernal-fallback" });

    expect(result.current.heldJoystickInputs.size).toBe(0);
    // HARD13-001 regression: clearing local state is not enough - the inputs are
    // still physically held on the device, so the downgrade must also relay a
    // release_all. Previously this was gated on the (already-downgraded) current
    // tier and silently skipped, stranding the held direction on the device.
    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({ events: [{ kind: "release_all" }] });
  });

  describe("edge cases and stress (port swap, autofire races, bursts)", () => {
    // Regression: swapping ports used to be a bare setState with no transport
    // side effect at all - a direction held on port 2 stayed relayed-held on
    // port 2 forever after swapping to port 1 (never released), because the
    // diff model only compares held-set CONTENTS, not which port they were
    // last sent to. Found by stress-reasoning through "swap ports while a
    // direction is held", now that port-swap is a single always-visible
    // toggle (as easy as autofire) users will do mid-play, not just at setup.
    it("releases the OLD port immediately and re-presses on the NEW port when swapping mid-hold", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

      act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });
      expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
        events: [{ kind: "joystick", port: 2, inputs: ["up"], transition: "press" }],
      });
      sendMachineInputBatchMock.mockClear();

      act(() => result.current.setPort(1));

      // The release on the old port must happen immediately - not wait for
      // the coalesce window - since it's a discrete, safety-relevant action.
      expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
        events: [{ kind: "joystick", port: 2, inputs: ["up"], transition: "release" }],
      });
      sendMachineInputBatchMock.mockClear();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });
      expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
        events: [{ kind: "joystick", port: 1, inputs: ["up"], transition: "press" }],
      });
    });

    it("does not send anything when swapping ports with nothing held", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

      act(() => result.current.setPort(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });

      expect(sendMachineInputBatchMock).not.toHaveBeenCalled();
    });

    it("is a no-op when swapping to the port that is already active", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
      act(() => result.current.setHeldJoystickInputs(new Set(["fire"])));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });
      sendMachineInputBatchMock.mockClear();

      act(() => result.current.setPort(2)); // already 2 (default)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });
      expect(sendMachineInputBatchMock).not.toHaveBeenCalled();
    });

    it("does not strand a port swap on the kernal-fallback tier (no REST relay to release from)", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));
      act(() => result.current.setHeldJoystickInputs(new Set(["up"])));

      expect(() => act(() => result.current.setPort(1))).not.toThrow();
      expect(sendMachineInputBatchMock).not.toHaveBeenCalled();
    });

    // Regression: disabling autofire while the last-sent state happened to be
    // mid "off phase" of the duty cycle left the base held set (which still
    // includes "fire" - the user's finger never left the button) un-relayed,
    // because nothing forced a resync flush on the toggle itself. Uses a very
    // slow rate (0.1Hz -> 10s period, 5s half) so the off-phase window is wide
    // and the assertion isn't sensitive to exact interval/debounce interleaving.
    it("re-syncs the true held state when autofire is disabled mid off-phase", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
      act(() => result.current.setAutofireRateHz(0.1));
      act(() => result.current.setAutofireEnabled(true));
      act(() => result.current.setHeldJoystickInputs(new Set(["fire"])));

      // Comfortably past the 5s half-period boundary, still within the 10s period.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100);
      });
      const lastEventsBeforeDisable = sendMachineInputBatchMock.mock.calls.at(-1)?.[0];
      const fireEventBeforeDisable = lastEventsBeforeDisable?.events.find((e: { inputs?: string[] }) =>
        e.inputs?.includes("fire"),
      );
      // The off-phase flush must have sent a RELEASE for fire (not a press) -
      // confirming autofire actually suppressed it at the device, which is the
      // precondition for the re-sync-on-disable regression below to be meaningful.
      expect(fireEventBeforeDisable?.transition).toBe("release");
      sendMachineInputBatchMock.mockClear();

      act(() => result.current.setAutofireEnabled(false));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });

      // The still-physically-held fire input must be relayed once autofire
      // stops overriding it - not silently left released.
      expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
        events: [{ kind: "joystick", port: 2, inputs: ["fire"], transition: "press" }],
      });
    });

    it("collapses 50 rapid alternating held-set changes within one coalesce window into a single network call", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

      act(() => {
        for (let i = 0; i < 50; i += 1) {
          result.current.setHeldJoystickInputs(i % 2 === 0 ? new Set(["up"]) : new Set(["down"]));
        }
      });
      // Final state after the flapping settles: "down" (odd count 1..49 ends on odd i=49 -> down).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });

      expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(1);
      expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
        events: [{ kind: "joystick", port: 2, inputs: ["down"], transition: "press" }],
      });
    });

    it("keeps sending fresh diffs correctly across many sequential coalesce windows (no drift)", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

      for (let round = 0; round < 20; round += 1) {
        const inputs = round % 2 === 0 ? new Set(["up", "fire"] as const) : new Set(["down"] as const);
        act(() => result.current.setHeldJoystickInputs(inputs));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(40);
        });
      }

      // Last round (19, odd) moved to "down" from "up+fire": both up and fire release.
      const lastCall = sendMachineInputBatchMock.mock.calls.at(-1)?.[0];
      const events = lastCall.events as Array<{ transition: string; inputs: string[] }>;
      const pressEvent = events.find((e) => e.transition === "press");
      const releaseEvent = events.find((e) => e.transition === "release");
      expect(pressEvent?.inputs).toEqual(["down"]);
      expect(new Set(releaseEvent?.inputs)).toEqual(new Set(["up", "fire"]));
    });

    it("continues coalescing correctly while a previous batch send is still in flight (slow network)", async () => {
      let resolveFirst!: () => void;
      sendMachineInputBatchMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = () => resolve({ errors: [], keyboard: { inputs: [] }, joysticks: [] });
          }),
      );
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

      act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });
      // First send is now in flight and NOT yet resolved.
      expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(1);

      // A second, independent change must still schedule and fire its own
      // flush - it must not be blocked waiting for the first to resolve.
      act(() => result.current.setHeldJoystickInputs(new Set(["up", "right"])));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });
      expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(2);
      expect(sendMachineInputBatchMock).toHaveBeenLastCalledWith({
        events: [{ kind: "joystick", port: 2, inputs: ["right"], transition: "press" }],
      });

      resolveFirst();
      await act(async () => {
        await Promise.resolve();
      });
    });

    it("chunks a long typed burst across multiple 64-event batches, in order", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

      act(() => {
        for (let i = 0; i < 70; i += 1) {
          result.current.sendChar("a");
        }
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });

      expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(2);
      expect(sendMachineInputBatchMock.mock.calls[0][0].events).toHaveLength(64);
      expect(sendMachineInputBatchMock.mock.calls[1][0].events).toHaveLength(6);
    });

    it("survives rapid output-mode flapping without leaking a stale held input", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
      act(() => result.current.setHeldJoystickInputs(new Set(["up", "fire"])));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });
      sendMachineInputBatchMock.mockClear();

      act(() => {
        result.current.setOutputMode("type");
        result.current.setOutputMode("joystick");
        result.current.setOutputMode("type");
        result.current.setOutputMode("joystick");
      });

      expect(result.current.heldJoystickInputs.size).toBe(0);
      // Every mode flip that actually changes mode calls releaseAll, which is
      // immediate (not debounced) - each must have gone out.
      expect(
        sendMachineInputBatchMock.mock.calls.every((call) =>
          call[0].events.every((e: { kind: string }) => e.kind === "release_all"),
        ),
      ).toBe(true);
    });

    // Lead F5 (accepted, won't-fix): documents rather than guards against a
    // known, low-value edge case - requires two taps on different controls
    // within the same 40ms window, so real-world impact is negligible.
    it("drops a typed char still pending in the coalesce window when the mode switches (F5, accepted)", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

      act(() => result.current.sendChar("a"));
      act(() => result.current.setOutputMode("type"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });

      expect(
        sendMachineInputBatchMock.mock.calls.some((call) =>
          call[0].events.some((e: { kind: string }) => e.kind === "keyboard"),
        ),
      ).toBe(false);
    });

    it("calling releaseAll repeatedly is idempotent and never throws", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
      act(() => result.current.setHeldJoystickInputs(new Set(["up"])));

      expect(() => {
        act(() => {
          result.current.releaseAll();
          result.current.releaseAll();
          result.current.releaseAll();
        });
      }).not.toThrow();
      expect(result.current.heldJoystickInputs.size).toBe(0);
    });

    it("does not crash and drops cleanly when the device rejects a batch mid-burst then recovers", async () => {
      sendMachineInputBatchMock.mockRejectedValueOnce(new Error("timeout"));
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

      act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });
      expect(result.current.connectionStatus).toBe("error");

      // Recovery: the next real change must send a full fresh press (not a
      // diff against the stale pre-failure state, which was reset to empty).
      sendMachineInputBatchMock.mockResolvedValueOnce({ errors: [], keyboard: { inputs: [] }, joysticks: [] });
      act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });

      expect(sendMachineInputBatchMock).toHaveBeenLastCalledWith({
        events: [{ kind: "joystick", port: 2, inputs: ["up"], transition: "press" }],
      });
      expect(result.current.connectionStatus).toBe("idle");
    });

    it("handles rapid autofire rate changes mid-cycle without throwing", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
      act(() => result.current.setHeldJoystickInputs(new Set(["fire"])));
      act(() => result.current.setAutofireEnabled(true));

      expect(() => {
        act(() => {
          [5, 10, 20, 2, 15].forEach((rate) => result.current.setAutofireRateHz(rate));
        });
      }).not.toThrow();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      // Should have ticked/flushed multiple times without erroring.
      expect(sendMachineInputBatchMock.mock.calls.length).toBeGreaterThan(0);
    });
  });
});
