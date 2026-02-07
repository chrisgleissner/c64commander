import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const nodeTestGlobs = [
  "tests/unit/tracing/traceFormatter.test.ts",
  "tests/unit/tracing/traceIds.test.ts",
  "tests/unit/tracing/traceSession.test.ts",
  "tests/unit/tracing/traceContext.test.ts",
  "tests/unit/tracing/redaction.test.ts",
  "tests/unit/tracing/effectCorrelation.test.ts",
  "tests/unit/tracing/actionTrace.test.ts",
  "tests/unit/tracing/traceActionContextStore.test.ts",
  "tests/unit/traceComparison*.test.ts",
  "tests/unit/diagnostics/**",
  "tests/unit/sid/**",
  "tests/unit/disks/**",
  "tests/unit/fileTypes.test.ts",
  "tests/unit/fileLibraryUtils.test.ts",
  "tests/unit/playlistTotals.test.ts",
  "tests/unit/sidUtils.test.ts",
  "tests/unit/sidStatus.test.ts",
  "tests/unit/sidVolumeControl.test.ts",
  "tests/unit/audioMixerSolo.test.ts",
  "tests/unit/diskTypes.test.ts",
  "tests/unit/diskFirstPrg.test.ts",
  "tests/unit/playbackClock.test.ts",
  "tests/unit/lib/playback/**",
  "tests/unit/lib/disks/**",
  "tests/unit/lib/buildInfo.test.ts",
  "tests/unit/config/audioMixerOptions.test.ts",
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "./src"),
    },
  },
  test: {
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit-jsdom",
          environment: "jsdom",
          include: ["tests/unit/**/*.{test,spec}.{ts,tsx}", "src/**/*.{test,spec}.{ts,tsx}"],
          exclude: nodeTestGlobs,
        },
      },
      {
        extends: true,
        test: {
          name: "unit-node",
          environment: "node",
          include: nodeTestGlobs,
        },
      },
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
        statements: 10,
        branches: 55,
        functions: 35,
        lines: 10,
      },
    },
  },
});
