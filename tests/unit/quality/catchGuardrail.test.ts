import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SCAN_ROOTS = ["src", "android/app/src/main/java", "tests", "android/app/src/test"] as const;

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".kt", ".java"]);
const SILENT_FALLBACK_RETURN = /\breturn\s+(?:null|undefined|\[\]|\{\}|""|'')\s*;?/;
const DIAGNOSTIC_OR_CONTEXT =
  /\b(?:addLog|addErrorLog|buildErrorLogDetails|reportUserError|logger\.(?:warn|error)|console\.(?:warn|error)|log[A-Z][A-Za-z0-9_]*|warn[A-Z][A-Za-z0-9_]*|report[A-Z][A-Za-z0-9_]*|throw\s+new|throw\s+[A-Za-z_])/;

type CatchBlock = {
  file: string;
  line: number;
  text: string;
};

const walkFiles = (root: string): string[] => {
  const absoluteRoot = path.resolve(process.cwd(), root);
  if (!existsSync(absoluteRoot)) return [];
  const entries = readdirSync(absoluteRoot);
  return entries.flatMap((entry) => {
    const absolutePath = path.join(absoluteRoot, entry);
    const relativePath = path.relative(process.cwd(), absolutePath);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) return walkFiles(relativePath);
    return TEXT_EXTENSIONS.has(path.extname(entry)) ? [relativePath] : [];
  });
};

const lineNumberAt = (source: string, index: number) => source.slice(0, index).split("\n").length;

const stripComments = (value: string) =>
  value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .trim();

const extractCatchBlocks = (file: string, source: string): CatchBlock[] => {
  const blocks: CatchBlock[] = [];
  const catchPattern = /(?<!\.)\bcatch\b[^{]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = catchPattern.exec(source))) {
    let depth = 1;
    let cursor = catchPattern.lastIndex;
    while (cursor < source.length && depth > 0) {
      const char = source[cursor];
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      cursor += 1;
    }
    blocks.push({
      file,
      line: lineNumberAt(source, match.index),
      text: source.slice(match.index, cursor),
    });
    catchPattern.lastIndex = cursor;
  }
  return blocks;
};

const findCatchBlocks = (file: string): CatchBlock[] =>
  extractCatchBlocks(file, readFileSync(path.resolve(process.cwd(), file), "utf8"));

const allCatchBlocks = () => SCAN_ROOTS.flatMap(walkFiles).flatMap(findCatchBlocks);

const isProductionFile = (file: string) => file.startsWith("src/") || file.startsWith("android/app/src/main/java/");

const emptyCatchBlocks = (blocks: CatchBlock[]) =>
  blocks.filter((block) => stripComments(block.text.replace(/\bcatch\b[^{]*\{/, "").replace(/\}\s*$/, "")) === "");

const silentFallbackBlocks = (blocks: CatchBlock[]) =>
  blocks.filter((block) => SILENT_FALLBACK_RETURN.test(block.text) && !DIAGNOSTIC_OR_CONTEXT.test(block.text));

describe("catch block guardrails", () => {
  // Both guards below assert that a filtered list is empty, so a scan root that has
  // moved away or an extractor that stopped matching would make them pass having
  // read nothing. These two check that the scan and the extractor still work.
  it("scans every root it claims to cover", () => {
    for (const root of SCAN_ROOTS) {
      const absoluteRoot = path.resolve(process.cwd(), root);
      expect(existsSync(absoluteRoot), `${root} is not a directory, so this guard scans nothing`).toBe(true);
      expect(walkFiles(root).length, `${root} yielded no source file`).toBeGreaterThan(10);
    }
    // 971 blocks across the four roots when this bound was written.
    expect(allCatchBlocks().length, "the catch block extractor found almost nothing").toBeGreaterThan(400);
  });

  it("flags a planted empty catch and a planted silent fallback", () => {
    const planted = extractCatchBlocks(
      "src/planted.ts",
      [
        "try { a(); } catch (error) {}",
        "try { b(); } catch (error) { return null; }",
        "try { c(); } catch (error) { console.warn(error); return null; }",
      ].join("\n"),
    );

    expect(planted).toHaveLength(3);
    expect(emptyCatchBlocks(planted).map((block) => block.line)).toEqual([1]);
    expect(silentFallbackBlocks(planted).map((block) => block.line)).toEqual([2]);
  });

  it("does not introduce empty production catch blocks", () => {
    const emptyCatches = emptyCatchBlocks(allCatchBlocks()).filter((block) => isProductionFile(block.file));

    expect(emptyCatches).toEqual([]);
  });

  it("requires silent fallback returns to include diagnostic context", () => {
    const silentFallbacks = silentFallbackBlocks(allCatchBlocks()).filter((block) => isProductionFile(block.file));

    expect(silentFallbacks).toEqual([]);
  });
});
