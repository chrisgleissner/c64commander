import { beforeEach, describe, expect, it, vi } from "vitest";
import { FtpClientWeb } from "@/lib/native/ftpClient.web";

vi.mock("@/lib/ftp/ftpConfig", () => ({
  getFtpBridgeUrl: vi.fn(() => "http://bridge.local"),
}));

describe("FtpClientWeb retry policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not retry timeout failures inside the web bridge for listDirectory", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("FTP bridge request timed out"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entries: [{ name: "demo.sid", path: "/demo.sid", type: "file" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = new FtpClientWeb();
    await expect(client.listDirectory({ host: "c64u" })).rejects.toThrow("FTP bridge request timed out");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry HTTP 5xx responses inside the web bridge for readFile", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "upstream unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: "QQ==", sizeBytes: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = new FtpClientWeb();
    await expect(
      client.readFile({
        host: "c64u",
        path: "/songlengths.md5",
      }),
    ).rejects.toThrow("upstream unavailable");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry timeout failures inside the web bridge for writeFile", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("FTP bridge request timed out"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sizeBytes: 4 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = new FtpClientWeb();
    await expect(
      client.writeFile({
        host: "c64u",
        path: "/Temp/demo.reu",
        data: "QUJDRA==",
      }),
    ).rejects.toThrow("FTP bridge request timed out");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry HTTP 4xx responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "bad request" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = new FtpClientWeb();
    await expect(client.listDirectory({ host: "c64u" })).rejects.toThrow("bad request");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails after one bridge attempt for repeated transient failures", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network failed to fetch"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = new FtpClientWeb();
    await expect(client.readFile({ host: "c64u", path: "/demo.sid" })).rejects.toThrow("network failed to fetch");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("posts FTP ping through the bridge and returns ok=true", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = new FtpClientWeb();
    await expect(
      client.pingFtp({
        host: "c64u",
        port: 21,
        username: "user",
        password: "secret",
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://bridge.local/v1/ftp/ping",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          host: "c64u",
          port: 21,
          username: "user",
          password: "secret",
          traceContext: undefined,
        }),
      }),
    );
  });

  it("treats a ping payload without ok=true as a failed ping response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = new FtpClientWeb();
    await expect(client.pingFtp({ host: "c64u" })).resolves.toEqual({ ok: false });
  });
});

describe("FtpClientWeb missing bridge URL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when bridge URL is not configured for listDirectory", async () => {
    const { getFtpBridgeUrl } = await import("@/lib/ftp/ftpConfig");
    vi.mocked(getFtpBridgeUrl).mockReturnValueOnce(null);

    const client = new FtpClientWeb();
    await expect(client.listDirectory({ host: "c64u" })).rejects.toThrow("missing FTP bridge URL");
  });

  it("throws when bridge URL is not configured for readFile", async () => {
    const { getFtpBridgeUrl } = await import("@/lib/ftp/ftpConfig");
    vi.mocked(getFtpBridgeUrl).mockReturnValueOnce(null);

    const client = new FtpClientWeb();
    await expect(client.readFile({ host: "c64u", path: "/demo.sid" })).rejects.toThrow("missing FTP bridge URL");
  });

  it("throws when bridge URL is not configured for writeFile", async () => {
    const { getFtpBridgeUrl } = await import("@/lib/ftp/ftpConfig");
    vi.mocked(getFtpBridgeUrl).mockReturnValueOnce(null);

    const client = new FtpClientWeb();
    await expect(client.writeFile({ host: "c64u", path: "/demo.sid", data: "QQ==" })).rejects.toThrow(
      "missing FTP bridge URL",
    );
  });
});

describe("FtpClientWeb error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles AbortError timeout for listDirectory", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = new FtpClientWeb();
    await expect(client.listDirectory({ host: "c64u" })).rejects.toThrow("FTP bridge request timed out");
  });

  it("handles AbortError timeout for readFile", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = new FtpClientWeb();
    await expect(client.readFile({ host: "c64u", path: "/demo.sid" })).rejects.toThrow("FTP bridge request timed out");
  });

  it("rejects writeFile when payload is missing sizeBytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = new FtpClientWeb();
    await expect(client.writeFile({ host: "c64u", path: "/demo.sid", data: "QQ==" })).rejects.toThrow(
      "invalid write payload",
    );
  });

  it("handles error response with no JSON body for listDirectory", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = new FtpClientWeb();
    await expect(client.listDirectory({ host: "c64u" })).rejects.toThrow("FTP bridge error: HTTP 500");
  });

  it("rejects listDirectory when payload entries are missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ entries: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = new FtpClientWeb();
    await expect(client.listDirectory({ host: "c64u" })).rejects.toThrow("invalid list payload");
  });

  it("rejects readFile when payload is missing data field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sizeBytes: 100 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = new FtpClientWeb();
    await expect(client.readFile({ host: "c64u", path: "/demo.sid" })).rejects.toThrow("invalid file payload");
  });

  it("does not retry connection reset errors inside the web bridge", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ entries: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = new FtpClientWeb();
    await expect(client.listDirectory({ host: "c64u" })).rejects.toThrow("connection reset");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats error response with only HTTP status as FTP bridge error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
      }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = new FtpClientWeb();
    await expect(client.listDirectory({ host: "c64u" })).rejects.toThrow("unauthorized");
  });
});

describe("FtpClientWeb unsupported operations", () => {
  it("rejects recursive listing — the web bridge cannot enumerate recursively", async () => {
    const client = new FtpClientWeb();
    await expect(client.listDirectoryRecursive({ host: "c64u", path: "/" })).rejects.toThrow(
      "FTP bridge recursive listing is unavailable on web.",
    );
  });

  it("cancelRead resolves to a no-op (the web bridge has no cancellation channel)", async () => {
    const client = new FtpClientWeb();
    await expect(client.cancelRead({ requestId: "ftp-read-1" })).resolves.toBeUndefined();
  });

  it("addListener returns an inert handle whose remove() is a no-op", async () => {
    const client = new FtpClientWeb();
    const listener = vi.fn();
    const handle = await client.addListener("ftpReadProgress", listener);
    expect(typeof handle.remove).toBe("function");
    await expect(handle.remove()).resolves.toBeUndefined();
    // The web bridge never streams progress, so the listener is never invoked.
    expect(listener).not.toHaveBeenCalled();
  });
});
