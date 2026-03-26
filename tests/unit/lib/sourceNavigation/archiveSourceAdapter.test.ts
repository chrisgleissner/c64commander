import { describe, expect, it } from "vitest";
import { createArchiveSourceLocation } from "@/lib/sourceNavigation/archiveSourceAdapter";

describe("createArchiveSourceLocation", () => {
    it("creates a commoserve source location", () => {
        const source = createArchiveSourceLocation("commoserve");
        expect(source.id).toBe("archive-commoserve");
        expect(source.type).toBe("commoserve");
        expect(source.name).toBe("CommoServe");
        expect(source.rootPath).toBe("/");
        expect(source.isAvailable).toBe(true);
    });

    it("creates an assembly64 source location", () => {
        const source = createArchiveSourceLocation("assembly64");
        expect(source.id).toBe("archive-assembly64");
        expect(source.type).toBe("assembly64");
        expect(source.name).toBe("Assembly64");
        expect(source.rootPath).toBe("/");
        expect(source.isAvailable).toBe(true);
    });

    it("returns empty arrays for listEntries and listFilesRecursive", async () => {
        const source = createArchiveSourceLocation("commoserve");
        expect(await source.listEntries("/")).toEqual([]);
        expect(await source.listFilesRecursive("/")).toEqual([]);
    });
});
