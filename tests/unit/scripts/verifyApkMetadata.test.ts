import { describe, expect, it } from "vitest";
import { ApkMetadataError, parseBadging, verifyApkMetadata } from "../../../scripts/verify-apk-metadata.mjs";

const AAPT_BADGING = [
  "package: name='uk.gleissner.c64uremote' versionCode='1601' versionName='0.8.8-rc1' compileSdkVersion='35'",
  "application-label:'C64U Remote'",
  "application-label-en:'C64U Remote'",
  "application: label='C64U Remote' icon='res/mipmap-anydpi-v26/ic_launcher.xml'",
  "launchable-activity: name='uk.gleissner.c64uremote.MainActivity'  label='C64U Remote' icon=''",
  "uses-permission: name='android.permission.INTERNET'",
].join("\n");

const AAPT_BADGING_COMMANDER = [
  "package: name='uk.gleissner.c64commander' versionCode='1601' versionName='0.8.8-rc1'",
  "application-label:'C64 Commander'",
  "application: label='C64 Commander' icon='res/mipmap/ic_launcher.png'",
].join("\n");

describe("parseBadging", () => {
  it("extracts application id, label and version from aapt badging output", () => {
    const parsed = parseBadging(AAPT_BADGING);
    expect(parsed.applicationId).toBe("uk.gleissner.c64uremote");
    expect(parsed.label).toBe("C64U Remote");
    expect(parsed.versionName).toBe("0.8.8-rc1");
    expect(parsed.versionCode).toBe("1601");
  });

  it("parses the regular C64 Commander badging", () => {
    const parsed = parseBadging(AAPT_BADGING_COMMANDER);
    expect(parsed.applicationId).toBe("uk.gleissner.c64commander");
    expect(parsed.label).toBe("C64 Commander");
  });

  it("falls back to the application: label line when application-label is absent", () => {
    const parsed = parseBadging(
      [
        "package: name='com.example.app' versionCode='1' versionName='1.0'",
        "application: label='Fallback Label' icon='x'",
      ].join("\n"),
    );
    expect(parsed.label).toBe("Fallback Label");
  });

  it("returns nulls when fields are missing", () => {
    const parsed = parseBadging("garbage output with no recognizable fields");
    expect(parsed.applicationId).toBeNull();
    expect(parsed.label).toBeNull();
  });
});

describe("verifyApkMetadata", () => {
  it("throws a clear error when the APK file does not exist", () => {
    expect(() => verifyApkMetadata("/nonexistent/path/to.apk", { expectApplicationId: "x" })).toThrow(ApkMetadataError);
    expect(() => verifyApkMetadata("/nonexistent/path/to.apk")).toThrow(/not found/);
  });
});
