import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const readRepositoryFile = (relativePath: string) => readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

const SEMVER = "\\d+\\.\\d+\\.\\d+";

// Authoritative AGP <-> Gradle wrapper pairings. Dependabot auto-bumps the
// Android Gradle Plugin but is configured to leave the Gradle wrapper alone
// (see .github/dependabot.yml), because AGP major versions change internal
// Gradle-facing APIs. When AGP moves, add the validated wrapper version here
// so the pairing is a deliberate, reviewed decision rather than silent drift.
// The build's compatibility with each pair is additionally validated by CI.
const KNOWN_GOOD_AGP_WRAPPER_PAIRS: Record<string, string> = {
  "9.2.1": "9.6.1",
  "9.3.0": "9.6.1",
};

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
    // a single literal, so an AGP bump never stalifies this test with a confusing
    // mismatch. The extracted pair is asserted against KNOWN_GOOD_AGP_WRAPPER_PAIRS
    // below, preserving the coordination guard this test exists to enforce.
    const agpVersion = androidBuild.match(new RegExp(`com\\.android\\.tools\\.build:gradle:(${SEMVER})`));
    const wrapperVersion = wrapper.match(new RegExp(`gradle-(${SEMVER})-bin\\.zip`));

    expect(agpVersion, "android/build.gradle must declare the AGP classpath with a semver version").not.toBeNull();
    expect(wrapperVersion, "gradle-wrapper.properties must pin a concrete gradle distribution").not.toBeNull();

    const agp = agpVersion?.[1];
    const gradle = wrapperVersion?.[1];
    expect(
      KNOWN_GOOD_AGP_WRAPPER_PAIRS[agp ?? ""],
      `AGP ${agp} has no documented Gradle wrapper pair; add one to KNOWN_GOOD_AGP_WRAPPER_PAIRS`,
    ).toBe(gradle);
  });
});
