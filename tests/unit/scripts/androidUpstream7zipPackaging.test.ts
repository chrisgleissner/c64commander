import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const buildGradlePath = path.resolve(process.cwd(), "android/app/build.gradle");
const buildGradle = readFileSync(buildGradlePath, "utf8");

describe("android upstream 7zip packaging", () => {
    it("keeps release packaging on arm device ABIs only", () => {
        expect(buildGradle).toContain('def upstream7zipReleaseAbis = ["armeabi-v7a", "arm64-v8a"]');
        expect(buildGradle).toMatch(
            /release\s*\{\s*jniLibs\.srcDirs \+= \[upstream7zipGeneratedJniLibsDirForVariant\("release"\)\]/s,
        );
        expect(buildGradle).toMatch(/release\s*\{[\s\S]*?ndk\s*\{\s*abiFilters "armeabi-v7a", "arm64-v8a"\s*\}/s);
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
});
