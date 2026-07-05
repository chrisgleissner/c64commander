import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const readRepositoryFile = (relativePath: string) => readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("dependabot Android compatibility guardrails", () => {
  it("pins the Gradle wrapper so it is upgraded in lockstep with the Android Gradle Plugin", () => {
    const dependabot = readRepositoryFile(".github/dependabot.yml");
    const androidBuild = readRepositoryFile("android/build.gradle");
    const wrapper = readRepositoryFile("android/gradle/wrapper/gradle-wrapper.properties");

    // Keep the wrapper paired with a known-good AGP release, and keep Dependabot
    // from auto-bumping the wrapper ahead of a coordinated AGP upgrade.
    expect(dependabot).toContain("- dependency-name: gradle");
    expect(dependabot).toContain("lockstep with the Android Gradle Plugin");
    expect(androidBuild).toContain("com.android.tools.build:gradle:9.2.1");
    expect(wrapper).toContain("gradle-9.6.1-bin.zip");
  });
});
