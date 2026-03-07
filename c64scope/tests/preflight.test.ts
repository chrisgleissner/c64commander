/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from "vitest";
import { runPreflight } from "../src/preflight.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string }) => void) => {
    cb(new Error("mocked"), { stdout: "" });
  }),
}));

describe("preflight", () => {
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
});
