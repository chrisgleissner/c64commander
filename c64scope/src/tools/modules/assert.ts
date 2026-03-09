/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertionCatalog, evidenceTypeCatalog } from "../../catalog/index.js";
import { defineToolModule, parseZodArgs } from "../types.js";
import { jsonResult } from "../responses.js";

const recordAssertionSchema = z.object({
  runId: z.string().min(1),
  assertionId: z.string().min(1),
  title: z.string().min(1),
  oracleClass: z.string().min(1),
  passed: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});

const verifyStreamSignatureSchema = z.object({
  runId: z.string().min(1),
  streamType: z.enum(["audio", "video"]),
  expectedBorderColor: z.number().int().min(0).max(15).optional(),
  expectedBackgroundColor: z.number().int().min(0).max(15).optional(),
  minAudioRms: z.number().min(0).max(1).default(0.005),
  minFrameCompleteness: z.number().min(0).max(1).default(0.6),
});

export const assertModule = defineToolModule({
  domain: "scope_assert",
  summary: "Assertion catalog and assertion recording.",
  tools: [
    {
      name: "scope_assert.list_assertions",
      description: "List the built-in assertion definitions.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        return jsonResult({
          ok: true,
          runId: "scope-assert",
          timestamp: new Date().toISOString(),
          data: {
            assertions: assertionCatalog,
          },
        });
      },
    },
    {
      name: "scope_assert.record_assertion",
      description: "Record an assertion result for a run.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
          assertionId: { type: "string" },
          title: { type: "string" },
          oracleClass: { type: "string" },
          passed: { type: "boolean" },
          details: { type: "object" },
        },
        required: ["runId", "assertionId", "title", "oracleClass", "passed"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const parsed = parseZodArgs(recordAssertionSchema, args);
        return jsonResult(await ctx.sessionStore.recordAssertion(parsed));
      },
    },
    {
      name: "scope_assert.verify_stream_signature",
      description:
        "Verify captured UDP stream analysis against expected audio/video signal signatures and record assertions.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
          streamType: { type: "string", enum: ["audio", "video"] },
          expectedBorderColor: { type: "number" },
          expectedBackgroundColor: { type: "number" },
          minAudioRms: { type: "number" },
          minFrameCompleteness: { type: "number" },
        },
        required: ["runId", "streamType"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const parsed = parseZodArgs(verifyStreamSignatureSchema, args);
        const sessionSummary = await ctx.sessionStore.getArtifactSummary(parsed.runId);
        if (!sessionSummary.ok) {
          return jsonResult(sessionSummary);
        }

        const artifactDir = String(sessionSummary.data.artifactDir);
        const analysisPath = path.join(artifactDir, `${parsed.streamType}-stream-analysis.json`);
        const raw = await readFile(analysisPath, "utf-8");
        const analysis = JSON.parse(raw) as Record<string, unknown>;

        if (parsed.streamType === "audio") {
          const rms = Number(analysis.rms ?? 0);
          const packetCount = Number((analysis.stats as Record<string, unknown> | undefined)?.packetCount ?? 0);
          const passed = packetCount > 0 && rms >= parsed.minAudioRms;

          await ctx.sessionStore.recordAssertion({
            runId: parsed.runId,
            assertionId: "assert-stream-audio",
            title: "Audio stream contains non-silent signal",
            oracleClass: "A/V signal",
            passed,
            details: {
              packetCount,
              rms,
              minAudioRms: parsed.minAudioRms,
              dominantFrequencyHz: analysis.dominantFrequencyHz,
            },
          });

          return jsonResult({
            ok: true,
            runId: parsed.runId,
            timestamp: new Date().toISOString(),
            data: {
              passed,
              analysisPath,
              packetCount,
              rms,
            },
          });
        }

        const borderColor = Number(analysis.dominantBorderColor ?? -1);
        const backgroundColor = Number(analysis.dominantBackgroundColor ?? -1);
        const frameCompleteness = Number(analysis.frameCompleteness ?? 0);
        const expectedBorder = parsed.expectedBorderColor ?? 2;
        const expectedBackground = parsed.expectedBackgroundColor ?? 6;
        const passed =
          frameCompleteness >= parsed.minFrameCompleteness &&
          borderColor === expectedBorder &&
          backgroundColor === expectedBackground;

        await ctx.sessionStore.recordAssertion({
          runId: parsed.runId,
          assertionId: "assert-stream-video",
          title: "Video stream matches expected color signature",
          oracleClass: "A/V signal",
          passed,
          details: {
            dominantBorderColor: borderColor,
            dominantBackgroundColor: backgroundColor,
            expectedBorderColor: expectedBorder,
            expectedBackgroundColor: expectedBackground,
            frameCompleteness,
            minFrameCompleteness: parsed.minFrameCompleteness,
          },
        });

        return jsonResult({
          ok: true,
          runId: parsed.runId,
          timestamp: new Date().toISOString(),
          data: {
            passed,
            analysisPath,
            dominantBorderColor: borderColor,
            dominantBackgroundColor: backgroundColor,
            frameCompleteness,
          },
        });
      },
    },
    {
      name: "scope_assert.list_evidence_types",
      description: "List the canonical evidence types accepted for observation-layer attachment.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        return jsonResult({
          ok: true,
          runId: "scope-assert",
          timestamp: new Date().toISOString(),
          data: {
            evidenceTypes: evidenceTypeCatalog,
          },
        });
      },
    },
  ],
});
