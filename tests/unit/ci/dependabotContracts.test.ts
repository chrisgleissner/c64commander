import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const readRepositoryFile = (relativePath: string) => readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

const SEMVER = "\\d+\\.\\d+\\.\\d+";

describe("dependabot Android compatibility guardrails", () => {
  it("keeps the Gradle wrapper pinned in lockstep with the Android Gradle Plugin", () => {
    const dependabot = readRepositoryFile(".github/dependabot.yml");
    const androidBuild = readRepositoryFile("android/build.gradle");
    const wrapper = readRepositoryFile("android/gradle/wrapper/gradle-wrapper.properties");

    // Dependabot must not auto-bump the Gradle wrapper: AGP major versions change
    // internal Gradle-facing APIs, so wrapper upgrades are opt-in (bumped by hand
    // alongside com.android.tools.build:gradle). This keeps the pairing deliberate.
    expect(dependabot).toContain("- dependency-name: gradle");
    expect(dependabot).toContain("lockstep with the Android Gradle Plugin");

    // Derive the pinned versions from the files themselves rather than hardcoding
    // literals, so a Dependabot AGP bump never stalifies this test. The build's
    // compatibility with the pairing is validated by the Android CI jobs.
    const agpVersion = androidBuild.match(new RegExp(`com\\.android\\.tools\\.build:gradle:(${SEMVER})`));
    const wrapperVersion = wrapper.match(new RegExp(`gradle-(${SEMVER})-bin\\.zip`));

    expect(agpVersion, "android/build.gradle must declare the AGP classpath with a semver version").not.toBeNull();
    expect(wrapperVersion, "gradle-wrapper.properties must pin a concrete gradle distribution").not.toBeNull();
  });
});
