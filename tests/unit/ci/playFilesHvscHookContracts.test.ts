import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const readRepoFile = (...parts: string[]) => readFileSync(path.resolve(process.cwd(), ...parts), "utf8");

describe("Play files HVSC hook contracts", () => {
    it("shares one hvsc hook instance between the page chooser and hvsc controls", () => {
        const playFilesPage = readRepoFile("src", "pages", "PlayFilesPage.tsx");
        const hvscManager = readRepoFile("src", "pages", "playFiles", "components", "HvscManager.tsx");

        expect(playFilesPage.match(/useHvscLibrary\(/g) ?? []).toHaveLength(1);
        expect(playFilesPage).toContain("const hvsc = useHvscLibrary();");
        expect(playFilesPage).toContain("<HvscManager hvscControlsEnabled={true} hvsc={hvsc} />");

        expect(hvscManager).toContain("hvsc: HvscLibraryState;");
        expect(hvscManager).not.toContain("useHvscLibrary(");
    });
});
