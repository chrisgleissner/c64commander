import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logging")>();
  return { ...actual, addLog: vi.fn() };
});

import { discoverConfigCandidates } from "@/lib/config/configDiscovery";
import { addLog } from "@/lib/logging";
import type { SourceEntry } from "@/lib/sourceNavigation/types";

describe("discoverConfigCandidates", () => {
  it("scans a non-slash source root as the final parent-directory candidate location", async () => {
    const listEntries = vi.fn(async (path: string): Promise<SourceEntry[]> => {
      switch (path) {
        case "/Downloads/Games/":
          return [
            { type: "file", name: "Nested.sid", path: "/Downloads/Games/Nested.sid" },
            { type: "file", name: "Nested.cfg", path: "/Downloads/Games/Nested.cfg" },
          ];
        case "/Downloads/":
          return [{ type: "file", name: "Root.cfg", path: "/Downloads/Root.cfg" }];
        default:
          return [];
      }
    });

    const candidates = await discoverConfigCandidates({
      sourceType: "ultimate",
      sourceRootPath: "/Downloads",
      targetFile: {
        name: "Nested.sid",
        path: "/Downloads/Games/Nested.sid",
      },
      listEntries,
    });

    expect(candidates).toEqual([
      {
        ref: {
          kind: "ultimate",
          fileName: "Nested.cfg",
          path: "/Downloads/Games/Nested.cfg",
          modifiedAt: null,
          sizeBytes: null,
        },
        strategy: "exact-name",
        distance: 0,
        confidence: "high",
      },
      {
        ref: {
          kind: "ultimate",
          fileName: "Root.cfg",
          path: "/Downloads/Root.cfg",
          modifiedAt: null,
          sizeBytes: null,
        },
        strategy: "parent-directory",
        distance: 1,
        confidence: "low",
      },
    ]);
    expect(listEntries).toHaveBeenCalledTimes(2);
  });

  /*
   * The firmware falls back to `<program>.usr` when no `<program>.cfg` sits beside a PRG, and it
   * applies that file with or without the app's knowledge. Discovery has to name it for the app to
   * be able to show it, edit it or decline it.
   */
  it("offers the .usr the firmware falls back to beside a program", async () => {
    const listEntries = vi.fn(async (path: string): Promise<SourceEntry[]> =>
      path === "/Usb0/Games/"
        ? [
            { type: "file", name: "Game.prg", path: "/Usb0/Games/Game.prg" },
            { type: "file", name: "Game.usr", path: "/Usb0/Games/Game.usr" },
          ]
        : [],
    );

    const candidates = await discoverConfigCandidates({
      sourceType: "ultimate",
      sourceRootPath: "/Usb0",
      targetFile: { name: "Game.prg", path: "/Usb0/Games/Game.prg" },
      listEntries,
    });

    expect(candidates.map((candidate) => [candidate.ref.fileName, candidate.strategy])).toEqual([
      ["Game.usr", "exact-name"],
    ]);
  });

  it("prefers the .cfg and leaves the .usr out when both sit beside the program", async () => {
    const listEntries = vi.fn(async (path: string): Promise<SourceEntry[]> =>
      path === "/Usb0/Games/"
        ? [
            { type: "file", name: "Game.prg", path: "/Usb0/Games/Game.prg" },
            { type: "file", name: "Game.cfg", path: "/Usb0/Games/Game.cfg" },
            { type: "file", name: "Game.usr", path: "/Usb0/Games/Game.usr" },
          ]
        : [],
    );

    const candidates = await discoverConfigCandidates({
      sourceType: "ultimate",
      sourceRootPath: "/Usb0",
      targetFile: { name: "Game.prg", path: "/Usb0/Games/Game.prg" },
      listEntries,
    });

    expect(candidates.map((candidate) => candidate.ref.fileName)).toEqual(["Game.cfg"]);
  });

  /* The firmware only does this for programs, so a cartridge's `.usr` neighbour means nothing. */
  it("ignores a .usr beside a cartridge", async () => {
    const listEntries = vi.fn(async (path: string): Promise<SourceEntry[]> =>
      path === "/Usb0/Games/"
        ? [
            { type: "file", name: "Game.crt", path: "/Usb0/Games/Game.crt" },
            { type: "file", name: "Game.usr", path: "/Usb0/Games/Game.usr" },
          ]
        : [],
    );

    const candidates = await discoverConfigCandidates({
      sourceType: "ultimate",
      sourceRootPath: "/Usb0",
      targetFile: { name: "Game.crt", path: "/Usb0/Games/Game.crt" },
      listEntries,
    });

    expect(candidates).toEqual([]);
  });

  /*
   * A folder that cannot be listed means this file has no settings file beside it, not that adding
   * the file failed. An archive entry's parent, a lapsed folder permission and a device that
   * dropped off all read the same way.
   */
  it("reports no candidates when the folder cannot be listed", async () => {
    const listEntries = vi.fn(async () => {
      throw new Error("permission denied");
    });

    await expect(
      discoverConfigCandidates({
        sourceType: "local",
        sourceId: "phone",
        sourceRootPath: "/",
        targetFile: { name: "Game.prg", path: "/Games/Game.prg" },
        listEntries,
      }),
    ).resolves.toEqual([]);
  });

  it("logs at warn which folder could not be listed", async () => {
    vi.mocked(addLog).mockClear();
    const listEntries = vi.fn(async () => {
      throw new Error("permission denied");
    });

    await discoverConfigCandidates({
      sourceType: "local",
      sourceId: "phone",
      sourceRootPath: "/Games",
      targetFile: { name: "Game.prg", path: "/Games/Game.prg" },
      listEntries,
    });

    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Config discovery: could not list a folder; looking for no settings file there",
      { path: "/Games/", error: "permission denied" },
    );
  });
});
