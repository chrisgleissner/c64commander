/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeMemory = vi.fn(async () => undefined);
const readMemory = vi.fn(async () => new Uint8Array([0]));
const toastMock = vi.fn();

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ getDeviceHost: () => "c64u", readMemory, writeMemory }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => toastMock(...args) }));

import { useBasicCommands } from "@/hooks/useBasicCommands";
import { BASIC_COMMANDS } from "@/lib/remoteInput/basicCommands";
import { resetKernalFallbackInjectionQueueForTests } from "@/lib/remoteInput/kernalFallbackInjector";

const bytesOf = (text: string) => [...text].map((char) => char.charCodeAt(0));
const RETURN = 0x0d;

const writtenBufferChunks = () =>
  writeMemory.mock.calls.filter(([address]) => address === "0277").map(([, payload]) => [...(payload as Uint8Array)]);

const sendAndSettle = async (id: string) => {
  const { result } = renderHook(() => useBasicCommands());
  result.current(BASIC_COMMANDS.find((command) => command.id === id)!);
  await vi.waitFor(() => expect(writeMemory).toHaveBeenCalled(), { timeout: 3000 });
};

describe("useBasicCommands", () => {
  beforeEach(() => {
    writeMemory.mockClear();
    readMemory.mockClear();
    toastMock.mockClear();
    resetKernalFallbackInjectionQueueForTests();
  });

  it.each([
    ["list", "LIST"],
    ["run", "RUN"],
  ])("writes %s and RETURN into the keyboard buffer in one chunk", async (id, text) => {
    await sendAndSettle(id);

    expect(writtenBufferChunks()).toEqual([[...bytesOf(text), RETURN]]);
    expect(writeMemory).toHaveBeenCalledWith("00C6", new Uint8Array([text.length + 1]));
  });

  it('writes LOAD"$",8 and RETURN into the keyboard buffer in one ten-byte chunk', async () => {
    await sendAndSettle("load-directory");

    expect(writtenBufferChunks()).toEqual([[...bytesOf('LOAD"$",8'), RETURN]]);
  });

  it('splits LOAD"*",8,1 and RETURN across the buffer\'s ten-byte limit without losing RETURN', async () => {
    await sendAndSettle("load-first-program");
    await vi.waitFor(() => expect(writtenBufferChunks().length).toBe(2), { timeout: 3000 });

    expect(writtenBufferChunks()).toEqual([
      bytesOf('LOAD"*",8,1').slice(0, 10),
      [...bytesOf('LOAD"*",8,1').slice(10), RETURN],
    ]);
  });

  it("queues behind an injection that is already running instead of interleaving buffer writes", async () => {
    const { result } = renderHook(() => useBasicCommands());
    result.current(BASIC_COMMANDS[0]);
    result.current(BASIC_COMMANDS[1]);

    await vi.waitFor(() => expect(writtenBufferChunks().length).toBe(2), { timeout: 3000 });

    expect(writtenBufferChunks()).toEqual([
      [...bytesOf("LIST"), RETURN],
      [...bytesOf("RUN"), RETURN],
    ]);
  });

  it("reports a failed injection with a notification", async () => {
    writeMemory.mockRejectedValueOnce(new Error("device offline"));
    const { result } = renderHook(() => useBasicCommands());

    result.current(BASIC_COMMANDS[0]);

    await vi.waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not send LIST" })),
    );
  });
});
