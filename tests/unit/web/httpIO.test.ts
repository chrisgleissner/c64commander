// @vitest-environment node
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { readBody, readJsonBody, writeBuffer, writeJson, writeText } from "../../../web/server/src/httpIO";

const createResponse = () => ({
  writeHead: vi.fn(),
  end: vi.fn(),
});

describe("httpIO", () => {
  it("reads raw and JSON bodies, including empty bodies", async () => {
    const rawReq = Readable.from([Buffer.from("abc"), "def"]);
    const jsonReq = Readable.from([JSON.stringify({ ok: true })]);
    const emptyReq = Readable.from([]);

    await expect(readBody(rawReq as any)).resolves.toEqual(Buffer.from("abcdef"));
    await expect(readJsonBody<{ ok: boolean }>(jsonReq as any)).resolves.toEqual({ ok: true });
    await expect(readJsonBody<Record<string, never>>(emptyReq as any)).resolves.toEqual({});
  });

  it("writes JSON, text, and binary responses with explicit headers", () => {
    const jsonRes = createResponse();
    writeJson(jsonRes as any, 201, { ok: true });
    expect(jsonRes.writeHead).toHaveBeenCalledWith(201, expect.objectContaining({ "Cache-Control": "no-store" }));
    expect(jsonRes.end).toHaveBeenCalledWith(Buffer.from(JSON.stringify({ ok: true })));

    const textRes = createResponse();
    writeText(textRes as any, 202, "hello", "text/plain; charset=utf-8", "public, max-age=60");
    expect(textRes.writeHead).toHaveBeenCalledWith(
      202,
      expect.objectContaining({ "Cache-Control": "public, max-age=60", "Content-Type": "text/plain; charset=utf-8" }),
    );
    expect(textRes.end).toHaveBeenCalledWith(Buffer.from("hello"));

    const bufferRes = createResponse();
    writeBuffer(bufferRes as any, 203, Buffer.from([1, 2, 3]), "application/test", "public, max-age=10");
    expect(bufferRes.writeHead).toHaveBeenCalledWith(
      203,
      expect.objectContaining({ "Content-Type": "application/test", "Cache-Control": "public, max-age=10" }),
    );
    expect(bufferRes.end).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
  });
});
