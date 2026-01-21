import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import istanbul from "vite-plugin-istanbul";
import path from "path";
import fs from "fs";

const pkg = JSON.parse(
  fs.readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);

const appVersion = process.env.VITE_APP_VERSION || pkg.version || "";
const gitSha =
  process.env.VITE_GIT_SHA ||
  process.env.GIT_SHA ||
  process.env.GITHUB_SHA ||
  "";
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
      include: 'src/*',
      exclude: ['node_modules', 'test/', 'tests/', 'playwright/'],
      extension: ['.js', '.ts', '.tsx'],
      requireEnv: false,
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
