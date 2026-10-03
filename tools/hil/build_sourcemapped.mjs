#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Rebuild the web bundle of one commit with source maps, so a CPU profile taken on the phone can be
 * read in original function names.
 *
 * A profile names minified functions (`N9`, `W9`) at positions in `index-<hash>.js`. A source map
 * only translates those positions if it was produced by the same build, so this reproduces the
 * build as closely as it can:
 *
 *   - a detached git worktree at the commit, sharing the main checkout's node_modules;
 *   - the `VITE_*` values the original build embedded, read back out of the APK's own bundle
 *     (`--apk`), because Vite inlines the whole `import.meta.env` object and every one of them,
 *     the build time and the debug device list included, changes the bytes and so the chunk hash;
 *   - `vite build --sourcemap hidden`, which writes `.map` files without adding a
 *     `sourceMappingURL` comment to the code, into `--out`, never into `dist/`.
 *
 * It then compares every rebuilt chunk with the APK's: same name and same bytes is an exact match;
 * a different hash with the same chunk prefix is compared by content, and the report says which.
 *
 * Usage:
 *   node tools/hil/build_sourcemapped.mjs --commit be11a2bda --apk path/to/app.apk --out <dir>
 *
 * Writes <out>/dist/assets/*.js(.map), <out>/apk-assets/*.js and <out>/match.json.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

/** The `{BASE_URL:"/",...}` object literal Vite inlined for `import.meta.env`, as source text. */
export const findEmbeddedEnvLiteral = (code) => {
  const start = code.indexOf('{BASE_URL:"');
  if (start < 0) return null;
  let depth = 0;
  let quote = null;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  return null;
};

/** The `VITE_*` entries of the embedded env object. The literal holds only strings and `!0`/`!1`. */
export const embeddedViteEnv = (code) => {
  const literal = findEmbeddedEnvLiteral(code);
  if (!literal) throw new Error("no inlined import.meta.env object in the bundle");
  const env = new Function(`return (${literal});`)();
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key]) => key.startsWith("VITE_"))
      .map(([key, value]) => [key, String(value)]),
  );
};

/** `index-sftUog9q.js` -> `index`; the part of a chunk name that survives a content change. */
export const chunkPrefix = (name) => name.replace(/-[A-Za-z0-9_-]{8}\.js$/, "");

/**
 * Pair each APK chunk with the rebuilt one: by exact name first, then by prefix with a byte compare.
 * Returns one row per APK chunk.
 */
export const matchChunks = (apkFiles, builtFiles) => {
  const builtByName = new Map(builtFiles.map((file) => [file.name, file]));
  return apkFiles.map((apk) => {
    const same = builtByName.get(apk.name);
    if (same) return { apk: apk.name, built: same.name, match: same.bytes.equals(apk.bytes) ? "exact" : "name-only" };
    const candidates = builtFiles.filter((file) => chunkPrefix(file.name) === chunkPrefix(apk.name));
    const identical = candidates.find((file) => file.bytes.equals(apk.bytes));
    if (identical) return { apk: apk.name, built: identical.name, match: "content" };
    if (candidates.length === 1) return { apk: apk.name, built: candidates[0].name, match: "differs" };
    return { apk: apk.name, built: null, match: "missing" };
  });
};

const readJsDir = (dir) =>
  fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({ name, bytes: fs.readFileSync(path.join(dir, name)) }));

const run = (command, args, options) => {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
};

const main = () => {
  const argv = process.argv.slice(2);
  const arg = (name) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const commit = arg("commit");
  const out = arg("out") && path.resolve(arg("out"));
  const apk = arg("apk") && path.resolve(arg("apk"));
  if (!commit || !out) {
    console.error("usage: build_sourcemapped.mjs --commit <sha> --out <dir> [--apk <apk>] [--keep-src]");
    process.exit(2);
  }
  if (path.resolve(out).startsWith(path.join(REPO, "dist"))) throw new Error("--out must not be inside dist/");
  fs.mkdirSync(out, { recursive: true });

  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("VITE_")));
  let apkAssets = null;
  if (apk) {
    apkAssets = path.join(out, "apk-assets");
    fs.rmSync(apkAssets, { recursive: true, force: true });
    fs.mkdirSync(apkAssets, { recursive: true });
    execFileSync("unzip", ["-q", "-o", "-j", apk, "assets/public/assets/*.js", "-d", apkAssets]);
    const index = fs.readdirSync(apkAssets).find((name) => /^index-.*\.js$/.test(name));
    if (!index) throw new Error(`no index-*.js in ${apk}`);
    const embedded = embeddedViteEnv(fs.readFileSync(path.join(apkAssets, index), "utf8"));
    Object.assign(env, embedded);
    console.log(`env from ${index}: ${Object.keys(embedded).join(", ")}`);
  }

  const src = path.join(out, "src");
  if (fs.existsSync(src)) run("git", ["-C", REPO, "worktree", "remove", "--force", src]);
  run("git", ["-C", REPO, "worktree", "add", "--detach", src, commit]);
  try {
    fs.symlinkSync(fs.realpathSync(path.join(REPO, "node_modules")), path.join(src, "node_modules"));
    const resolved = execFileSync("git", ["-C", src, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    console.log(`building ${resolved}`);
    run("npm", ["run", "prebuild"], { cwd: src, env });
    const dist = path.join(out, "dist");
    run(
      process.execPath,
      ["scripts/run-vite.mjs", "build", "--sourcemap", "hidden", "--outDir", dist, "--emptyOutDir"],
      { cwd: src, env },
    );

    const report = { commit: resolved, apk: apk ?? null, chunks: [] };
    if (apkAssets) {
      report.chunks = matchChunks(readJsDir(apkAssets), readJsDir(path.join(dist, "assets")));
      const counts = report.chunks.reduce((acc, row) => ({ ...acc, [row.match]: (acc[row.match] ?? 0) + 1 }), {});
      console.log(`chunk match against the APK: ${JSON.stringify(counts)}`);
      for (const row of report.chunks.filter((r) => r.match !== "exact")) {
        console.log(`  ${row.match.padEnd(9)} ${row.apk} -> ${row.built ?? "(none)"}`);
      }
    }
    fs.writeFileSync(path.join(out, "match.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`source maps in ${path.join(dist, "assets")}`);
  } finally {
    if (!argv.includes("--keep-src")) run("git", ["-C", REPO, "worktree", "remove", "--force", src]);
  }
};

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  try {
    main();
  } catch (error) {
    console.error(`build_sourcemapped: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exit(1);
  }
}
