import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";

const { writeFile } = vi.hoisted(() => ({ writeFile: vi.fn(async (_path: string, _data: string) => undefined) }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: { ...actual.default, existsSync: () => true, promises: { ...actual.promises, writeFile } },
  };
});

describe("browser coverage collection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_COVERAGE", "true");
    vi.stubGlobal("window", {});
    writeFile.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends coverage as a JSON string and writes every counter unchanged", async () => {
    const coverage = { "play.ts": { s: { 0: 2, 1: 0 }, f: { 0: 1 }, b: { 0: [3, 0] } } };
    (window as any).__coverage__ = coverage;
    const page = {
      evaluate: vi.fn(async (evaluate: () => unknown) => {
        const payload = evaluate();
        expect(typeof payload).toBe("string");
        return payload;
      }),
    } as unknown as Page;
    const { saveCoverageFromPage } = await import("../../../playwright/withCoverage");

    await saveCoverageFromPage(page, "rapid skip");

    expect(writeFile).toHaveBeenCalledOnce();
    expect(JSON.parse(writeFile.mock.calls[0][1] as string)).toEqual(coverage);
  });

  it.each([null, undefined])("does not write an invalid report when browser counters are %s", async (counters) => {
    (window as any).__coverage__ = counters;
    const page = { evaluate: vi.fn(async (evaluate: () => unknown) => evaluate()) } as unknown as Page;
    const { saveCoverageFromPage } = await import("../../../playwright/withCoverage");

    await saveCoverageFromPage(page, "uninstrumented page");

    expect(writeFile).not.toHaveBeenCalled();
  });

  it("rethrows collection failure with the test name and original error cause", async () => {
    const failure = new Error("CDP target vanished");
    const page = { evaluate: vi.fn().mockRejectedValue(failure) } as unknown as Page;
    const { saveCoverageFromPage } = await import("../../../playwright/withCoverage");

    await expect(saveCoverageFromPage(page, "rapid skip")).rejects.toMatchObject({
      message: "Collecting browser coverage for rapid skip failed",
      cause: failure,
    });
    expect(writeFile).not.toHaveBeenCalled();
  });
});
