/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * `cap sync` copies one web bundle into both native projects, so each app carries things only the
 * browser build can use: the 7-Zip WebAssembly extractor (both apps extract HVSC natively, and the
 * WASM build needs ~1.1 GB to unpack the full archive, so it cannot serve as a fallback on a phone
 * either) and every variant's branding. The prune removes exactly those, and nothing else.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneNativeAssets } from "../../../scripts/prune-native-assets.mjs";

const dirs: string[] = [];

const makeTree = (files: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prune-native-"));
  dirs.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
};

const run = (root: string, activeVariantId: string) =>
  pruneNativeAssets({
    repoRoot: root,
    roots: [path.join(root, "web")],
    activeVariantId,
    variantIds: ["c64commander", "c64u-remote"],
  });

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("prune-native-assets", () => {
  it("removes the 7-Zip WebAssembly build, whatever its content hash", () => {
    const root = makeTree({
      "web/assets/7zz-CgkXYLdN.wasm": "x",
      "web/assets/7zz-OTHERHASH.wasm": "x",
      "web/index.html": "<html></html>",
    });
    const result = run(root, "c64commander");
    expect(fs.existsSync(path.join(root, "web/assets/7zz-CgkXYLdN.wasm"))).toBe(false);
    expect(fs.existsSync(path.join(root, "web/assets/7zz-OTHERHASH.wasm"))).toBe(false);
    expect(result.removed).toHaveLength(2);
  });

  it("keeps the engine WebAssembly that on-device playback actually uses", () => {
    const root = makeTree({
      "web/wasm/libsidplayfp/dist/libsidplayfp.wasm": "x",
      "web/assets/7zz-abc.wasm": "x",
    });
    run(root, "c64commander");
    // Only the 7-Zip build is dead on native; the SID engine is the whole point of local playback.
    expect(fs.existsSync(path.join(root, "web/wasm/libsidplayfp/dist/libsidplayfp.wasm"))).toBe(true);
  });

  it("removes the other variant's branding and keeps its own", () => {
    const files = {
      "web/c64commander.png": "x",
      "web/c64commander-192.png": "x",
      "web/c64commander-maskable-512.png": "x",
      "web/c64u-remote.png": "x",
      "web/favicon.png": "x",
    };

    const asCommander = makeTree(files);
    run(asCommander, "c64commander");
    expect(fs.existsSync(path.join(asCommander, "web/c64commander.png"))).toBe(true);
    expect(fs.existsSync(path.join(asCommander, "web/c64commander-192.png"))).toBe(true);
    expect(fs.existsSync(path.join(asCommander, "web/c64u-remote.png"))).toBe(false);
    // Shared chrome belongs to neither variant and stays.
    expect(fs.existsSync(path.join(asCommander, "web/favicon.png"))).toBe(true);

    const asRemote = makeTree(files);
    run(asRemote, "c64u-remote");
    expect(fs.existsSync(path.join(asRemote, "web/c64u-remote.png"))).toBe(true);
    expect(fs.existsSync(path.join(asRemote, "web/c64commander.png"))).toBe(false);
    expect(fs.existsSync(path.join(asRemote, "web/c64commander-192.png"))).toBe(false);
    expect(fs.existsSync(path.join(asRemote, "web/c64commander-maskable-512.png"))).toBe(false);
  });

  it("leaves everything else alone", () => {
    const root = makeTree({
      "web/assets/index-abc.js": "x",
      "web/data/sidcorr/hvsc-tiny.sidcorr": "x",
      "web/manifest.webmanifest": "{}",
    });
    const result = run(root, "c64commander");
    expect(result.removed).toEqual([]);
    expect(fs.existsSync(path.join(root, "web/data/sidcorr/hvsc-tiny.sidcorr"))).toBe(true);
  });

  it("is safe to run when a platform has not been set up", () => {
    const root = makeTree({ "web/index.html": "<html></html>" });
    const result = pruneNativeAssets({
      repoRoot: root,
      roots: [path.join(root, "web"), path.join(root, "never-synced")],
      activeVariantId: "c64commander",
      variantIds: ["c64commander", "c64u-remote"],
    });
    expect(result.removed).toEqual([]);
  });
});
