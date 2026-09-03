// @vitest-environment node
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  JSON_BODY_LIMIT_BYTES,
  PayloadTooLargeError,
  readBody,
  readJsonBody,
  writeBuffer,
  writeJson,
  writeText,
} from "../../../web/server/src/httpIO";

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

  // HARD27-009: readBody concatenated every chunk with no cap, so an
  // unauthenticated client could buffer an unbounded body into the process.
  it("refuses a body over the limit without buffering the remainder", async () => {
    const chunk = Buffer.alloc(16 * 1024, 0x61);
    const delivered: number[] = [];
    let index = 0;
    const req = new Readable({
      read() {
        index += 1;
        // Ten chunks is 160 KiB against a 64 KiB limit.
        if (index > 10) {
          this.push(null);
          return;
        }
        delivered.push(index);
        this.push(chunk);
      },
    });

    await expect(readBody(req as never)).rejects.toBeInstanceOf(PayloadTooLargeError);
    // The fifth chunk crosses 64 KiB, so the rest is never pulled from the socket.
    expect(delivered.length).toBeLessThan(10);

    const exact = Readable.from([Buffer.alloc(JSON_BODY_LIMIT_BYTES, 0x62)]);
    await expect(readBody(exact as never)).resolves.toHaveLength(JSON_BODY_LIMIT_BYTES);

    const oversizedJson = Readable.from([Buffer.alloc(JSON_BODY_LIMIT_BYTES + 1, 0x63)]);
    await expect(readJsonBody(oversizedJson as never)).rejects.toBeInstanceOf(PayloadTooLargeError);

    // A caller that needs a file-sized body raises its own limit.
    const large = Readable.from([Buffer.alloc(JSON_BODY_LIMIT_BYTES + 1, 0x64)]);
    await expect(readBody(large as never, JSON_BODY_LIMIT_BYTES * 2)).resolves.toHaveLength(JSON_BODY_LIMIT_BYTES + 1);
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
