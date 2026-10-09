/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Runs `tools/hil/*.hil.ts`: the app's own modules against a real Ultimate, in the same jsdom
 * environment the unit tests use. CI never runs these; they need the bench.
 *
 *   npx vitest run --config tools/hil/vitest.hil.config.ts
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../src"),
    },
  },
  test: {
    root: path.resolve(__dirname, "../.."),
    environment: "jsdom",
    include: ["tools/hil/**/*.hil.ts"],
    testTimeout: 6 * 60 * 60 * 1000,
    hookTimeout: 10 * 60 * 1000,
    fileParallelism: false,
  },
});
