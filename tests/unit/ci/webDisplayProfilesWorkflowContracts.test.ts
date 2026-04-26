import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const readWorkflow = (name: string) => readFileSync(path.resolve(process.cwd(), ".github/workflows", name), "utf8");
const readPlaywrightSpec = (name: string) => readFileSync(path.resolve(process.cwd(), "playwright", name), "utf8");

describe("web display profile zoom proof contracts", () => {
    it("routes the browser-zoom diagnostics proof to the dedicated web Playwright lane", () => {
        const workflow = readWorkflow("android.yaml");
        expect(workflow).toContain("- name: Run web display profile zoom proof");
        expect(workflow).toContain('PLAYWRIGHT_DEVICES: "web"');
        expect(workflow).toContain('npx playwright test playwright/displayProfiles.spec.ts -g "@web-platform" --project=web');
    });

    it("marks the browser-zoom diagnostics proof as web-platform only so phone shards do not skip it", () => {
        const spec = readPlaywrightSpec("displayProfiles.spec.ts");
        expect(spec).toContain("compact diagnostics CTA layout remains reachable under browser zoom on web @web-platform");
        expect(spec).toContain('if (testInfo.project.name !== "web")');
    });
});
