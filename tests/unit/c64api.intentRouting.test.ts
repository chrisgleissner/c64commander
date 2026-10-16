// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const interactionCalls: Array<{ path: string; intent: string }> = [];
const interactionMetas: Array<Record<string, unknown>> = [];

const ensureWindow = () => {
  if (typeof window !== "undefined") {
    return;
  }

  const target = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
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
      location: { origin: "http://localhost" },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
  });
};

const ensureLocalStorage = () => {
  if (typeof localStorage !== "undefined") {
    return;
  }

  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
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
    },
  });
};

ensureWindow();
ensureLocalStorage();

const fetchMock = vi.fn();
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: fetchMock,
});

vi.mock("@/lib/deviceInteraction/deviceInteractionManager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/deviceInteraction/deviceInteractionManager")>();

  return {
    ...actual,
    withRestInteraction: vi.fn(async (meta, run) => {
      interactionCalls.push({ path: meta.normalizedUrl ?? meta.path, intent: meta.intent });
      interactionMetas.push(meta);
      return run();
    }),
    scheduleConfigWrite: vi.fn((run) => run()),
  };
});

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
  buildErrorLogDetails: vi.fn((error: Error, details?: Record<string, unknown>) => ({
    ...details,
    error: error.message,
  })),
}));

vi.mock("@/lib/secureStorage", () => ({
  setPassword: vi.fn(),
  getPassword: vi.fn(async () => null),
  clearPassword: vi.fn(),
  hasStoredPasswordFlag: vi.fn(() => false),
  getCachedPassword: vi.fn(() => null),
}));

vi.mock("@capacitor/core", () => ({
  CapacitorHttp: { request: vi.fn() },
  Capacitor: {
    getPlatform: vi.fn(() => "web"),
    isNativePlatform: vi.fn(() => false),
  },
  registerPlugin: vi.fn(() => ({})),
}));

import { C64API } from "@/lib/c64api";

describe("C64API intent routing", () => {
  beforeEach(() => {
    interactionCalls.length = 0;
    interactionMetas.length = 0;
    fetchMock.mockReset();
  });

  const binaryResponse = () =>
    new Response(Uint8Array.from([0x2a]).buffer, {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });

  const infoResponse = () =>
    new Response(JSON.stringify({ product: "Ultimate 64", errors: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("tells the REST gateway which device readMemory and getInfo are for", async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes("readmem") ? binaryResponse() : infoResponse()));
    const api = new C64API("http://u2", undefined, "u2");

    await api.readMemory("D012", 1, { __c64uIntent: "system" });
    await api.getInfo({ __c64uIntent: "system" });

    expect(interactionMetas.map((meta) => meta.deviceHost)).toEqual(["u2", "u2"]);
  });

  it("passes the health probe flags of readMemory on to the REST gateway", async () => {
    fetchMock.mockImplementation(async () => binaryResponse());
    const api = new C64API("http://c64u");

    await api.readMemory("D012", 1, {
      __c64uIntent: "system",
      __c64uRecoveryProbe: true,
      __c64uSuppressCircuitContribution: true,
    });
    await api.readMemory("00A2", 3, { __c64uIntent: "user", __c64uForceProbe: true });

    expect(interactionMetas[0]).toMatchObject({
      bypassCircuit: true,
      suppressCircuitContribution: true,
      forceProbe: false,
      bypassCooldown: false,
    });
    expect(interactionMetas[1]).toMatchObject({
      forceProbe: true,
      bypassCircuit: true,
      bypassCooldown: true,
      bypassBackoff: true,
      suppressCircuitContribution: false,
    });
  });

  it("counts a getInfo that joins one already in flight as dispatched, so its probe timeout starts", async () => {
    let answer!: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const api = new C64API("http://c64u");
    const dispatched: string[] = [];

    const first = api.getInfo({ __c64uOnDispatch: () => dispatched.push("first") });
    await Promise.resolve();
    await Promise.resolve();
    const joined = api.getInfo({ __c64uOnDispatch: () => dispatched.push("joined") });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dispatched).toEqual(["first", "joined"]);
    answer(infoResponse());
    await expect(first).resolves.toMatchObject({ product: "Ultimate 64" });
    await expect(joined).resolves.toMatchObject({ product: "Ultimate 64" });
  });

  it("reports dispatch when readMemory and getInfo leave the queue, before the device is asked", async () => {
    const events: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      events.push(`fetch ${url.includes("readmem") ? "readmem" : "info"}`);
      return url.includes("readmem") ? binaryResponse() : infoResponse();
    });
    const api = new C64API("http://c64u");

    await api.readMemory("D012", 1, { __c64uOnDispatch: () => events.push("dispatch readmem") });
    await api.getInfo({ __c64uBypassCache: true, __c64uOnDispatch: () => events.push("dispatch info") });

    expect(events).toEqual(["dispatch readmem", "fetch readmem", "dispatch info", "fetch info"]);
    fetchMock.mock.calls.forEach(([, init]) => {
      expect(init).not.toHaveProperty("__c64uOnDispatch");
    });
  });

  it("routes readMemory through the REST gateway with the caller intent", async () => {
    fetchMock.mockResolvedValue(
      new Response(Uint8Array.from([0xde, 0xad]).buffer, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    );

    const api = new C64API("http://c64u");

    await expect(api.readMemory("1000", 2, { __c64uIntent: "system" })).resolves.toEqual(Uint8Array.from([0xde, 0xad]));

    expect(interactionCalls).toContainEqual({
      path: "/v1/machine:readmem?address=1000&length=2",
      intent: "system",
    });
  });

  it("defaults upload requests to user intent when no explicit intent is provided", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const api = new C64API("http://c64u");

    await expect(
      api.runPrgUpload(new Blob([Uint8Array.from([0x01, 0x08, 0x60])]), { filename: "demo.prg" }),
    ).resolves.toEqual({ errors: [] });

    expect(interactionCalls).toContainEqual({
      path: "/v1/runners:run_prg",
      intent: "user",
    });
  });
});
