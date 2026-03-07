import { afterEach, describe, expect, it, vi } from "vitest";

describe("index entrypoint", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
        process.exitCode = 0;
    });

    it("starts the scope server through the entrypoint", async () => {
        const runScopeServer = vi.fn().mockResolvedValue(undefined);
        vi.doMock("../src/server.js", () => ({ runScopeServer }));

        await import("../src/index.ts");
        await Promise.resolve();

        expect(runScopeServer).toHaveBeenCalledTimes(1);
        expect(process.exitCode).not.toBe(1);
    });

    it("reports startup failures through the entrypoint", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const runScopeServer = vi.fn().mockRejectedValue(new Error("startup failed"));
        vi.doMock("../src/server.js", () => ({ runScopeServer }));

        await import("../src/index.ts?failure");
        await Promise.resolve();
        await Promise.resolve();

        expect(runScopeServer).toHaveBeenCalledTimes(1);
        expect(consoleSpy).toHaveBeenCalled();
        expect(process.exitCode).toBe(1);
    });

    it("reports non-Error startup failures through the entrypoint", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const runScopeServer = vi.fn().mockRejectedValue("string failure");
        vi.doMock("../src/server.js", () => ({ runScopeServer }));

        await import("../src/index.ts?string-failure");
        await Promise.resolve();
        await Promise.resolve();

        expect(consoleSpy).toHaveBeenCalledWith("string failure");
        expect(process.exitCode).toBe(1);
    });

    it("falls back to error.message when stack is unavailable", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const failure = new Error("message only");
        Object.defineProperty(failure, "stack", { value: undefined, configurable: true });
        const runScopeServer = vi.fn().mockRejectedValue(failure);
        vi.doMock("../src/server.js", () => ({ runScopeServer }));

        await import("../src/index.ts?message-only");
        await Promise.resolve();
        await Promise.resolve();

        expect(consoleSpy).toHaveBeenCalledWith("message only");
        expect(process.exitCode).toBe(1);
    });
});
