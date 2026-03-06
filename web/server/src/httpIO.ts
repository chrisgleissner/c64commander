import type { IncomingMessage, ServerResponse } from "node:http";

export const readBody = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

export const readJsonBody = async <T>(req: IncomingMessage): Promise<T> => {
  const body = await readBody(req);
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
