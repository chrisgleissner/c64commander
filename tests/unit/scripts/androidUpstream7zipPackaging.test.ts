import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const buildGradlePath = path.resolve(process.cwd(), "android/app/build.gradle");
const buildGradle = readFileSync(buildGradlePath, "utf8");

describe("android upstream 7zip packaging", () => {
  it("keeps release packaging on arm device ABIs only", () => {
    // The default is still arm-only — a release must never carry the x86 slices that debug builds
    // use for emulators. A variant may narrow this further (see below) but never widen it.
    expect(buildGradle).toContain('def upstream7zipDefaultReleaseAbis = ["armeabi-v7a", "arm64-v8a"]');
    expect(buildGradle).toMatch(
      /release\s*\{\s*jniLibs\.srcDirs \+= \[upstream7zipGeneratedJniLibsDirForVariant\("release"\)\]/s,
    );
    // Packaged ABIs come from the resolved release list rather than a second hardcoded copy, so the
    // filter and the libraries that get built can never disagree.
    expect(buildGradle).toMatch(
      /release\s*\{[\s\S]*?ndk\s*\{\s*abiFilters\(\*upstream7zipReleaseAbis\.toArray\(new String\[0\]\)\)\s*\}/s,
    );
  });

  it("lets a variant narrow the release ABIs, and falls back when it says nothing", () => {
    // An edition that targets a single 64-bit handset should not ship a 32-bit slice of the 7-Zip
    // library (~2.3 MB) that none of its devices can load.
    expect(buildGradle).toMatch(
      /def upstream7zipReleaseAbis = \(declaredReleaseAbis instanceof List && !declaredReleaseAbis\.isEmpty\(\)\)\s*\?\s*declaredReleaseAbis\.collect \{ it\.toString\(\) \}\s*:\s*upstream7zipDefaultReleaseAbis/s,
    );
    expect(buildGradle).toContain("def declaredReleaseAbis = variantMetadata.platform.android.releaseAbis");
  });

  it("retains all development ABIs for debug variants", () => {
    expect(buildGradle).toContain('def upstream7zipAllAbis = ["armeabi-v7a", "arm64-v8a", "x86", "x86_64"]');
    expect(buildGradle).toMatch(
      /def upstream7zipVariantAbis = \[\s*debug: upstream7zipAllAbis,\s*minifiedDebug: upstream7zipAllAbis,\s*release: upstream7zipReleaseAbis,\s*\]/s,
    );
    expect(buildGradle).toMatch(
      /debug\s*\{[\s\S]*?ndk\s*\{\s*abiFilters "armeabi-v7a", "arm64-v8a", "x86", "x86_64"\s*\}/s,
    );
  });

  it("invalidates upstream 7zip exec tasks when source or ndk inputs change", () => {
    expect(buildGradle).toContain("inputs.property('sourceUrl', upstream7zipSourceUrl)");
    expect(buildGradle).toContain("inputs.property('sourceSha256', upstream7zipSourceSha256)");
    expect(buildGradle).toContain("inputs.property('apiLevel', upstream7zipApiLevel.toString())");
    expect(buildGradle).toContain("inputs.property('ndkVersion', upstream7zipNdkVersion)");
    expect(buildGradle).toContain("inputs.property('ndkDirPath', resolveAndroidNdkDir().absolutePath)");
  });
});
