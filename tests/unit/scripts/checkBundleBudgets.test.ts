import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BUDGET_BYTES, findOverBudget, measureChunks } from "../../../scripts/check-bundle-budgets.mjs";

const scriptPath = path.resolve(process.cwd(), "scripts/check-bundle-budgets.mjs");
const temporaryRoots: string[] = [];

/** A dist tree the script will read when run with this directory as its cwd. */
const makeDistRoot = (chunks: Record<string, Buffer | string>) => {
  const root = mkdtempSync(path.join(tmpdir(), "bundle-budgets-"));
  temporaryRoots.push(root);
  const assets = path.join(root, "dist", "assets");
  mkdirSync(assets, { recursive: true });
  for (const [name, content] of Object.entries(chunks)) writeFileSync(path.join(assets, name), content);
  return { assets, root };
};

const runScript = (cwd: string, args: string[] = []) => {
  try {
    const stdout = execFileSync("node", [scriptPath, ...args], { cwd, encoding: "utf8" });
    return { status: 0, output: stdout };
  } catch (error) {
    const failure = error as { status: number; stderr: string; stdout: string };
    return { status: failure.status, output: `${failure.stdout}${failure.stderr}` };
  }
};

afterEach(() => {
  while (temporaryRoots.length > 0) rmSync(temporaryRoots.pop()!, { force: true, recursive: true });
});

describe("check-bundle-budgets: what is measured", () => {
  it("measures only .js chunks, and reports them largest compressed first", () => {
    // Random bytes barely compress, so each chunk's gzipped size tracks its raw size.
    const { assets } = makeDistRoot({
      "large.js": randomBytes(40 * 1024),
      "small.js": randomBytes(4 * 1024),
      "styles.css": randomBytes(80 * 1024),
      "index.html": "<!doctype html>",
    });

    const measured = measureChunks(assets);

    expect(measured.map((chunk) => chunk.name)).toEqual(["large.js", "small.js"]);
    expect(measured[0].gzBytes).toBeGreaterThan(measured[1].gzBytes);
    expect(measured[0].rawBytes).toBe(40 * 1024);
  });

  it("returns nothing for an assets directory that holds no chunk", () => {
    const { assets } = makeDistRoot({ "styles.css": "body{}" });

    expect(measureChunks(assets)).toEqual([]);
  });
});

describe("check-bundle-budgets: what fails", () => {
  it("uses the 250 KB gzipped cap and flags only what exceeds it", () => {
    expect(BUDGET_BYTES).toBe(250 * 1024);

    const files = [
      { gzBytes: BUDGET_BYTES + 1, name: "over.js", rawBytes: 0 },
      { gzBytes: BUDGET_BYTES, name: "exactly-at-the-cap.js", rawBytes: 0 },
      { gzBytes: BUDGET_BYTES - 1, name: "under.js", rawBytes: 0 },
    ];

    expect(findOverBudget(files).map((file) => file.name)).toEqual(["over.js"]);
  });

  it("exits 1 and names the chunk when one is over budget", () => {
    const { root } = makeDistRoot({ "huge.js": randomBytes(300 * 1024) });

    const { status, output } = runScript(root);

    expect(status).toBe(1);
    expect(output).toContain("huge.js");
    expect(output).toContain("exceed the 250.00 KB gzipped cap");
  });

  it("exits 0 when every chunk is within budget", () => {
    const { root } = makeDistRoot({ "tiny.js": randomBytes(1024) });

    expect(runScript(root).status).toBe(0);
  });

  // The gate ran in CI for months against a tree with no dist and reported success,
  // so the two ways it can measure nothing are both asserted here.
  it("exits 2 when the assets directory exists but holds no chunk, even with --skip-if-missing", () => {
    const { root } = makeDistRoot({ "styles.css": "body{}" });

    const { status, output } = runScript(root, ["--skip-if-missing"]);

    expect(status).toBe(2);
    expect(output).toContain("contains no .js chunk");
  });

  it("exits 2 for an unbuilt tree unless the caller opts into skipping", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bundle-budgets-"));
    temporaryRoots.push(root);

    expect(runScript(root).status).toBe(2);

    const skipped = runScript(root, ["--skip-if-missing"]);
    expect(skipped.status).toBe(0);
    expect(skipped.output).toContain("skipping");
  });
});
