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
  inspectRequestPayload,
  inspectResponsePayload,
  normalizeUrlPath,
  readResponseBody,
  waitWithAbortSignal,
} from "@/lib/c64api/requestRuntime";
import { collectTraceHeaders } from "@/lib/tracing/payloadPreview";

describe("requestRuntime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getDeviceStateSnapshot.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

    const signaledWaitController = new AbortController();
    const signaledWait = waitWithAbortSignal(20, signaledWaitController.signal);
    await vi.advanceTimersByTimeAsync(20);
    await expect(signaledWait).resolves.toBeUndefined();
  });

  it("clones and sizes budget values defensively", () => {
    const value = { nested: { count: 1 } };
    const cloned = cloneBudgetValue(value);
    expect(cloned).toEqual(value);

    vi.stubGlobal("structuredClone", () => {
      throw new Error("clone failed");
    });
    expect(cloneBudgetValue(value)).toBe(value);

    vi.stubGlobal("structuredClone", undefined as unknown as typeof structuredClone);
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

  it("normalizes invalid URLs conservatively and propagates rejected promises", async () => {
    await expect(awaitPromiseWithAbortSignal(Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(normalizeUrlPath("not a valid url")).toBe("not a valid url");
  });

  it("inspects request payload variants across text, binary, streams, and objects", async () => {
    expect(estimateBudgetValueBytes(true)).toBe(4);
    expect(estimateBudgetValueBytes(new ArrayBuffer(5))).toBe(5);

    await expect(inspectRequestPayload(null)).resolves.toEqual({ body: null, payloadPreview: null });

    vi.stubGlobal("ReadableStream", class FakeReadableStream {} as typeof ReadableStream);
    const stream = new ReadableStream();
    await expect(inspectRequestPayload(stream)).resolves.toEqual({ body: "[stream]", payloadPreview: null });

    await expect(inspectRequestPayload('{"ok":true}')).resolves.toMatchObject({
      body: { ok: true },
      payloadPreview: expect.objectContaining({ ascii: '{"ok":true}' }),
    });

    await expect(inspectRequestPayload("plain-text")).resolves.toMatchObject({
      body: "plain-text",
      payloadPreview: expect.objectContaining({ ascii: "plain-text" }),
    });

    const filePayload = new File(["abc"], "demo.prg", { type: "application/octet-stream" });
    await expect(inspectRequestPayload(filePayload)).resolves.toMatchObject({
      body: {
        type: "file",
        fileName: "demo.prg",
        sizeBytes: 3,
        mimeType: "application/octet-stream",
        source: "blob",
      },
      payloadPreview: expect.objectContaining({ ascii: "abc" }),
    });

    const typelessFilePayload = new File(["xyz"], "demo.bin");
    await expect(inspectRequestPayload(typelessFilePayload)).resolves.toMatchObject({
      body: {
        type: "file",
        fileName: "demo.bin",
        mimeType: null,
      },
    });

    const blobFormData = new FormData();
    blobFormData.append("blob", new Blob(["abc"], { type: "text/plain" }));
    vi.stubGlobal("File", undefined as unknown as typeof File);
    await expect(inspectRequestPayload(blobFormData)).resolves.toMatchObject({
      body: {
        type: "form-data",
        fields: [{ name: "blob", type: "file", sizeBytes: 3, mimeType: "text/plain" }],
      },
    });

    class FakeFormData {
      forEach(callback: (value: Blob, name: string) => void) {
        callback(new Blob(["abc"], { type: "text/plain" }), "blob");
      }
    }
    vi.stubGlobal("FormData", FakeFormData as unknown as typeof FormData);
    await expect(inspectRequestPayload(new FormData())).resolves.toMatchObject({
      body: {
        type: "form-data",
        fields: [{ name: "blob", type: "file", sizeBytes: 3, mimeType: "text/plain" }],
      },
    });

    class TypelessBlobFormData {
      forEach(callback: (value: Blob, name: string) => void) {
        callback(new Blob(["abc"]), "blob");
      }
    }
    vi.stubGlobal("FormData", TypelessBlobFormData as unknown as typeof FormData);
    await expect(inspectRequestPayload(new FormData())).resolves.toMatchObject({
      body: {
        type: "form-data",
        fields: [{ name: "blob", type: "file", sizeBytes: 3 }],
      },
    });

    await expect(inspectRequestPayload(new ArrayBuffer(2))).resolves.toMatchObject({
      body: { type: "array-buffer", sizeBytes: 2 },
      payloadPreview: expect.objectContaining({ byteCount: 2 }),
    });

    await expect(inspectRequestPayload({ nested: { ok: true } })).resolves.toMatchObject({
      body: { nested: { ok: true } },
      payloadPreview: expect.objectContaining({ ascii: '{"nested":{"ok":true}}' }),
    });
  });

  it("inspects response payload variants across empty, text, and binary responses", async () => {
    await expect(
      inspectResponsePayload(
        new Response(null, {
          status: 204,
          headers: { "content-type": "application/json", "content-length": "0" },
        }),
      ),
    ).resolves.toEqual({
      headers: { "content-length": "0", "content-type": "application/json" },
      body: null,
      payloadPreview: null,
    });

    await expect(
      inspectResponsePayload(
        new Response("ok", {
          headers: { "content-type": "text/plain", "x-mode": "demo" },
        }),
      ),
    ).resolves.toMatchObject({
      headers: expect.objectContaining({
        "content-type": expect.stringContaining("text/plain"),
        "x-mode": "demo",
      }),
      body: "ok",
      payloadPreview: expect.objectContaining({ ascii: "ok" }),
    });

    await expect(
      inspectResponsePayload(
        new Response(Uint8Array.from([0x01, 0x02, 0x03]), {
          headers: { "content-type": "application/octet-stream" },
        }),
      ),
    ).resolves.toMatchObject({
      headers: { "content-type": "application/octet-stream" },
      body: { type: "binary", sizeBytes: 3, mimeType: "application/octet-stream" },
      payloadPreview: expect.objectContaining({ byteCount: 3 }),
    });

    await expect(
      inspectResponsePayload(
        new Response(Uint8Array.from([0x01]), {
          headers: {},
        }),
      ),
    ).resolves.toMatchObject({
      headers: {},
      body: { type: "binary", sizeBytes: 1, mimeType: null },
      payloadPreview: expect.objectContaining({ byteCount: 1 }),
    });

    await expect(
      inspectResponsePayload(
        new Response(new Uint8Array(0), {
          headers: { "content-type": "application/octet-stream" },
        }),
      ),
    ).resolves.toMatchObject({
      headers: { "content-type": "application/octet-stream" },
      body: null,
      payloadPreview: null,
    });

    await expect(
      inspectResponsePayload(
        new Response("", {
          headers: { "content-type": "application/json" },
        }),
      ),
    ).resolves.toMatchObject({
      headers: expect.objectContaining({ "content-type": "application/json" }),
      body: null,
      payloadPreview: null,
    });

    const textFailureResponse = {
      headers: new Headers({ "content-type": "text/plain" }),
      status: 200,
      clone: () => ({
        text: async () => {
          throw new Error("text read failed");
        },
      }),
    } as unknown as Response;
    await expect(inspectResponsePayload(textFailureResponse)).resolves.toEqual({
      headers: { "content-type": "text/plain" },
      body: null,
      payloadPreview: null,
    });

    const binaryFailureResponse = {
      headers: new Headers(),
      status: 200,
      clone: () => ({
        arrayBuffer: async () => {
          throw new Error("binary read failed");
        },
      }),
    } as unknown as Response;
    await expect(inspectResponsePayload(binaryFailureResponse)).resolves.toEqual({
      headers: {},
      body: null,
      payloadPreview: null,
    });
  });

  it("collects full trace headers and builds byte previews with dot placeholders", async () => {
    expect(
      collectTraceHeaders([
        ["x-test", "one"],
        ["x-test", "two"],
      ]),
    ).toEqual({
      "x-test": ["one", "two"],
    });

    const requestTrace = await inspectRequestPayload(new Uint8Array([0x00, 0x0a, 0x41, 0x42]));
    expect(requestTrace.body).toEqual({ type: "array-buffer-view", sizeBytes: 4 });
    expect(requestTrace.payloadPreview).toEqual({
      byteCount: 4,
      previewByteCount: 4,
      hex: "00 0a 41 42",
      ascii: "..AB",
      truncated: false,
    });

    const responseTrace = await inspectResponsePayload(
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json",
          "x-device": "c64u",
        },
      }),
    );
    expect(responseTrace.headers).toEqual(
      expect.objectContaining({
        "content-type": expect.stringContaining("application/json"),
        "x-device": "c64u",
      }),
    );
    expect(responseTrace.body).toEqual({ ok: true });
    expect(responseTrace.payloadPreview?.ascii).toBe('{"ok":true}');

    expect(extractRequestBody({ ok: true })).toEqual({ ok: true });
    await expect(readResponseBody(new Response("ok"))).resolves.toBeNull();
    await expect(readResponseBody(new Response(null))).resolves.toBeNull();
  });
});
