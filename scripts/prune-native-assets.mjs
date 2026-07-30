#!/usr/bin/env node
/*
 * Remove files from the synced native projects that nothing can reach at run time.
 *
 * `cap sync` copies `dist/` verbatim into the Android and iOS projects, because one web bundle
 * serves the browser build and both apps. That is the right default and the wrong final answer:
 * some of what the browser build needs is unreachable once the app has native plugins, and the web
 * bundle carries every variant's branding because it has no idea which app it is about to become.
 * Neither is harmful, but both are shipped bytes that cannot ever be used.
 *
 * This runs after `cap sync` and prunes only what is provably dead for the artifact being built.
 * `dist/` itself is never touched, so the web build keeps everything.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const VARIANT_JSON = path.join(REPO_ROOT, "src/generated/variant.json");

/** The synced web roots, one per native project. Missing ones are skipped (a platform may not be set up). */
const NATIVE_WEB_ROOTS = [
  path.join(REPO_ROOT, "android/app/src/main/assets/public"),
  path.join(REPO_ROOT, "ios/App/App/public"),
];

/**
 * The 7-Zip WebAssembly build.
 *
 * Both apps extract HVSC natively — Android through `lib7zz.so`, iOS through SWCompression — and
 * `resolveHvscIngestionMode()` blocks the non-native path in production anyway. The one route that
 * still reaches this in a shipped app is the fallback taken when the native extractor meets a 7z
 * method chain it cannot decode, and measurement says that fallback cannot do the job on a phone
 * regardless: extracting the full HVSC through the WASM build peaks at ~1.1 GB, because it unpacks
 * the whole 372 MB archive into the Emscripten filesystem before reading a single entry out of it.
 * A device that hits that path runs out of memory instead of failing cleanly, so the 1.6 MB buys
 * nothing on native. The browser build, which has no native extractor and no such memory ceiling,
 * keeps it.
 */
const isSevenZipWasm = (relativePath) => /(^|\/)7zz-[^/]*\.wasm$/.test(relativePath);

const readActiveVariantId = () => {
  const parsed = JSON.parse(fs.readFileSync(VARIANT_JSON, "utf8"));
  const id = parsed?.variant?.id;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`Could not read the active variant id from ${VARIANT_JSON}`);
  }
  return id.trim();
};

/**
 * Brand images belonging to a variant this artifact is not.
 *
 * `public/` holds every variant's icons because it is shared, and only the active variant's are
 * referenced (through the generated variant metadata, the manifest and index.html). The others are
 * inert bytes carrying another product's identity, which is worth removing on its own account.
 */
const foreignBrandMatcher = (activeVariantId, variantIds) => {
  const foreign = variantIds.filter((id) => id !== activeVariantId);
  return (relativePath) => {
    const name = path.basename(relativePath);
    return foreign.some((id) => name === `${id}.png` || name.startsWith(`${id}-`));
  };
};

const walk = (dir, base = dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
};

export const pruneNativeAssets = ({
  repoRoot = REPO_ROOT,
  roots = NATIVE_WEB_ROOTS,
  activeVariantId,
  variantIds,
} = {}) => {
  const active = activeVariantId ?? readActiveVariantId();
  const ids =
    variantIds ??
    fs
      .readdirSync(path.join(repoRoot, "variants/assets"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  const isForeignBrand = foreignBrandMatcher(active, ids);

  const removed = [];
  let bytes = 0;
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const relative of walk(root)) {
      if (!isSevenZipWasm(relative) && !isForeignBrand(relative)) continue;
      const full = path.join(root, relative);
      bytes += fs.statSync(full).size;
      fs.rmSync(full);
      removed.push(path.relative(repoRoot, full).split(path.sep).join("/"));
    }
  }
  return { activeVariantId: active, removed, bytes };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = pruneNativeAssets();
  const mib = (result.bytes / (1024 * 1024)).toFixed(2);
  process.stdout.write(
    `[prune-native-assets] ${result.activeVariantId}: removed ${result.removed.length} file(s), ${mib} MiB\n`,
  );
  for (const file of result.removed) process.stdout.write(`  - ${file}\n`);
}
