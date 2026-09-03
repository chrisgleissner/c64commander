import type { IncomingMessage, ServerResponse } from "node:http";

// HARD27-009: request bodies were concatenated with no cap, including on
// /auth/login, which any unauthenticated LAN client can reach. A body larger
// than the limit is refused as soon as the limit is crossed, so the remainder is
// never buffered.
export class PayloadTooLargeError extends Error {
  readonly limitBytes: number;

  constructor(limitBytes: number) {
    super(`Request body exceeds ${limitBytes} bytes`);
    this.name = "PayloadTooLargeError";
    this.limitBytes = limitBytes;
  }
}

// A JSON control message. The largest one the app sends is a saved-device list.
export const JSON_BODY_LIMIT_BYTES = 64 * 1024;

// A file transferred through the FTP write endpoint, matching the Android
// plugin's 32 MiB maxReadFileBytes. The JSON envelope carries the file
// base64-encoded, which inflates it by a third, so the body limit allows for
// that expansion and the surrounding JSON.
export const FILE_BYTES_LIMIT = 32 * 1024 * 1024;
export const FILE_BODY_LIMIT_BYTES = 48 * 1024 * 1024;

export const readBody = async (req: IncomingMessage, limitBytes = JSON_BODY_LIMIT_BYTES): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limitBytes) {
      // Stop consuming rather than destroying the socket: the caller still has
      // to send the 413, and Node closes the connection itself once a response
      // finishes on an incomplete request.
      req.pause();
      throw new PayloadTooLargeError(limitBytes);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

export const readJsonBody = async <T>(req: IncomingMessage, limitBytes = JSON_BODY_LIMIT_BYTES): Promise<T> => {
  const body = await readBody(req, limitBytes);
  if (body.length === 0) {
    return {} as T;
  }
  return JSON.parse(body.toString("utf8")) as T;
};

export const writeJson = (res: ServerResponse, status: number, payload: unknown) => {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
  });
  res.end(body);
};

export const writeText = (
  res: ServerResponse,
  status: number,
  body: string,
  contentType = "text/plain; charset=utf-8",
  cacheControl = "no-store",
) => {
  const data = Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": String(data.length),
    "Cache-Control": cacheControl,
  });
  res.end(data);
};

export const writeBuffer = (
  res: ServerResponse,
  status: number,
  data: Buffer,
  contentType = "application/octet-stream",
  cacheControl = "no-store",
) => {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": String(data.length),
    "Cache-Control": cacheControl,
  });
  res.end(data);
};
