import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const readRepositoryFile = (relativePath: string) => readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

const SEMVER = "\\d+\\.\\d+\\.\\d+";

describe("dependabot Android compatibility guardrails", () => {
  it("keeps the Gradle wrapper coordinated with the Android Gradle Plugin major version", () => {
    const dependabot = readRepositoryFile(".github/dependabot.yml");
    const androidBuild = readRepositoryFile("android/build.gradle");
    const wrapper = readRepositoryFile("android/gradle/wrapper/gradle-wrapper.properties");

    // The real guard: Dependabot must not auto-bump the Gradle wrapper. AGP
    // *major* versions change internal Gradle-facing APIs, so a wrapper upgrade
    // is opt-in — bumped by hand alongside com.android.tools.build:gradle so the
    // pairing stays deliberate. (See .github/dependabot.yml.)
    expect(dependabot).toContain("- dependency-name: gradle");
    expect(dependabot).toContain("lockstep with the Android Gradle Plugin");

    const agpVersion = androidBuild.match(new RegExp(`com\\.android\\.tools\\.build:gradle:(${SEMVER})`));
    const wrapperVersion = wrapper.match(new RegExp(`gradle-(${SEMVER})-bin\\.zip`));

    expect(agpVersion, "android/build.gradle must declare the AGP classpath with a semver version").not.toBeNull();
    expect(wrapperVersion, "gradle-wrapper.properties must pin a concrete gradle distribution").not.toBeNull();

    // The durable invariant — AGP and the wrapper must share a MAJOR version.
    // Routine Dependabot AGP patch/minor bumps (e.g. 9.2.1 → 9.3.1) stay within a
    // major and need no wrapper change, so they no longer stalify this test; only
    // a *major* AGP move (which does need a coordinated wrapper bump) trips it. CI
    // validates the actual build for the finer AGP↔Gradle compatibility.
    const agpMajor = agpVersion![1].split(".")[0];
    const wrapperMajor = wrapperVersion![1].split(".")[0];
    expect(
      wrapperMajor,
      `AGP ${agpVersion![1]} and the Gradle wrapper ${wrapperVersion![1]} must share a major version; ` +
        `a major AGP bump needs a deliberately-coordinated Gradle wrapper bump (Dependabot leaves the wrapper alone).`,
    ).toBe(agpMajor);
  });
});
