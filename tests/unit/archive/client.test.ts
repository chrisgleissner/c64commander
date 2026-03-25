import { afterEach, describe, expect, it, vi } from "vitest";
import { buildArchiveQuery } from "@/lib/archive/queryBuilder";
import { BaseArchiveClient, createArchiveClient } from "@/lib/archive/client";
import { createAssembly64Mock } from "../../mocks/assembly64Mock";
import { createCommoserveMock } from "../../mocks/commoserveMock";

describe("archive client", () => {
  const closers: Array<() => Promise<void>> = [];

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

  it("rejects aborted requests", async () => {
    const controller = new AbortController();
    const client = createArchiveClient({ backend: "commodore" }, () => new Promise<Response>(() => undefined));

    const promise = client.getPresets({ signal: controller.signal });
    controller.abort(new Error("aborted by test"));

    await expect(promise).rejects.toThrow("aborted by test");
  });
});
