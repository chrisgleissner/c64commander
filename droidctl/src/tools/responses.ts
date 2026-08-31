/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ToolRunResult } from "./types.js";

export function jsonResult(data: unknown, metadata?: Record<string, unknown>): ToolRunResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: {
      type: "json",
      data,
    },
    metadata,
  };
}
