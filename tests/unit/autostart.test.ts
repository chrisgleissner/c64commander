/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AUTOSTART_SEQUENCE, buildAutostartSequence, injectAutostart } from "@/lib/playback/autostart";

const createApiMock = () => ({
  readMemory: vi.fn<[], Promise<Uint8Array>>(),
  writeMemory: vi.fn<[], Promise<{ errors: string[] }>>(),
});

describe("buildAutostartSequence", () => {
  it("falls back to busId 8 for non-finite or negative input", () => {
    const defaultSeq = buildAutostartSequence(8);
    expect(buildAutostartSequence(Infinity)).toEqual(defaultSeq);
    expect(buildAutostartSequence(-1)).toEqual(defaultSeq);
    expect(buildAutostartSequence(NaN)).toEqual(defaultSeq);
  });
});

describe("autostart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes autostart when keyboard buffer is empty", async () => {
    const api = createApiMock();
    api.readMemory.mockResolvedValue(new Uint8Array([0]));
    api.writeMemory.mockResolvedValue({ errors: [] });

    const task = injectAutostart(api as any, AUTOSTART_SEQUENCE, {
      pollIntervalMs: 50,
    });
    await vi.runAllTimersAsync();
    await task;

    const firstChunk = AUTOSTART_SEQUENCE.slice(0, 10);
    const secondChunk = AUTOSTART_SEQUENCE.slice(10);
    expect(api.writeMemory).toHaveBeenCalledWith("0277", firstChunk);
    expect(api.writeMemory).toHaveBeenCalledWith("00C6", new Uint8Array([firstChunk.length]));
    expect(api.writeMemory).toHaveBeenCalledWith("0277", secondChunk);
    expect(api.writeMemory).toHaveBeenCalledWith("00C6", new Uint8Array([secondChunk.length]));
  });

  it("throws when keyboard buffer stays busy", async () => {
    const api = createApiMock();
    api.readMemory.mockResolvedValue(new Uint8Array([2]));
    api.writeMemory.mockResolvedValue({ errors: [] });

    const task = injectAutostart(api as any, AUTOSTART_SEQUENCE, {
      pollIntervalMs: 10,
      maxAttempts: 3,
    });
    const assertion = expect(task).rejects.toThrow("Keyboard buffer remained busy");
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("uses default poll interval and max attempts when options not provided", async () => {
    // Covers the options.pollIntervalMs ?? 120 and options.maxAttempts ?? 20 fallback branches
    const api = createApiMock();
    api.readMemory.mockResolvedValue(new Uint8Array([0]));
    api.writeMemory.mockResolvedValue({ errors: [] });

    // Call without any options — triggers both ?? default branches
    const task = injectAutostart(api as any);
    await vi.runAllTimersAsync();
    await task;

    const firstChunk = AUTOSTART_SEQUENCE.slice(0, 10);
    expect(api.writeMemory).toHaveBeenCalledWith("0277", firstChunk);
  });

  it("treats empty readMemory response as buffer-length zero via nullish coalescing", async () => {
    // Covers data[0] ?? 0 when readMemory returns an empty Uint8Array
    const api = createApiMock();
    // Return empty array: data[0] is undefined, ?? 0 makes it 0 (buffer clear)
    api.readMemory.mockResolvedValue(new Uint8Array(0));
    api.writeMemory.mockResolvedValue({ errors: [] });

    const task = injectAutostart(api as any, AUTOSTART_SEQUENCE, {
      pollIntervalMs: 10,
      maxAttempts: 3,
    });
    await vi.runAllTimersAsync();
    await task;

    const firstChunk = AUTOSTART_SEQUENCE.slice(0, 10);
    expect(api.writeMemory).toHaveBeenCalledWith("0277", firstChunk);
  });

  it("HARD12-008: chunks the kernal autostart payload so no single write to $0277 exceeds the 10-byte keyboard buffer for bus 8", async () => {
    const api = createApiMock();
    api.readMemory.mockResolvedValue(new Uint8Array([0]));
    api.writeMemory.mockResolvedValue({ errors: [] });

    const sequence = buildAutostartSequence(8);
    expect(sequence.length).toBeGreaterThan(10);

    const task = injectAutostart(api as any, sequence, { pollIntervalMs: 10, maxAttempts: 5 });
    await vi.runAllTimersAsync();
    await task;

    const writeBufferCalls = api.writeMemory.mock.calls.filter(([address]) => address === "0277");
    expect(writeBufferCalls.length).toBeGreaterThan(1);
    for (const [, payload] of writeBufferCalls) {
      expect((payload as Uint8Array).length).toBeLessThanOrEqual(10);
    }

    const lengthCalls = api.writeMemory.mock.calls.filter(([address]) => address === "00C6");
    for (const [, payload] of lengthCalls) {
      expect((payload as Uint8Array)[0]).toBeLessThanOrEqual(10);
    }
  });

  it("HARD12-008: chunks the two-digit-bus payload so no single write to $0277 exceeds 10 bytes for bus 10", async () => {
    const api = createApiMock();
    api.readMemory.mockResolvedValue(new Uint8Array([0]));
    api.writeMemory.mockResolvedValue({ errors: [] });

    const sequence = buildAutostartSequence(10);
    expect(sequence.length).toBeGreaterThan(10);

    const task = injectAutostart(api as any, sequence, { pollIntervalMs: 10, maxAttempts: 5 });
    await vi.runAllTimersAsync();
    await task;

    const writeBufferCalls = api.writeMemory.mock.calls.filter(([address]) => address === "0277");
    expect(writeBufferCalls.length).toBeGreaterThan(1);
    for (const [, payload] of writeBufferCalls) {
      expect((payload as Uint8Array).length).toBeLessThanOrEqual(10);
    }
  });

  it("HARD12-008: waits for the keyboard buffer to drain between chunks before writing the next one", async () => {
    const api = createApiMock();
    // First two reads return busy (non-zero), the rest return empty.
    let callCount = 0;
    api.readMemory.mockImplementation(async () => {
      callCount += 1;
      return new Uint8Array([callCount <= 2 ? 5 : 0]);
    });
    api.writeMemory.mockResolvedValue({ errors: [] });

    const sequence = buildAutostartSequence(10);
    const task = injectAutostart(api as any, sequence, { pollIntervalMs: 10, maxAttempts: 5 });
    await vi.runAllTimersAsync();
    await task;

    // Two chunks × (read busy twice + write) → at least two writes.
    const writeBufferCalls = api.writeMemory.mock.calls.filter(([address]) => address === "0277");
    expect(writeBufferCalls.length).toBeGreaterThanOrEqual(2);
    for (const [, payload] of writeBufferCalls) {
      expect((payload as Uint8Array).length).toBeLessThanOrEqual(10);
    }
  });
});
