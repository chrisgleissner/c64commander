import { describe, expect, it, vi } from "vitest";

import { discoverConfigCandidates } from "@/lib/config/configDiscovery";
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
});
