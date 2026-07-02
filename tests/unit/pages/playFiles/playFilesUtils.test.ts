/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  buildPlaylistItemId,
  applyDurationOverrideToPlaylist,
  formatTime,
  formatBytes,
  formatDate,
  isSongCategory,
  normalizeLocalPath,
  getLocalFilePath,
  normalizeDurationInputDraft,
  parseDurationInput,
  tryAcquireSingleFlight,
  releaseSingleFlight,
  resolvePlayTargetIndex,
  clampDurationSeconds,
  formatDurationSeconds,
  durationSecondsToSlider,
  sliderToDurationSeconds,
  parseVolumeOption,
  parseModifiedAt,
  extractAudioMixerItems,
  shuffleArray,
  DURATION_MIN_SECONDS,
  DURATION_MAX_SECONDS,
} from "@/pages/playFiles/playFilesUtils";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { mergeAudioMixerOptions } from "@/lib/config/audioMixer";
import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/audioMixer", () => ({
  mergeAudioMixerOptions: vi.fn(),
}));
vi.mock("@/lib/config/normalizeConfigItem", () => ({
  normalizeConfigItem: vi.fn(),
}));

describe("playFilesUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("formatTime", () => {
    it("formats milliseconds to MM:SS", () => {
      expect(formatTime(1000)).toBe("0:01");
      expect(formatTime(65000)).toBe("1:05");
      expect(formatTime(3600000)).toBe("60:00");
    });
    it("handles undefined", () => {
      expect(formatTime(undefined)).toBe("—:—");
    });
  });

  describe("formatBytes", () => {
    it("formats bytes", () => {
      expect(formatBytes(10)).toBe("10 B");
      expect(formatBytes(1024)).toBe("1.0 KB");
      expect(formatBytes(1536)).toBe("1.5 KB");
    });
    it("handles null/undefined/negative", () => {
      expect(formatBytes(null)).toBe("—");
      expect(formatBytes(undefined)).toBe("—");
      expect(formatBytes(-1)).toBe("—");
    });
  });

  describe("formatDate", () => {
    it("formats valid date string", () => {
      const formatted = formatDate("2023-01-01T12:00:00Z");
      expect(formatted).not.toBe("—");
    });
    it("handles invalid", () => {
      expect(formatDate(null)).toBe("—");
      expect(formatDate("invalid")).toBe("—");
    });
  });

  describe("isSongCategory", () => {
    it("identifies songs", () => {
      expect(isSongCategory("sid")).toBe(true);
      expect(isSongCategory("mod")).toBe(true);
      expect(isSongCategory("prg")).toBe(false);
    });
  });

  describe("normalizeLocalPath", () => {
    it("prepends slash if missing", () => {
      expect(normalizeLocalPath("foo")).toBe("/foo");
      expect(normalizeLocalPath("/foo")).toBe("/foo");
    });
  });

  describe("getLocalFilePath", () => {
    it("uses webkitRelativePath if available", () => {
      const file = { webkitRelativePath: "path/to/file" } as any;
      expect(getLocalFilePath(file)).toBe("/path/to/file");
    });
    it("fallbacks to name", () => {
      const file = { name: "file.d64" } as any;
      expect(getLocalFilePath(file)).toBe("/file.d64");
    });
  });

  describe("parseDurationInput", () => {
    it("parses MM:SS", () => {
      expect(parseDurationInput("1:05")).toBe(65000);
    });
    it("parses seconds", () => {
      expect(parseDurationInput("65")).toBe(65000);
    });
    it("handles invalid", () => {
      expect(parseDurationInput("invalid")).toBeUndefined();
      expect(parseDurationInput("1:invalid")).toBeUndefined();
      expect(parseDurationInput("1:100")).toBeUndefined(); // Seconds >= 60 invalid in strict time?
    });
    it("returns undefined for empty or whitespace input (BRDA:73 TRUE)", () => {
      expect(parseDurationInput("")).toBeUndefined();
      expect(parseDurationInput("   ")).toBeUndefined();
    });
  });

  describe("normalizeDurationInputDraft", () => {
    it("keeps duration drafts constrained to digits and one colon", () => {
      expect(normalizeDurationInputDraft("abc5:30xyz")).toBe("5:30");
      expect(normalizeDurationInputDraft("1::05")).toBe("1:05");
      expect(normalizeDurationInputDraft("12:345")).toBe("12:34");
      expect(normalizeDurationInputDraft("123")).toBe("12");
    });

    it("preserves incomplete mm:ss drafts without accepting unrelated text", () => {
      expect(normalizeDurationInputDraft("1:")).toBe("1:");
      expect(normalizeDurationInputDraft("x:y")).toBe(":");
      expect(normalizeDurationInputDraft(" 0a:5b ")).toBe("0:5");
    });
  });

  describe("tryAcquireSingleFlight (playFilesUtils)", () => {
    it("acquires flight when ref is false, then rejects when already acquired", () => {
      // Importing from playFilesUtils to cover BRDA:105/107 in that module
      const ref = { current: false };
      expect(tryAcquireSingleFlight(ref)).toBe(true);
      expect(ref.current).toBe(true);
      expect(tryAcquireSingleFlight(ref)).toBe(false);
      releaseSingleFlight(ref);
      expect(ref.current).toBe(false);
      expect(tryAcquireSingleFlight(ref)).toBe(true);
    });
  });

  describe("buildPlaylistItemId", () => {
    it("distinguishes repeated playlist entries by addedAt", () => {
      expect(
        buildPlaylistItemId({
          source: "hvsc",
          sourceId: "hvsc-library",
          path: "/MUSICIANS/Test/demo.sid",
          addedAt: "2026-05-21T10:00:00.000Z",
        }),
      ).not.toBe(
        buildPlaylistItemId({
          source: "hvsc",
          sourceId: "hvsc-library",
          path: "/MUSICIANS/Test/demo.sid",
          addedAt: "2026-05-21T10:00:01.000Z",
        }),
      );
    });

    it("preserves the legacy base id when addedAt is absent", () => {
      expect(
        buildPlaylistItemId({
          source: "hvsc",
          sourceId: "hvsc-library",
          path: "/MUSICIANS/Test/demo.sid",
        }),
      ).toBe("hvsc:hvsc-library:/MUSICIANS/Test/demo.sid");
    });
  });

  describe("applyDurationOverrideToPlaylist", () => {
    const createPlaylistItem = (
      id: string,
      durationMs: number | undefined,
      durationSource?: "default" | null,
    ): PlaylistItem => ({
      id,
      request: {
        source: "ultimate",
        path: `/${id}.sid`,
      },
      category: "sid",
      label: id,
      path: `/${id}.sid`,
      durationMs,
      durationSource,
      sourceId: null,
      sizeBytes: null,
      modifiedAt: null,
      addedAt: null,
      status: "ready",
      unavailableReason: null,
      configRef: null,
      configOrigin: null,
      configOverrides: null,
      archiveRef: null,
      subsongCount: null,
    });

    it("fills unresolved items and tags them as default-sourced", () => {
      const unresolved = createPlaylistItem("unresolved", undefined);
      const playlist = [unresolved];

      const updated = applyDurationOverrideToPlaylist(playlist, 12_000);

      expect(updated[0]).toEqual({ ...unresolved, durationMs: 12_000, durationSource: "default" });
    });

    it("keeps updating an item that was previously default-sourced", () => {
      const previouslyDefaulted = createPlaylistItem("defaulted", 90_000, "default");
      const playlist = [previouslyDefaulted];

      const updated = applyDurationOverrideToPlaylist(playlist, 12_000);

      expect(updated[0]).toEqual({ ...previouslyDefaulted, durationMs: 12_000, durationSource: "default" });
    });

    it("never clobbers an item whose duration was resolved from metadata", () => {
      const resolved = createPlaylistItem("resolved", 180_000);
      const playlist = [resolved];

      const updated = applyDurationOverrideToPlaylist(playlist, 12_000);

      expect(updated).toBe(playlist);
      expect(updated[0]).toBe(resolved);
    });

    it("only updates unresolved/default items in a mixed playlist, leaving resolved items untouched", () => {
      const resolved = createPlaylistItem("resolved", 180_000);
      const unresolved = createPlaylistItem("unresolved", undefined);
      const playlist = [resolved, unresolved];

      const updated = applyDurationOverrideToPlaylist(playlist, 12_000);

      expect(updated[0]).toBe(resolved);
      expect(updated[1]).toEqual({ ...unresolved, durationMs: 12_000, durationSource: "default" });
    });

    it("returns the original playlist when every eligible duration already matches", () => {
      const playlist = [
        createPlaylistItem("resolved", 12_000),
        createPlaylistItem("defaulted", 12_000, "default"),
      ];

      expect(applyDurationOverrideToPlaylist(playlist, 12_000)).toBe(playlist);
    });
  });

  describe("sliders", () => {
    it("clamps duration", () => {
      expect(clampDurationSeconds(0)).toBe(DURATION_MIN_SECONDS);
      expect(clampDurationSeconds(100000)).toBe(DURATION_MAX_SECONDS);
    });

    it("converts to/from slider", () => {
      const seconds = 60;
      const slider = durationSecondsToSlider(seconds);
      const convertedBack = sliderToDurationSeconds(slider);
      // expect close enough due to rounding steps
      expect(Math.abs(convertedBack - seconds)).toBeLessThan(5);
    });

    it("formatDurationSeconds", () => {
      expect(formatDurationSeconds(60)).toBe("1:00");
    });
  });

  describe("parseVolumeOption", () => {
    it("parses number from string", () => {
      expect(parseVolumeOption("Value 10.5")).toBe(10.5);
      expect(parseVolumeOption("No number")).toBeUndefined();
    });
  });

  describe("parseModifiedAt", () => {
    it("parses date string", () => {
      expect(parseModifiedAt("2023-01-01")).toBeDefined();
    });
    it("handles invalid", () => {
      expect(parseModifiedAt(undefined)).toBeUndefined();
      expect(parseModifiedAt("invalid")).toBeUndefined();
    });
  });

  describe("extractAudioMixerItems", () => {
    it("extracts items", () => {
      const payload = {
        "Audio Mixer": {
          items: {
            "Item 1": { value: 10 },
          },
        },
      };
      vi.mocked(normalizeConfigItem).mockReturnValue({
        value: 10,
        options: ["a"],
      } as any);
      vi.mocked(mergeAudioMixerOptions).mockReturnValue(["a"]);

      const result = extractAudioMixerItems(payload);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Item 1");
    });

    it("handles empty payload", () => {
      expect(extractAudioMixerItems(undefined)).toEqual([]);
      expect(extractAudioMixerItems({})).toEqual([]);
    });

    it("returns empty array when items is a non-object value (BRDA:137 block 63)", () => {
      // itemsData='42' → !itemsData=false, typeof '42'!=='object'=true → return []
      const payload = { "Audio Mixer": { items: "42" } };
      expect(extractAudioMixerItems(payload as any)).toEqual([]);
    });

    it("passes presets from normalized.details to mergeAudioMixerOptions (BRDA:145 block 67)", () => {
      const payload = { "Audio Mixer": { items: { "Item 1": { value: 5 } } } };
      vi.mocked(normalizeConfigItem).mockReturnValue({
        value: 5,
        options: ["x"],
        details: { presets: ["p1", "p2"] },
      } as any);
      vi.mocked(mergeAudioMixerOptions).mockReturnValue(["p1", "p2"]);
      const result = extractAudioMixerItems(payload);
      expect(result[0].options).toEqual(["p1", "p2"]);
      expect(mergeAudioMixerOptions).toHaveBeenCalledWith(["x"], ["p1", "p2"]);
    });
  });

  describe("shuffleArray", () => {
    it("shuffles", () => {
      const arr = [1, 2, 3, 4, 5];
      const shuffled = shuffleArray(arr);
      expect(shuffled).toHaveLength(5);
      expect(shuffled).toContain(1);
      expect(shuffled).not.toBe(arr); // New array
    });

    it("shuffles single element", () => {
      expect(shuffleArray([1])).toEqual([1]);
    });
  });
});
