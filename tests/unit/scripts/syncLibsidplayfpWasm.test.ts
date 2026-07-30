import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * The engine is an npm dependency copied verbatim into `public/` so Vite serves
 * it as a static asset and Capacitor bundles it into the native app.
 *
 * "Verbatim" is the property worth testing. The previous arrangement kept
 * hand-adapted copies of `index.js` and `player.js` in the repo; they drifted
 * from the engine they were adapting until the app was calling an API that no
 * longer matched. These tests assert that what is served is byte-for-byte what
 * npm delivered, so that class of drift cannot recur silently.
 */
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SERVED = path.join(ROOT, "public/wasm/libsidplayfp/dist");
const PACKAGE_ROOT = path.dirname(require.resolve("libsidplayfp-wasm/package.json"));
const PACKAGED = path.join(PACKAGE_ROOT, "dist");

/** Only useful to someone rebuilding the engine, which a browser never does. */
const EXCLUDED = new Set(["complete-source.tar.gz", "complete-source.tar.gz.stamp"]);

async function fileTree(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
    .sort();
}

const digest = async (file: string) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");

/** Git-ignored and populated by `prebuild`, so a fresh clone has not synced yet. */
const synced = existsSync(path.join(SERVED, "libsidplayfp.wasm"));

describe.skipIf(!synced)("synced libsidplayfp-wasm engine", () => {
  it("serves exactly the files the package ships, minus the source archive", async () => {
    const expected = (await fileTree(PACKAGED)).filter((file) => !EXCLUDED.has(file));

    expect(await fileTree(SERVED)).toEqual(expected);
  });

  it("serves them byte-for-byte, with no local adaptation", async () => {
    const files = await fileTree(SERVED);
    const differing: string[] = [];

    for (const file of files) {
      if ((await digest(path.join(SERVED, file))) !== (await digest(path.join(PACKAGED, file)))) {
        differing.push(file);
      }
    }

    expect(differing).toEqual([]);
  });

  /**
   * Since 0.1.1 the package resolves its own artifacts relative to itself, so a
   * verbatim copy works wherever it is served from. This asserts the property
   * that matters — every relative import the entry point makes resolves inside
   * the served tree — rather than the exact spelling of the path, which is the
   * package's business and has already changed once.
   */
  it("resolves every relative import inside the served tree", async () => {
    const index = await fs.readFile(path.join(SERVED, "index.js"), "utf8");
    const specifiers = [...index.matchAll(/from\s+"(\.[^"]+)"|import\("(\.[^"]+)"\)/g)].map(
      (match) => match[1] ?? match[2],
    );
    const unresolved = specifiers.filter((s) => !existsSync(path.resolve(SERVED, s)));

    expect(specifiers.length).toBeGreaterThan(0);
    expect(unresolved).toEqual([]);
  });

  /**
   * The previous layout put the engine directly under `public/wasm/libsidplayfp/`.
   * Anything left there would still be copied into the bundle and the native app,
   * so the sync must own the whole directory, not just `dist/`.
   */
  it("leaves nothing behind from an earlier layout", async () => {
    const engineDir = path.dirname(SERVED);
    const strays = (await fs.readdir(engineDir)).filter((entry) => entry !== "dist");

    expect(strays).toEqual([]);
  });

  it("ships the licence and third-party notices the GPL requires", () => {
    expect(existsSync(path.join(SERVED, "LICENSE"))).toBe(true);
    expect(existsSync(path.join(SERVED, "THIRD-PARTY-NOTICES.md"))).toBe(true);
  });

  it("is the version this repo depends on", async () => {
    const [manifest, installed] = await Promise.all([
      fs.readFile(path.join(ROOT, "package.json"), "utf8"),
      fs.readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
    ]);
    const range = JSON.parse(manifest).dependencies["libsidplayfp-wasm"];

    expect(range).toMatch(/^\^\d+\.\d+\.\d+$/);
    expect(JSON.parse(installed).version).toBe(range.slice(1));
  });

  /** The URL `localSid.worker.ts` loads must actually be servable. */
  it("serves the entry point the playback worker loads", async () => {
    const worker = await fs.readFile(path.join(ROOT, "src/lib/playback/localSid.worker.ts"), "utf8");
    const url = /LIBSIDPLAYFP_URL\s*=\s*"([^"]+)"/.exec(worker)?.[1];

    expect(url).toBe("/wasm/libsidplayfp/dist/index.js");
    expect(existsSync(path.join(ROOT, "public", url!))).toBe(true);
  });
});
