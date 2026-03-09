/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { z } from "zod";
import { captureAndAnalyzeStream } from "../../stream/index.js";
import { defineToolModule, parseZodArgs } from "../types.js";
import { jsonResult } from "../responses.js";

const reserveCaptureSchema = z.object({
  runId: z.string().min(1),
  endpoints: z.array(z.string().min(1)).optional(),
});

const runIdSchema = z.object({
  runId: z.string().min(1),
});

const degradeCaptureSchema = z.object({
  runId: z.string().min(1),
  reason: z.string().min(1),
});

const captureStreamSchema = z.object({
  runId: z.string().min(1),
  c64uHost: z.string().min(1),
  streamType: z.enum(["audio", "video"]),
  durationMs: z.number().int().min(200).max(30000).default(3000),
  bindAddress: z.string().min(1).optional(),
  bindPort: z.number().int().min(1024).max(65535).optional(),
  destinationIp: z.string().min(1).optional(),
});

export const captureModule = defineToolModule({
  domain: "scope_capture",
  summary: "Capture reservation and lifecycle management.",
  tools: [
    {
      name: "scope_capture.reserve_capture",
      description: "Reserve capture endpoints for a run.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
          endpoints: { type: "array", items: { type: "string" } },
        },
        required: ["runId"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const parsed = parseZodArgs(reserveCaptureSchema, args);
        return jsonResult(await ctx.sessionStore.reserveCapture(parsed));
      },
    },
    {
      name: "scope_capture.start_capture",
      description: "Start capture for a reserved run.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
        },
        required: ["runId"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const parsed = parseZodArgs(runIdSchema, args);
        return jsonResult(await ctx.sessionStore.startCapture(parsed.runId));
      },
    },
    {
      name: "scope_capture.stop_capture",
      description: "Stop active capture for a run.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
        },
        required: ["runId"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const parsed = parseZodArgs(runIdSchema, args);
        return jsonResult(await ctx.sessionStore.stopCapture(parsed.runId));
      },
    },
    {
      name: "scope_capture.capture_stream",
      description:
        "Capture live C64U UDP audio/video stream packets, run stream analysis, and attach stream evidence to the run.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
          c64uHost: { type: "string" },
          streamType: { type: "string", enum: ["audio", "video"] },
          durationMs: { type: "number" },
          bindAddress: { type: "string" },
          bindPort: { type: "number" },
          destinationIp: { type: "string" },
        },
        required: ["runId", "c64uHost", "streamType"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const parsed = parseZodArgs(captureStreamSchema, args);

        const sessionSummary = await ctx.sessionStore.getArtifactSummary(parsed.runId);
        if (!sessionSummary.ok) {
          return jsonResult(sessionSummary);
        }
        const artifactDir = String(sessionSummary.data.artifactDir);

        await ctx.sessionStore.reserveCapture({
          runId: parsed.runId,
          endpoints: [
            `udp://${parsed.destinationIp ?? "auto"}:${parsed.bindPort ?? (parsed.streamType === "audio" ? 11001 : 11000)}`,
          ],
        });
        await ctx.sessionStore.startCapture(parsed.runId);

        try {
          const result = await captureAndAnalyzeStream({
            streamType: parsed.streamType,
            c64uHost: parsed.c64uHost,
            artifactDir,
            durationMs: parsed.durationMs,
            bindAddress: parsed.bindAddress,
            bindPort: parsed.bindPort,
            destinationIp: parsed.destinationIp,
          });

          await ctx.sessionStore.attachEvidence({
            runId: parsed.runId,
            evidenceId: `ev-stream-${parsed.streamType}`,
            evidenceType: "stream_capture",
            summary: `${parsed.streamType} UDP stream capture`,
            path: result.analysisPath,
            metadata: {
              streamType: parsed.streamType,
              bindAddress: result.capture.bindAddress,
              bindPort: result.capture.bindPort,
              destination: result.capture.destination,
              durationMs: result.capture.durationMs,
              packetCount: result.capture.packets.length,
              analysisPath: result.analysisPath,
              packetsPath: result.packetsPath,
            },
          });

          await ctx.sessionStore.stopCapture(parsed.runId);

          return jsonResult({
            ok: true,
            runId: parsed.runId,
            timestamp: new Date().toISOString(),
            data: {
              streamType: parsed.streamType,
              packetCount: result.capture.packets.length,
              analysisPath: result.analysisPath,
              packetsPath: result.packetsPath,
              analysis: result.analysis,
            },
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return jsonResult(await ctx.sessionStore.degradeCapture(parsed.runId, message));
        }
      },
    },
    {
      name: "scope_capture.degrade_capture",
      description: "Mark an active or reserved capture as degraded due to endpoint failure or infrastructure issues.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
          reason: { type: "string" },
        },
        required: ["runId", "reason"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const parsed = parseZodArgs(degradeCaptureSchema, args);
        return jsonResult(await ctx.sessionStore.degradeCapture(parsed.runId, parsed.reason));
      },
    },
  ],
});
