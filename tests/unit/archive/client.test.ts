import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildArchiveQuery } from "@/lib/archive/queryBuilder";
import { BaseArchiveClient, createArchiveClient } from "@/lib/archive/client";
import { createAssembly64Mock } from "../../mocks/assembly64Mock";
import { createCommoserveMock } from "../../mocks/commoserveMock";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
  },
  CapacitorHttp: {
    request: vi.fn(),
  },
}));

describe("archive client", () => {
  const closers: Array<() => Promise<void>> = [];

  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(CapacitorHttp.request).mockReset();
  });

  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((close) => close()));
  });

  it("injects required headers and searches against the resolved backend host", async () => {
    const server = await createCommoserveMock();
    closers.push(server.close);
    const client = createArchiveClient({ backend: "commodore", hostOverride: server.host });

    const results = await client.search({ name: "joyride", category: "apps" });

    expect(results).toHaveLength(1);
    expect(server.requests.at(-1)?.url).toContain(
      encodeURIComponent(buildArchiveQuery({ name: "joyride", category: "apps" })),
    );
    expect(server.requests.at(-1)?.headers["client-id"]).toBe("Commodore");
    expect(server.requests.at(-1)?.headers["user-agent"]).toBe("Assembly Query");
  });

  it("uses the assembly64 subclass defaults and returns entries", async () => {
    const server = await createAssembly64Mock();
    closers.push(server.close);
    const client = createArchiveClient({ backend: "assembly64", hostOverride: server.host });

    const entries = await client.getEntries("200", 10);

    expect(entries).toEqual([{ path: "wizball.d64", id: 0, size: 174848, date: 560822400000 }]);
    expect(client.getResolvedConfig()).toMatchObject({
      backend: "assembly64",
      clientId: "Ultimate",
      host: server.host,
    });
    expect(server.requests.at(-1)?.headers["client-id"]).toBe("Ultimate");
  });

  it("downloads binary payloads and exposes the binary URL", async () => {
    const server = await createCommoserveMock();
    closers.push(server.close);
    const client = createArchiveClient({ backend: "commodore", hostOverride: server.host });

    const binary = await client.downloadBinary("100", 40, 0, "joyride.prg");

    expect(binary.fileName).toBe("joyride.prg");
    expect(binary.bytes).toEqual(new Uint8Array([0x01, 0x08, 0x60]));
    expect(client.getBinaryUrl("100", 40, 0)).toBe(`${server.baseUrl}/leet/search/bin/100/40/0`);
  });

  it("applies optional request and response transform hooks", async () => {
    const server = await createCommoserveMock();
    closers.push(server.close);

    class TestClient extends BaseArchiveClient {
      constructor() {
        super({ backend: "commodore", hostOverride: server.host });
      }

      protected override transformRequest(request: RequestInit & { url: string }) {
        return {
          ...request,
          headers: {
            ...(request.headers as Record<string, string>),
            "X-Test": "1",
          },
        };
      }

      protected override transformResponse<T>(response: T): T {
        if (Array.isArray(response)) {
          return [...response, { id: "999", category: 40, name: "Injected" }] as T;
        }
        return response;
      }
    }

    const client = new TestClient();
    const results = await client.search({ name: "joyride", category: "apps" });

    expect(results.at(-1)).toMatchObject({ name: "Injected" });
    expect(server.requests.at(-1)?.headers["x-test"]).toBe("1");
  });

  it("includes backend and host context when the archive server returns a protocol error payload", async () => {
    const server = await createCommoserveMock();
    closers.push(server.close);
    const client = createArchiveClient({
      backend: "commodore",
      hostOverride: server.host,
      clientIdOverride: "Wrong",
    });

    await expect(client.search({ name: "joyride", category: "apps" })).rejects.toThrow(
      `commodore archive request failed for ${server.host}: Archive server returned error 464`,
    );
  });

  it("rejects timed out requests", async () => {
    vi.useFakeTimers();
    const client = createArchiveClient({ backend: "commodore" }, () => new Promise<Response>(() => undefined));

    const expectation = expect(client.getPresets()).rejects.toThrow("commodore archive request failed");
    await vi.advanceTimersByTimeAsync(10_000);
    await expectation;
    vi.useRealTimers();
  });

  it("aborts the underlying fetch when a request times out", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            reject(init.signal?.reason ?? new Error("aborted"));
          },
          { once: true },
        );
      });
    });
    const client = createArchiveClient({ backend: "commodore", hostOverride: "archive.local" }, fetchMock);

    const expectation = expect(client.getPresets()).rejects.toThrow(
      "commodore archive request failed for archive.local: Archive request timed out",
    );

    await vi.advanceTimersByTimeAsync(10_000);
    await expectation;
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: expect.objectContaining({ aborted: true }),
      }),
    );
    vi.useRealTimers();
  });

  it("falls back to a plain fetch when the runtime rejects AbortSignal instances", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_input: string | URL | Request, init?: RequestInit) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        throw new Error('Expected signal ("AbortSignal {}") to be an instance of AbortSignal.');
      })
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "1", name: "Latest uploads" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const client = createArchiveClient({ backend: "commodore", hostOverride: "archive.local" }, fetchMock);

    await expect(client.getPresets()).resolves.toEqual([{ id: "1", name: "Latest uploads" }]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.not.objectContaining({ signal: expect.anything() }),
    );
  });

  it("rejects aborted requests", async () => {
    const controller = new AbortController();
    const client = createArchiveClient({ backend: "commodore" }, () => new Promise<Response>(() => undefined));

    const promise = client.getPresets({ signal: controller.signal });
    controller.abort(new Error("aborted by test"));

    await expect(promise).rejects.toThrow("aborted by test");
  });

  it("does not invoke fetch when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("aborted before start"));
    const fetchMock = vi.fn<typeof fetch>();
    const client = createArchiveClient({ backend: "commodore" }, fetchMock);

    await expect(client.getPresets({ signal: controller.signal })).rejects.toThrow("aborted before start");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not treat errorCode 0 as a protocol failure", async () => {
    const client = createArchiveClient(
      { backend: "commodore" },
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ id: "1", category: 40, name: "Okay", errorCode: 0 }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(client.search({ name: "ok", category: "apps" })).resolves.toEqual([
      { id: "1", category: 40, name: "Okay", errorCode: 0 },
    ]);
  });

  it("returns an empty entry list when the archive response omits contentEntry", async () => {
    const client = createArchiveClient(
      { backend: "commodore" },
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ totalRows: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(client.getEntries("100", 40)).resolves.toEqual([]);
  });

  it("wraps archive binary download failures with backend and host context", async () => {
    const client = createArchiveClient(
      { backend: "commodore", hostOverride: "archive.local" },
      vi.fn().mockResolvedValue(new Response("nope", { status: 503, statusText: "Unavailable" })),
    );

    await expect(client.downloadBinary("100", 40, 0, "broken.prg")).rejects.toThrow(
      "commodore archive download failed for archive.local: Archive binary download failed with 503 Unavailable",
    );
  });

  it("applies request transforms before downloading binaries", async () => {
    class TestBinaryClient extends BaseArchiveClient {
      constructor() {
        super(
          { backend: "commodore", hostOverride: "archive.local" },
          vi.fn().mockResolvedValue(
            new Response(new Uint8Array([1, 8, 96]), {
              status: 200,
              headers: { "Content-Type": "application/octet-stream" },
            }),
          ),
        );
      }

      protected override transformRequest(request: RequestInit & { url: string }) {
        return {
          ...request,
          headers: {
            ...(request.headers as Record<string, string>),
            "X-Binary-Test": "1",
          },
        };
      }
    }

    const client = new TestBinaryClient();

    await expect(client.downloadBinary("100", 40, 0, "joyride.prg")).resolves.toMatchObject({
      fileName: "joyride.prg",
    });
  });

  it("uses CapacitorHttp on native platforms for JSON archive requests", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 200,
      data: [{ id: "100", category: 40, name: "Joyride" }],
      headers: { "content-type": "application/json" },
    } as never);

    const client = createArchiveClient({ backend: "commodore" });
    await expect(client.search({ name: "joyride", category: "apps" })).resolves.toEqual([
      { id: "100", category: 40, name: "Joyride" },
    ]);
    expect(vi.mocked(CapacitorHttp.request)).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        responseType: "json",
        headers: expect.objectContaining({
          "accept-encoding": "identity",
          "client-id": "Commodore",
          "user-agent": "Assembly Query",
        }),
      }),
    );
  });

  it("parses string JSON payloads returned by CapacitorHttp", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 200,
      data: JSON.stringify([{ id: "100", category: 40, name: "Joyride" }]),
      headers: { "content-type": "application/json" },
    } as never);

    const client = createArchiveClient({ backend: "commodore" });
    await expect(client.search({ name: "joyride", category: "apps" })).resolves.toEqual([
      { id: "100", category: 40, name: "Joyride" },
    ]);
  });

  it("uses CapacitorHttp on native platforms for binary archive downloads", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 200,
      data: [1, 8, 96],
      headers: { "content-type": "application/octet-stream" },
    } as never);

    const client = createArchiveClient({ backend: "commodore" });
    const binary = await client.downloadBinary("100", 40, 0, "joyride.prg");

    expect(binary.bytes).toEqual(new Uint8Array([1, 8, 96]));
    expect(vi.mocked(CapacitorHttp.request)).toHaveBeenCalledWith(
      expect.objectContaining({
        responseType: "arraybuffer",
      }),
    );
  });

  it("decodes base64 binary payloads returned by CapacitorHttp", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 200,
      data: "AQhg",
      headers: { "content-type": "application/octet-stream" },
    } as never);

    const client = createArchiveClient({ backend: "commodore" });
    const binary = await client.downloadBinary("100", 40, 0, "joyride.prg");

    expect(binary.bytes).toEqual(new Uint8Array([1, 8, 96]));
  });

  it("falls back to fetch when native platform detection throws", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockImplementation(() => {
      throw new Error("platform probe failed");
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: "100", category: 40, name: "Joyride" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const client = createArchiveClient({ backend: "commodore" }, fetchMock);
    await expect(client.search({ name: "joyride", category: "apps" })).resolves.toEqual([
      { id: "100", category: 40, name: "Joyride" },
    ]);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("decodes base64 native binary payloads", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 200,
      data: "AQhg",
      headers: { "content-type": "application/octet-stream" },
    } as never);

    const client = createArchiveClient({ backend: "commodore" });
    await expect(client.downloadBinary("100", 40, 0, "joyride.prg")).resolves.toMatchObject({
      bytes: new Uint8Array([1, 8, 96]),
    });
  });

  it("decodes Uint8Array native binary payloads", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 200,
      data: new Uint8Array([1, 8, 96]),
      headers: { "content-type": "application/octet-stream" },
    } as never);

    const client = createArchiveClient({ backend: "commodore" });
    await expect(client.downloadBinary("100", 40, 0, "joyride.prg")).resolves.toMatchObject({
      bytes: new Uint8Array([1, 8, 96]),
    });
  });

  it("surfaces non-ok archive responses", async () => {
    const client = createArchiveClient(
      { backend: "commodore", hostOverride: "archive.local" },
      vi.fn().mockResolvedValue(new Response("boom", { status: 503, statusText: "Service Unavailable" })),
    );

    await expect(client.getPresets()).rejects.toThrow(
      "commodore archive request failed for archive.local: Archive request failed with 503 Service Unavailable",
    );
  });

  it("rejects immediately when an external signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already aborted"));
    const client = createArchiveClient({ backend: "commodore" }, () => new Promise<Response>(() => undefined));

    await expect(client.getPresets({ signal: controller.signal })).rejects.toThrow("already aborted");
  });

  it("rejects when an external signal aborts after the request has started", async () => {
    const controller = new AbortController();
    const client = createArchiveClient({ backend: "commodore" }, () => new Promise<Response>(() => undefined));
    const expectation = expect(client.getPresets({ signal: controller.signal })).rejects.toThrow("aborted after start");

    controller.abort(new Error("aborted after start"));

    await expectation;
  });

  it("fails native binary downloads with unsupported payload shapes", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 200,
      data: { invalid: true },
      headers: { "content-type": "application/octet-stream" },
    } as never);

    const client = createArchiveClient({ backend: "commodore" });
    await expect(client.downloadBinary("100", 40, 0, "joyride.prg")).rejects.toThrow(
      "Archive native HTTP returned an unsupported binary payload.",
    );
  });
});
