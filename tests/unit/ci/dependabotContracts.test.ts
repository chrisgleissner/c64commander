import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const readRepositoryFile = (relativePath: string) => readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("dependabot Android compatibility guardrails", () => {
  it("ignores kotlinx-coroutines-test updates while Android still builds with Kotlin 1.9.x", () => {
    const dependabot = readRepositoryFile(".github/dependabot.yml");
    const androidBuild = readRepositoryFile("android/build.gradle");

    expect(androidBuild).toContain("ext.kotlin_version = '1.9.25'");
    expect(dependabot).toContain("- dependency-name: org.jetbrains.kotlinx:kotlinx-coroutines-test");
    expect(dependabot).toContain("Android build is still compiled with Kotlin 1.9.x");
  });
});
