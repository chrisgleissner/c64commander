import { beforeEach, describe, expect, it } from "vitest";
import { reportFallback } from "@/lib/diagnostics/fallbackReporter";
import { addLog, clearLogs, getLogs, resetLoggingCacheForTests } from "@/lib/logging";

// `fallbackReporter` imports nothing, so `savedDevices/host.ts` can call it without closing an
// import cycle back through `logging`. The cost of that is a sink `logging` has to register on
// import, and nothing else in the app would notice if that registration were dropped. This file
// holds it. It installs no sink of its own and never resets the reporter, so the only thing that
// can put an entry in the log is the wiring under test.
describe("the logging module wires the fallback sink", () => {
  beforeEach(() => {
    resetLoggingCacheForTests();
    clearLogs();
  });

  it("turns a reported fallback into a warn-level diagnostics entry", () => {
    addLog("info", "anchor");
    reportFallback("wiring.check", "abcd", { fallbackHost: "c64u" });

    const entry = getLogs().find((log) => log.message.includes("wiring.check"));
    expect(entry).toBeDefined();
    expect(entry?.level).toBe("warn");
    expect(entry?.details).toMatchObject({
      site: "wiring.check",
      valueShape: "string(length=4)",
      fallbackHost: "c64u",
    });
  });
});
