import { beforeEach, describe, expect, it } from "vitest";

import { readSectionStates, writeSectionState } from "@/lib/ui/collapsibleSectionStore";

const OPEN_SECTIONS_KEY = "c64u_open_sections";
const LEGACY_SETTINGS_KEY = "c64u_settings_open_sections";

describe("collapsibleSectionStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty for a scope nothing has written to yet", () => {
    expect(readSectionStates("home")).toEqual(new Map());
  });

  it("remembers an opened section under its scope", () => {
    writeSectionState("home", "video", true);

    expect(readSectionStates("home")).toEqual(new Map([["video", true]]));
  });

  it("remembers a closed section explicitly, rather than forgetting it", () => {
    writeSectionState("home", "video", true);
    writeSectionState("home", "video", false);

    expect(readSectionStates("home")).toEqual(new Map([["video", false]]));
  });

  it("does not report an untouched id as either open or closed", () => {
    writeSectionState("home", "video", false);

    const states = readSectionStates("home");
    expect(states.has("cpu-ram")).toBe(false);
    expect(states.get("video")).toBe(false);
  });

  it("keeps scopes independent, even with the same section id", () => {
    writeSectionState("home", "video", true);
    writeSectionState("settings", "video", false);

    expect(readSectionStates("home")).toEqual(new Map([["video", true]]));
    expect(readSectionStates("settings")).toEqual(new Map([["video", false]]));
  });

  it("does not let one scope's writes disturb another scope's stored ids", () => {
    writeSectionState("home", "cpu-ram", true);
    writeSectionState("home", "audio", true);
    writeSectionState("settings", "appearance", true);

    writeSectionState("home", "audio", false);

    expect(readSectionStates("home")).toEqual(
      new Map([
        ["cpu-ram", true],
        ["audio", false],
      ]),
    );
    expect(readSectionStates("settings")).toEqual(new Map([["appearance", true]]));
  });

  it("discards an unreadable stored value instead of throwing", () => {
    localStorage.setItem(OPEN_SECTIONS_KEY, "{not json");

    expect(readSectionStates("home")).toEqual(new Map());
  });

  it("ignores non-boolean entries in a malformed stored object", () => {
    localStorage.setItem(
      OPEN_SECTIONS_KEY,
      JSON.stringify({ "home:video": true, "home:audio": "yes", "home:lighting": null }),
    );

    expect(readSectionStates("home")).toEqual(new Map([["video", true]]));
  });

  it("treats a pre-fix array of open ids as explicitly open, leaving other ids untouched", () => {
    localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(["home:video", 42, null, { id: "home:audio" }]));

    expect(readSectionStates("home")).toEqual(new Map([["video", true]]));
  });

  it("migrates the legacy Settings-only store into the shared one, once", () => {
    localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify(["appearance", "device-safety"]));

    expect(readSectionStates("settings")).toEqual(
      new Map([
        ["appearance", true],
        ["device-safety", true],
      ]),
    );
    expect(localStorage.getItem(LEGACY_SETTINGS_KEY)).toBeNull();
  });

  it("does not resurrect a migrated section that was closed after migration", () => {
    localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify(["appearance"]));

    readSectionStates("settings"); // triggers the one-time migration
    writeSectionState("settings", "appearance", false);

    expect(readSectionStates("settings")).toEqual(new Map([["appearance", false]]));
  });

  it("does not touch unrelated scopes already in the shared store during migration", () => {
    writeSectionState("home", "video", true);
    localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify(["appearance"]));

    readSectionStates("settings");

    expect(readSectionStates("home")).toEqual(new Map([["video", true]]));
    expect(readSectionStates("settings")).toEqual(new Map([["appearance", true]]));
  });

  it("is a no-op when there is nothing legacy to migrate", () => {
    writeSectionState("settings", "appearance", true);

    readSectionStates("settings");

    expect(readSectionStates("settings")).toEqual(new Map([["appearance", true]]));
  });
});
