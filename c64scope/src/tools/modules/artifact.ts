/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { z } from "zod";
import { defineToolModule, parseZodArgs } from "../types.js";
import { jsonResult } from "../responses.js";

const runIdSchema = z.object({
  runId: z.string().min(1),
});

export const artifactModule = defineToolModule({
  domain: "scope_artifact",
  summary: "Artifact-summary retrieval for completed or in-progress runs.",
  tools: [
    {
      name: "scope_artifact.get_artifact_summary",
      description: "Return the current artifact summary for a run.",
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
        return jsonResult(await ctx.sessionStore.getArtifactSummary(parsed.runId));
      },
    },
  ],
});
