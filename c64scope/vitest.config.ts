/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "dist/**",
        "node_modules/**",
        "tests/**",
        "vitest.config.ts",
        "src/hardwareValidation.ts",
        "src/hilEvidenceRun.ts",
        "src/playbackVolumeLatency.ts",
        "src/stream/types.ts",
        "src/cta/discover.ts",
        "src/cta/discoverRoutes.ts",
        "src/cta/gate*.ts",
        "src/cta/keypadCanaryRunner.ts",
        "src/cta/runner.ts",
        "src/cta/runnerCommon.ts",
        "src/cta/uiHelpers.ts",
        "src/validation/cases/**",
        "src/validation/index.ts",
        "src/validation/types.ts",
      ],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
