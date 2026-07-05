/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const injectAutostartMock = vi.fn(async () => undefined);

vi.mock("@/lib/playback/autostart", () => ({
  injectAutostart: (...args: unknown[]) => injectAutostartMock(...args),
}));

import type { C64API } from "@/lib/c64api";
import {
  enqueueKernalFallbackInjection,
  resetKernalFallbackInjectionQueueForTests,
} from "@/lib/remoteInput/kernalFallbackInjector";

const api = {} as C64API;
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
    resetKernalFallbackInjectionQueueForTests();
  });

  it("bounds dropIfBusy injections to two (one in flight + one queued) when repeats pile up (HARD16-003)", async () => {
    const resolveFirst = deferInjectAutostartOnce();

    const first = enqueueKernalFallbackInjection(api, payload(1), { dropIfBusy: true });
    const second = enqueueKernalFallbackInjection(api, payload(2), { dropIfBusy: true });
    for (let byte = 3; byte <= 6; byte += 1) {
      void enqueueKernalFallbackInjection(api, payload(byte), { dropIfBusy: true });
    }

    await flushMicrotasks();
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);

    resolveFirst();
    await Promise.all([first, second]);

    expect(injectAutostartMock).toHaveBeenCalledTimes(2);
    expect(injectAutostartMock).toHaveBeenNthCalledWith(1, api, payload(1));
    expect(injectAutostartMock).toHaveBeenNthCalledWith(2, api, payload(2));
  });

  it("never drops injections enqueued without dropIfBusy (typed characters are always delivered)", async () => {
    const resolveFirst = deferInjectAutostartOnce();

    const promises = [1, 2, 3, 4, 5].map((byte) => enqueueKernalFallbackInjection(api, payload(byte)));

    await flushMicrotasks();
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);

    resolveFirst();
    await Promise.all(promises);

    expect(injectAutostartMock).toHaveBeenCalledTimes(5);
  });

  it("clears the busy guard once an injection settles so a later hold-repeat can start again (HARD16-003)", async () => {
    await enqueueKernalFallbackInjection(api, payload(1), { dropIfBusy: true });
    injectAutostartMock.mockClear();

    await enqueueKernalFallbackInjection(api, payload(2), { dropIfBusy: true });
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);
  });

  it("keeps counting accurately after a failed injection so drops resume correctly (HARD16-003)", async () => {
    injectAutostartMock.mockRejectedValueOnce(new Error("device offline"));
    await enqueueKernalFallbackInjection(api, payload(1), { dropIfBusy: true }).catch(() => undefined);
    injectAutostartMock.mockClear();

    const resolveNext = deferInjectAutostartOnce();
    const first = enqueueKernalFallbackInjection(api, payload(2), { dropIfBusy: true });
    const second = enqueueKernalFallbackInjection(api, payload(3), { dropIfBusy: true });
    void enqueueKernalFallbackInjection(api, payload(4), { dropIfBusy: true });

    await flushMicrotasks();
    expect(injectAutostartMock).toHaveBeenCalledTimes(1);

    resolveNext();
    await Promise.all([first, second]);
    expect(injectAutostartMock).toHaveBeenCalledTimes(2);
  });
});
