/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TelnetError } from "@/lib/telnet/telnetTypes";

const { getConnectionSnapshotMock, mockConnect, mockDisconnect, mockSend, mockRead } = vi.hoisted(() => ({
  getConnectionSnapshotMock: vi.fn(() => ({ state: "REAL_CONNECTED" })),
  mockConnect: vi.fn(),
  mockDisconnect: vi.fn(),
  mockSend: vi.fn(),
  mockRead: vi.fn(),
}));

vi.mock("@/lib/connection/connectionManager", () => ({
  getConnectionSnapshot: (...args: unknown[]) => getConnectionSnapshotMock(...args),
}));

vi.mock("@/lib/native/telnetSocket", () => ({
  TelnetSocket: {
    connect: mockConnect,
    disconnect: mockDisconnect,
    send: mockSend,
    read: mockRead,
  },
}));

import { createTelnetClient, shouldUseMockTelnetTransport } from "@/lib/telnet/telnetClient";

describe("createTelnetClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionSnapshotMock.mockReturnValue({ state: "REAL_CONNECTED" });
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
    mockSend.mockResolvedValue(undefined);
    mockRead.mockResolvedValue({ data: "" });
    localStorage.clear();
    delete (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled;
    delete (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl;
    delete (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl;
  });

  describe("native transport", () => {
    it("connects via TelnetSocket plugin for real-device targets", async () => {
      const client = createTelnetClient();

      await client.connect("192.168.1.10", 23);

      expect(mockConnect).toHaveBeenCalledWith({
        host: "192.168.1.10",
        port: 23,
        timeoutMs: 5000,
      });
      expect(client.isConnected()).toBe(true);
      expect(shouldUseMockTelnetTransport()).toBe(false);
    });

    it("throws TelnetError on connection failure", async () => {
      mockConnect.mockRejectedValue(new Error("Network unreachable"));
      const client = createTelnetClient();

      await expect(client.connect("bad-host", 23)).rejects.toThrow(TelnetError);
      expect(client.isConnected()).toBe(false);
    });

    it("disconnects and logs warnings for disconnect failures without rethrowing", async () => {
      mockDisconnect.mockRejectedValue(new Error("already closed"));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const client = createTelnetClient();

      await client.connect("localhost", 23);
      await client.disconnect();

      expect(mockDisconnect).toHaveBeenCalled();
      expect(client.isConnected()).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith("TelnetSocket.disconnect() failed", {
        error: expect.any(Error),
      });
      warnSpy.mockRestore();
    });

    it("sends data as base64 via plugin", async () => {
      const client = createTelnetClient();

      await client.connect("localhost", 23);
      await client.send(new Uint8Array([0x1b, 0x5b, 0x41]));

      expect(mockSend).toHaveBeenCalledWith({ data: expect.any(String) });
    });

    it("marks disconnected on send failure", async () => {
      mockSend.mockRejectedValue(new Error("broken pipe"));
      const client = createTelnetClient();

      await client.connect("localhost", 23);
      await expect(client.send(new Uint8Array([0x41]))).rejects.toThrow(TelnetError);
      expect(client.isConnected()).toBe(false);
    });

    it("reads and decodes base64 data from plugin", async () => {
      mockRead.mockResolvedValue({ data: btoa("HI") });
      const client = createTelnetClient();

      await client.connect("localhost", 23);

      expect(await client.read(500)).toEqual(new Uint8Array([0x48, 0x49]));
    });

    it("returns an empty array on read timeout", async () => {
      mockRead.mockRejectedValue(new Error("read timed out"));
      const client = createTelnetClient();

      await client.connect("localhost", 23);

      expect((await client.read(500)).length).toBe(0);
    });

    it("marks disconnected on non-timeout read failure", async () => {
      mockRead.mockRejectedValue(new Error("connection reset"));
      const client = createTelnetClient();

      await client.connect("localhost", 23);
      await expect(client.read(500)).rejects.toThrow(TelnetError);
      expect(client.isConnected()).toBe(false);
    });
  });

  describe("mock transport", () => {
    it("uses the telnet mock transport for external mock targets", async () => {
      (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = "http://127.0.0.1:8080";
      localStorage.setItem("c64u_device_host", "127.0.0.1:8080");

      const client = createTelnetClient();

      await client.connect("c64u", 23);
      const initData = await client.read(100);

      expect(shouldUseMockTelnetTransport()).toBe(true);
      expect(mockConnect).not.toHaveBeenCalled();
      expect(initData.length).toBeGreaterThan(0);
      expect(client.isConnected()).toBe(true);
    });

    it("uses the telnet mock transport for internal demo targets", async () => {
      getConnectionSnapshotMock.mockReturnValue({ state: "DEMO_ACTIVE" });
      const client = createTelnetClient();

      await client.connect("c64u", 23);
      await client.send(new Uint8Array([0x1b, 0x5b, 0x31, 0x35, 0x7e]));

      expect(mockConnect).not.toHaveBeenCalled();
      expect(client.isConnected()).toBe(true);
    });

    it("still throws when sending before connecting", async () => {
      (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = "http://127.0.0.1:8080";
      localStorage.setItem("c64u_device_host", "127.0.0.1:8080");

      const client = createTelnetClient();

      await expect(client.send(new Uint8Array([0x41]))).rejects.toThrow(TelnetError);
    });
  });
});
