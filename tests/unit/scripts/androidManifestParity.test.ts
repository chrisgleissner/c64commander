import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MANIFEST_DIR = path.join(REPO_ROOT, "android/app/src/main");

const readManifest = (name: string) => readFileSync(path.join(MANIFEST_DIR, name), "utf8");

const usesPermissions = (xml: string): string[] =>
  [...xml.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)].map((m) => m[1]).sort();

const serviceNames = (xml: string): string[] =>
  [...xml.matchAll(/<service\s+android:name="([^"]+)"/g)].map((m) => m[1]).sort();

// Normalize for a drift comparison: drop XML comments, blank lines, and the
// elements/permissions the reduced manifest is allowed to omit, then compare.
const REMOVED_LINE_MARKERS = [
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
  "android.permission.WAKE_LOCK",
  ".BackgroundExecutionService",
];

const normalizeShared = (xml: string): string =>
  xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !REMOVED_LINE_MARKERS.some((marker) => line.includes(marker)))
    .join("\n");

describe("AndroidManifest parity (full vs no-background)", () => {
  const full = readManifest("AndroidManifest.xml");
  const reduced = readManifest("AndroidManifest.no-background.xml");

  it("the full manifest declares the background-execution service and permissions", () => {
    expect(usesPermissions(full)).toEqual([
      "android.permission.CHANGE_WIFI_MULTICAST_STATE",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
      "android.permission.INTERNET",
      "android.permission.WAKE_LOCK",
    ]);
    expect(serviceNames(full)).toContain(".BackgroundExecutionService");
  });

  it("the reduced manifest keeps INTERNET + multicast and drops the foreground service", () => {
    expect(usesPermissions(reduced)).toEqual([
      "android.permission.CHANGE_WIFI_MULTICAST_STATE",
      "android.permission.INTERNET",
    ]);
    expect(serviceNames(reduced)).toEqual([]);
  });

  it("both manifests keep the launcher activity and FileProvider", () => {
    for (const xml of [full, reduced]) {
      expect(xml).toContain('android:name=".MainActivity"');
      expect(xml).toContain("android.intent.category.LAUNCHER");
      expect(xml).toContain("${applicationId}.fileprovider");
      expect(xml).toContain('android:usesCleartextTraffic="true"');
    }
  });

  it("differs from the full manifest ONLY by the background-execution bits (no drift)", () => {
    // After removing comments and the allowed-omitted lines, the shared content
    // (application attributes, activity, provider, INTERNET) must be identical.
    expect(normalizeShared(reduced)).toBe(normalizeShared(full));
  });
});
