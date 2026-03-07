/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { z } from "zod";
import type { PeerHealthLevel, PeerName } from "../../labState.js";
import { defineToolModule, parseZodArgs } from "../types.js";
import { jsonResult } from "../responses.js";

const reportPeerHealthSchema = z.object({
  peer: z.enum(["mobile_controller", "c64bridge", "capture_infrastructure"]),
  level: z.enum(["healthy", "degraded", "unavailable", "unknown"]),
  detail: z.string().min(1),
});

export const labModule = defineToolModule({
  domain: "scope_lab",
  summary: "Lab readiness and peer-server health checks.",
  tools: [
    {
      name: "scope_lab.get_lab_state",
      description:
        "Return the current c64scope lab-health view including peer-server readiness and overall lab readiness.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute(_args, ctx) {
        const readiness = ctx.labStateStore.checkReadiness();
        return jsonResult({
          ok: true,
          runId: "scope-lab",
          timestamp: new Date().toISOString(),
          data: {
            ready: readiness.ready,
            peers: readiness.peers,
            degradedReasons: readiness.degradedReasons,
          },
        });
      },
    },
    {
      name: "scope_lab.report_peer_health",
      description:
        "Report the health status of a peer server (mobile_controller, c64bridge, or capture_infrastructure).",
      inputSchema: {
        type: "object",
        properties: {
          peer: {
            type: "string",
            enum: ["mobile_controller", "c64bridge", "capture_infrastructure"],
          },
          level: {
            type: "string",
            enum: ["healthy", "degraded", "unavailable", "unknown"],
          },
          detail: { type: "string" },
        },
        required: ["peer", "level", "detail"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const parsed = parseZodArgs(reportPeerHealthSchema, args);
        const report = ctx.labStateStore.reportPeerHealth(
          parsed.peer as PeerName,
          parsed.level as PeerHealthLevel,
          parsed.detail,
        );
        return jsonResult({
          ok: true,
          runId: "scope-lab",
          timestamp: new Date().toISOString(),
          data: report,
        });
      },
    },
    {
      name: "scope_lab.check_lab_readiness",
      description: "Check whether all peer servers are healthy and the lab is ready for test execution.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute(_args, ctx) {
        const readiness = ctx.labStateStore.checkReadiness();
        return jsonResult({
          ok: true,
          runId: "scope-lab",
          timestamp: new Date().toISOString(),
          data: readiness,
        });
      },
    },
  ],
});
