import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      module: path.resolve(__dirname, "./src/lib/polyfills/module.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}", "src/**/*.{test,spec}.{ts,tsx}"],
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
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
