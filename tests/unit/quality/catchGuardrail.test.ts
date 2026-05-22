import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SCAN_ROOTS = ["src", "android/app/src/main/java", "tests", "android/app/src/test"] as const;

const EMPTY_CATCH_ALLOWLIST = new Set([
  "android/app/src/test/java/uk/gleissner/c64commander/BackgroundExecutionServiceTest.kt:47",
  "android/app/src/test/java/uk/gleissner/c64commander/HvscArchiveExtractorTest.kt:159",
]);

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

const findCatchBlocks = (file: string): CatchBlock[] => {
  const source = readFileSync(path.resolve(process.cwd(), file), "utf8");
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

const allCatchBlocks = () => SCAN_ROOTS.flatMap(walkFiles).flatMap(findCatchBlocks);

describe("catch block guardrails", () => {
  it("does not introduce empty catch blocks outside documented cancellation tests", () => {
    const emptyCatches = allCatchBlocks()
      .filter((block) => stripComments(block.text.replace(/\bcatch\b[^{]*\{/, "").replace(/\}\s*$/, "")) === "")
      .filter((block) => block.file.startsWith("src/") || block.file.startsWith("android/app/src/main/java/"))
      .filter((block) => !EMPTY_CATCH_ALLOWLIST.has(`${block.file}:${block.line}`));

    expect(emptyCatches).toEqual([]);
  });

  it("requires silent fallback returns to include diagnostic context", () => {
    const silentFallbacks = allCatchBlocks().filter((block) => {
      if (!block.file.startsWith("src/") && !block.file.startsWith("android/app/src/main/java/")) return false;
      return SILENT_FALLBACK_RETURN.test(block.text) && !DIAGNOSTIC_OR_CONTEXT.test(block.text);
    });

    expect(silentFallbacks).toEqual([]);
  });
});
