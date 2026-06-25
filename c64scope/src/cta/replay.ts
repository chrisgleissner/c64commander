/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { z } from "zod";
import { redactRecord } from "./redaction.js";

export const recordedActionSchema = z.object({
  runId: z.string().min(1),
  suiteId: z.string().min(1),
  caseId: z.string().min(1),
  stepId: z.string().min(1),
  recordedAt: z.string().min(1),
  target: z.string().min(1),
  route: z.string().min(1),
  overlay: z.string().nullable(),
  actionType: z.string().min(1),
  semanticTarget: z.string().min(1),
  inputMethod: z.enum(["keypad", "touch", "system", "text"]),
  keyCode: z.number().int().nullable(),
  value: z.unknown().optional(),
  preStateSignature: z.string().min(1),
  postStateSignature: z.string().min(1).nullable(),
  durationMs: z.number().nonnegative(),
  result: z.enum(["PASS", "FAIL", "BLOCKED", "INCONCLUSIVE"]),
  retryCount: z.number().int().nonnegative(),
  screenshotRef: z.string().nullable(),
  uiHierarchyRef: z.string().nullable(),
  diagnosticsRef: z.string().nullable(),
  c64scopeEventRef: z.string().nullable(),
  error: z.string().nullable(),
  recoveryAction: z.string().nullable(),
});

export const replaySpecSchema = z.object({
  runId: z.string().min(1),
  caseId: z.string().min(1),
  requiredTarget: z.string().min(1),
  requiredAppState: z.record(z.string(), z.unknown()),
  requiredFixtures: z.array(z.string()),
  requiredFeatureFlags: z.array(z.string()),
  actions: z.array(recordedActionSchema),
  timeouts: z.record(z.string(), z.number().nonnegative()),
  assertions: z.array(z.string()),
  cleanup: z.array(z.string()),
});

export type RecordedAction = z.infer<typeof recordedActionSchema>;
export type ReplaySpec = z.infer<typeof replaySpecSchema>;

export function recordedAction(
  input: z.input<typeof recordedActionSchema>,
  secrets: readonly string[] = [],
): RecordedAction {
  const redacted = redactRecord(input as Record<string, unknown>, secrets);
  return recordedActionSchema.parse(redacted);
}

export function buildReplaySpec(input: {
  runId: string;
  caseId: string;
  requiredTarget: string;
  actions: readonly RecordedAction[];
  requiredAppState?: Record<string, unknown>;
  requiredFixtures?: readonly string[];
  requiredFeatureFlags?: readonly string[];
  timeouts?: Record<string, number>;
  assertions?: readonly string[];
  cleanup?: readonly string[];
}): ReplaySpec {
  if (input.actions.length === 0) {
    throw new Error(`Cannot build replay spec for ${input.runId}/${input.caseId} without recorded actions.`);
  }

  return replaySpecSchema.parse({
    runId: input.runId,
    caseId: input.caseId,
    requiredTarget: input.requiredTarget,
    requiredAppState: input.requiredAppState ?? {},
    requiredFixtures: [...(input.requiredFixtures ?? [])],
    requiredFeatureFlags: [...(input.requiredFeatureFlags ?? [])],
    actions: [...input.actions],
    timeouts: input.timeouts ?? {},
    assertions: [...(input.assertions ?? [])],
    cleanup: [...(input.cleanup ?? [])],
  });
}

export function replayCommand(spec: ReplaySpec): string {
  return `npm run scope:cta:replay -- --run-id ${spec.runId} --case ${spec.caseId}`;
}
