import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const readRepoFile = (...parts: string[]) =>
    readFileSync(path.resolve(process.cwd(), ...parts), "utf8");

describe("Android Maestro workflow contracts", () => {
    it("avoids blind bottom-edge taps in the shared launch subflow", () => {
        const flow = readRepoFile(".maestro", "subflows", "launch-and-wait.yaml");
        expect(flow).toContain('visible: "Home"');
        expect(flow).toContain('text: "Don\'t show again"');
        expect(flow).toContain('text: "OK"');
        expect(flow).not.toContain('visible: "C64 Commander"');
        expect(flow).not.toContain('point: "8%,95%"');
    });

    it("opens the play tab through app selectors instead of bottom-edge coordinates", () => {
        const flow = readRepoFile(".maestro", "perf-hvsc-baseline.yaml");
        expect(flow).toContain('visible: "Indexed .* of .* songs\\\\."');
        expect(flow).toContain('id: "import-option-hvsc"');
        expect(flow).toContain('text: "Done"');
        expect(flow).toContain('point: "25%,90%"');
        expect(flow).toContain('text: "Retry connection"');
        expect(flow).not.toContain('point: "25%,95%"');
    });
});
