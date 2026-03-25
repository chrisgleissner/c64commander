import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildArchivePlayPlan, executeArchiveEntry, getArchiveEntryActionLabel } from "@/lib/archive/execution";
import { executePlayPlan } from "@/lib/playback/playbackRouter";

vi.mock("@/lib/playback/playbackRouter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/playback/playbackRouter")>("@/lib/playback/playbackRouter");
  return {
    ...actual,
    executePlayPlan: vi.fn(),
  };
});

describe("archive execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies entry actions from filenames", () => {
    expect(getArchiveEntryActionLabel("demo.prg")).toBe("Run");
    expect(getArchiveEntryActionLabel("disk.d64")).toBe("Mount & run");
    expect(getArchiveEntryActionLabel("tune.sid")).toBe("Play");
  });

  it("builds a play plan from downloaded binary metadata", () => {
    const plan = buildArchivePlayPlan({
      fileName: "demo.prg",
      bytes: new Uint8Array([0x01, 0x08, 0x60]),
      contentType: "application/octet-stream",
      url: "http://example.invalid/file",
    });

    expect(plan).toMatchObject({ source: "local", category: "prg", path: "demo.prg" });
  });

  it("adds an extension when binary detection succeeds for an extensionless archive file", () => {
    const plan = buildArchivePlayPlan({
      fileName: "wizball",
      bytes: new Uint8Array(174848),
      contentType: "application/octet-stream",
      url: "http://example.invalid/wizball",
    });

    expect(plan).toMatchObject({ category: "disk", path: "wizball.d64", mountType: "d64" });
  });

  it("rejects unsupported archive payloads before execution", () => {
    expect(() =>
      buildArchivePlayPlan({
        fileName: "broken.bin",
        bytes: new Uint8Array([0x01]),
        contentType: "application/octet-stream",
        url: "http://example.invalid/broken.bin",
      }),
    ).toThrow("Unsupported archive file broken.bin");
  });

  it("routes downloaded PRG files into the existing REST playback pipeline", async () => {
    await executeArchiveEntry({
      result: { id: "100", category: 40, name: "Joyride" },
      entry: { path: "joyride.prg", id: 0 },
      binary: {
        fileName: "joyride.prg",
        bytes: new Uint8Array([0x01, 0x08, 0x60]),
        contentType: "application/octet-stream",
        url: "http://archive.local/joyride.prg",
      },
    });

    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: "local",
        category: "prg",
        path: "joyride.prg",
      }),
    );
  });
});
