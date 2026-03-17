/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import istanbul from "vite-plugin-istanbul";
import path from "path";
import fs from "fs";
import { spawnSync } from "child_process";
import { deriveVersionLabel } from "./src/lib/versionLabel";

const pkg = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

type RunGitOptions = {
  quiet?: boolean;
  suppressStderrPattern?: RegExp;
};

const runGit = (args: string[], label: string, options: RunGitOptions = {}) => {
  const result = spawnSync("git", args, { encoding: "utf-8" });
  if (result.status === 0) return result.stdout.trim();
  const stderr = result.stderr?.trim() || "";
  const shouldSuppress = Boolean(options.suppressStderrPattern && stderr && options.suppressStderrPattern.test(stderr));
  if (options.quiet || shouldSuppress) return "";
  if (result.error) {
    console.warn(`[build] ${label} failed: ${result.error.message}`);
  } else if (stderr) {
    console.warn(`[build] ${label} failed: ${stderr}`);
  }
  return "";
};

const resolveGitSha = () =>
  process.env.VITE_GIT_SHA ||
  process.env.GIT_SHA ||
  process.env.GITHUB_SHA ||
  runGit(["rev-parse", "HEAD"], "git rev-parse");

const sanitizeBuildToken = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, "-");

const resolveAppVersion = () => pkg.version || "";

const resolveAppVersionLabel = (gitDescribeValue: string, gitShaValue: string, fallbackVersion: string) =>
  deriveVersionLabel({
    gitDescribe: gitDescribeValue,
    gitSha: gitShaValue,
    fallbackVersion,
  });

const resolveServiceWorkerBuildId = (appVersion: string, gitShaValue: string, buildTimeValue: string) => {
  const envBuildId = process.env.VITE_SW_BUILD_ID || process.env.SW_BUILD_ID || "";
  if (envBuildId) return sanitizeBuildToken(envBuildId);

  const gitShaShort = gitShaValue ? gitShaValue.slice(0, 8) : "";
  const buildTimeToken = buildTimeValue ? sanitizeBuildToken(buildTimeValue.replace(/[:]/g, "-")) : "";
  return [appVersion, gitShaShort || buildTimeToken].filter(Boolean).join("-") || "dev";
};

const gitSha = resolveGitSha();
const gitDescribe =
  process.env.VITE_GIT_DESCRIBE ||
  process.env.GIT_DESCRIBE ||
  runGit(["describe", "--tags", "--long", "--dirty", "--always"], "git describe", {
    quiet: true,
  });
const appVersion = resolveAppVersion();
const appVersionLabel = resolveAppVersionLabel(gitDescribe, gitSha, appVersion);
const buildTime = process.env.VITE_BUILD_TIME || new Date().toISOString();
const serviceWorkerBuildId = resolveServiceWorkerBuildId(appVersion, gitSha, buildTime);
const enableCoverageInstrumentation = ["1", "true"].includes((process.env.VITE_COVERAGE || "").toLowerCase());

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8064,
    hmr: {
      overlay: false,
    },
  },
  assetsInclude: ["**/*.yaml", "**/*.yml"],
  build: {
    outDir: "dist",
    // Adjust warning threshold to avoid noisy chunk warnings while keeping defaults.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/react-router-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "vendor-react";
          }
          if (id.includes("/@radix-ui/") || id.includes("/framer-motion/") || id.includes("/lucide-react/")) {
            return "vendor-ui";
          }
          if (id.includes("/7z-wasm/") || id.includes("/fflate/")) {
            return "vendor-hvsc";
          }
          return "vendor";
        },
      },
    },
  },
  plugins: [
    react(),
    ...(enableCoverageInstrumentation
      ? [
          istanbul({
            include: "src/**/*",
            exclude: ["node_modules", "test/", "tests/", "playwright/"],
            extension: [".js", ".ts", ".tsx"],
            requireEnv: true,
            forceBuildInstrument: true,
          }),
        ]
      : []),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_VERSION_LABEL__: JSON.stringify(appVersionLabel),
    __GIT_SHA__: JSON.stringify(gitSha),
    __BUILD_TIME__: JSON.stringify(buildTime),
    __SW_BUILD_ID__: JSON.stringify(serviceWorkerBuildId),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      module: path.resolve(__dirname, "./src/lib/polyfills/module.ts"),
    },
  },
}));
