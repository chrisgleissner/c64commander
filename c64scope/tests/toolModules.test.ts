import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";
import { ScopeSessionStore } from "../src/sessionStore.js";
import { createToolRegistry } from "../src/toolsRegistry.js";

const originalDevices = process.env.C64SCOPE_CONNECTED_DEVICES;
const originalBridge = process.env.C64SCOPE_C64BRIDGE_STATUS;
const originalCapture = process.env.C64SCOPE_CAPTURE_STATUS;

afterEach(() => {
    process.env.C64SCOPE_CONNECTED_DEVICES = originalDevices;
    process.env.C64SCOPE_C64BRIDGE_STATUS = originalBridge;
    process.env.C64SCOPE_CAPTURE_STATUS = originalCapture;
});

function parseJsonText(result: { content: readonly { text: string }[] }) {
    return JSON.parse(result.content[0]?.text ?? "{}");
}

describe("tool modules", () => {
    it("invokes lab, catalog, assertion, and artifact tools through the registry", async () => {
        const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-tools-"));
        const sessionStore = new ScopeSessionStore(artifactRoot);
        const toolRegistry = createToolRegistry({ sessionStore, logger: createLogger("scope-test") });

        process.env.C64SCOPE_CONNECTED_DEVICES = "device-1,device-2";
        process.env.C64SCOPE_C64BRIDGE_STATUS = "ready";
        process.env.C64SCOPE_CAPTURE_STATUS = "idle";

        try {
            const lab = parseJsonText(await toolRegistry.invoke("scope_lab.get_lab_state", {}));
            const catalog = parseJsonText(await toolRegistry.invoke("scope_catalog.list_cases", {}));
            const assertions = parseJsonText(await toolRegistry.invoke("scope_assert.list_assertions", {}));
            const missingArtifact = parseJsonText(
                await toolRegistry.invoke("scope_artifact.get_artifact_summary", { runId: "missing-run" }),
            );

            expect(lab.data.mobileControllerDevices).toEqual(["device-1", "device-2"]);
            expect(catalog.data.cases).toHaveLength(3);
            expect(assertions.data.assertions).toHaveLength(3);
            expect(missingArtifact.ok).toBe(false);

            delete process.env.C64SCOPE_CONNECTED_DEVICES;
            delete process.env.C64SCOPE_C64BRIDGE_STATUS;
            delete process.env.C64SCOPE_CAPTURE_STATUS;

            const defaultLab = parseJsonText(await toolRegistry.invoke("scope_lab.get_lab_state", {}));
            expect(defaultLab.data.mobileControllerDevices).toEqual([]);
            expect(defaultLab.data.c64bridgeStatus).toBe("unknown");
            expect(defaultLab.data.captureStatus).toBe("unconfigured");
        } finally {
            await rm(artifactRoot, { recursive: true, force: true });
        }
    });
});
