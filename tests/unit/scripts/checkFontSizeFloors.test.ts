import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MIN_ARBITRARY_PX, MIN_SCANNED_FILES, findViolations, walk } from "../../../scripts/check-font-size-floors.mjs";

const scriptPath = path.resolve(process.cwd(), "scripts/check-font-size-floors.mjs");
const temporaryRoots: string[] = [];

/** A src tree the script will read when run with this directory as its cwd. */
const makeSrcRoot = (files: Record<string, string>, filler = 0) => {
  const root = mkdtempSync(path.join(tmpdir(), "font-size-floors-"));
  temporaryRoots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const full = path.join(root, "src", relativePath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  const fillerDir = path.join(root, "src", "filler");
  if (filler > 0) mkdirSync(fillerDir, { recursive: true });
  for (let index = 0; index < filler; index += 1) {
    writeFileSync(path.join(fillerDir, `filler${index}.tsx`), "export const x = 1;\n");
  }
  return root;
};

const runScript = (cwd: string) => {
  try {
    return { status: 0, output: execFileSync("node", [scriptPath], { cwd, encoding: "utf8" }) };
  } catch (error) {
    const failure = error as { status: number; stderr: string; stdout: string };
    return { status: failure.status, output: `${failure.stdout}${failure.stderr}` };
  }
};

afterEach(() => {
  while (temporaryRoots.length > 0) rmSync(temporaryRoots.pop()!, { force: true, recursive: true });
});

describe("check-font-size-floors: what is rejected", () => {
  it("rejects px, rem and em sizes below the floor and accepts the floor itself", () => {
    const violations = findViolations([
      { file: "src/a.tsx", source: 'const a = "text-[9px]";' },
      { file: "src/b.tsx", source: 'const b = "text-[0.65rem]";' },
      { file: "src/c.tsx", source: 'const c = "text-[0.6em]";' },
      { file: "src/d.tsx", source: 'const d = "text-[11px]";' },
      { file: "src/e.tsx", source: 'const e = "text-[1rem]";' },
    ]);

    expect(violations).toEqual([
      { file: "src/a.tsx", line: 1, value: "text-[9px]" },
      { file: "src/b.tsx", line: 1, value: "text-[0.65rem]" },
      { file: "src/c.tsx", line: 1, value: "text-[0.6em]" },
    ]);
  });

  it("reports the line a violation sits on, not the file alone", () => {
    const violations = findViolations([{ file: "src/a.tsx", source: 'a\nb\nconst c = "text-[8px]";\n' }]);

    expect(violations).toEqual([{ file: "src/a.tsx", line: 3, value: "text-[8px]" }]);
  });

  it("agrees with the documented floor", () => {
    expect(MIN_ARBITRARY_PX).toBe(11);
  });
});

describe("check-font-size-floors: what is scanned", () => {
  it("walks into subdirectories and reads only .ts, .tsx and .css", () => {
    const root = makeSrcRoot({
      "a.tsx": "",
      "nested/b.ts": "",
      "nested/deep/c.css": "",
      "d.md": "",
      "e.svg": "",
    });

    const scanned = walk(path.join(root, "src")).map((file) => path.relative(path.join(root, "src"), file));

    expect(scanned.sort()).toEqual(
      ["a.tsx", "nested/b.ts", "nested/deep/c.css"].map((p) => p.split("/").join(path.sep)),
    );
  });

  it("fails rather than passing when the walk finds almost nothing", () => {
    const result = runScript(makeSrcRoot({ "a.tsx": 'const a = "text-lg";' }));

    expect(result.status).toBe(2);
    expect(result.output).toContain("Nothing was measured");
  });

  it("fails on a planted violation in a tree large enough to be scanned", () => {
    const root = makeSrcRoot({ "bad.tsx": 'const bad = "text-[9px]";' }, MIN_SCANNED_FILES);

    const result = runScript(root);

    expect(result.status).toBe(1);
    expect(result.output).toContain("src/bad.tsx:1  text-[9px]");
  });

  it("passes on the same tree once the violation is raised to the floor", () => {
    const root = makeSrcRoot({ "bad.tsx": 'const bad = "text-[11px]";' }, MIN_SCANNED_FILES);

    const result = runScript(root);

    expect(result.status).toBe(0);
    expect(result.output).toContain("no arbitrary sizes below 11px");
  });
});
