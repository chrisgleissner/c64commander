import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}", "src/**/*.{test,spec}.{ts,tsx}"],
    environmentMatchGlobs: [
      // Pure service/logic tests — no DOM, no React, no browser APIs.
      // Tests that use @vitest-environment directives override this.
      ["tests/unit/tracing/traceFormatter.test.ts", "node"],
      ["tests/unit/tracing/traceIds.test.ts", "node"],
      ["tests/unit/tracing/traceSession.test.ts", "node"],
      ["tests/unit/tracing/traceContext.test.ts", "node"],
      ["tests/unit/tracing/redaction.test.ts", "node"],
      ["tests/unit/tracing/effectCorrelation.test.ts", "node"],
      ["tests/unit/tracing/actionTrace.test.ts", "node"],
      ["tests/unit/tracing/traceActionContextStore.test.ts", "node"],
      ["tests/unit/traceComparison*.test.ts", "node"],
      ["tests/unit/diagnostics/**", "node"],
      ["tests/unit/sid/**", "node"],
      ["tests/unit/disks/**", "node"],
      ["tests/unit/fileTypes.test.ts", "node"],
      ["tests/unit/fileLibraryUtils.test.ts", "node"],
      ["tests/unit/playlistTotals.test.ts", "node"],
      ["tests/unit/sidUtils.test.ts", "node"],
      ["tests/unit/sidStatus.test.ts", "node"],
      ["tests/unit/sidVolumeControl.test.ts", "node"],
      ["tests/unit/audioMixerSolo.test.ts", "node"],
      ["tests/unit/diskTypes.test.ts", "node"],
      ["tests/unit/diskFirstPrg.test.ts", "node"],
      ["tests/unit/playbackClock.test.ts", "node"],
      ["tests/unit/lib/playback/**", "node"],
      ["tests/unit/lib/disks/**", "node"],
      ["tests/unit/lib/buildInfo.test.ts", "node"],
      ["tests/unit/config/audioMixerOptions.test.ts", "node"],
    ],
    coverage: {
      provider: "v8",
      all: false,
      reporter: ["text", "lcov", "html", "json"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/vite-env.d.ts",
        "src/main.tsx",
        "**/*.d.ts",
        "**/*.config.{ts,js}",
        "**/node_modules/**",
      ],
      thresholds: {
        // Current baseline thresholds - aim to increase over time
        statements: 10,
        branches: 55,
        functions: 35,
        lines: 10,
      },
    },
  },
});
