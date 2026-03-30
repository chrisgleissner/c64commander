/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelnetSession } from "@/lib/telnet/telnetSession";
import { TelnetError } from "@/lib/telnet/telnetTypes";

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

const encoder = new TextEncoder();

describe("createTelnetSession reconnect coverage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reconnects successfully on the second retry attempt after a transport connect failure", async () => {
    vi.useFakeTimers();

    let connected = false;
    const connect = vi.fn().mockImplementation(async () => {
      if (connect.mock.calls.length === 1) {
        connected = true;
        return;
      }
      if (connect.mock.calls.length === 2) {
        connected = false;
        throw new TelnetError("temporary transport failure", "CONNECTION_FAILED");
      }
      connected = true;
    });
    const transport = {
      connect,
      disconnect: vi.fn().mockImplementation(async () => {
        connected = false;
      }),
      send: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue(encoder.encode("READY")),
      isConnected: vi.fn(() => connected),
    };
    const session = createTelnetSession(transport);

    await session.connect("c64u", 23);
    connected = false;

    const sendPromise = session.sendKey("F5");
    await vi.advanceTimersByTimeAsync(500);
    await expect(sendPromise).resolves.toBeUndefined();

    expect(connect).toHaveBeenCalledTimes(3);
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(session.isConnected()).toBe(true);
  });

  it("disconnects the transport after five minutes of inactivity", async () => {
    vi.useFakeTimers();

    let connected = false;
    const transport = {
      connect: vi.fn().mockImplementation(async () => {
        connected = true;
      }),
      disconnect: vi.fn().mockImplementation(async () => {
        connected = false;
      }),
      send: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue(encoder.encode("READY")),
      isConnected: vi.fn(() => connected),
    };
    const session = createTelnetSession(transport);

    await session.connect("c64u", 23);
    expect(session.isConnected()).toBe(true);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(transport.disconnect).toHaveBeenCalledTimes(1);
    expect(session.isConnected()).toBe(false);
  });

  it("detects the password prompt, sends the password, and marks the session authenticated", async () => {
    let connected = false;
    const transport = {
      connect: vi.fn().mockImplementation(async () => {
        connected = true;
      }),
      disconnect: vi.fn().mockImplementation(async () => {
        connected = false;
      }),
      send: vi.fn().mockResolvedValue(undefined),
      read: vi
        .fn()
        .mockResolvedValueOnce(encoder.encode("Password:"))
        .mockResolvedValueOnce(encoder.encode("Welcome to C64 Ultimate")),
      isConnected: vi.fn(() => connected),
    };
    const session = createTelnetSession(transport);

    await session.connect("c64u", 23, "secret");

    expect(transport.send).toHaveBeenCalledWith(encoder.encode("secret\r"));
    expect(session.isConnected()).toBe(true);
  });
});
