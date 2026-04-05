import { afterEach, describe, expect, it } from "vitest";
import { createMockHvscServer } from "../../../playwright/mockHvscServer";

const activeServers: Array<Awaited<ReturnType<typeof createMockHvscServer>>> = [];

afterEach(async () => {
  while (activeServers.length) {
    const server = activeServers.pop();
    if (server) await server.close();
  }
});

describe("createMockHvscServer", () => {
  it("serves archive HEAD requests with a content length and request log entry", async () => {
    const server = await createMockHvscServer();
    activeServers.push(server);

    const response = await fetch(`${server.baseUrl}/hvsc/HVSC_${server.baseline.version}-all-of-them.7z`, {
      method: "HEAD",
    });

    expect(response.status).toBe(200);
    expect(Number(response.headers.get("content-length"))).toBeGreaterThan(0);
    expect(await response.text()).toBe("");

    const requestLog = server.getRequestLog();
    expect(requestLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "HEAD",
          path: `/hvsc/HVSC_${server.baseline.version}-all-of-them.7z`,
          statusCode: 200,
          bytesSent: 0,
          contentLength: Number(response.headers.get("content-length")),
        }),
      ]),
    );
  });

  it("records throttled archive downloads in the request log", async () => {
    const server = await createMockHvscServer({ bytesPerSecond: 32 * 1024, chunkSizeBytes: 8 * 1024 });
    activeServers.push(server);

    const response = await fetch(`${server.baseUrl}/hvsc/archive/update`);
    const buffer = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(buffer.byteLength).toBeGreaterThan(0);

    const requestLog = server.getRequestLog();
    const download = requestLog.find((entry) => entry.path === "/hvsc/archive/update");
    expect(download).toEqual(
      expect.objectContaining({
        method: "GET",
        statusCode: 200,
        bytesSent: buffer.byteLength,
        contentLength: buffer.byteLength,
      }),
    );
    expect(download?.durationMs ?? 0).toBeGreaterThan(0);
  });
});
