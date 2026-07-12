/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const injectAutostartMock = vi.fn(async () => undefined);
const addLogMock = vi.fn();

vi.mock("@/lib/playback/autostart", () => ({
  injectAutostart: (...args: unknown[]) => injectAutostartMock(...args),
}));
vi.mock("@/lib/logging", () => ({
  addLog: (...args: unknown[]) => addLogMock(...args),
}));

import type { C64API } from "@/lib/c64api";
import {
  drainKernalFallbackInjectionQueue,
  enqueueKeyboardBufferInjection,
  resetKernalFallbackInjectionQueueForTests,
} from "@/lib/remoteInput/kernalFallbackInjector";

let currentHost = "hostA";
const api = { getDeviceHost: () => currentHost } as unknown as C64API;
const injectOptions = expect.objectContaining({ shouldAbort: expect.any(Function) });
const payload = (byte: number) => new Uint8Array([byte]);

const flushMicrotasks = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

const deferInjectAutostartOnce = () => {
  let resolve!: () => void;
  injectAutostartMock.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  return () => resolve();
};

describe("kernalFallbackInjector", () => {
  beforeEach(() => {
    injectAutostartMock.mockReset();
    injectAutostartMock.mockImplementation(async () => undefined);
    addLogMock.mockReset();
    currentHost = "hostA";
    resetKernalFallbackInjectionQueueForTests();
  });

  it("bounds dropIfBusy injections to two (one in flight + one queued) when repeats pile up (HARD16-003)", async () => {
    const resolveFirst = deferInjectAutostartOnce();

    const first = enqueueKeyboardBufferInjection(api, payload(1), { dropIfBusy: true });
    const second = enqueueKeyboardBufferInjection(api, payload(2), { dropIfBusy: true });
    for (let byte = 3; byte <= 6; byte += 1) {
      void enqueueKeyboardBufferInjection(api, payload(byte), { dropIfBusy: true });
    }

    await flushMicrotasks();
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);

    resolveFirst();
    await Promise.all([first, second]);

    expect(injectAutostartMock).toHaveBeenCalledTimes(2);
    expect(injectAutostartMock).toHaveBeenNthCalledWith(1, api, payload(1), injectOptions);
    expect(injectAutostartMock).toHaveBeenNthCalledWith(2, api, payload(2), injectOptions);
  });

  it("never drops injections enqueued without dropIfBusy (typed characters are always delivered)", async () => {
    const resolveFirst = deferInjectAutostartOnce();

    const promises = [1, 2, 3, 4, 5].map((byte) => enqueueKeyboardBufferInjection(api, payload(byte)));

    await flushMicrotasks();
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);

    resolveFirst();
    await Promise.all(promises);

    expect(injectAutostartMock).toHaveBeenCalledTimes(5);
  });

  it("clears the busy guard once an injection settles so a later hold-repeat can start again (HARD16-003)", async () => {
    await enqueueKeyboardBufferInjection(api, payload(1), { dropIfBusy: true });
    injectAutostartMock.mockClear();

    await enqueueKeyboardBufferInjection(api, payload(2), { dropIfBusy: true });
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);
  });

  it("keeps counting accurately after a failed injection so drops resume correctly (HARD16-003)", async () => {
    injectAutostartMock.mockRejectedValueOnce(new Error("device offline"));
    await enqueueKeyboardBufferInjection(api, payload(1), { dropIfBusy: true }).catch(() => undefined);
    injectAutostartMock.mockClear();

    const resolveNext = deferInjectAutostartOnce();
    const first = enqueueKeyboardBufferInjection(api, payload(2), { dropIfBusy: true });
    const second = enqueueKeyboardBufferInjection(api, payload(3), { dropIfBusy: true });
    void enqueueKeyboardBufferInjection(api, payload(4), { dropIfBusy: true });

    await flushMicrotasks();
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);

    resolveNext();
    await Promise.all([first, second]);
    expect(injectAutostartMock).toHaveBeenCalledTimes(2);
  });

  it("skips a queued injection whose device changed while an earlier one was in flight (HARD19-017)", async () => {
    const resolveFirst = deferInjectAutostartOnce();

    const first = enqueueKeyboardBufferInjection(api, payload(1));
    const second = enqueueKeyboardBufferInjection(api, payload(2));

    await flushMicrotasks();
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);

    // A saved-device switch retargets the shared API to device B mid-queue.
    currentHost = "hostB";
    resolveFirst();
    await Promise.all([first, second]);

    // The second injection must NOT run against device B, and a warning is logged.
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);
    expect(addLogMock).toHaveBeenCalledWith(
      "warn",
      "Skipping kernal-fallback injection: device changed or queue drained since enqueue",
      expect.objectContaining({ enqueuedHost: "hostA", currentHost: "hostB" }),
    );
  });

  it("aborts an in-flight injection at its next REST step when the device changes (HARD19-017)", async () => {
    // Capture the shouldAbort predicate injectAutostart is given.
    let capturedShouldAbort: (() => boolean) | undefined;
    injectAutostartMock.mockImplementationOnce(async (_api, _payload, options: { shouldAbort?: () => boolean }) => {
      capturedShouldAbort = options.shouldAbort;
    });

    await enqueueKeyboardBufferInjection(api, payload(1));

    expect(capturedShouldAbort).toBeTypeOf("function");
    // Same device -> keep going.
    expect(capturedShouldAbort!()).toBe(false);
    // Device retargeted mid-injection -> abort.
    currentHost = "hostB";
    expect(capturedShouldAbort!()).toBe(true);
  });

  it("drains queued injections so a device retarget cancels them (HARD19-017)", async () => {
    const resolveFirst = deferInjectAutostartOnce();

    const first = enqueueKeyboardBufferInjection(api, payload(1));
    const second = enqueueKeyboardBufferInjection(api, payload(2));

    await flushMicrotasks();
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);

    // prepareForDeviceRetarget calls this before the switch.
    drainKernalFallbackInjectionQueue();
    resolveFirst();
    await Promise.all([first, second]);

    // The queued (second) injection is cancelled by the drain.
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);
  });
});
