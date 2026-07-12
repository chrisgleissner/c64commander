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
  getC64API: () => ({ sendMachineInputBatch: sendMachineInputBatchMock, getDeviceHost: () => "test-host" }),
}));

vi.mock("@/lib/playback/autostart", () => ({
  injectAutostart: (...args: unknown[]) => injectAutostartMock(...args),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: (...args: unknown[]) => addErrorLogMock(...args),
  buildErrorLogDetails: (error: Error, context: Record<string, unknown>) => ({ error: error.message, ...context }),
}));

// The device-safeguard serialization (HARD12-017) is its own orthogonal concern
// with dedicated coverage in machineInputThrottle.test.ts; here it dispatches
// immediately (no serialization/queue) so this file's coalescing/debounce timing
// assertions stay exact.
vi.mock("@/lib/remoteInput/machineInputThrottle", () => ({
  runSerializedMachineInput: (dispatch: () => unknown) => Promise.resolve(dispatch()),
}));

import { useRemoteInputSession } from "@/hooks/useRemoteInputSession";
import { saveAutofireRateHz } from "@/lib/remoteInput/autofire";
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

  it("flushes a single keyboard press on the leading edge, well before the full coalesce window elapses", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

    act(() => result.current.setHeldKeyboardInputs(new Set(["a"])));
    // Unlike the joystick path above (fixed 40ms wait), a keyboard change on
    // an otherwise-idle session rides LEADING_EDGE_WINDOW_MS (0ms), not
    // COALESCE_WINDOW_MS - advancing by 0ms is enough to fire the timeout.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(1);
    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
      events: [{ kind: "keyboard", inputs: ["a"], transition: "press" }],
    });
  });

  it("still coalesces a second rapid keyboard change into the SAME leading-edge flush instead of splitting it into two calls", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

    // Two changes back-to-back with no timer advance in between: the second
    // call's own scheduleFlush sees a flush already pending (the first
    // call's near-instant one) and, per the "pull earlier, never later"
    // rule, must not push it out to the full 40ms window.
    act(() => {
      result.current.setHeldKeyboardInputs(new Set(["a"]));
      result.current.setHeldKeyboardInputs(new Set(["a", "b"]));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(1);
    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
      events: [
        { kind: "keyboard", inputs: ["a"], transition: "press" },
        { kind: "keyboard", inputs: ["b"], transition: "press" },
      ],
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
    expect(injectAutostartMock).toHaveBeenCalledWith(
      expect.anything(),
      new Uint8Array([0x41]),
      expect.objectContaining({ shouldAbort: expect.any(Function) }),
    );
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
    expect(injectAutostartMock).toHaveBeenCalledWith(
      expect.anything(),
      new Uint8Array([0x41]),
      expect.objectContaining({ shouldAbort: expect.any(Function) }),
    );
  });

  it("round-trips a shifted digit (the BASIC quote) through the kernal fallback char path (HARD15-003)", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));
    await act(async () => {
      result.current.sendKeyboardInputs(["2", "left_shift"]);
    });
    expect(injectAutostartMock).toHaveBeenCalledWith(
      expect.anything(),
      new Uint8Array([0x22]),
      expect.objectContaining({ shouldAbort: expect.any(Function) }),
    );
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
    expect(injectAutostartMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      new Uint8Array([0x41]),
      expect.objectContaining({ shouldAbort: expect.any(Function) }),
    );
    expect(injectAutostartMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      new Uint8Array([0x42]),
      expect.objectContaining({ shouldAbort: expect.any(Function) }),
    );
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
    expect(injectAutostartMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      new Uint8Array([0x42]),
      expect.objectContaining({ shouldAbort: expect.any(Function) }),
    );
  });

  it("HARD19-013: clears the fallback 'Reconnecting' indicator once a later injection succeeds", async () => {
    injectAutostartMock.mockRejectedValueOnce(new Error("wifi blip"));
    const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));

    // One transient failure flips the indicator to error ("Reconnecting…").
    act(() => result.current.sendChar("a"));
    await act(flushMicrotasks);
    expect(result.current.connectionStatus).toBe("error");

    // The very next keystroke injects fine — previously nothing on the fallback
    // tier ever set the status back, so it stayed "Reconnecting…" all session.
    act(() => result.current.sendChar("b"));
    await act(flushMicrotasks);
    expect(result.current.connectionStatus).toBe("idle");
  });

  it("HARD19-013: clears the fallback indicator when a later keyboard-chord injection succeeds", async () => {
    injectAutostartMock.mockRejectedValueOnce(new Error("wifi blip"));
    const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));

    act(() => result.current.sendKeyboardInputs(["a", "left_shift"]));
    await act(flushMicrotasks);
    expect(result.current.connectionStatus).toBe("error");

    act(() => result.current.sendKeyboardInputs(["b", "left_shift"]));
    await act(flushMicrotasks);
    expect(result.current.connectionStatus).toBe("idle");
  });

  it("hot-swaps the autofire rate when the persisted rate changes elsewhere (Settings slider, PR299)", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    expect(result.current.autofireRateHz).not.toBe(8);

    act(() => {
      // Simulates the Settings → Remote Input slider writing the shared preference.
      saveAutofireRateHz(8);
    });

    expect(result.current.autofireRateHz).toBe(8);
    localStorage.removeItem("c64u_remote_input_autofire_rate_hz");
  });

  it("bounds fallback cursor hold-repeat instead of queueing every repeat (HARD16-003)", async () => {
    let resolveFirst!: () => void;
    injectAutostartMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));

    await act(async () => {
      for (let i = 0; i < 10; i += 1) result.current.sendCursor("down");
      await flushMicrotasks();
    });
    // The first repeat is in flight (held); one is queued behind it; the other 8 are dropped.
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst();
      await flushMicrotasks();
      await flushMicrotasks();
    });
    // A 10-deep backlog would have drained to 10 calls here; the depth guard bounds it to 2.
    expect(injectAutostartMock).toHaveBeenCalledTimes(2);
  });

  it("still delivers every typed fallback character while a cursor injection is in flight (HARD16-003)", async () => {
    let resolveFirst!: () => void;
    injectAutostartMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));

    await act(async () => {
      result.current.sendCursor("down");
      await flushMicrotasks();
    });
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.sendChar("a");
      result.current.sendChar("b");
      await flushMicrotasks();
    });
    // Typed characters never pass dropIfBusy: they queue behind the held cursor, never drop.
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst();
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(injectAutostartMock).toHaveBeenCalledTimes(3);
    expect(injectAutostartMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      new Uint8Array([0x41]),
      expect.objectContaining({ shouldAbort: expect.any(Function) }),
    );
    expect(injectAutostartMock).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      new Uint8Array([0x42]),
      expect.objectContaining({ shouldAbort: expect.any(Function) }),
    );
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

  it("cancels a still-pending flush timer instead of letting it fire after an active-input-release registry release (HARD13-001 residual E1)", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    // "up" is relayed and confirmed sent first, so releaseNow's own
    // already-relayed guard passes...
    act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    sendMachineInputBatchMock.mockClear();

    // ...then "down" is added on top, scheduling a NEW pending flush that
    // has not fired yet when the device-switch release comes in.
    act(() => result.current.setHeldJoystickInputs(new Set(["up", "down"])));

    await act(async () => {
      await releaseActiveRemoteInput();
    });
    expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(1);
    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({ events: [{ kind: "release_all" }] });
    sendMachineInputBatchMock.mockClear();

    // The pending "down" flush must not ALSO fire afterwards and re-press it
    // behind the release's back.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    expect(sendMachineInputBatchMock).not.toHaveBeenCalled();
  });

  it("logs (not throws) when the active-input-release registry's release_all fails (HARD13-001 residual E1)", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    sendMachineInputBatchMock.mockClear();
    sendMachineInputBatchMock.mockRejectedValueOnce(new Error("device offline"));

    await act(async () => {
      await releaseActiveRemoteInput();
    });

    expect(addErrorLogMock).toHaveBeenCalledWith("Remote input pre-switch release-all failed", expect.any(Object));
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
    expect(injectAutostartMock).toHaveBeenCalledWith(
      expect.anything(),
      new Uint8Array([0x11]),
      expect.objectContaining({ shouldAbort: expect.any(Function) }),
    );
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

  it("HARD19-013: does not clear a prior cursor error on a dropIfBusy short-circuit with no new probe", async () => {
    injectAutostartMock.mockRejectedValueOnce(new Error("device offline"));
    let resolveFirst!: () => void;
    injectAutostartMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));

    act(() => result.current.sendCursor("up"));
    await act(flushMicrotasks);
    expect(result.current.connectionStatus).toBe("error");

    act(() => result.current.sendCursor("up"));
    await act(flushMicrotasks);
    act(() => result.current.sendCursor("up"));
    await act(flushMicrotasks);
    act(() => result.current.sendCursor("up"));
    await act(flushMicrotasks);

    expect(result.current.connectionStatus).toBe("error");

    resolveFirst();
    await act(flushMicrotasks);
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
    expect(injectAutostartMock).toHaveBeenCalledWith(
      expect.anything(),
      new Uint8Array([0x85]),
      expect.objectContaining({ shouldAbort: expect.any(Function) }),
    );
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

  it("HARD19-013: clears the fallback indicator when a later special-key injection succeeds", async () => {
    injectAutostartMock.mockRejectedValueOnce(new Error("device offline"));
    const { result } = renderHook(() => useRemoteInputSession({ tier: "kernal-fallback" }));

    act(() => result.current.sendSpecialKey("f1"));
    await act(flushMicrotasks);
    expect(result.current.connectionStatus).toBe("error");

    act(() => result.current.sendSpecialKey("f3"));
    await act(flushMicrotasks);
    expect(result.current.connectionStatus).toBe("idle");
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

  it("logs (not throws) when the HARD15-007 recovery release_all after a send failure itself fails", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

    act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    sendMachineInputBatchMock.mockClear();

    // The ordinary press+release_all recovery is DISTINCT from releaseAll()'s
    // own release_all (see "does not loop..." above, which short-circuits the
    // recovery entirely): this is a genuine ordinary send failing, so its
    // recovery release_all is a SEPARATE call that can independently fail.
    sendMachineInputBatchMock.mockRejectedValueOnce(new Error("timeout"));
    sendMachineInputBatchMock.mockRejectedValueOnce(new Error("still unreachable"));
    act(() => result.current.setHeldJoystickInputs(new Set(["up", "right"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
      await flushMicrotasks();
    });

    expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(2);
    expect(addErrorLogMock).toHaveBeenCalledWith(
      "Remote input recovery release-all after send failure failed",
      expect.any(Object),
    );
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
    // because nothing forced a resync flush on the toggle itself. Uses the
    // slowest rate (1Hz -> 1s period, 500ms half) so the off-phase window is
    // wide and the assertion isn't sensitive to exact interval/debounce interleaving.
    it("re-syncs the true held state when autofire is disabled mid off-phase", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
      act(() => result.current.setAutofireRateHz(1));
      act(() => result.current.setAutofireEnabled(true));
      act(() => result.current.setHeldJoystickInputs(new Set(["fire"])));

      // Comfortably past the 500ms half-period boundary, still within the 1s period.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
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

    // Issue 3b: the phase is an explicit boolean flipped by a dedicated interval,
    // so it can never alias against the flush cadence and get stuck on one phase
    // (the original "autofire never fires" bug). Prove it oscillates across MANY
    // full cycles - both presses and releases, repeatedly - at the default rate.
    const collectFireTransitions = () => {
      const transitions: string[] = [];
      for (const call of sendMachineInputBatchMock.mock.calls) {
        for (const event of call[0].events as Array<{ inputs?: string[]; transition?: string }>) {
          if (event.transition && event.inputs?.includes("fire")) transitions.push(event.transition);
        }
      }
      return transitions;
    };

    it.each([5, 10])("oscillates fire on/off across many full cycles at %iHz (Issue 3b, no aliasing)", async (rate) => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
      act(() => result.current.setAutofireRateHz(rate));
      act(() => result.current.setHeldJoystickInputs(new Set(["fire"])));
      act(() => result.current.setAutofireEnabled(true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      const transitions = collectFireTransitions();
      expect(transitions.filter((t) => t === "press").length).toBeGreaterThanOrEqual(3);
      expect(transitions.filter((t) => t === "release").length).toBeGreaterThanOrEqual(3);
    });

    // Issue 3c anti-choppy: with no joystick movement, autofire edges flush on a
    // smooth, regular cadence (~one half-period apart), never clustered or dropped.
    it("keeps autofire on a smooth, regular cadence when nothing else is moving (Issue 3c)", async () => {
      const sendTimes: number[] = [];
      sendMachineInputBatchMock.mockImplementation(async () => {
        sendTimes.push(Date.now());
        return { errors: [], keyboard: { inputs: [] }, joysticks: [] };
      });
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
      act(() => result.current.setAutofireRateHz(5)); // 100ms half-period
      act(() => result.current.setHeldJoystickInputs(new Set(["fire"])));
      act(() => result.current.setAutofireEnabled(true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(sendTimes.length).toBeGreaterThanOrEqual(8);
      // Skip the very first gap (initial coalesce flush -> first toggle); every
      // steady-state toggle is one half-period apart with no jitter.
      for (let i = 2; i < sendTimes.length; i += 1) {
        const gap = sendTimes[i] - sendTimes[i - 1];
        expect(gap).toBeGreaterThanOrEqual(95);
        expect(gap).toBeLessThanOrEqual(105);
      }
    });

    // Issue 3c: a joystick move arriving just before an autofire edge (<10ms)
    // merges into the SAME outgoing packet - one call carrying both changes.
    it("merges a joystick move within the autofire coalesce window into one packet (Issue 3c)", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
      act(() => result.current.setAutofireRateHz(5)); // ticks at t=100, 200, ...
      act(() => result.current.setHeldJoystickInputs(new Set(["fire"])));
      act(() => result.current.setAutofireEnabled(true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(95); // just before the t=100 toggle; initial press-fire already sent
      });
      sendMachineInputBatchMock.mockClear();

      act(() => result.current.setHeldJoystickInputs(new Set(["fire", "up"]))); // move at t=95, 5ms before the edge
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30); // through the t=100 edge + merged flush
      });

      expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(1);
      const events = sendMachineInputBatchMock.mock.calls[0][0].events as Array<{
        transition: string;
        inputs: string[];
      }>;
      expect(events.some((e) => e.transition === "press" && e.inputs.includes("up"))).toBe(true);
      expect(events.some((e) => e.transition === "release" && e.inputs.includes("fire"))).toBe(true);
    });

    // Issue 3c: a joystick move NOT near an autofire edge is dispatched promptly
    // on its own window - never held hostage waiting for an edge that won't join.
    it("dispatches a joystick move far from any autofire edge on its own window (Issue 3c)", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
      act(() => result.current.setAutofireRateHz(5)); // ticks every 100ms
      act(() => result.current.setHeldJoystickInputs(new Set(["fire"])));
      act(() => result.current.setAutofireEnabled(true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(215); // t=215: 15ms past the t=200 edge, 85ms before the next
      });
      sendMachineInputBatchMock.mockClear();

      act(() => result.current.setHeldJoystickInputs(new Set(["fire", "up"]))); // move at t=215
      await act(async () => {
        await vi.advanceTimersByTimeAsync(41); // its own 40ms window (t=255), well before the t=300 edge
      });

      const hasUpPress = sendMachineInputBatchMock.mock.calls.some((call) =>
        (call[0].events as Array<{ transition: string; inputs?: string[] }>).some(
          (e) => e.transition === "press" && e.inputs?.includes("up"),
        ),
      );
      expect(hasUpPress).toBe(true);
    });

    // Issue 3e: leaving the joystick overlay (releaseAll: sheet close, tab/mode
    // switch, unmount, panic) must STOP autofire, not just release held inputs.
    it("stops autofire when releaseAll runs, with no further phase toggles (Issue 3e)", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
      act(() => result.current.setHeldJoystickInputs(new Set(["fire"])));
      act(() => result.current.setAutofireEnabled(true));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      expect(result.current.autofireEnabled).toBe(true);

      act(() => result.current.releaseAll());
      expect(result.current.autofireEnabled).toBe(false);

      sendMachineInputBatchMock.mockClear();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000); // well past many would-be toggle intervals
      });
      expect(sendMachineInputBatchMock).not.toHaveBeenCalled();
    });
  });

  // No key ever latches (except SHIFT LOCK, which lives in useKeyboardHoldDispatch):
  // a key is asserted on the wire for EXACTLY as long as it is held, and every
  // transition below is verified for its precise coalesced REST timing. These
  // are the game-play scenarios (e.g. David's Midnight Magic flippers) the latch
  // bug broke.
  describe("no-latch hold/release REST timing (game-play)", () => {
    it("coalesces multiple simultaneously-pressed keys into a single press REST call", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

      act(() => result.current.setHeldKeyboardInputs(new Set(["commodore", "left_shift"])));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(1);
      expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
        events: [{ kind: "keyboard", inputs: ["commodore", "left_shift"], transition: "press" }],
      });
    });

    it("collapses a short tap (press then release within one window) into a single firmware `tap` call", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

      act(() => {
        result.current.setHeldKeyboardInputs(new Set(["commodore"]));
        result.current.setHeldKeyboardInputs(new Set());
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // A same-window press+release is a real hardware-unsafe zero-gap pair, so
      // the transport collapses it to the firmware's 60ms `tap` - one REST call.
      expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(1);
      expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
        events: [{ kind: "keyboard", inputs: ["commodore"], transition: "tap" }],
      });
    });

    it("keeps a long-held key asserted: a press call now, a distinct release call only when let go", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

      act(() => result.current.setHeldKeyboardInputs(new Set(["commodore"])));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(1);
      expect(sendMachineInputBatchMock).toHaveBeenLastCalledWith({
        events: [{ kind: "keyboard", inputs: ["commodore"], transition: "press" }],
      });

      // Held for real time: NOT collapsed to a tap, and no extra traffic while held.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(1);

      // Release lands in a later, separate flush -> its own release call.
      act(() => result.current.setHeldKeyboardInputs(new Set()));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(2);
      expect(sendMachineInputBatchMock).toHaveBeenLastCalledWith({
        events: [{ kind: "keyboard", inputs: ["commodore"], transition: "release" }],
      });
    });

    it("releases two keys held for different durations independently, each in its own diff (flipper timing)", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

      // Both flippers (C= + SHIFT) pressed together and held.
      act(() => result.current.setHeldKeyboardInputs(new Set(["commodore", "left_shift"])));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(sendMachineInputBatchMock).toHaveBeenLastCalledWith({
        events: [{ kind: "keyboard", inputs: ["commodore", "left_shift"], transition: "press" }],
      });
      sendMachineInputBatchMock.mockClear();

      // Let go of SHIFT first (shorter press); C= stays held. Only SHIFT is released.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      act(() => result.current.setHeldKeyboardInputs(new Set(["commodore"])));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(sendMachineInputBatchMock).toHaveBeenLastCalledWith({
        events: [{ kind: "keyboard", inputs: ["left_shift"], transition: "release" }],
      });

      // Let go of C= later (longer press). Only C= is released.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      act(() => result.current.setHeldKeyboardInputs(new Set()));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(sendMachineInputBatchMock).toHaveBeenLastCalledWith({
        events: [{ kind: "keyboard", inputs: ["commodore"], transition: "release" }],
      });
    });

    it("rides a simultaneous joystick move and key press on ONE coalesced REST call", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

      act(() => {
        result.current.setHeldJoystickInputs(new Set(["up"]));
        result.current.setHeldKeyboardInputs(new Set(["commodore"]));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });

      expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(1);
      expect(sendMachineInputBatchMock).toHaveBeenCalledWith({
        events: [
          { kind: "joystick", port: 2, inputs: ["up"], transition: "press" },
          { kind: "keyboard", inputs: ["commodore"], transition: "press" },
        ],
      });
    });
  });
});
