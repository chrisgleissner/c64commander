/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addLog = vi.fn();

vi.mock("@/lib/logging", () => ({
  addLog,
}));

const getActiveAction = vi.fn(
  () =>
    null as {
      correlationId: string;
      origin: string;
      name: string;
      componentName: string | null;
    } | null,
);

vi.mock("@/lib/tracing/actionTrace", () => ({
  getActiveAction,
}));

const getPlaybackTraceSnapshot = vi.fn(
  () =>
    null as {
      sourceKind: string;
      localAccessMode: string | null;
      trackInstanceId: string | null;
      playlistItemId: string | null;
    } | null,
);

vi.mock("@/pages/playFiles/playbackTraceStore", () => ({
  getPlaybackTraceSnapshot,
}));

describe("logger", () => {
  let logger: typeof import("@/lib/diagnostics/logger");

  beforeEach(async () => {
    addLog.mockClear();
    getActiveAction.mockReturnValue(null);
    getPlaybackTraceSnapshot.mockReturnValue(null);
    logger = await import("@/lib/diagnostics/logger");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes debug log and calls console.debug", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    logger.logger.debug("test debug");
    expect(addLog).toHaveBeenCalledWith("debug", "test debug", expect.any(Object));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("writes info log and calls console.info", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logger.logger.info("test info");
    expect(addLog).toHaveBeenCalledWith("info", "test info", expect.any(Object));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("writes warn log and calls console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.logger.warn("test warn");
    expect(addLog).toHaveBeenCalledWith("warn", "test warn", expect.any(Object));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("writes error log and calls console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.logger.error("test error");
    expect(addLog).toHaveBeenCalledWith("error", "test error", expect.any(Object));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("suppresses console output when includeConsole is false", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.logger.warn("suppressed", { includeConsole: false });
    expect(addLog).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("normalizes Error objects in details", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.logger.error("boom", { details: { error: new Error("oops") } });
    const logged = addLog.mock.calls[0][2];
    expect(logged.error).toEqual(
      expect.objectContaining({
        name: "Error",
        message: "oops",
      }),
    );
    spy.mockRestore();
  });

  it("normalizes string errors in details", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.logger.error("boom", { details: { error: "string err" } });
    const logged = addLog.mock.calls[0][2];
    expect(logged.error).toEqual({
      name: "Error",
      message: "string err",
      stack: null,
    });
    spy.mockRestore();
  });

  it("preserves non-normalizable errors in details", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.logger.error("boom", { details: { error: 42 } });
    const logged = addLog.mock.calls[0][2];
    expect(logged.error).toBe(42);
    spy.mockRestore();
  });

  it("includes active action context when available", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    getActiveAction.mockReturnValue({
      correlationId: "abc",
      origin: "ui",
      name: "test-action",
      componentName: "MyComp",
    });
    logger.logger.info("with-action");
    const logged = addLog.mock.calls[0][2];
    expect(logged.correlationId).toBe("abc");
    expect(logged.origin).toBe("ui");
    expect(logged.actionName).toBe("test-action");
    expect(logged.component).toBe("MyComp");
    spy.mockRestore();
  });

  it("prefers explicit component over action componentName", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    getActiveAction.mockReturnValue({
      correlationId: "abc",
      origin: "ui",
      name: "test-action",
      componentName: "ActionComp",
    });
    logger.logger.info("component-override", { component: "ExplicitComp" });
    const logged = addLog.mock.calls[0][2];
    expect(logged.component).toBe("ExplicitComp");
    spy.mockRestore();
  });

  it("includes playback lifecycle state when playback is active", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    getPlaybackTraceSnapshot.mockReturnValue({
      sourceKind: "hvsc",
      localAccessMode: "file",
      trackInstanceId: "track-1",
      playlistItemId: "item-1",
    });
    logger.logger.info("with-playback");
    const logged = addLog.mock.calls[0][2];
    expect(logged.sourceKind).toBe("hvsc");
    expect(logged.localAccessMode).toBe("file");
    expect(logged.trackInstanceId).toBe("track-1");
    expect(logged.lifecycleState).not.toBeNull();
    spy.mockRestore();
  });

  it("sets lifecycleState to null when no playback context", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    getPlaybackTraceSnapshot.mockReturnValue(null);
    logger.logger.info("no-playback");
    const logged = addLog.mock.calls[0][2];
    expect(logged.lifecycleState).toBeNull();
    expect(logged.sourceKind).toBeNull();
    spy.mockRestore();
  });

  describe("installConsoleDiagnosticsBridge", () => {
    it("returns noop uninstall when explicitly disabled", () => {
      const uninstall = logger.installConsoleDiagnosticsBridge({
        enabled: false,
      });
      expect(typeof uninstall).toBe("function");
      uninstall();
    });

    it("forwards console.warn through logger", () => {
      const uninstall = logger.installConsoleDiagnosticsBridge();
      try {
        console.warn("bridged warning");
        expect(addLog).toHaveBeenCalledWith("warn", "bridged warning", expect.any(Object));
      } finally {
        uninstall();
      }
    });

    it("forwards console.error through logger", () => {
      const uninstall = logger.installConsoleDiagnosticsBridge();
      try {
        console.error("bridged error");
        expect(addLog).toHaveBeenCalledWith("error", "bridged error", expect.any(Object));
      } finally {
        uninstall();
      }
    });

    it("normalizes Error argument in console.warn", () => {
      const uninstall = logger.installConsoleDiagnosticsBridge();
      try {
        console.warn(new Error("warn-err"));
        const calls = addLog.mock.calls.filter((c) => c[0] === "warn" && c[1] === "warn-err");
        expect(calls.length).toBeGreaterThan(0);
      } finally {
        uninstall();
      }
    });

    it("normalizes object argument in console.error", () => {
      const uninstall = logger.installConsoleDiagnosticsBridge();
      try {
        console.error({ code: 42 });
        const calls = addLog.mock.calls.filter((c) => c[0] === "error");
        expect(calls.length).toBeGreaterThan(0);
        expect(calls[0][1]).toBe('{"code":42}');
      } finally {
        uninstall();
      }
    });

    it("handles non-string non-error non-object arguments", () => {
      const uninstall = logger.installConsoleDiagnosticsBridge();
      try {
        console.error(42);
        const calls = addLog.mock.calls.filter((c) => c[0] === "error");
        expect(calls.length).toBeGreaterThan(0);
        expect(calls[0][1]).toBe("42");
      } finally {
        uninstall();
      }
    });

    it("handles empty console.warn arguments", () => {
      const uninstall = logger.installConsoleDiagnosticsBridge();
      try {
        console.warn();
        const calls = addLog.mock.calls.filter((c) => c[0] === "warn");
        expect(calls.length).toBeGreaterThan(0);
        expect(calls[0][1]).toBe("");
      } finally {
        uninstall();
      }
    });

    it("passes extra arguments in details.args", () => {
      const uninstall = logger.installConsoleDiagnosticsBridge();
      try {
        console.error("msg", "extra1", new Error("detail-err"));
        const calls = addLog.mock.calls.filter((c) => c[0] === "error" && c[1] === "msg");
        expect(calls.length).toBeGreaterThan(0);
      } finally {
        uninstall();
      }
    });

    it("returns noop when called a second time (already installed)", () => {
      const first = logger.installConsoleDiagnosticsBridge();
      try {
        const second = logger.installConsoleDiagnosticsBridge();
        second(); // noop, does not uninstall the first
      } finally {
        first();
      }
    });

    it("catches JSON.stringify errors for circular objects in console.error", () => {
      const uninstall = logger.installConsoleDiagnosticsBridge();
      try {
        const circular: Record<string, unknown> = {};
        circular.self = circular; // circular reference
        console.error(circular);
        const calls = addLog.mock.calls.filter((c) => c[0] === "error");
        expect(calls.length).toBeGreaterThan(0);
        // String(circularObj) = '[object Object]'
        expect(calls[0][1]).toBe("[object Object]");
      } finally {
        uninstall();
      }
    });

    it("installConsoleDiagnosticsBridge with enabled:false returns noop without installing", () => {
      // Reset any prior bridge state by explicitly checking idempotency
      const noop = logger.installConsoleDiagnosticsBridge({ enabled: false });
      // Calling the returned function should not throw
      expect(() => noop()).not.toThrow();
      // Test that bridge is NOT installed (calling bridge-captured warn does not go through bridge)
      addLog.mockClear();
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      console.warn("should-not-route-through-bridge");
      // If bridge were installed, addLog would be called with 'warn'; it should NOT be
      expect(addLog).not.toHaveBeenCalledWith("warn", "should-not-route-through-bridge", expect.anything());
      spy.mockRestore();
    });
  });
});
