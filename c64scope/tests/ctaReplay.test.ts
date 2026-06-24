/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { buildReplaySpec, recordedAction, replayCommand } from "../src/cta/replay.js";

const baseAction = {
  runId: "run-1",
  suiteId: "suite-1",
  caseId: "case-1",
  stepId: "step-1",
  recordedAt: "2026-06-24T00:00:00.000Z",
  target: "c64u",
  route: "/settings",
  overlay: null,
  actionType: "input",
  semanticTarget: "lbl|/settings||text-input|password",
  inputMethod: "text" as const,
  keyCode: null,
  value: "pwd",
  preStateSignature: "before",
  postStateSignature: "after",
  durationMs: 20,
  result: "FAIL" as const,
  retryCount: 0,
  screenshotRef: null,
  uiHierarchyRef: "hierarchy.xml",
  diagnosticsRef: null,
  c64scopeEventRef: null,
  error: "bad password pwd",
  recoveryAction: null,
};

describe("CTA replay", () => {
  it("redacts recorded action values and known secret literals", () => {
    const action = recordedAction(baseAction, ["pwd"]);

    expect(action.value).toBe("[REDACTED]");
    expect(action.error).toBe("bad password [REDACTED]");
  });

  it("builds replay specs and commands from recorded actions", () => {
    const action = recordedAction({ ...baseAction, value: "safe", error: null });
    const spec = buildReplaySpec({
      runId: "run-1",
      caseId: "case-1",
      requiredTarget: "c64u",
      actions: [action],
      requiredFeatureFlags: ["backgroundPlayback"],
      assertions: ["UI error remains visible"],
    });

    expect(spec.actions).toHaveLength(1);
    expect(spec.requiredFeatureFlags).toEqual(["backgroundPlayback"]);
    expect(replayCommand(spec)).toBe("npm run scope:cta:replay -- --run-id run-1 --case case-1");
  });

  it("rejects empty replay specs", () => {
    expect(() => buildReplaySpec({ runId: "run-1", caseId: "case-1", requiredTarget: "c64u", actions: [] })).toThrow(
      /without recorded actions/,
    );
  });
});
