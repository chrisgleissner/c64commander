/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPreflight } from "../src/preflight.js";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

describe("preflight", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string }) => void) => {
        cb(new Error("mocked"), { stdout: "" });
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dry-run mode skips hardware checks", async () => {
    const result = await runPreflight({ dryRun: true });
    expect(result.ready).toBe(true);
    const hardwareChecks = result.checks.filter(
      (c) =>
        c.name === "adb_available" ||
        c.name === "device_connected" ||
        c.name === "c64u_reachable" ||
        c.name === "app_installed",
    );
    expect(hardwareChecks.every((c) => c.status === "skip")).toBe(true);
  });

  it("checks node version", async () => {
    const result = await runPreflight({ dryRun: true });
    const nodeCheck = result.checks.find((c) => c.name === "node_version");
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck!.status).toBe("pass");
  });

  it("includes all 5 checks in non-dry-run mode", async () => {
    const result = await runPreflight();
    expect(result.checks).toHaveLength(5);
    expect(result.checks.map((c) => c.name)).toEqual([
      "node_version",
      "adb_available",
      "device_connected",
      "c64u_reachable",
      "app_installed",
    ]);
  });

  it("not ready when hardware checks fail", async () => {
    const result = await runPreflight();
    expect(result.ready).toBe(false);
  });

  it("passes all non-dry-run checks when adb, device, app, and c64u are reachable", async () => {
    execFileMock.mockImplementation(
      (cmd: string, args: string[], cb: (err: Error | null, result: { stdout: string }) => void) => {
        if (cmd === "adb" && args[0] === "version") {
          cb(null, { stdout: "Android Debug Bridge version 1.0.41\n" });
          return;
        }
        if (cmd === "adb" && args[0] === "devices") {
          cb(null, { stdout: "List of devices attached\nserial-9 device usb:1-1\n" });
          return;
        }
        if (cmd === "curl") {
          cb(null, { stdout: '{"version":"1.0"}' });
          return;
        }
        if (cmd === "adb" && args.includes("pm")) {
          cb(null, { stdout: "package:uk.gleissner.c64commander\n" });
          return;
        }
        cb(new Error(`unexpected: ${cmd} ${args.join(" ")}`), { stdout: "" });
      },
    );

    const result = await runPreflight({
      deviceSerial: "serial-9",
      c64uHost: "c64u.local",
      appPackage: "uk.gleissner.c64commander",
    });

    expect(result.ready).toBe(true);
    expect(result.checks.map((check) => check.status)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
  });

  it("reports missing or mismatched devices and app install state", async () => {
    execFileMock.mockImplementation(
      (cmd: string, args: string[], cb: (err: Error | null, result: { stdout: string }) => void) => {
        if (cmd === "adb" && args[0] === "version") {
          cb(null, { stdout: "Android Debug Bridge version 1.0.41\n" });
          return;
        }
        if (cmd === "adb" && args[0] === "devices") {
          cb(null, { stdout: "List of devices attached\nserial-2 device usb:1-1\n" });
          return;
        }
        if (cmd === "curl") {
          cb(new Error("offline"), { stdout: "" });
          return;
        }
        if (cmd === "adb" && args.includes("pm")) {
          cb(null, { stdout: "" });
          return;
        }
        cb(new Error(`unexpected: ${cmd} ${args.join(" ")}`), { stdout: "" });
      },
    );

    const result = await runPreflight({
      deviceSerial: "serial-1",
      c64uHost: "down-host",
      appPackage: "uk.gleissner.c64commander",
    });

    expect(result.ready).toBe(false);
    expect(result.checks.find((check) => check.name === "device_connected")?.detail).toContain("serial-1 not found");
    expect(result.checks.find((check) => check.name === "c64u_reachable")?.detail).toContain("not reachable");
    expect(result.checks.find((check) => check.name === "app_installed")?.detail).toContain("not installed");
  });

  it("reports no connected devices and failed package queries", async () => {
    execFileMock.mockImplementation(
      (cmd: string, args: string[], cb: (err: Error | null, result: { stdout: string }) => void) => {
        if (cmd === "adb" && args[0] === "version") {
          cb(null, { stdout: "Android Debug Bridge version 1.0.41\n" });
          return;
        }
        if (cmd === "adb" && args[0] === "devices") {
          cb(null, { stdout: "List of devices attached\n\n" });
          return;
        }
        if (cmd === "curl") {
          cb(null, { stdout: '{"version":"1.0"}' });
          return;
        }
        if (cmd === "adb" && args.includes("pm")) {
          cb(new Error("pm failed"), { stdout: "" });
          return;
        }
        cb(new Error(`unexpected: ${cmd} ${args.join(" ")}`), { stdout: "" });
      },
    );

    const result = await runPreflight();

    expect(result.ready).toBe(false);
    expect(result.checks.find((check) => check.name === "device_connected")?.detail).toBe("No Android devices connected");
    expect(result.checks.find((check) => check.name === "app_installed")?.detail).toContain("Failed to check");
  });

  it("fails the node version check on unsupported runtimes", async () => {
    const originalVersion = process.version;
    Object.defineProperty(process, "version", {
      configurable: true,
      value: "v22.0.0",
    });

    try {
      const result = await runPreflight({ dryRun: true });
      expect(result.ready).toBe(false);
      expect(result.checks.find((check) => check.name === "node_version")?.status).toBe("fail");
    } finally {
      Object.defineProperty(process, "version", {
        configurable: true,
        value: originalVersion,
      });
    }
  });
});
