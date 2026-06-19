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

  it("pins the Gradle wrapper so it is upgraded in lockstep with the Android Gradle Plugin", () => {
    const dependabot = readRepositoryFile(".github/dependabot.yml");
    const androidBuild = readRepositoryFile("android/build.gradle");
    const wrapper = readRepositoryFile("android/gradle/wrapper/gradle-wrapper.properties");

    // Gradle 9.6 broke AGP 8.13.2 (InternalProblems/AndroidProblemReporterProvider).
    // Keep the wrapper on a known-good 9.5.x release paired with AGP 8.13.x, and keep
    // Dependabot from auto-bumping the wrapper ahead of a coordinated AGP upgrade.
    expect(dependabot).toContain("- dependency-name: gradle");
    expect(dependabot).toContain("lockstep with the Android Gradle Plugin");
    expect(androidBuild).toContain("com.android.tools.build:gradle:8.13.2");
    expect(wrapper).toContain("gradle-9.5.1-bin.zip");
  });
});
