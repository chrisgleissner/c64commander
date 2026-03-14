import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDeviceStateSnapshot = vi.fn();

vi.mock("@/lib/deviceInteraction/deviceStateStore", () => ({
  getDeviceStateSnapshot: (...args: unknown[]) => getDeviceStateSnapshot(...args),
}));

import {
  awaitPromiseWithAbortSignal,
  buildReadRequestDedupeKey,
  cloneBudgetValue,
  createAbortError,
  estimateBudgetValueBytes,
  extractRequestBody,
  getIdleContext,
  readResponseBody,
  waitWithAbortSignal,
} from "@/lib/c64api/requestRuntime";

describe("requestRuntime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getDeviceStateSnapshot.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates dedupe keys only for read-only requests without bodies", () => {
    expect(buildReadRequestDedupeKey("POST", "http://c64u/v1/info", {}, null)).toBeNull();
    expect(buildReadRequestDedupeKey("GET", "http://c64u/v1/info", {}, "body")).toBeNull();
    expect(buildReadRequestDedupeKey("GET", "http://c64u/v1/info?b=2&a=1", { B: "2", a: "1" }, undefined)).toContain(
      "GET /v1/info?a=1&b=2 a:1|b:2",
    );
  });

  it("handles abort helpers before and during waits", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    await expect(waitWithAbortSignal(50, abortedController.signal)).rejects.toMatchObject({ name: "AbortError" });
    await expect(awaitPromiseWithAbortSignal(Promise.resolve("x"), abortedController.signal)).rejects.toMatchObject({
      name: "AbortError",
    });

    const controller = new AbortController();
    const pendingWait = waitWithAbortSignal(100, controller.signal);
    controller.abort();
    await expect(pendingWait).rejects.toMatchObject({ name: "AbortError" });

    const asyncController = new AbortController();
    const pendingPromise = awaitPromiseWithAbortSignal(
      new Promise<string>((resolve) => setTimeout(() => resolve("done"), 100)),
      asyncController.signal,
    );
    asyncController.abort();
    await expect(pendingPromise).rejects.toMatchObject({ name: "AbortError" });

    const pendingUnsignaledWait = waitWithAbortSignal(20);
    await vi.advanceTimersByTimeAsync(20);
    await expect(pendingUnsignaledWait).resolves.toBeUndefined();
  });

  it("clones and sizes budget values defensively", () => {
    const value = { nested: { count: 1 } };
    const cloned = cloneBudgetValue(value);
    expect(cloned).toEqual(value);

    vi.stubGlobal("structuredClone", () => {
      throw new Error("clone failed");
    });
    expect(cloneBudgetValue(value)).toBe(value);

    expect(estimateBudgetValueBytes(null)).toBe(0);
    expect(estimateBudgetValueBytes("abcd")).toBe(4);
    expect(estimateBudgetValueBytes(42)).toBe(2);
    expect(estimateBudgetValueBytes(new Uint8Array([1, 2, 3]))).toBe(3);
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(estimateBudgetValueBytes(circular)).toBeNull();
  });

  it("derives idle context from device state snapshots", () => {
    getDeviceStateSnapshot.mockReturnValue({ state: "READY", lastSuccessAtMs: Date.now() - 15_000 });
    expect(getIdleContext()).toMatchObject({ deviceState: "READY", wasIdle: true });

    getDeviceStateSnapshot.mockReturnValue({ state: "READY", lastSuccessAtMs: null });
    expect(getIdleContext()).toMatchObject({ deviceState: "READY", idleMs: null, wasIdle: false });
  });

  it("extracts request bodies across supported payload types", () => {
    expect(extractRequestBody(null)).toBeNull();
    expect(extractRequestBody('{"ok":true}')).toEqual({ ok: true });
    expect(extractRequestBody("not-json")).toBe("not-json");

    const formData = new FormData();
    formData.append("label", "demo");
    formData.append("file", new File(["abc"], "demo.sid", { type: "audio/prs.sid" }));
    expect(extractRequestBody(formData)).toMatchObject({
      type: "form-data",
      fields: [
        { name: "label", type: "text" },
        { name: "file", type: "file", fileName: "demo.sid", mimeType: "audio/prs.sid" },
      ],
    });

    expect(extractRequestBody(new Blob(["abc"], { type: "text/plain" }))).toMatchObject({
      type: "blob",
      mimeType: "text/plain",
    });
    expect(extractRequestBody(new ArrayBuffer(8))).toEqual({ type: "array-buffer", sizeBytes: 8 });
    expect(extractRequestBody(new Uint8Array([1, 2, 3]))).toEqual({ type: "array-buffer-view", sizeBytes: 3 });
  });

  it("reads response bodies only when JSON parsing is applicable", async () => {
    const jsonResponse = new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
    expect(await readResponseBody(jsonResponse)).toEqual({ ok: true });

    const textResponse = new Response("ok", { headers: { "content-type": "text/plain" } });
    expect(await readResponseBody(textResponse)).toBeNull();

    const invalidJsonResponse = new Response("{", { headers: { "content-type": "application/json" } });
    expect(await readResponseBody(invalidJsonResponse)).toBeNull();
  });

  it("creates standard abort errors", () => {
    expect(createAbortError()).toMatchObject({ name: "AbortError", message: "The operation was aborted" });
  });
});
