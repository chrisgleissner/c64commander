/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { buildActionSummaries } from "@/lib/diagnostics/actionSummaries";
import type { TraceEvent } from "@/lib/tracing/types";

const buildTrace = (
  overrides: Partial<TraceEvent> & Pick<TraceEvent, "id" | "type" | "correlationId">,
): TraceEvent => ({
  id: overrides.id,
  timestamp: overrides.timestamp ?? "2024-01-01T00:00:00.000Z",
  relativeMs: overrides.relativeMs ?? 0,
  type: overrides.type,
  origin: overrides.origin ?? "user",
  correlationId: overrides.correlationId,
  data: overrides.data ?? {},
});

describe("buildActionSummaries", () => {
  it("derives summaries with origin mapping, effects, and error counts", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "EVT-0000",
        type: "action-start",
        correlationId: "COR-0001",
        relativeMs: 0,
        data: { name: "playback.start" },
      }),
      buildTrace({
        id: "EVT-0001",
        type: "rest-request",
        correlationId: "COR-0001",
        relativeMs: 100,
        data: {
          method: "GET",
          url: "http://device/v1/info",
          normalizedUrl: "/v1/info",
          headers: { accept: "application/json" },
          body: null,
          payloadPreview: null,
          target: "real-device",
        },
      }),
      buildTrace({
        id: "EVT-0002",
        type: "rest-response",
        correlationId: "COR-0001",
        relativeMs: 150,
        data: {
          status: 200,
          headers: { "content-type": "application/json" },
          body: {},
          payloadPreview: { byteCount: 2, previewByteCount: 2, hex: "7b 7d", ascii: "{}", truncated: false },
          durationMs: 50,
          error: null,
        },
      }),
      buildTrace({
        id: "EVT-0003",
        type: "ftp-operation",
        correlationId: "COR-0001",
        relativeMs: 200,
        data: {
          operation: "list",
          path: "/SIDS",
          result: "failure",
          error: "Denied",
          target: "real-device",
        },
      }),
      buildTrace({
        id: "EVT-0004",
        type: "error",
        correlationId: "COR-0001",
        relativeMs: 210,
        data: { message: "FTP failed", name: "Error" },
      }),
      buildTrace({
        id: "EVT-0005",
        type: "action-end",
        correlationId: "COR-0001",
        relativeMs: 300,
        data: { status: "error", error: "FTP failed" },
      }),
      buildTrace({
        id: "EVT-0006",
        type: "action-start",
        correlationId: "COR-0002",
        relativeMs: 400,
        origin: "automatic",
        data: { name: "background.refresh" },
      }),
      buildTrace({
        id: "EVT-0007",
        type: "rest-request",
        correlationId: "COR-0002",
        relativeMs: 420,
        origin: "automatic",
        data: {
          method: "POST",
          url: "http://device/v1/configs",
          normalizedUrl: "/v1/configs",
          headers: {},
          body: { foo: "bar" },
          target: "real-device",
        },
      }),
    ];

    const summaries = buildActionSummaries(traces);
    expect(summaries).toHaveLength(2);

    const first = summaries[0];
    expect(first.correlationId).toBe("COR-0001");
    expect(first.origin).toBe("user");
    expect(first.originalOrigin).toBeUndefined();
    expect(first.durationMs).toBeGreaterThanOrEqual(0);
    expect(first.durationMsMissing).toBeUndefined();
    expect(first.restCount).toBe(1);
    expect(first.ftpCount).toBe(1);
    expect(first.errorCount).toBe(1);
    expect(first.outcome).toBe("error");

    const restEffect = first.effects.find((effect) => effect.type === "REST");
    expect(restEffect).toBeDefined();
    expect(restEffect && "method" in restEffect ? restEffect.method : "").toBe("GET");
    expect(restEffect && "path" in restEffect ? restEffect.path : "").toBe("/v1/info");
    expect(restEffect && "requestHeaders" in restEffect ? restEffect.requestHeaders : undefined).toEqual({
      accept: "application/json",
    });

    const ftpEffect = first.effects.find((effect) => effect.type === "FTP");
    expect(ftpEffect).toBeDefined();
    expect(ftpEffect && "operation" in ftpEffect ? ftpEffect.operation : "").toBe("list");

    const second = summaries[1];
    expect(second.correlationId).toBe("COR-0002");
    expect(second.origin).toBe("system");
    expect(second.originalOrigin).toBe("automatic");
    expect(second.durationMs).toBeGreaterThanOrEqual(0);
    expect(second.durationMsMissing).toBeUndefined();
    expect(second.outcome).toBe("incomplete");
    expect(second.restCount).toBe(1);
    expect(second.ftpCount).toBeUndefined();
    expect(second.errorCount).toBeUndefined();
  });

  it("resolves success outcome", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    expect(summary.outcome).toBe("success");
    expect(summary.errorCount).toBeUndefined();
  });

  it("resolves blocked outcome", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "blocked" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    expect(summary.outcome).toBe("blocked");
  });

  it("resolves timeout outcome", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "timeout" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    expect(summary.outcome).toBe("timeout");
  });

  it("uses fallback action name when actionStart has no name", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "COR-ANON",
        relativeMs: 0,
        data: {},
      }),
      buildTrace({
        id: "E2",
        type: "action-end",
        correlationId: "COR-ANON",
        relativeMs: 100,
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    expect(summary.actionName).toBe("Action COR-ANON");
  });

  it("handles error status with no error events as errorCount 1", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "error", error: "bad" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    expect(summary.errorCount).toBe(1);
    expect(summary.errorMessage).toBe("bad");
  });

  it("includes action-end error effect when distinct from error events", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "error",
        correlationId: "C1",
        relativeMs: 50,
        data: { message: "network timeout" },
      }),
      buildTrace({
        id: "E3",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "error", error: "request failed" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const errorEffects = (summary.effects ?? []).filter((effect) => effect.type === "ERROR");
    expect(errorEffects).toHaveLength(2);
    expect(errorEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "error", message: "network timeout" }),
        expect.objectContaining({
          label: "action-end error",
          message: "request failed",
        }),
      ]),
    );
    expect(summary.errorCount).toBe(2);
    expect(summary.errorMessage).toBe("request failed");
  });

  it("handles REST response without matching request", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "rest-response",
        correlationId: "C1",
        relativeMs: 50,
        data: { status: 200, durationMs: 50 },
      }),
      buildTrace({
        id: "E3",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    expect(summary.effects).toBeUndefined();
  });

  it("handles non-string error coercion in REST response", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "rest-request",
        correlationId: "C1",
        relativeMs: 10,
        data: { method: "GET", url: "/api", target: "real-device" },
      }),
      buildTrace({
        id: "E3",
        type: "rest-response",
        correlationId: "C1",
        relativeMs: 50,
        data: { status: 500, error: 42, durationMs: 40 },
      }),
      buildTrace({
        id: "E4",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "error" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const restEffect = summary.effects?.find((e) => e.type === "REST");
    expect(restEffect && "error" in restEffect ? restEffect.error : undefined).toBe("42");
  });

  it("sorts by startRelativeMs then by correlationId", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C-BBB",
        relativeMs: 100,
        data: { name: "b" },
      }),
      buildTrace({
        id: "E2",
        type: "action-end",
        correlationId: "C-BBB",
        relativeMs: 200,
        data: { status: "success" },
      }),
      buildTrace({
        id: "E3",
        type: "action-start",
        correlationId: "C-AAA",
        relativeMs: 100,
        data: { name: "a" },
      }),
      buildTrace({
        id: "E4",
        type: "action-end",
        correlationId: "C-AAA",
        relativeMs: 200,
        data: { status: "success" },
      }),
    ];
    const summaries = buildActionSummaries(traces);
    expect(summaries[0].correlationId).toBe("C-AAA");
    expect(summaries[1].correlationId).toBe("C-BBB");
  });

  it("marks durationMsMissing when timestamps are invalid", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: NaN,
        timestamp: "bad",
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "action-end",
        correlationId: "C1",
        relativeMs: NaN,
        timestamp: "bad",
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    expect(summary.durationMsMissing).toBe(true);
    expect(summary.durationMs).toBeNull();
  });

  it("handles unmatched pending REST requests", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "rest-request",
        correlationId: "C1",
        relativeMs: 10,
        data: {
          method: "POST",
          normalizedUrl: "/api/fire",
          target: "real-device",
        },
      }),
      buildTrace({
        id: "E3",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "error", error: "timeout" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    expect(summary.restCount).toBe(1);
    const restEffect = summary.effects?.find((e) => e.type === "REST");
    expect(restEffect && "error" in restEffect ? restEffect.error : undefined).toBe("timeout");
    expect(restEffect && "durationMs" in restEffect ? restEffect.durationMs : undefined).toBeNull();
  });

  it("includes deterministic label on REST effects", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "rest-request",
        correlationId: "C1",
        relativeMs: 10,
        data: {
          method: "GET",
          normalizedUrl: "/v1/info",
          target: "real-device",
        },
      }),
      buildTrace({
        id: "E3",
        type: "rest-response",
        correlationId: "C1",
        relativeMs: 50,
        data: { status: 200, durationMs: 40, error: null },
      }),
      buildTrace({
        id: "E4",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const restEffect = summary.effects?.find((e) => e.type === "REST");
    expect(restEffect?.label).toBe("GET /v1/info");
  });

  it("includes deterministic label on FTP effects", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "ftp-operation",
        correlationId: "C1",
        relativeMs: 20,
        data: {
          operation: "list",
          path: "/SIDS",
          result: "success",
          error: null,
          target: "real-device",
        },
      }),
      buildTrace({
        id: "E3",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const ftpEffect = summary.effects?.find((e) => e.type === "FTP");
    expect(ftpEffect?.label).toBe("list /SIDS");
  });

  it("preserves null status (no-response) in REST effect", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "rest-request",
        correlationId: "C1",
        relativeMs: 10,
        data: {
          method: "GET",
          normalizedUrl: "/v1/info",
          target: "real-device",
        },
      }),
      buildTrace({
        id: "E3",
        type: "rest-response",
        correlationId: "C1",
        relativeMs: 50,
        data: { status: null, durationMs: 30, error: "network error" },
      }),
      buildTrace({
        id: "E4",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "error" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const restEffect = summary.effects?.find((e) => e.type === "REST");
    expect(restEffect && "status" in restEffect ? restEffect.status : "missing").toBeNull();
  });

  it("surfaces trigger from action-start.data into ActionSummary", () => {
    const trigger = {
      kind: "timer",
      name: "connectivity.probe",
      intervalMs: 5000,
      details: null,
    };
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "probe", trigger },
      }),
      buildTrace({
        id: "E2",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    expect(summary.trigger).toEqual(trigger);
  });

  it("scopes effects to action boundaries and keeps counts aligned with visible effects", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E0",
        type: "rest-request",
        correlationId: "C1",
        relativeMs: -10,
        data: { method: "GET", normalizedUrl: "/pre", target: "real-device" },
      }),
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "rest-request",
        correlationId: "C1",
        relativeMs: 10,
        data: {
          method: "GET",
          normalizedUrl: "/inside",
          target: "real-device",
        },
      }),
      buildTrace({
        id: "E3",
        type: "rest-response",
        correlationId: "C1",
        relativeMs: 20,
        data: { status: 200, durationMs: 10, error: null },
      }),
      buildTrace({
        id: "E4",
        type: "ftp-operation",
        correlationId: "C1",
        relativeMs: 30,
        data: {
          operation: "list",
          path: "/inside",
          result: "success",
          target: "real-device",
        },
      }),
      buildTrace({
        id: "E5",
        type: "error",
        correlationId: "C1",
        relativeMs: 35,
        data: { message: "inside error" },
      }),
      buildTrace({
        id: "E6",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 40,
        data: { status: "error", error: "inside error" },
      }),
      buildTrace({
        id: "E7",
        type: "ftp-operation",
        correlationId: "C1",
        relativeMs: 50,
        data: {
          operation: "list",
          path: "/post",
          result: "failure",
          target: "real-device",
        },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const effects = summary.effects ?? [];
    const restEffects = effects.filter((effect) => effect.type === "REST");
    const ftpEffects = effects.filter((effect) => effect.type === "FTP");
    const errorEffects = effects.filter((effect) => effect.type === "ERROR");

    expect(restEffects).toHaveLength(1);
    expect(ftpEffects).toHaveLength(1);
    expect(errorEffects).toHaveLength(1);
    expect(summary.restCount).toBe(restEffects.length);
    expect(summary.ftpCount).toBe(ftpEffects.length);
    expect(summary.errorCount).toBe(errorEffects.length);
  });

  it("omits trigger when action-start has no trigger field", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    expect(summary.trigger).toBeUndefined();
  });

  it("uses unknown error label when error event has no message", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "error",
        correlationId: "C1",
        relativeMs: 50,
        data: {},
      }),
      buildTrace({
        id: "E3",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "error" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const errorEffects = (summary.effects ?? []).filter((e) => e.type === "ERROR");
    expect(errorEffects.length).toBeGreaterThanOrEqual(1);
    const unknownEffect = errorEffects.find((e) => "message" in e && e.message === "unknown error");
    expect(unknownEffect).toBeDefined();
  });

  it("deduplicates error effects when same message appears in error event and action-end", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "error",
        correlationId: "C1",
        relativeMs: 50,
        data: { message: "disk full" },
      }),
      buildTrace({
        id: "E3",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "error", error: "disk full" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const errorEffects = (summary.effects ?? []).filter((e) => e.type === "ERROR");
    // duplicate 'disk full' should appear only once
    expect(errorEffects.filter((e) => "message" in e && e.message === "disk full")).toHaveLength(1);
  });

  it("adds default error effect when no error events and no error field but status is error", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "error" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const errorEffects = (summary.effects ?? []).filter((e) => e.type === "ERROR");
    expect(errorEffects).toHaveLength(1);
    expect(errorEffects[0] && "message" in errorEffects[0] ? errorEffects[0].message : "").toBe(
      "action ended with error",
    );
  });

  it("includes product from REST response body", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "rest-request",
        correlationId: "C1",
        relativeMs: 10,
        data: {
          method: "GET",
          normalizedUrl: "/v1/info",
          target: "real-device",
        },
      }),
      buildTrace({
        id: "E3",
        type: "rest-response",
        correlationId: "C1",
        relativeMs: 50,
        data: {
          status: 200,
          body: { product: "1541ultimate2+" },
          durationMs: 40,
          error: null,
        },
      }),
      buildTrace({
        id: "E4",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const restEffect = summary.effects?.find((e) => e.type === "REST");
    expect(restEffect && "product" in restEffect ? restEffect.product : undefined).toBe("1541ultimate2+");
  });

  it("treats array body as null responseBody so product is absent", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "rest-request",
        correlationId: "C1",
        relativeMs: 10,
        data: {
          method: "GET",
          normalizedUrl: "/v1/items",
          target: "real-device",
        },
      }),
      buildTrace({
        id: "E3",
        type: "rest-response",
        correlationId: "C1",
        relativeMs: 50,
        data: { status: 200, body: [{ id: 1 }], durationMs: 20, error: null },
      }),
      buildTrace({
        id: "E4",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const restEffect = summary.effects?.find((e) => e.type === "REST");
    expect(restEffect && "product" in restEffect ? restEffect.product : undefined).toBeUndefined();
  });

  it("falls back to endStatus when response has no status key", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "rest-request",
        correlationId: "C1",
        relativeMs: 10,
        data: {
          method: "GET",
          normalizedUrl: "/v1/info",
          target: "real-device",
        },
      }),
      buildTrace({
        id: "E3",
        type: "rest-response",
        correlationId: "C1",
        relativeMs: 50,
        data: { durationMs: 20, error: null },
      }),
      buildTrace({
        id: "E4",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const restEffect = summary.effects?.find((e) => e.type === "REST");
    // endStatus = 'success', used as responseStatus fallback
    expect(restEffect && "status" in restEffect ? restEffect.status : "missing").toBe("success");
  });

  it("falls back to url when normalizedUrl absent in REST request", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "rest-request",
        correlationId: "C1",
        relativeMs: 10,
        data: {
          method: "POST",
          url: "http://device/v1/configs",
          target: "real-device",
        },
      }),
      buildTrace({
        id: "E3",
        type: "rest-response",
        correlationId: "C1",
        relativeMs: 50,
        data: { status: 201, durationMs: 30, error: null },
      }),
      buildTrace({
        id: "E4",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const restEffect = summary.effects?.find((e) => e.type === "REST");
    expect(restEffect && "path" in restEffect ? restEffect.path : "").toBe("http://device/v1/configs");
  });

  it("leaves no error field on pending REST request when endError is null", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "rest-request",
        correlationId: "C1",
        relativeMs: 10,
        data: {
          method: "GET",
          normalizedUrl: "/v1/info",
          target: "real-device",
        },
      }),
      buildTrace({
        id: "E3",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "incomplete" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const restEffect = summary.effects?.find((e) => e.type === "REST");
    expect(restEffect).toBeDefined();
    expect(restEffect && "error" in restEffect ? restEffect.error : "no-field").toBe("no-field");
  });

  it("returns null errorMessage when no error field and no error events exist", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    expect(summary.errorMessage).toBeUndefined();
  });

  it("resolves origin as unknown for unrecognized origin value", () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        origin: "legacy" as "user",
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    expect(summary.origin).toBe("unknown");
    expect(summary.originalOrigin).toBe("legacy");
  });

  it("uses relative duration when event timestamps are null", () => {
    // Covers toTimestampMs(null)→null (line 95), candidate===null in reduce (line 112),
    // and Number.isFinite(relativeMs) fallback (line 123)
    const traces: TraceEvent[] = [
      {
        id: "E1",
        timestamp: null as unknown as string,
        relativeMs: 0,
        type: "action-start",
        origin: "user",
        correlationId: "C1",
        data: { name: "test" },
      },
      {
        id: "E2",
        timestamp: null as unknown as string,
        relativeMs: 50,
        type: "rest-response",
        origin: "user",
        correlationId: "C1",
        data: { status: 200, durationMs: 50 },
      },
      {
        id: "E3",
        timestamp: null as unknown as string,
        relativeMs: 100,
        type: "action-end",
        origin: "user",
        correlationId: "C1",
        data: { status: "success" },
      },
    ];
    const [summary] = buildActionSummaries(traces);
    expect(summary.durationMs).toBe(100);
    expect(summary.durationMsMissing).toBeUndefined();
  });

  it("falls back to UNKNOWN method and unknown path when rest-response has no method or url in request data", () => {
    // Covers lines 186-187: readString(method) ?? 'UNKNOWN', readString(normalizedUrl) ?? readString(url) ?? 'unknown'
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "rest-request",
        correlationId: "C1",
        relativeMs: 10,
        data: {},
      }),
      buildTrace({
        id: "E3",
        type: "rest-response",
        correlationId: "C1",
        relativeMs: 50,
        data: { status: 200, durationMs: 30 },
      }),
      buildTrace({
        id: "E4",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const restEffect = summary.effects?.find((e) => e.type === "REST");
    expect(restEffect && "method" in restEffect ? restEffect.method : "").toBe("UNKNOWN");
    expect(restEffect && "path" in restEffect ? restEffect.path : "").toBe("unknown");
  });

  it("falls back to UNKNOWN method and unknown path for unmatched pending rest-request with no data", () => {
    // Covers lines 213-214: method ?? 'UNKNOWN', path ?? 'unknown' in pendingRequests.forEach
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "rest-request",
        correlationId: "C1",
        relativeMs: 10,
        data: {},
      }),
      buildTrace({
        id: "E3",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "error", error: "timeout" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const restEffect = summary.effects?.find((e) => e.type === "REST");
    expect(restEffect && "method" in restEffect ? restEffect.method : "").toBe("UNKNOWN");
    expect(restEffect && "path" in restEffect ? restEffect.path : "").toBe("unknown");
  });

  it("returns null status when readNumber returns null for non-numeric string status", () => {
    // Covers line 195: readNumber(status) ?? null where readNumber returns null (string "ok" is not a number)
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "rest-request",
        correlationId: "C1",
        relativeMs: 10,
        data: {
          method: "GET",
          normalizedUrl: "/v1/info",
          target: "real-device",
        },
      }),
      buildTrace({
        id: "E3",
        type: "rest-response",
        correlationId: "C1",
        relativeMs: 50,
        data: { status: "ok", durationMs: 30 },
      }),
      buildTrace({
        id: "E4",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const restEffect = summary.effects?.find((e) => e.type === "REST");
    expect(restEffect && "status" in restEffect ? restEffect.status : "missing").toBeNull();
  });

  it("uses null endStatus fallback when rest-response has no status key and actionEnd has no status", () => {
    // Covers line 196: endStatus ?? null where endStatus is null
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "rest-request",
        correlationId: "C1",
        relativeMs: 10,
        data: {
          method: "GET",
          normalizedUrl: "/v1/info",
          target: "real-device",
        },
      }),
      buildTrace({
        id: "E3",
        type: "rest-response",
        correlationId: "C1",
        relativeMs: 50,
        data: { durationMs: 30 },
      }),
      buildTrace({
        id: "E4",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: {},
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const restEffect = summary.effects?.find((e) => e.type === "REST");
    expect(restEffect && "status" in restEffect ? restEffect.status : "missing").toBeNull();
  });

  it("falls back to unknown operation, path and null target for FTP event missing fields", () => {
    // Covers lines 236, 237, 243: operation ?? 'unknown', path ?? 'unknown', target ?? null
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "action-start",
        correlationId: "C1",
        relativeMs: 0,
        data: { name: "test" },
      }),
      buildTrace({
        id: "E2",
        type: "ftp-operation",
        correlationId: "C1",
        relativeMs: 20,
        data: {},
      }),
      buildTrace({
        id: "E3",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    const ftpEffect = summary.effects?.find((e) => e.type === "FTP");
    expect(ftpEffect && "operation" in ftpEffect ? ftpEffect.operation : "").toBe("unknown");
    expect(ftpEffect && "path" in ftpEffect ? ftpEffect.path : "").toBe("unknown");
    expect(ftpEffect && "target" in ftpEffect ? ftpEffect.target : "missing").toBeNull();
  });

  it("resolves origin from actionEnd when no action-start event exists", () => {
    // Covers line 278: actionStart?.origin ?? actionEnd?.origin (second ?? branch)
    // Also covers line 273: actionStart?.relativeMs ?? ordered[0]?.relativeMs (second ?? branch)
    // Also covers line 289: actionStart?.timestamp ?? ordered[0]?.timestamp (second ?? branch)
    const traces: TraceEvent[] = [
      buildTrace({
        id: "E1",
        type: "rest-request",
        correlationId: "C1",
        relativeMs: 10,
        origin: "automatic",
        data: {
          method: "GET",
          normalizedUrl: "/v1/info",
          target: "real-device",
        },
      }),
      buildTrace({
        id: "E2",
        type: "action-end",
        correlationId: "C1",
        relativeMs: 100,
        origin: "automatic",
        data: { status: "success" },
      }),
    ];
    const [summary] = buildActionSummaries(traces);
    expect(summary.origin).toBe("system");
    expect(summary.originalOrigin).toBe("automatic");
    expect(summary.outcome).toBe("incomplete");
  });
});
