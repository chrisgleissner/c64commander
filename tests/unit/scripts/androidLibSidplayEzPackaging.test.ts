/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(path.resolve(process.cwd(), relative), "utf8");
const buildGradle = read("android/app/build.gradle");
const buildScript = read("android/scripts/build-libsidplayez.sh");

/**
 * How libSidplayEZ gets into the APK: from one pinned upstream commit whose archive is checked by
 * SHA-256, for exactly the ABIs the 7-Zip library ships for, with 16 KB pages.
 */
describe("android libSidplayEZ packaging", () => {
  it("pins one upstream commit and the checksum of its source archive", () => {
    const revision = /def libsidplayezRevision = "([0-9a-f]{40})"/.exec(buildGradle)?.[1];
    expect(revision).toBeDefined();
    expect(buildGradle).toContain(
      'def libsidplayezSourceUrl = "https://github.com/Toddler-Boy/libSidplayEZ/archive/${libsidplayezRevision}.tar.gz"',
    );
    expect(buildGradle).toMatch(/def libsidplayezSourceSha256 = "[0-9a-f]{64}"/);
    expect(buildScript).toContain('if [[ "$actual" != "$sha" ]]; then');
  });

  it("builds the same ABIs the 7-Zip library is built for, in every variant", () => {
    expect(buildGradle).toMatch(
      /upstream7zipVariantAbis\.each \{ variantName, abis ->\s*def capitalizedVariantName[\s\S]*?def taskName = "buildLibSidplayEz\$\{capitalizedVariantName\}AndroidLibraries"/,
    );
    for (const variant of ["debug", "minifiedDebug", "release"]) {
      expect(buildGradle).toContain(`jniLibs.srcDirs += [new File(libsidplayezGeneratedJniLibsBaseDir, "${variant}")]`);
    }
  });

  it("links for 16 KB pages, strips, and bundles its C++ runtime statically", () => {
    expect(buildScript).toContain("-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384");
    expect(buildScript).toContain('llvm-strip" --strip-unneeded');
    expect(buildScript).toContain("-static-libstdc++");
    expect(buildScript).toContain("-Wl,--gc-sections");
  });

  it("compiles the engine without the ultraSID application layer, whose output depends on file paths", () => {
    expect(buildScript).toContain("find . -name '*.cpp' -not -path './EZ/*'");
  });

  it("runs the C++ suites from the build, the engine suite included", () => {
    expect(buildGradle).toContain("[name: 'Engine', binary: 'engine_test', sanitizers: ['none', 'address']]");
    expect(buildGradle).toContain(
      "[name: 'Wrapper', binary: 'ez_session_test', sanitizers: ['none', 'address', 'thread']]",
    );
  });

  it("packages the native libraries' license and credit files in every variant, from the repository", () => {
    // They were copied out of the build's extracted sources, which a build cache can skip; then the
    // APK shipped without them and nothing noticed.
    const licenses = "android/app/src/main/nativeLicenses/public/licenses";
    expect(buildGradle).toContain("assets.srcDirs += ['src/main/nativeLicenses']");
    expect(read(`${licenses}/libsidplayez/COPYING`)).toContain(
      "GNU GENERAL PUBLIC LICENSE\n                       Version 2",
    );
    expect(read(`${licenses}/libsidplayez/AUTHORS`)).toContain("Michael Hartmann");
    expect(read(`${licenses}/libsidplayez/residfp-AUTHORS`)).toContain("Dag Lem");
    expect(read(`${licenses}/7-zip/License.txt`)).toContain("GNU LGPL");
    expect(read(`${licenses}/7-zip/copying.txt`)).toContain("GNU LESSER GENERAL PUBLIC LICENSE");
  });

  it("fails the build when an upstream license file no longer matches the packaged copy", () => {
    expect(buildScript).toContain('if ! cmp -s "$SRC_DIR/${pair%%:*}" "$copies/${pair##*:}"; then');
    expect(read("android/scripts/build-upstream-7zip.sh")).toContain(
      'if ! cmp -s "$EXTRACT_DIR/DOC/$license" "$LICENSE_COPIES/$license"; then',
    );
  });
});
