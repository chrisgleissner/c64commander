import { beforeEach, describe, expect, it, vi } from "vitest";
import { FtpClientWeb } from "@/lib/native/ftpClient.web";

vi.mock("@/lib/ftp/ftpConfig", () => ({
  getFtpBridgeUrl: vi.fn(() => "http://bridge.local"),
}));

describe("FtpClientWeb retry policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries timeout failures and eventually succeeds for listDirectory", async () => {
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
    const result = await client.listDirectory({ host: "c64u" });

    expect(result.entries).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries HTTP 5xx responses and succeeds for readFile", async () => {
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
    const result = await client.readFile({
      host: "c64u",
      path: "/songlengths.md5",
    });

    expect(result.data).toBe("QQ==");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries timeout failures and eventually succeeds for writeFile", async () => {
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
    const result = await client.writeFile({ host: "c64u", path: "/Temp/demo.reu", data: "QUJDRA==" });

    expect(result.sizeBytes).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("fails after max retry attempts for repeated transient failures", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network failed to fetch"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = new FtpClientWeb();
    await expect(client.readFile({ host: "c64u", path: "/demo.sid" })).rejects.toThrow("network failed to fetch");

    expect(fetchMock).toHaveBeenCalledTimes(3);
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

  it("retries on connection reset errors", async () => {
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
    const result = await client.listDirectory({ host: "c64u" });
    expect(result.entries).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
