import { z } from "zod";
import { defineToolModule, parseZodArgs } from "../types.js";
import { jsonResult } from "../responses.js";

const startSessionSchema = z.object({
  caseId: z.string().min(1),
  artifactDir: z.string().min(1).optional(),
  captureEndpoints: z.array(z.string().min(1)).optional(),
});

const recordStepSchema = z.object({
  runId: z.string().min(1),
  stepId: z.string().min(1),
  route: z.string().min(1),
  featureArea: z.string().min(1),
  action: z.string().min(1),
  peerServer: z.string().min(1).optional(),
  preconditions: z.array(z.string().min(1)).optional(),
  primaryOracle: z.string().min(1),
  fallbackOracle: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
});

const attachEvidenceSchema = z.object({
  runId: z.string().min(1),
  evidenceId: z.string().min(1),
  stepId: z.string().min(1).optional(),
  evidenceType: z.string().min(1),
  summary: z.string().min(1),
  path: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const finalizeSessionSchema = z.object({
  runId: z.string().min(1),
  outcome: z.enum(["pass", "fail", "inconclusive"]),
  failureClass: z.enum(["product_failure", "infrastructure_failure", "inconclusive"]),
  summary: z.string().min(1),
});

export const sessionModule = defineToolModule({
  domain: "scope_session",
  summary: "Session lifecycle, semantic step recording, and evidence correlation.",
  tools: [
    {
      name: "scope_session.start_session",
      description: "Create a new c64scope session for a case run.",
      inputSchema: {
        type: "object",
        properties: {
          caseId: { type: "string" },
          artifactDir: { type: "string" },
          captureEndpoints: { type: "array", items: { type: "string" } },
        },
        required: ["caseId"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const parsed = parseZodArgs(startSessionSchema, args);
        return jsonResult(await ctx.sessionStore.startSession(parsed));
      },
    },
    {
      name: "scope_session.record_step",
      description: "Record one semantic action step in the active run timeline.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
          stepId: { type: "string" },
          route: { type: "string" },
          featureArea: { type: "string" },
          action: { type: "string" },
          peerServer: { type: "string" },
          preconditions: { type: "array", items: { type: "string" } },
          primaryOracle: { type: "string" },
          fallbackOracle: { type: "string" },
          notes: { type: "string" },
        },
        required: ["runId", "stepId", "route", "featureArea", "action", "primaryOracle"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const parsed = parseZodArgs(recordStepSchema, args);
        return jsonResult(await ctx.sessionStore.recordStep(parsed));
      },
    },
    {
      name: "scope_session.attach_evidence",
      description: "Attach an external evidence reference to a session timeline.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
          evidenceId: { type: "string" },
          stepId: { type: "string" },
          evidenceType: { type: "string" },
          summary: { type: "string" },
          path: { type: "string" },
          metadata: { type: "object" },
        },
        required: ["runId", "evidenceId", "evidenceType", "summary"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const parsed = parseZodArgs(attachEvidenceSchema, args);
        return jsonResult(await ctx.sessionStore.attachEvidence(parsed));
      },
    },
    {
      name: "scope_session.finalize_session",
      description: "Finalize a session with deterministic outcome and summary.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
          outcome: { type: "string", enum: ["pass", "fail", "inconclusive"] },
          failureClass: {
            type: "string",
            enum: ["product_failure", "infrastructure_failure", "inconclusive"],
          },
          summary: { type: "string" },
        },
        required: ["runId", "outcome", "failureClass", "summary"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const parsed = parseZodArgs(finalizeSessionSchema, args);
        return jsonResult(await ctx.sessionStore.finalizeSession(parsed));
      },
    },
  ],
});
