/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

describe("validation helpers", () => {
  it("wraps adb and curl helpers", async () => {
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(null, { stdout: "ok\n" }));
    const { adb, c64uGet, c64uFtpList } = await import("../src/validation/helpers.js");

    await expect(adb("serial-1", "shell", "pwd")).resolves.toBe("ok\n");
    await expect(c64uGet("c64u", "/v1/info")).resolves.toBe("ok\n");
    await expect(c64uFtpList("c64u", "/USB0")).resolves.toBe("ok\n");
  });

  it("captures logcat, checks foreground state, dumps UI, and resets C64", async () => {
    execFileMock.mockImplementation((_cmd, args, cb) => {
      const joined = args.join(" ");
      if (joined.includes("dumpsys activity activities")) {
        cb(null, { stdout: "uk.gleissner.c64commander/.MainActivity" });
        return;
      }
      if (joined.includes("uiautomator dump")) {
        cb(null, { stdout: "" });
        return;
      }
      if (joined.includes("cat /sdcard/Download/c64scope-ui.xml")) {
        cb(null, { stdout: "<hierarchy></hierarchy>" });
        return;
      }
      if (joined.includes("logcat -d")) {
        cb(null, { stdout: "threadtime log" });
        return;
      }
      cb(null, { stdout: "" });
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => "ok",
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      status: 200,
      statusText: "OK",
    } as Response);

    const { captureLogcat, dumpUiHierarchy, isAppInForeground, readC64Memory, resetC64Machine, ts } =
      await import("../src/validation/helpers.js");
    const logPath = path.join(os.tmpdir(), `c64scope-log-${Date.now()}.txt`);

    try {
      expect(await captureLogcat("serial-1", logPath, 10)).toBe("threadtime log");
      expect(await readFile(logPath, "utf-8")).toBe("threadtime log");
      await expect(isAppInForeground("serial-1")).resolves.toBe(true);
      await expect(dumpUiHierarchy("serial-1")).resolves.toContain("<hierarchy");
      await expect(readC64Memory("c64u", 0x1000, 3)).resolves.toEqual(new Uint8Array([1, 2, 3]));
      await expect(resetC64Machine("c64u")).resolves.toBeUndefined();
      expect(ts()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      fetchMock.mockRestore();
      await rm(logPath, { force: true });
    }
  });

  it("retries screenshot capture and validates UI dump content", async () => {
    let screencapAttempts = 0;
    execFileMock.mockImplementation((_cmd, args, cb) => {
      const joined = args.join(" ");
      if (joined.includes("screencap")) {
        screencapAttempts += 1;
        if (screencapAttempts === 1) {
          cb(new Error("busy"), { stdout: "" });
          return;
        }
      }
      if (joined.includes("uiautomator dump")) {
        cb(null, { stdout: "" });
        return;
      }
      if (joined.includes("cat /sdcard/Download/c64scope-ui.xml")) {
        cb(null, { stdout: "not-xml" });
        return;
      }
      cb(null, { stdout: "" });
    });

    const { dumpUiHierarchy, takeScreenshot } = await import("../src/validation/helpers.js");
    const shotPath = path.join(os.tmpdir(), `c64scope-shot-${Date.now()}.png`);

    try {
      await expect(takeScreenshot("serial-1", shotPath)).resolves.toBeUndefined();
      await expect(dumpUiHierarchy("serial-1")).rejects.toThrow(/did not produce XML hierarchy/);
    } finally {
      await rm(shotPath, { force: true });
    }
  });

  it("surfaces helper failure states for foreground checks, PRG runs, memory reads, and resets", async () => {
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(null, { stdout: "other.app/.MainActivity" }));

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: async () => "busy",
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        arrayBuffer: async () => new Uint8Array([]).buffer,
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "reset failed",
      } as Response);

    const { isAppInForeground, readC64Memory, resetC64Machine, runPrgOnC64u } =
      await import("../src/validation/helpers.js");

    try {
      await expect(isAppInForeground("serial-1")).resolves.toBe(false);
      await expect(runPrgOnC64u("c64u", Buffer.from([1, 2, 3]))).resolves.toMatchObject({
        ok: false,
        status: 503,
        body: "busy",
      });
      await expect(readC64Memory("c64u", 0x1000, 3)).rejects.toThrow(/readmem failed: 500 Internal Server Error/);
      await expect(resetC64Machine("c64u")).rejects.toThrow(/machine reset failed: 500 Internal Server Error/);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
