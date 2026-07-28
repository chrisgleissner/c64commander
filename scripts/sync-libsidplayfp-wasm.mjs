#!/usr/bin/env node
/*
 * Copies the libsidplayfp WASM engine from node_modules into
 *   public/wasm/libsidplayfp/dist/
 * so Vite serves it as a static asset.
 *
 * WHY A COPY AT ALL
 * -----------------
 * `public/` is copied verbatim by Vite, so the emscripten glue is never parsed
 * by the bundler, and Capacitor then copies `dist/` into the native bundle. The
 * engine therefore ships *inside* the APK / IPA / Docker image and the app
 * downloads nothing at runtime. `localSid.worker.ts` loads it lazily, only when
 * the user selects the "This device" playback engine.
 *
 * WHY VERBATIM, AND WHY THE `dist/` LEVEL IS KEPT
 * -----------------------------------------------
 * The package's `index.js` imports `../dist/libsidplayfp.js`. Mirroring the
 * package's own layout makes that resolve unchanged, so what is served is
 * byte-for-byte what npm delivered. Flattening the tree would require rewriting
 * that import, which is how the previous hand-adapted copies of `index.js` and
 * `player.js` came to exist — and how they silently fell behind the engine they
 * were adapting.
 *
 * Integrity comes from the npm lockfile, so there is no digest to maintain here.
 * Version comes from package.json, so a bump is a reviewable one-line diff.
 *
 * Runs from `prebuild`, before `vite build`.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_DIR = path.join(ROOT, "public", "wasm", "libsidplayfp");
const TARGET = path.join(ENGINE_DIR, "dist");

const packageJsonPath = require.resolve("libsidplayfp-wasm/package.json");
const source = path.join(path.dirname(packageJsonPath), "dist");
const { version } = JSON.parse(readFileSync(packageJsonPath, "utf8"));

if (!existsSync(source)) {
  console.error(`[wasm:sync] libsidplayfp-wasm ${version} has no dist/ at ${source}`);
  process.exit(1);
}

// The whole engine directory is generated, so replace it whole. Syncing only
// `dist/` would leave anything an earlier layout put beside it — which Vite
// would still copy into the bundle and Capacitor into the app.
rmSync(ENGINE_DIR, { recursive: true, force: true });
mkdirSync(ENGINE_DIR, { recursive: true });
cpSync(source, TARGET, { recursive: true });

// Only useful to someone rebuilding the engine, which a browser never does, and
// 1.5 MB that would otherwise ship inside the app. Everything else is copied
// unchanged — including the source maps: the package does not ship the sources
// they name, but deleting them is worse than leaving them, because the `.js`
// files still carry `sourceMappingURL` and tools then fail to find the map at
// all rather than merely failing to find its sources.
for (const buildOnly of ["complete-source.tar.gz", "complete-source.tar.gz.stamp"]) {
  rmSync(path.join(TARGET, buildOnly), { force: true });
}

for (const required of [
  "index.js",
  "player.js",
  "libsidplayfp.js",
  "libsidplayfp.wasm",
  "LICENSE",
  "THIRD-PARTY-NOTICES.md",
  path.join("sidlite", "libsidplayfp.js"),
  path.join("sidlite", "libsidplayfp.wasm"),
]) {
  if (!existsSync(path.join(TARGET, required))) {
    console.error(`[wasm:sync] libsidplayfp-wasm ${version} is missing ${required}`);
    process.exit(1);
  }
}

console.log(`[wasm:sync] libsidplayfp-wasm ${version} -> public/wasm/libsidplayfp/dist/`);
