import { describe, expect, it } from "vitest";
import { createArchiveSourceLocation } from "@/lib/sourceNavigation/archiveSourceAdapter";
import { buildDefaultArchiveClientConfig } from "@/lib/archive/config";

describe("createArchiveSourceLocation", () => {
    it("creates a source location from archive config", () => {
        const source = createArchiveSourceLocation(buildDefaultArchiveClientConfig());
        expect(source.id).toBe("archive-commoserve");
        expect(source.type).toBe("commoserve");
        expect(source.name).toBe("CommoServe");
        expect(source.rootPath).toBe("/");
        expect(source.isAvailable).toBe(true);
    });

    it("returns empty arrays for listEntries and listFilesRecursive", async () => {
        const source = createArchiveSourceLocation(buildDefaultArchiveClientConfig());
        expect(await source.listEntries("/")).toEqual([]);
        expect(await source.listFilesRecursive("/")).toEqual([]);
    });
});
