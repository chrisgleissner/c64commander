/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildKeyInputDetails,
  emitKeyInputDiagnostics,
  resolveKeyFamily,
  type KeyInputRawEvent,
} from "@/lib/diagnostics/keyInputDiagnostics";
import { saveDebugLoggingEnabled } from "@/lib/config/appSettings";
import { clearLogs, getLogs } from "@/lib/logging";
import { redactExportValue } from "@/lib/diagnostics/exportRedaction";

const raw = (overrides: Partial<KeyInputRawEvent>): KeyInputRawEvent => ({
  type: "keydown",
  key: "",
  code: "",
  keyCode: 0,
  ...overrides,
});

describe("resolveKeyFamily", () => {
  it("classifies physical keys (numpad digits distinct from top-row)", () => {
    expect(resolveKeyFamily(raw({ code: "Digit5", key: "5" }), "digit5")).toBe("digit");
    expect(resolveKeyFamily(raw({ code: "Numpad5", key: "5" }), "digit5")).toBe("numpad-digit");
    expect(resolveKeyFamily(raw({ code: "ArrowDown", key: "ArrowDown" }), "dpadDown")).toBe("dpad");
    expect(resolveKeyFamily(raw({ code: "DpadCenter" }), "center")).toBe("dpad");
    expect(resolveKeyFamily(raw({ code: "Enter", key: "Enter" }), "enter")).toBe("enter");
    expect(resolveKeyFamily(raw({ code: "Backspace", key: "Backspace" }), "delete")).toBe("delete");
    expect(resolveKeyFamily(raw({ code: "NumpadMultiply", key: "*" }), "star")).toBe("star");
    expect(resolveKeyFamily(raw({ key: "#" }), "hash")).toBe("hash");
    expect(resolveKeyFamily(raw({ code: "ShiftLeft", key: "Shift" }), null)).toBe("modifier");
    expect(resolveKeyFamily(raw({ code: "KeyQ", key: "q" }), null)).toBe("unknown");
  });
});

describe("buildKeyInputDetails", () => {
  it("carries the raw + normalized fields, keyFamily, and an ignoredReason when unhandled", () => {
    const details = buildKeyInputDetails({
      rawEvent: raw({ code: "KeyZ", key: "z", keyCode: 90, which: 90, location: 0 }),
      normalizedAction: null,
      handled: false,
      ignoredReason: "no-binding",
      preventDefaultApplied: false,
      keypadEnabled: true,
      modality: "key-navigation",
      selectedControlId: "cta-1",
    });

    expect(details).toMatchObject({
      category: "key-input",
      normalizedAction: null,
      keyFamily: "unknown",
      handled: false,
      ignoredReason: "no-binding",
      preventDefaultApplied: false,
      keypadEnabled: true,
      modality: "key-navigation",
      selectedControlId: "cta-1",
    });
    expect(details.rawEvent).toMatchObject({ key: "z", code: "KeyZ", keyCode: 90 });
    expect(typeof details.timestamp).toBe("number");
  });

  it("includes lengths-only t9State and never raw text", () => {
    const details = buildKeyInputDetails({
      rawEvent: raw({ code: "Digit2", key: "2" }),
      normalizedAction: "digit2",
      handled: true,
      preventDefaultApplied: true,
      keypadEnabled: true,
      modality: "key-navigation",
      t9State: {
        active: true,
        mode: "multitap",
        pendingLength: 1,
        candidateIndex: 0,
        candidateCount: 4,
        committedLength: 7,
      },
    });

    expect(details.t9State).toEqual({
      active: true,
      mode: "multitap",
      pendingLength: 1,
      candidateIndex: 0,
      candidateCount: 4,
      committedLength: 7,
    });
    // No ignoredReason when handled.
    expect(details.ignoredReason).toBeUndefined();
    // The whole serialized payload contains only counts — no secret-like values.
    expect(JSON.stringify(details)).not.toMatch(/192\.168/);
  });

  it("redacts the key identity but keeps keyFamily when redactKeyIdentity is set", () => {
    const details = buildKeyInputDetails({
      rawEvent: raw({ code: "Digit9", key: "9", keyCode: 57, which: 57, location: 0 }),
      normalizedAction: "digit9",
      handled: true,
      preventDefaultApplied: true,
      keypadEnabled: true,
      modality: "key-navigation",
      redactKeyIdentity: true,
      t9State: {
        active: true,
        mode: "hostname",
        pendingLength: 0,
        candidateIndex: -1,
        candidateCount: 0,
        committedLength: 2,
      },
    });

    // The typed digit must not be reconstructable from the raw event or action…
    expect(details.normalizedAction).toBeNull();
    expect(details.rawEvent).toMatchObject({ key: null, code: null, keyCode: null, which: null });
    // …but the hardware family is retained for calibration grouping.
    expect(details.keyFamily).toBe("digit");
    // Non-identifying structural fields are preserved.
    expect(details.rawEvent).toMatchObject({ type: "keydown", repeat: false });
  });

  it("redacts host-bearing values by key name on export", () => {
    const details = buildKeyInputDetails({
      rawEvent: raw({ code: "Digit1", key: "1" }),
      normalizedAction: "digit1",
      handled: true,
      preventDefaultApplied: true,
      keypadEnabled: true,
      modality: "key-navigation",
    });
    // Simulate a hypothetical host-bearing field nested in details — the recursive
    // export redactor must sanitize it by key name.
    const withHost = { ...details, activeElement: { hostname: "192.168.1.50" } };
    const redacted = redactExportValue(withHost) as { activeElement: { hostname: string } };
    expect(redacted.activeElement.hostname).not.toContain("192.168");
  });
});

describe("emitKeyInputDiagnostics — gating", () => {
  beforeEach(() => clearLogs());
  afterEach(() => {
    saveDebugLoggingEnabled(false);
    clearLogs();
  });

  const params = {
    rawEvent: raw({ code: "ArrowDown", key: "ArrowDown" }),
    normalizedAction: "dpadDown" as const,
    handled: true,
    preventDefaultApplied: true,
    keypadEnabled: true,
    modality: "key-navigation" as const,
  };

  it("does NOT emit when debug logging is off", () => {
    saveDebugLoggingEnabled(false);
    emitKeyInputDiagnostics(params);
    expect(getLogs().some((entry) => entry.message === "key-input")).toBe(false);
  });

  it("emits a debug key-input entry when debug logging is on", () => {
    saveDebugLoggingEnabled(true);
    emitKeyInputDiagnostics(params);
    const entry = getLogs().find((log) => log.message === "key-input");
    expect(entry).toBeDefined();
    expect(entry?.level).toBe("debug");
    expect(entry?.details).toMatchObject({ normalizedAction: "dpadDown", keyFamily: "dpad", handled: true });
  });
});
