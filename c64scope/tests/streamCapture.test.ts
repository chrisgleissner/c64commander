/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSocket = {
  bind: vi.fn(),
  addMembership: vi.fn(),
  once: vi.fn(),
  on: vi.fn(),
  close: vi.fn(),
};

vi.mock("node:dgram", () => ({
  default: {
    createSocket: vi.fn(() => mockSocket),
  },
  createSocket: vi.fn(() => mockSocket),
}));

describe("stream capture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    mockSocket.bind.mockReset();
    mockSocket.addMembership.mockReset();
    mockSocket.once.mockReset();
    mockSocket.on.mockReset();
    mockSocket.close.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("captures audio packets and writes analysis artifacts", async () => {
    const { captureAndAnalyzeStream } = await import("../src/stream/capture.js");
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "c64scope-stream-capture-"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => "",
    } as Response);

    mockSocket.once.mockImplementation((_event, _handler) => undefined);
    mockSocket.on.mockImplementation((event, handler) => {
      if (event === "message") {
        setTimeout(() => handler(Buffer.alloc(2 + 384 * 2, 1)), 10);
      }
      return mockSocket;
    });
    mockSocket.bind.mockImplementation((_port, _addr, cb) => cb());

    try {
      const pending = captureAndAnalyzeStream({
        streamType: "audio",
        c64uHost: "c64u",
        artifactDir,
        durationMs: 20,
      });
      await vi.advanceTimersByTimeAsync(30);
      const result = await pending;

      expect(result.capture.streamType).toBe("audio");
      expect(result.capture.destination).toBe("239.0.1.65:11001");
      expect(result.capture.packets.length).toBe(1);
      expect(mockSocket.close).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(await readFile(result.analysisPath, "utf-8")).toContain("sampleRateHz");
      expect((await readFile(result.packetsPath)).length).toBeGreaterThan(0);
    } finally {
      fetchMock.mockRestore();
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("fails when no packets are captured after a recoverable start error", async () => {
    const { captureAndAnalyzeStream } = await import("../src/stream/capture.js");
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "c64scope-stream-empty-"));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "network host resolve error",
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "",
      } as Response);

    mockSocket.once.mockImplementation((_event, _handler) => undefined);
    mockSocket.on.mockImplementation(() => mockSocket);
    mockSocket.bind.mockImplementation((_port, _addr, cb) => cb());

    try {
      const pending = captureAndAnalyzeStream({
        streamType: "video",
        c64uHost: "c64u",
        artifactDir,
        durationMs: 20,
      });
      const rejection = expect(pending).rejects.toThrow(
        /No UDP packets captured after recoverable stream start response/,
      );
      await vi.advanceTimersByTimeAsync(30);
      await rejection;
    } finally {
      fetchMock.mockRestore();
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("fails when no packets are captured after a successful start", async () => {
    const { captureAndAnalyzeStream } = await import("../src/stream/capture.js");
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "c64scope-stream-no-packets-"));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "",
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "",
      } as Response);

    mockSocket.once.mockImplementation((_event, _handler) => undefined);
    mockSocket.on.mockImplementation(() => mockSocket);
    mockSocket.bind.mockImplementation((_port, _addr, cb) => cb());

    try {
      const pending = captureAndAnalyzeStream({
        streamType: "video",
        c64uHost: "c64u",
        artifactDir,
        durationMs: 20,
        destinationIp: "192.168.1.50:not-a-port",
      });
      const rejection = expect(pending).rejects.toThrow(/No UDP packets captured for video stream/);
      await vi.advanceTimersByTimeAsync(30);
      await rejection;
      expect(mockSocket.addMembership).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("reports stop failures after packets are captured", async () => {
    const { captureAndAnalyzeStream } = await import("../src/stream/capture.js");
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "c64scope-stream-stop-fail-"));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "",
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "stop failed",
      } as Response);

    mockSocket.once.mockImplementation((_event, _handler) => undefined);
    mockSocket.on.mockImplementation((event, handler) => {
      if (event === "message") {
        setTimeout(() => handler(Buffer.from([1, 2, 3, 4])), 10);
      }
      return mockSocket;
    });
    mockSocket.bind.mockImplementation((_port, _addr, cb) => cb());

    try {
      const pending = captureAndAnalyzeStream({
        streamType: "video",
        c64uHost: "c64u",
        artifactDir,
        durationMs: 20,
        bindAddress: "127.0.0.1",
        bindPort: 12000,
        destinationIp: "239.0.1.64:11000",
      });
      const rejection = expect(pending).rejects.toThrow(/Failed to stop C64U video stream/);
      await vi.advanceTimersByTimeAsync(30);
      await rejection;
    } finally {
      fetchMock.mockRestore();
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("tolerates recoverable timeout starts when packets still arrive on a multicast bind", async () => {
    const { captureAndAnalyzeStream } = await import("../src/stream/capture.js");
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "c64scope-stream-timeout-"));
    const timeoutError = Object.assign(new Error("start timed out"), { name: "TimeoutError" });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "",
      } as Response);

    mockSocket.once.mockImplementation((_event, _handler) => undefined);
    mockSocket.on.mockImplementation((event, handler) => {
      if (event === "message") {
        setTimeout(() => handler(Buffer.alloc(2 + 384 * 2, 1)), 10);
      }
      return mockSocket;
    });
    mockSocket.bind.mockImplementation((_port, _addr, cb) => cb());

    try {
      const pending = captureAndAnalyzeStream({
        streamType: "audio",
        c64uHost: "c64u",
        artifactDir,
        durationMs: 20,
        bindAddress: "127.0.0.1",
      });
      await vi.advanceTimersByTimeAsync(30);
      const result = await pending;

      expect(result.capture.packets).toHaveLength(1);
      expect(mockSocket.addMembership).toHaveBeenCalledWith("239.0.1.65", "127.0.0.1");
    } finally {
      fetchMock.mockRestore();
      await rm(artifactDir, { recursive: true, force: true });
    }
  });
});
