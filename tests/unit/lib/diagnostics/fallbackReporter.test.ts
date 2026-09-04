import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeValueShape,
  reportFallback,
  resetFallbackReporterForTests,
  setFallbackReporter,
} from "@/lib/diagnostics/fallbackReporter";

afterEach(() => {
  resetFallbackReporterForTests();
});

describe("fallbackReporter", () => {
  it("reports the site, the value shape and the caller's context", () => {
    const sink = vi.fn();
    setFallbackReporter(sink);

    reportFallback("some.site", "abcdef", { fallbackHost: "c64u" });

    expect(sink).toHaveBeenCalledWith("some.site", "string(length=6)", { fallbackHost: "c64u" });
  });

  it("never puts a string's content in the report", () => {
    const sink = vi.fn();
    setFallbackReporter(sink);

    reportFallback("secureStorage.parsePasswordState", "hunter2-not-a-real-password");

    const [, shape, context] = sink.mock.calls[0];
    expect(shape).toBe("string(length=27)");
    expect(JSON.stringify([shape, context])).not.toContain("hunter2");
  });

  it("reports a site and shape once, so a per-request parse cannot flood the log", () => {
    const sink = vi.fn();
    setFallbackReporter(sink);

    reportFallback("hot.path", new TypeError("Invalid URL"));
    reportFallback("hot.path", new TypeError("Invalid URL"));
    reportFallback("hot.path", new TypeError("Invalid base URL"));

    expect(sink).toHaveBeenCalledTimes(2);
  });

  it("describes shapes without disclosing object or array contents", () => {
    expect(describeValueShape(null)).toBe("null");
    expect(describeValueShape(undefined)).toBe("undefined");
    expect(describeValueShape(["a", "b"])).toBe("array(length=2)");
    expect(describeValueShape({ password: "secret" })).toBe("object(keys=1)");
    expect(describeValueShape(7)).toBe("number");
    expect(describeValueShape(new TypeError("Invalid URL"))).toBe("TypeError: Invalid URL");
  });

  it("drops reports when no sink is registered", () => {
    expect(() => reportFallback("no.sink", "x")).not.toThrow();
  });
});
