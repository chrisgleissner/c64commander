import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testFilePath = fileURLToPath(import.meta.url);
const playFilesPagePath = resolve(dirname(testFilePath), "../../../../src/pages/PlayFilesPage.tsx");
const playFilesPageSource = readFileSync(playFilesPagePath, "utf8");

describe("PlayFilesPage import navigation guards", () => {
  it("delegates import blocking to the extracted hook instead of inlining navigation guards", () => {
    expect(playFilesPageSource).toContain("useImportNavigationGuards(isImportNavigationBlocked);");
    expect(playFilesPageSource).not.toContain("registerNavigationGuard(");
    expect(playFilesPageSource).not.toContain('window.addEventListener("beforeunload"');
  });
});
