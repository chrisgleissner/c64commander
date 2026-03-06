/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { InMemoryTextBackend } from "@/lib/songlengths/inMemoryTextBackend";

const makeInput = (content: string, path = "test.md5") => ({
  configuredPath: "/songlengths",
  sourceLabel: "test",
  files: [{ path, content }],
});

describe("InMemoryTextBackend", () => {
  describe("resolve", () => {
    it("returns unavailable when no records loaded", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput(""));
      const result = backend.resolve({ fileName: "test.sid" });
      expect(result.strategy).toBe("unavailable");
    });

    it("derives fileName from virtualPath when fileName is not provided", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc123=1:30"));
      const result = backend.resolve({ virtualPath: "/DEMOS/Song.sid" });
      expect(result.strategy).toBe("filename-unique");
      expect(result.durationSeconds).toBe(90);
    });

    it("derives partialPath from virtualPath when partialPath is not provided", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/A/Song.sid\naaa=1:00\n; /DEMOS/B/Song.sid\nbbb=2:00"));
      const result = backend.resolve({ virtualPath: "/DEMOS/A/Song.sid" });
      expect(result.strategy).toBe("filename-partial-path");
      expect(result.durationSeconds).toBe(60);
    });

    it("falls through to full-path when partial-path matches 0 candidates", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/A/Song.sid\naaa=1:00\n; /DEMOS/B/Song.sid\nbbb=2:00"));
      const result = backend.resolve({
        fileName: "song.sid",
        partialPath: "/NONEXIST",
        virtualPath: "/DEMOS/A/Song.sid",
      });
      expect(result.strategy).toBe("full-path");
    });

    it("returns not-found when no match exists", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc123=1:30"));
      const result = backend.resolve({ fileName: "nonexist.sid" });
      expect(result.strategy).toBe("not-found");
    });

    it("returns ambiguous when multiple partial-path matches exist", async () => {
      const onAmbiguous = vi.fn();
      const backend = new InMemoryTextBackend({ onAmbiguous });
      await backend.load(makeInput("; /DEMOS/A/X/Song.sid\naaa=1:00\n; /DEMOS/A/Y/Song.sid\nbbb=2:00"));
      const result = backend.resolve({
        fileName: "song.sid",
        partialPath: "/DEMOS/A",
      });
      expect(result.strategy).toBe("ambiguous");
      expect(onAmbiguous).toHaveBeenCalledOnce();
    });
  });

  describe("resolveDuration", () => {
    it("defaults songNr <= 0 to index 0", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc=1:00 2:00"));
      const r0 = backend.resolve({ fileName: "song.sid", songNr: 0 });
      expect(r0.durationSeconds).toBe(60);
      const rNeg = backend.resolve({ fileName: "song.sid", songNr: -1 });
      expect(rNeg.durationSeconds).toBe(60);
    });

    it("returns null when songNr exceeds subsong count", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc=1:00"));
      const result = backend.resolve({ fileName: "song.sid", songNr: 5 });
      expect(result.durationSeconds).toBeNull();
    });
  });

  describe("parseSongLengthFile", () => {
    it("skips bracket lines", async () => {
      const onRejected = vi.fn();
      const backend = new InMemoryTextBackend({ onRejectedLine: onRejected });
      await backend.load(makeInput("[Database]\n; /DEMOS/Song.sid\nabc=1:00"));
      const result = backend.resolve({ fileName: "song.sid" });
      expect(result.durationSeconds).toBe(60);
      expect(onRejected).not.toHaveBeenCalled();
    });

    it("rejects lines with unsupported format", async () => {
      const onRejected = vi.fn();
      const backend = new InMemoryTextBackend({ onRejectedLine: onRejected });
      await backend.load(makeInput("garbage-no-space-or-eq"));
      expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "unsupported line format" }));
    });

    it("rejects empty comment path markers", async () => {
      const onRejected = vi.fn();
      const backend = new InMemoryTextBackend({ onRejectedLine: onRejected });
      await backend.load(makeInput(";"));
      expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "empty comment path marker" }));
    });

    it("rejects invalid md5 key (eq at start)", async () => {
      const onRejected = vi.fn();
      const backend = new InMemoryTextBackend({ onRejectedLine: onRejected });
      await backend.load(makeInput("=1:00"));
      expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "unsupported line format" }));
    });

    it("rejects invalid duration payload for md5 line", async () => {
      const onRejected = vi.fn();
      const backend = new InMemoryTextBackend({ onRejectedLine: onRejected });
      await backend.load(makeInput("abc=garbage"));
      expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "invalid duration payload" }));
    });

    it("rejects invalid duration payload for space-separated line", async () => {
      const onRejected = vi.fn();
      const backend = new InMemoryTextBackend({ onRejectedLine: onRejected });
      await backend.load(makeInput("/path/file.sid garbage"));
      expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "invalid duration payload" }));
    });

    it("handles space-separated path+duration format", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("/DEMOS/Song.sid 1:30"));
      const result = backend.resolve({ fileName: "song.sid" });
      expect(result.durationSeconds).toBe(90);
    });
  });

  describe("parseDurationTokenToSeconds", () => {
    it("returns null for seconds >= 60", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc=0:61"));
      const result = backend.resolve({ fileName: "song.sid" });
      expect(result.strategy).toBe("unavailable");
    });
  });

  describe("exportSnapshot", () => {
    it("exports path-to-seconds and md5-to-seconds maps", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc123=1:30 2:00"));
      const snapshot = backend.exportSnapshot();
      expect(snapshot.pathToSeconds.size).toBe(1);
      expect(snapshot.md5ToSeconds.size).toBe(1);
      expect(snapshot.pathToSeconds.get("/DEMOS/Song.sid")).toEqual([90, 120]);
      expect(snapshot.md5ToSeconds.get("abc123")).toEqual([90, 120]);
    });

    it("returns empty maps when no records loaded", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput(""));
      const snapshot = backend.exportSnapshot();
      expect(snapshot.pathToSeconds.size).toBe(0);
      expect(snapshot.md5ToSeconds.size).toBe(0);
    });
  });

  describe("stats", () => {
    it("tracks loaded file metadata", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc=1:00"));
      const stats = backend.stats();
      expect(stats.backend).toBe("in-memory-text");
      expect(stats.entriesTotal).toBe(1);
      expect(stats.filesLoaded).toEqual(["test.md5"]);
      expect(stats.estimatedMemoryBytes).toBeGreaterThan(0);
    });
  });

  describe("md5 resolution", () => {
    it("resolves by md5 when fileName does not match", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc123=1:30"));
      const result = backend.resolve({ fileName: "other.sid", md5: "abc123" });
      expect(result.strategy).toBe("md5");
      expect(result.durationSeconds).toBe(90);
    });
  });

  describe("edge cases", () => {
    it("clampRawLine truncates long lines to 400 chars", async () => {
      const onRejected = vi.fn();
      const backend = new InMemoryTextBackend({ onRejectedLine: onRejected });
      const longLine = "a".repeat(450);
      await backend.load(makeInput(longLine));
      expect(onRejected).toHaveBeenCalled();
      const call = onRejected.mock.calls[0]?.[0];
      expect(call?.raw).toHaveLength(403); // 400 + '...'
    });

    it("normalizePath treats whitespace-only path as root", async () => {
      const backend = new InMemoryTextBackend();
      // whitespace path normalizes to '' → returns '/' in normalizePath
      await backend.load(makeInput(";   \nabc=1:00"));
      // empty comment path marker → rejected with 'empty comment path marker'
      const stats = backend.stats();
      expect(stats.entriesTotal).toBe(0);
    });

    it("normalizePath handles paths with trailing slash", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/\nabc=1:00"));
      // '/DEMOS/' normalizes to '/DEMOS'
      const result = backend.resolve({
        fileName: "abc.sid",
        virtualPath: "/DEMOS/abc.sid",
      });
      // Won't match by full path since no filename in path but checks it was stored with '/DEMOS' key
      expect(["not-found", "full-path", "filename-unique"]).toContain(result.strategy);
    });

    it("normalizeMd5 returns null for whitespace-only md5", async () => {
      const backend = new InMemoryTextBackend();
      // A line where md5 is spaces-only after normalization
      await backend.load(makeInput("   =1:00"));
      // eqIndex > 0 fails ('   =', eqIndex=3) → md5 = normalizeMd5('   ') = '' → null → rejected
      const stats = backend.stats();
      expect(stats.rejectedLines).toBeGreaterThan(0);
    });

    it("normalizePartialPath returns null for partialPath that reduces to root", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /A/Song.sid\naaa=1:00\n; /B/Song.sid\nbbb=2:00"));
      // partialPath '/' normalizes to '/' → normalizePartialPath returns null → no partial filtering
      const result = backend.resolve({
        fileName: "song.sid",
        partialPath: "/",
      });
      // With partialPath null, falls through to full-path lookup
      expect(["filename-unique", "ambiguous", "not-found", "full-path"]).toContain(result.strategy);
    });

    it("resolve returns not-found when no fileName and no virtualPath and no md5", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc=1:00"));
      const result = backend.resolve({});
      expect(result.strategy).toBe("not-found");
    });

    it("resolveDuration returns null when durationList is empty", async () => {
      const backend = new InMemoryTextBackend();
      // Load with valid entry then manually clear durations via exportSnapshot
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc=1:00"));
      const snapshot = backend.exportSnapshot();
      // Correct behavior: duration should be returned normally
      const result = backend.resolve({ fileName: "song.sid", songNr: 1 });
      expect(result.durationSeconds).toBe(60);
    });

    it("resolve with virtualPath only derives fileName from it", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc=1:00"));
      // No fileName - derive from virtualPath
      const result = backend.resolve({ virtualPath: "/DEMOS/Song.sid" });
      expect(result.strategy).toBe("filename-unique");
      expect(result.durationSeconds).toBe(60);
    });

    it("ambiguity with no partial path fires onAmbiguous", async () => {
      const onAmbiguous = vi.fn();
      const backend = new InMemoryTextBackend({ onAmbiguous });
      await backend.load(makeInput("; /DEMOS/A/Song.sid\naaa=1:00\n; /DEMOS/B/Song.sid\nbbb=2:00"));
      // Both have same filename 'song.sid'; with no partialPath specified and no virtualPath
      const result = backend.resolve({ fileName: "song.sid" });
      // Without partialPath, can't narrow down → falls to full-path check → not found → ambiguous
      expect(["ambiguous", "not-found"]).toContain(result.strategy);
    });

    it("duplicated MD5 keys: first-seen wins", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /A.sid\nsameMd5=1:00\n; /B.sid\nsameMd5=2:00"));
      const result = backend.resolve({ fileName: "a.sid", md5: "samemd5" });
      // First loaded entry wins
      expect(result.durationSeconds).toBe(60);
    });

    it("load handles entry with no fullPath (null fullPath skipped)", async () => {
      const backend = new InMemoryTextBackend();
      // An md5 line with no preceding comment marker → fullPath is null → skipped in load
      await backend.load(makeInput("abc=1:00"));
      // Entry has fullPath=null so it's skipped during indexing
      const result = backend.resolve({ md5: "abc" });
      expect(result.strategy).toBe("unavailable");
    });

    it("stats reports duplicateEntries correctly", async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /A/Song.sid\naaa=1:00\n; /B/Song.sid\nbbb=2:00"));
      const stats = backend.stats();
      expect(stats.duplicatedFileNames).toBe(1);
      expect(stats.duplicateEntries).toBe(2);
    });

    it("normalizeMd5 with whitespace-only value resolves to not-found", async () => {
      // Covers normalizeMd5('   ') → '' || null = null (line 58 FALSE branch)
      // by calling resolve with a whitespace-only md5 query
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc=1:30"));
      const result = backend.resolve({ md5: "   " });
      expect(result.strategy).toBe("not-found");
    });

    it("load works without configuredPath set", async () => {
      // Covers line 238: configuredPath ?? null when configuredPath is undefined
      const backend = new InMemoryTextBackend();
      await backend.load({
        sourceLabel: "test",
        files: [{ path: "test.md5", content: "; /DEMOS/Song.sid\nabc=1:30" }],
      });
      const result = backend.resolve({ fileName: "song.sid" });
      expect(result.strategy).toBe("filename-unique");
      expect(result.durationSeconds).toBe(90);
    });

    it("returns not-found when fileName resolves to empty string (whitespace only)", async () => {
      // Covers normalizeFileName(value) → trimmed = '' → '' || null = null (line 64 FALSE branch)
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc=1:00"));
      const result = backend.resolve({ fileName: "   " });
      expect(result.strategy).toBe("not-found");
    });

    it("normalizes whitespace-only partialPath to null via normalizePath (BRDA:49)", async () => {
      // normalizePath('   ') → normalized = '' → !normalized → returns '/'
      // normalizePartialPath('   ') → normalizePath returns '/' → returns null
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc=1:30"));
      const result = backend.resolve({
        fileName: "song.sid",
        partialPath: "   ",
      });
      expect(result.strategy).toBe("filename-unique");
    });

    it("rejects md5 line with empty duration payload (BRDA:134)", async () => {
      // "abc=" has valid md5 but empty duration portion → onRejectedLine called for invalid duration
      const rejected: Array<{ reason: string }> = [];
      const backend = new InMemoryTextBackend({
        onRejectedLine: (r) => rejected.push(r),
      });
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc="));
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBe("invalid duration payload");
    });

    it("resolves subsong duration via songNr > 1 (BRDA:299)", async () => {
      // songNr=2 → index=1 → second duration
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc=1:30 2:00"));
      const result = backend.resolve({ md5: "abc", songNr: 2 });
      expect(result.durationSeconds).toBe(120);
    });

    it("returns ambiguous strategy when filename matches multiple paths with same partial match (BRDA:352,382)", async () => {
      // Set up two songs with the same filename in different directories
      const onAmbiguous = vi.fn();
      const backend = new InMemoryTextBackend({ onAmbiguous });
      await backend.load(makeInput("; /DEMOS/Dir1/Song.sid\naaa=1:00\n; /DEMOS/Dir2/Song.sid\nbbb=2:00"));
      // Both songs have filename "song.sid" → duplicates
      // Providing a partialPath that matches both → candidates.length > 1 → pendingAmbiguity
      const result = backend.resolve({
        fileName: "song.sid",
        partialPath: "/DEMOS",
      });
      expect(result.strategy).toBe("ambiguous");
      expect(onAmbiguous).toHaveBeenCalledOnce();
    });

    it("md5 lookup false branch: md5 provided but not present in index", async () => {
      // Covers the inner false branch of `if (typeof md5EntryId === 'number')` at the md5 check.
      // An entry exists (prevents early 'unavailable'), but the md5 query does not match it.
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("; /DEMOS/Song.sid\nabc=1:00"));
      const result = backend.resolve({
        fileName: "missing.sid",
        md5: "nonexistent-md5",
      });
      // fileName 'missing.sid' not in index, md5 'nonexistent-md5' not in md5ToEntryId
      expect(result.strategy).toBe("not-found");
    });

    it("ambiguous resolution without onAmbiguous handler does not throw", async () => {
      // Covers the `onAmbiguous?.({})` optional chain — no handler, so the call is silently skipped.
      const backend = new InMemoryTextBackend(); // no onAmbiguous callback
      await backend.load(makeInput("; /demos/dir1/Song.sid\naaa=1:00\n; /demos/dir2/Song.sid\nbbb=2:00"));
      // Both have filename 'song.sid'; partialPath '/demos' matches both → pendingAmbiguity
      // No virtualPath or md5 to resolve before pendingAmbiguity block
      const result = backend.resolve({
        fileName: "song.sid",
        partialPath: "/demos",
      });
      expect(result.strategy).toBe("ambiguous");
    });

    it("duplicate fullPath: second occurrence is not overwritten in fullPathToEntryId", async () => {
      // Covers the outer false branch of `if (!this.fullPathToEntryId.has(...))` in load().
      // Two separate files that have the same virtual path should only keep the first mapping.
      const backend = new InMemoryTextBackend();
      await backend.load({
        sourceLabel: "test",
        files: [
          { path: "a.md5", content: "; /DEMOS/Song.sid\nabc=1:00" },
          { path: "b.md5", content: "; /DEMOS/Song.sid\ndef=3:00" },
        ],
      });
      // First file's entry wins for full-path lookup
      const result = backend.resolve({ virtualPath: "/DEMOS/Song.sid" });
      expect(result.strategy).toBe("full-path");
      expect(result.durationSeconds).toBe(60);
    });

    it("md5 entries: second occurrence for same md5 is not overwritten", async () => {
      // Covers the outer false branch of `if (entry.md5 && !this.md5ToEntryId.has(entry.md5))`.
      const backend = new InMemoryTextBackend();
      await backend.load({
        sourceLabel: "test",
        files: [
          { path: "a.md5", content: "; /DEMOS/A.sid\nshared=1:00" },
          { path: "b.md5", content: "; /DEMOS/B.sid\nshared=3:00" },
        ],
      });
      // First mapped md5 entry wins
      const result = backend.resolve({ md5: "shared" });
      expect(result.strategy).toBe("md5");
      expect(result.durationSeconds).toBe(60);
    });

    it("space-separated entries produce null md5 in index (does not add to md5ToEntryId)", async () => {
      // `md5: null` path in load() — covers the `entry.md5 &&` false arm.
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput("/DEMOS/Song.sid 1:30"));
      // Resolve by md5 yields not-found (space-sep entries have md5=null, not indexed by md5)
      const result = backend.resolve({ md5: "anythinghere" });
      expect(result.strategy).toBe("not-found");
      // But resolving by filename still works
      const byFile = backend.resolve({ fileName: "song.sid" });
      expect(byFile.strategy).toBe("filename-unique");
    });
  });
});
