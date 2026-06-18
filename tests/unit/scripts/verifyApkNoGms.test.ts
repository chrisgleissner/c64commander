import { describe, expect, it } from "vitest";
import { ApkGmsError, analyzeGmsUsage, verifyApkNoGms } from "../../../scripts/verify-apk-no-gms.mjs";

describe("analyzeGmsUsage", () => {
  it("passes an APK with no Google libraries/features (our app)", () => {
    const badging = [
      "package: name='uk.gleissner.c64uremote' versionCode='1' versionName='1.0'",
      "application-label:'C64U Remote'",
      "uses-permission: name='android.permission.INTERNET'",
      "uses-feature:'android.hardware.faketouch'",
    ].join("\n");
    const result = analyzeGmsUsage(badging);
    expect(result.ok).toBe(true);
    expect(result.requiredLibraries).toEqual([]);
    expect(result.requiredFeatures).toEqual([]);
  });

  it("flags a REQUIRED Google Play Services uses-library as a hard dependency", () => {
    const badging = [
      "package: name='com.example.app' versionCode='1' versionName='1.0'",
      "uses-library:'com.google.android.gms.maps'",
    ].join("\n");
    const result = analyzeGmsUsage(badging);
    expect(result.ok).toBe(false);
    expect(result.requiredLibraries).toContain("com.google.android.gms.maps");
  });

  it("does NOT flag an OPTIONAL (not-required) Google library", () => {
    const badging = [
      "package: name='com.example.app' versionCode='1' versionName='1.0'",
      "uses-library-not-required:'com.google.android.gms'",
    ].join("\n");
    expect(analyzeGmsUsage(badging).ok).toBe(true);
  });

  it("flags a required Google uses-feature", () => {
    const badging = ["package: name='x' versionName='1'", "uses-feature:'com.google.android.gms.feature'"].join("\n");
    expect(analyzeGmsUsage(badging).ok).toBe(false);
  });
});

describe("verifyApkNoGms", () => {
  it("throws a clear error when the APK does not exist", () => {
    expect(() => verifyApkNoGms("/nope/missing.apk")).toThrow(ApkGmsError);
    expect(() => verifyApkNoGms("/nope/missing.apk")).toThrow(/not found/);
  });
});
