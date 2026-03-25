/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const mockConnect = vi.hoisted(() => vi.fn());
const mockDisconnect = vi.hoisted(() => vi.fn());
const mockSend = vi.hoisted(() => vi.fn());
const mockRead = vi.hoisted(() => vi.fn());
const mockIsConnected = vi.hoisted(() => vi.fn());

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/native/telnetSocket", () => ({
  TelnetSocket: {
    connect: mockConnect,
    disconnect: mockDisconnect,
    send: mockSend,
    read: mockRead,
    isConnected: mockIsConnected,
  },
}));

import { createTelnetClient } from "@/lib/telnet/telnetClient";
import { TelnetError } from "@/lib/telnet/telnetTypes";

describe("createTelnetClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
    mockSend.mockResolvedValue(undefined);
    mockRead.mockResolvedValue({ data: "" }); // empty base64
    mockIsConnected.mockResolvedValue({ connected: false });
  });

  describe("connect", () => {
    it("connects via TelnetSocket plugin", async () => {
      const client = createTelnetClient();
      await client.connect("192.168.1.10", 23);
      expect(mockConnect).toHaveBeenCalledWith({
        host: "192.168.1.10",
        port: 23,
        timeoutMs: 5000,
      });
      expect(client.isConnected()).toBe(true);
    });

    it("throws TelnetError on connection failure", async () => {
      mockConnect.mockRejectedValue(new Error("Network unreachable"));
      const client = createTelnetClient();
      await expect(client.connect("bad-host", 23)).rejects.toThrow(TelnetError);
      expect(client.isConnected()).toBe(false);
    });
  });

  describe("disconnect", () => {
    it("disconnects and sets connected to false", async () => {
      const client = createTelnetClient();
      await client.connect("localhost", 23);
      await client.disconnect();
      expect(mockDisconnect).toHaveBeenCalled();
      expect(client.isConnected()).toBe(false);
    });

    it("logs warnings for disconnect failures without rethrowing", async () => {
      mockDisconnect.mockRejectedValue(new Error("already closed"));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const client = createTelnetClient();
      await client.connect("localhost", 23);
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith("TelnetSocket.disconnect() failed", {
        error: expect.any(Error),
      });
      warnSpy.mockRestore();
    });
  });

  describe("send", () => {
    it("sends data as base64 via plugin", async () => {
      const client = createTelnetClient();
      await client.connect("localhost", 23);
      const data = new Uint8Array([0x1b, 0x5b, 0x41]); // ESC [ A
      await client.send(data);
      expect(mockSend).toHaveBeenCalledWith({
        data: expect.any(String), // base64 encoded
      });
    });

    it("throws TelnetError when not connected", async () => {
      const client = createTelnetClient();
      await expect(client.send(new Uint8Array([0x41]))).rejects.toThrow(TelnetError);
    });

    it("marks disconnected on send failure", async () => {
      mockSend.mockRejectedValue(new Error("broken pipe"));
      const client = createTelnetClient();
      await client.connect("localhost", 23);
      await expect(client.send(new Uint8Array([0x41]))).rejects.toThrow(TelnetError);
      expect(client.isConnected()).toBe(false);
    });
  });

  describe("read", () => {
    it("reads and decodes base64 data from plugin", async () => {
      // Base64 for "HI" (0x48 0x49)
      mockRead.mockResolvedValue({ data: btoa("HI") });
      const client = createTelnetClient();
      await client.connect("localhost", 23);
      const result = await client.read(500);
      expect(result).toEqual(new Uint8Array([0x48, 0x49]));
    });

    it("returns empty array on timeout", async () => {
      mockRead.mockRejectedValue(new Error("read timed out"));
      const client = createTelnetClient();
      await client.connect("localhost", 23);
      const result = await client.read(500);
      expect(result.length).toBe(0);
    });

    it("throws TelnetError when not connected", async () => {
      const client = createTelnetClient();
      await expect(client.read(500)).rejects.toThrow(TelnetError);
    });

    it("marks disconnected on non-timeout read failure", async () => {
      mockRead.mockRejectedValue(new Error("connection reset"));
      const client = createTelnetClient();
      await client.connect("localhost", 23);
      await expect(client.read(500)).rejects.toThrow(TelnetError);
      expect(client.isConnected()).toBe(false);
    });
  });
});
