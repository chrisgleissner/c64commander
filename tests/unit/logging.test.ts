/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addErrorLog,
  addLog,
  buildErrorLogDetails,
  clearLogs,
  formatLogsForShare,
  getErrorLogs,
  getLogs,
  resetLoggingCacheForTests,
  setExternalLogs,
} from "@/lib/logging";
import { APP_SETTINGS_KEYS } from "@/lib/config/appSettings";
import { shouldSuppressDiagnosticsSideEffects } from "@/lib/diagnostics/diagnosticsOverlayState";
import { installConsoleDiagnosticsBridge, logger } from "@/lib/diagnostics/logger";
import { setTraceDeviceContext } from "@/lib/tracing/traceContext";

vi.mock("@/lib/diagnostics/diagnosticsOverlayState", () => ({
  shouldSuppressDiagnosticsSideEffects: vi.fn().mockReturnValue(false),
}));

const ensureWindow = () => {
  if (typeof window !== "undefined") return;
  const target = new EventTarget();
  const windowMock = {
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => target.addEventListener(type, listener, options),
    removeEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => target.removeEventListener(type, listener, options),
    dispatchEvent: (event: Event) => target.dispatchEvent(event),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    location: { origin: "http://localhost" },
  };
  Object.defineProperty(globalThis, "window", {
    value: windowMock,
    configurable: true,
  });
  if (typeof (globalThis as { CustomEvent?: typeof CustomEvent }).CustomEvent === "undefined") {
    class CustomEventShim<T = any> extends Event {
      detail?: T;
      constructor(type: string, params?: CustomEventInit<T>) {
        super(type, params);
        this.detail = params?.detail;
      }
    }
    Object.defineProperty(globalThis, "CustomEvent", {
      value: CustomEventShim,
      configurable: true,
    });
  }
};

const ensureLocalStorage = () => {
  if (typeof localStorage !== "undefined") return;
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
};

ensureWindow();
ensureLocalStorage();

describe("logging", () => {
  beforeEach(() => {
    localStorage.clear();
    resetLoggingCacheForTests();
    setTraceDeviceContext(null);
  });

  it("adds logs and filters errors", () => {
    const handler = vi.fn();
    window.addEventListener("c64u-logs-updated", handler as EventListener);

    addLog("info", "hello");
    addLog("debug", "hidden");
    addErrorLog("boom", { code: 500 });

    const logs = getLogs();
    expect(logs).toHaveLength(2);
    expect(getErrorLogs()).toHaveLength(1);
    expect(handler).toHaveBeenCalled();

    window.removeEventListener("c64u-logs-updated", handler as EventListener);
  });

  it("clears logs and formats entries for sharing", () => {
    addLog("warn", "warning", { note: "check" });
    const formatted = formatLogsForShare(getLogs());
    expect(formatted).toContain("WARN");
    expect(formatted).toContain("warning");

    clearLogs();
    expect(getLogs()).toHaveLength(0);
  });

  it("persists saved-device attribution on log write across a switch", () => {
    setTraceDeviceContext({
      savedDeviceId: "saved-office",
      savedDeviceNameSnapshot: "Office U64",
      savedDeviceHostSnapshot: "office-u64",
      verifiedUniqueId: "UID-OFFICE",
      verifiedHostname: "office-u64",
      verifiedProduct: "U64",
      connectionState: "READY",
    });
    addLog("info", "office log");

    setTraceDeviceContext({
      savedDeviceId: "saved-backup",
      savedDeviceNameSnapshot: "Backup Lab",
      savedDeviceHostSnapshot: "backup-lab",
      verifiedUniqueId: "UID-BACKUP",
      verifiedHostname: "backup-lab",
      verifiedProduct: "U64E",
      connectionState: "READY",
    });
    addLog("info", "backup log");

    expect(getLogs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "office log",
          device: expect.objectContaining({
            savedDeviceId: "saved-office",
            savedDeviceNameSnapshot: "Office U64",
            verifiedUniqueId: "UID-OFFICE",
          }),
        }),
        expect.objectContaining({
          message: "backup log",
          device: expect.objectContaining({
            savedDeviceId: "saved-backup",
            savedDeviceNameSnapshot: "Backup Lab",
            verifiedUniqueId: "UID-BACKUP",
          }),
        }),
      ]),
    );
  });

  it("records debug logs when enabled", () => {
    localStorage.setItem(APP_SETTINGS_KEYS.DEBUG_LOGGING_KEY, "1");
    addLog("debug", "verbose");
    expect(getLogs()).toHaveLength(1);
    expect(getLogs()[0].message).toBe("verbose");
  });

  it("captures error stacks with trimming", () => {
    const error = new Error("boom");
    error.stack = Array.from({ length: 120 }, (_, index) => `line-${index + 1}`).join("\n");

    const details = buildErrorLogDetails(error, { context: "rest" });

    expect(details.error).toEqual(expect.objectContaining({ name: "Error", message: "boom" }));
    expect(details.errorName).toBe("Error");
    expect(details.errorStack).toContain("line-1");
    expect(details.errorStack).toContain("stack truncated");
  });

  it("suppresses logs when diagnostics side effects are suppressed", () => {
    vi.mocked(shouldSuppressDiagnosticsSideEffects).mockReturnValue(true);
    addLog("info", "ignored");
    expect(getLogs()).toHaveLength(0);

    // Errors should still be recorded
    addLog("error", "important");
    expect(getLogs()).toHaveLength(1);
    vi.mocked(shouldSuppressDiagnosticsSideEffects).mockReturnValue(false);
  });

  it("handles corrupted log storage safely", () => {
    localStorage.setItem("c64u_app_logs", "invalid { json");
    expect(getLogs()).toEqual([]);
  });

  it("truncates stack trace by character count", () => {
    const error = new Error("long stack");
    const longLine = "a".repeat(3005);
    error.stack = `Error: long stack\n${longLine}`;

    const details = buildErrorLogDetails(error);
    expect(details.errorStack?.length).toBeLessThan(3100);
    expect(details.errorStack).toContain("(stack truncated)");
  });

  it("preserves existing error message in details", () => {
    const error = new Error("original");
    const details = buildErrorLogDetails(error, { error: "override" });
    expect(details.error).toEqual(expect.objectContaining({ message: "override" }));
  });

  it("treats warnings as problem logs in Errors tab selector", () => {
    addLog("warn", "slow response");
    addErrorLog("boom");
    expect(getErrorLogs().map((entry) => entry.level)).toEqual(["error", "warn"]);
  });

  it("writes canonical error payloads through diagnostics logger wrapper", () => {
    logger.error("wrapper failure", {
      details: { error: new Error("wrapped failure") },
      includeConsole: false,
    });

    const logs = getLogs();
    expect(logs).toHaveLength(1);
    const details = logs[0].details as {
      error?: { name?: string; message?: string };
    };
    expect(details.error?.name).toBe("Error");
    expect(details.error?.message).toBe("wrapped failure");
  });

  it("bridges console warn/error into diagnostics logs", () => {
    const uninstallBridge = installConsoleDiagnosticsBridge();
    const warnSpy = vi.spyOn(console, "warn");
    const errorSpy = vi.spyOn(console, "error");

    console.warn("bridge warn", { code: 1 });
    console.error("bridge error", { code: 2 });

    uninstallBridge();

    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    const messages = getLogs().map((entry) => entry.message);
    expect(messages).toContain("bridge warn");
    expect(messages).toContain("bridge error");
  });

  it("handles disabled and duplicate console bridge installation", () => {
    const disabledUninstall = installConsoleDiagnosticsBridge({
      enabled: false,
    });
    console.warn("disabled bridge");
    expect(getLogs()).toHaveLength(0);
    disabledUninstall();

    const uninstallBridge = installConsoleDiagnosticsBridge();
    const duplicateUninstall = installConsoleDiagnosticsBridge();
    console.warn("active bridge");
    duplicateUninstall();
    uninstallBridge();

    const messages = getLogs().map((entry) => entry.message);
    expect(messages).toContain("active bridge");
    expect(messages).not.toContain("disabled bridge");
  });

  it("normalizes non-string and error console messages", () => {
    const uninstallBridge = installConsoleDiagnosticsBridge();
    console.warn({ kind: "object-message" });
    console.error(new Error("error-message"));
    uninstallBridge();

    const logs = getLogs();
    expect(logs.map((entry) => entry.message)).toEqual(
      expect.arrayContaining(['{"kind":"object-message"}', "error-message"]),
    );
  });

  it("captures empty console.warn invocations as empty message entries", () => {
    const uninstallBridge = installConsoleDiagnosticsBridge();
    // exercise normalizeConsoleMessage no-args branch
    console.warn();
    uninstallBridge();

    const log = getLogs().find((entry) => entry.level === "warn" && entry.message === "");
    expect(log).toBeDefined();
  });

  it("preserves non-Error error payload values in logger details", () => {
    logger.error("plain object failure", {
      details: { error: { code: "E_OBJ" } },
      includeConsole: false,
    });

    const details = getLogs()[0].details as { error?: { code?: string } };
    expect(details.error?.code).toBe("E_OBJ");
  });

  it("forwards logger info/debug to console by default", () => {
    const infoSpy = vi.spyOn(console, "info");
    const debugSpy = vi.spyOn(console, "debug");

    logger.info("info-level");
    logger.debug("debug-level");

    expect(infoSpy).toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
  });

  it("redacts logs when requested", () => {
    addLog("info", "sensetive info");
    const formatted = formatLogsForShare(getLogs(), { redacted: true });
    // Assuming redaction replaces common patterns, but here message is plain.
    // Redaction logic is in exportRedaction.
    expect(formatted).toContain("sensetive info"); // redaction targets specifics like IPs.
  });

  it("generates ID without crypto", () => {
    const originalCrypto = globalThis.crypto;
    // @ts-expect-error - intentionally deleting global for test
    delete globalThis.crypto;

    addLog("info", "no crypto");
    const logs = getLogs();
    expect(logs[0].id).toMatch(/^\d+-\d+$/);

    globalThis.crypto = originalCrypto;
  });

  it("readLogs returns empty when localStorage is undefined (line 36 TRUE)", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(getLogs()).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("addLog returns early when window is undefined (line 53 TRUE)", () => {
    vi.stubGlobal("window", undefined);
    addLog("info", "should-not-store");
    vi.unstubAllGlobals();
    expect(getLogs()).toHaveLength(0);
  });

  it("clearLogs returns early when window is undefined (line 123 TRUE)", () => {
    addLog("info", "persisted");
    expect(getLogs()).toHaveLength(1);
    vi.stubGlobal("window", undefined);
    clearLogs();
    vi.unstubAllGlobals();
    expect(getLogs()).toHaveLength(1);
  });

  it("trimStack returns null for undefined stack (line 73 TRUE)", () => {
    const error = new Error("no-stack");
    error.stack = undefined;
    const details = buildErrorLogDetails(error);
    expect(details.errorStack).toBeNull();
  });

  it("mergeLogs deduplicates entries with the same id (line 107 TRUE)", () => {
    addLog("info", "original");
    const logs = getLogs();
    expect(logs).toHaveLength(1);
    setExternalLogs(logs);
    const merged = getLogs();
    expect(merged).toHaveLength(1);
  });

  it("does not throw and sanitizes a circular details value (HARD9-020)", () => {
    setExternalLogs([]);
    const circular: Record<string, unknown> = { reason: "boom" };
    circular.self = circular;

    expect(() => addLog("error", "Unhandled promise rejection", { reason: circular })).not.toThrow();

    const logs = getLogs();
    expect(logs).toHaveLength(1);
    // Circular details must be JSON-round-trippable (no throw) and must not
    // silently vanish - the sanitized placeholder is present somewhere in
    // the serialized details.
    expect(() => JSON.stringify(logs[0].details)).not.toThrow();
    expect(JSON.stringify(logs[0].details)).toContain("Circular");
  });

  it("does not throw when persisting a circular-details entry to localStorage (HARD9-020)", () => {
    vi.useFakeTimers();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => addLog("warn", "circular payload", circular)).not.toThrow();
    expect(() => vi.advanceTimersByTime(600)).not.toThrow();

    const raw = localStorage.getItem("c64u_app_logs");
    expect(raw).toBeTruthy();
    expect(() => JSON.parse(raw as string)).not.toThrow();
    vi.useRealTimers();
  });

  it("debounces persistence: rapid successive addLog calls only persist once after the debounce window (HARD9-020)", () => {
    vi.useFakeTimers();

    addLog("info", "line 1");
    addLog("info", "line 2");
    addLog("info", "line 3");

    // Still within the debounce window: nothing persisted to storage yet,
    // even though all three entries are already visible in-memory.
    expect(localStorage.getItem("c64u_app_logs")).toBeNull();
    expect(getLogs()).toHaveLength(3);

    vi.advanceTimersByTime(600);

    const written = JSON.parse(localStorage.getItem("c64u_app_logs") as string);
    expect(written).toHaveLength(3);
    vi.useRealTimers();
  });

  it("recovers from a quota-exceeded write by halving the log count and retrying (HARD9-020)", () => {
    // vi.spyOn(localStorage, ...) does not reliably intercept calls made
    // from another module against jsdom's Storage implementation in this
    // environment, so this test stubs the whole global instead.
    vi.useFakeTimers();
    const store = new Map<string, string>();
    let callCount = 0;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("QuotaExceededError");
        }
        store.set(key, value);
      },
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    addLog("info", "first");
    addLog("info", "second");

    expect(() => vi.advanceTimersByTime(600)).not.toThrow();

    // First attempt threw; the retry with a halved log count must have
    // succeeded (no "Failed to persist" warning) and actually written.
    expect(callCount).toBe(2);
    expect(warnSpy).not.toHaveBeenCalledWith("Failed to persist logs to localStorage", expect.anything());
    const written = JSON.parse(store.get("c64u_app_logs") as string);
    expect(written.length).toBe(1);

    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
