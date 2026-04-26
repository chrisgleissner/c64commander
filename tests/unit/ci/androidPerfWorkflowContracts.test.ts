import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const readWorkflow = (name: string) => readFileSync(path.resolve(process.cwd(), ".github/workflows", name), "utf8");

describe("Android perf workflow contracts", () => {
    it("asserts quick secondary perf budgets against the produced smoke summary", () => {
        const workflow = readWorkflow("android.yaml");

        expect(workflow).toContain("- name: Collect quick HVSC secondary summary");
        expect(workflow).toContain("run: npm run test:perf:secondary:quick");
        expect(workflow).toContain("- name: Apply optional perf budgets");
        expect(workflow).toContain("HVSC_PERF_SUMMARY_FILE: ci-artifacts/hvsc-performance/web/web-secondary-smoke.json");
        expect(workflow).toContain("run: npm run test:perf:assert:web");
    });
});
