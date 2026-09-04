import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AUDITED_FILES,
  findViolations,
  readAuditedFiles,
} from "../../../scripts/check-display-profile-breakpoints.mjs";

const scriptPath = path.resolve(process.cwd(), "scripts/check-display-profile-breakpoints.mjs");
const temporaryRoots: string[] = [];

/** A tree holding every audited path, so the script reads it when run with this cwd. */
const makeAuditedRoot = (overrides: Record<string, string> = {}) => {
  const root = mkdtempSync(path.join(tmpdir(), "display-profiles-"));
  temporaryRoots.push(root);
  for (const relativePath of AUDITED_FILES) {
    const full = path.join(root, relativePath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, overrides[relativePath] ?? 'const a = "flex items-center";\n');
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

describe("check-display-profile-breakpoints: what is rejected", () => {
  it("reports every Tailwind breakpoint prefix and nothing that merely looks like one", () => {
    const violations = findViolations([
      { path: "src/a.tsx", source: 'const a = "sm:hidden md:flex lg:grid xl:block 2xl:inline";' },
      { path: "src/b.tsx", source: 'const b = "text-sm bg-red-500 hover:underline";' },
    ]);

    expect(violations).toEqual([{ path: "src/a.tsx", matches: ["sm:", "md:", "lg:", "xl:", "2xl:"] }]);
  });

  it("reports a prefix on any line of a file, not the first one only", () => {
    const violations = findViolations([{ path: "src/a.tsx", source: 'a\nb\nconst c = "lg:hidden";\n' }]);

    expect(violations).toEqual([{ path: "src/a.tsx", matches: ["lg:"] }]);
  });
});

describe("check-display-profile-breakpoints: what is audited", () => {
  it("audits a non-empty list, every entry of which exists in this repository", () => {
    expect(AUDITED_FILES.length).toBeGreaterThan(5);
    for (const relativePath of AUDITED_FILES) {
      expect(existsSync(path.resolve(process.cwd(), relativePath)), `${relativePath} is audited but missing`).toBe(
        true,
      );
    }
  });

  it("fails rather than skipping when an audited surface has been renamed away", () => {
    const root = makeAuditedRoot();
    rmSync(path.join(root, AUDITED_FILES[0]));

    const result = runScript(root);

    expect(result.status).toBe(2);
    expect(result.output).toContain(AUDITED_FILES[0]);
    expect(() => readAuditedFiles(root)).toThrow(/no longer exist/);
  });

  it("fails on a planted breakpoint prefix in an audited surface", () => {
    const result = runScript(makeAuditedRoot({ [AUDITED_FILES[1]]: 'const a = "sm:hidden";\n' }));

    expect(result.status).toBe(1);
    expect(result.output).toContain(`${AUDITED_FILES[1]}: sm:`);
  });

  it("passes on the same tree once the prefix is removed", () => {
    const result = runScript(makeAuditedRoot());

    expect(result.status).toBe(0);
    expect(result.output).toContain(`${AUDITED_FILES.length} audited surfaces`);
  });
});
