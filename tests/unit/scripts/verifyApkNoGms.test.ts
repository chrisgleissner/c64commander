import { describe, expect, it } from "vitest";
import {
  ApkGmsError,
  analyzeGmsUsage,
  verifyApkNoGms,
  analyzeStartupInitializers,
} from "../../../scripts/verify-apk-no-gms.mjs";

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

describe("startup initializers that reach Google services", () => {
  // A required uses-library is not the only way to depend on Play Services, and this
  // is the case that got through: androidx.emoji2 registers EmojiCompatInitializer via
  // androidx.startup, which resolves its font through the GMS provider. The APK declares
  // no uses-library, so the badging check sees nothing, and a launch test on a
  // Google-less image passes because the initializer finds no provider there. Only a
  // device that HAS Play Services shows the coupling - by killing the app when that
  // provider's process dies.
  const metaData = (name: string) => `A: android:name(0x01010003)="${name}"`;

  it("flags the emoji2 initializer, naming what it reaches and how to remove it", () => {
    const result = analyzeStartupInitializers(metaData("androidx.emoji2.text.EmojiCompatInitializer"));
    expect(result.ok).toBe(false);
    expect(result.initializers).toHaveLength(1);
    expect(result.initializers[0].name).toBe("androidx.emoji2.text.EmojiCompatInitializer");
    expect(result.initializers[0].reaches).toContain("font");
    expect(result.initializers[0].remedy).toContain("tools:node");
  });

  it("leaves harmless initializers alone", () => {
    // Flagging every androidx.startup entry would reject builds for no reason: most
    // initializers never touch Google services.
    expect(analyzeStartupInitializers(metaData("androidx.lifecycle.ProcessLifecycleInitializer")).ok).toBe(true);
    expect(analyzeStartupInitializers(metaData("androidx.work.WorkManagerInitializer")).ok).toBe(true);
    expect(analyzeStartupInitializers("").ok).toBe(true);
  });

  it("does not match a different class that merely shares a prefix", () => {
    expect(analyzeStartupInitializers(metaData("androidx.emoji2.text.EmojiCompatInitializerXyz")).ok).toBe(true);
  });
});
