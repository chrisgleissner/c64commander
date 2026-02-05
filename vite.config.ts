import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import istanbul from "vite-plugin-istanbul";
import path from "path";
import fs from "fs";
import { spawnSync } from "child_process";

const pkg = JSON.parse(
  fs.readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);

const runGit = (args: string[], label: string) => {
  const result = spawnSync("git", args, { encoding: "utf-8" });
  if (result.status === 0) return result.stdout.trim();
  if (result.error) {
    console.warn(`[build] ${label} failed: ${result.error.message}`);
  } else if (result.stderr?.trim()) {
    console.warn(`[build] ${label} failed: ${result.stderr.trim()}`);
  }
  return "";
};

const gitTagFromEnv =
  (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME) || "";

const resolveGitSha = () =>
  process.env.VITE_GIT_SHA ||
  process.env.GIT_SHA ||
  process.env.GITHUB_SHA ||
  runGit(["rev-parse", "HEAD"], "git rev-parse");

const resolveExactGitTag = () =>
  gitTagFromEnv || runGit(["describe", "--tags", "--exact-match"], "git describe --exact-match");

const resolveLatestGitTag = () =>
  runGit(["describe", "--tags", "--abbrev=0"], "git describe --abbrev=0");

const resolveAppVersion = (gitShaValue: string) => {
  const envVersion = process.env.VITE_APP_VERSION || process.env.VERSION_NAME || "";
  const gitShaShort = gitShaValue ? gitShaValue.slice(0, 8) : "";
  const exactTag = resolveExactGitTag();
  const latestTag = exactTag || resolveLatestGitTag();

  if (latestTag) {
    if (exactTag) return latestTag;
    if (gitShaShort) return `${latestTag}-${gitShaShort}`;
    return latestTag;
  }

  if (envVersion) return envVersion;
  return pkg.version || "";
};

const gitSha = resolveGitSha();
const appVersion = resolveAppVersion(gitSha);
const buildTime = process.env.VITE_BUILD_TIME || new Date().toISOString();

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  assetsInclude: ['**/*.yaml', '**/*.yml'],
  build: {
    outDir: "dist",
    // Adjust warning threshold to avoid noisy chunk warnings while keeping defaults.
    chunkSizeWarningLimit: 1200,
  },
  plugins: [
    react(),
    // Instrument code for E2E coverage collection
    istanbul({
      include: 'src/**/*',
      exclude: ['node_modules', 'test/', 'tests/', 'playwright/'],
      extension: ['.js', '.ts', '.tsx'],
      requireEnv: true,
      envName: 'VITE_COVERAGE',
      forceBuildInstrument: true,
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __GIT_SHA__: JSON.stringify(gitSha),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      module: path.resolve(__dirname, "./src/lib/polyfills/module.ts"),
    },
  },
}));
