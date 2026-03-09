/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const adbMock = vi.fn();
const c64uGetMock = vi.fn();
const resetC64MachineMock = vi.fn();

vi.mock("../src/validation/helpers.js", () => ({
  adb: adbMock,
  c64uGet: c64uGetMock,
  resetC64Machine: resetC64MachineMock,
}));

describe("validation runner start failure", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("fails immediately when a session cannot be started", async () => {
    vi.doMock("../src/sessionStore.js", () => ({
      ScopeSessionStore: class {
        async startSession() {
          return {
            ok: false,
            runId: "run-start-fail",
            error: { message: "disk full" },
          };
        }
      },
    }));

    const { runCase } = await import("../src/validation/runner.js");

    await expect(
      runCase(
        {
          id: "TEST-START-FAIL",
          name: "Runner Start Failure",
          caseId: "RUN-START-FAIL",
          featureArea: "Home",
          route: "/",
          validationTrack: "product",
          safetyClass: "read-only",
          expectedOutcome: "fail",
          oracleClasses: ["UI", "REST-visible state"],
          run: async () => {
            throw new Error("should not execute");
          },
        },
        "serial-1",
        "c64u",
        "/tmp",
      ),
    ).rejects.toThrow(/Failed to start session: disk full/);
  });
});
