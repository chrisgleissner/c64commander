/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelnetSession } from "@/lib/telnet/telnetSession";
import { TELNET_KEYS, type TelnetTransport } from "@/lib/telnet/telnetTypes";
import {
  ConfigApplyCancelledError,
  createCancellableTelnetSession,
  leaveDeviceMenu,
} from "@/lib/config/configApplyCancellation";
import { addLog } from "@/lib/logging";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));

/**
 * The native Telnet plugin runs every send and read on one thread, in call order, and a read waits out its
 * timeout when the device sends nothing. This transport does the same.
 */
const createSerialTransport = () => {
  let connected = false;
  let queue: Promise<unknown> = Promise.resolve();
  let pendingInitialScreen = true;
  const sentKeys: string[] = [];
  const keyNames = new Map(Object.entries(TELNET_KEYS).map(([name, sequence]) => [sequence, name]));
  const serially = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };
  const transport: TelnetTransport = {
    connect: async () => {
      connected = true;
    },
    disconnect: () =>
      serially(async () => {
        connected = false;
      }),
    isConnected: () => connected,
    send: (data) =>
      serially(async () => {
        sentKeys.push(keyNames.get(new TextDecoder().decode(data)) ?? "raw");
      }),
    read: (timeoutMs) =>
      serially(async () => {
        if (pendingInitialScreen) {
          pendingInitialScreen = false;
          return new TextEncoder().encode("READY.");
        }
        await new Promise((resolve) => setTimeout(resolve, timeoutMs));
        return new Uint8Array(0);
      }),
  };
  return { transport, sentKeys };
};

describe("leaving the device menu after Stop cancelled a screen read", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(addLog).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends both exit keys within the exit budget instead of queueing them behind the abandoned read", async () => {
    const { transport, sentKeys } = createSerialTransport();
    const session = createTelnetSession(transport);
    await session.connect("c64u", 23);
    const firstScreen = session.readScreen(500);
    await vi.advanceTimersByTimeAsync(500);
    await firstScreen;

    const controller = new AbortController();
    const abandonedRead = createCancellableTelnetSession(session, controller.signal)
      .readScreen(500)
      .catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    expect(await abandonedRead).toBeInstanceOf(ConfigApplyCancelledError);

    const leaving = leaveDeviceMenu(session, "test");
    await vi.advanceTimersByTimeAsync(2_000);
    await leaving;

    expect(sentKeys).toEqual(["ESCAPE", "LEFT"]);
    expect(addLog).not.toHaveBeenCalledWith(
      "warn",
      "Could not leave the device menu after an interrupted settings-file apply",
      expect.anything(),
    );
  });
});
