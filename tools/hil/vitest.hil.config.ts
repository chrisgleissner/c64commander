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
 * Runs `tools/hil/*.hil.ts`: the app's modules against a real Ultimate in the unit tests' jsdom environment. CI runs
 * them against the mock server (`npm run test:remote-seek:mock`); commands are in docs/testing/remote-sid-seek.md.
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
