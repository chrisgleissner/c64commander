import { beforeEach, describe, expect, it } from "vitest";

import { readOpenSections, writeOpenSection } from "@/lib/ui/collapsibleSectionStore";

const OPEN_SECTIONS_KEY = "c64u_open_sections";
const LEGACY_SETTINGS_KEY = "c64u_settings_open_sections";

describe("collapsibleSectionStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty for a scope nothing has written to yet", () => {
    expect(readOpenSections("home")).toEqual(new Set());
  });

  it("remembers an opened section under its scope", () => {
    writeOpenSection("home", "video", true);

    expect(readOpenSections("home")).toEqual(new Set(["video"]));
  });

  it("forgets a section once it is closed", () => {
    writeOpenSection("home", "video", true);
    writeOpenSection("home", "video", false);

    expect(readOpenSections("home")).toEqual(new Set());
  });

  it("keeps scopes independent, even with the same section id", () => {
    writeOpenSection("home", "video", true);
    writeOpenSection("settings", "video", false);

    expect(readOpenSections("home")).toEqual(new Set(["video"]));
    expect(readOpenSections("settings")).toEqual(new Set());
  });

  it("does not let one scope's writes disturb another scope's stored ids", () => {
    writeOpenSection("home", "cpu-ram", true);
    writeOpenSection("home", "audio", true);
    writeOpenSection("settings", "appearance", true);

    writeOpenSection("home", "audio", false);

    expect(readOpenSections("home")).toEqual(new Set(["cpu-ram"]));
    expect(readOpenSections("settings")).toEqual(new Set(["appearance"]));
  });

  it("discards an unreadable stored value instead of throwing", () => {
    localStorage.setItem(OPEN_SECTIONS_KEY, "{not json");

    expect(readOpenSections("home")).toEqual(new Set());
  });

  it("ignores non-string entries in a malformed stored array", () => {
    localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(["home:video", 42, null, { id: "home:audio" }]));

    expect(readOpenSections("home")).toEqual(new Set(["video"]));
  });

  it("migrates the legacy Settings-only store into the shared one, once", () => {
    localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify(["appearance", "device-safety"]));

    expect(readOpenSections("settings")).toEqual(new Set(["appearance", "device-safety"]));
    expect(localStorage.getItem(LEGACY_SETTINGS_KEY)).toBeNull();
  });

  it("does not resurrect a migrated section that was closed after migration", () => {
    localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify(["appearance"]));

    readOpenSections("settings"); // triggers the one-time migration
    writeOpenSection("settings", "appearance", false);

    expect(readOpenSections("settings")).toEqual(new Set());
  });

  it("does not touch unrelated scopes already in the shared store during migration", () => {
    writeOpenSection("home", "video", true);
    localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify(["appearance"]));

    readOpenSections("settings");

    expect(readOpenSections("home")).toEqual(new Set(["video"]));
    expect(readOpenSections("settings")).toEqual(new Set(["appearance"]));
  });

  it("is a no-op when there is nothing legacy to migrate", () => {
    writeOpenSection("settings", "appearance", true);

    readOpenSections("settings");

    expect(readOpenSections("settings")).toEqual(new Set(["appearance"]));
  });
});
