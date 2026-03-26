import * as http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ArchiveEntry, ArchivePreset, ArchiveSearchResult } from "@/lib/archive/types";

export type ArchiveMockFixtures = {
  presets: ArchivePreset[];
  searchByQuery: Record<string, ArchiveSearchResult[]>;
  entriesByResultKey: Record<string, ArchiveEntry[]>;
  binariesByEntryKey: Record<string, Uint8Array>;
};

export type ArchiveMockRequest = {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
};

export type ArchiveMockServer = {
  host: string;
  baseUrl: string;
  requests: ArchiveMockRequest[];
  close: () => Promise<void>;
};

export type ArchiveMockConfig = {
  fixtures: ArchiveMockFixtures;
  expectedClientId: string;
  expectedUserAgent: string;
};

const sendJson = (res: ServerResponse, status: number, value: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
};

const decodeQuery = (url: URL) => url.searchParams.get("query") ?? "";

const resultKey = (id: string, category: string | number) => `${id}:${category}`;
const binaryKey = (id: string, category: string | number, index: string | number) => `${id}:${category}:${index}`;

const validateHeaders = (req: IncomingMessage, config: ArchiveMockConfig) => {
  if (req.headers["accept-encoding"] !== "identity") return false;
  if (req.headers["client-id"] !== config.expectedClientId) return false;
  if (req.headers["user-agent"] !== config.expectedUserAgent) return false;
  return true;
};

export const createBaseArchiveMock = async (config: ArchiveMockConfig): Promise<ArchiveMockServer> => {
  const requests: ArchiveMockRequest[] = [];
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push({ method, url: url.pathname + url.search, headers: req.headers });

    if (!validateHeaders(req, config)) {
      sendJson(res, 200, { errorCode: 464, timestamp: Date.now() });
      return;
    }

    if (method === "GET" && url.pathname === "/leet/search/aql/presets") {
      sendJson(res, 200, config.fixtures.presets);
      return;
    }

    if (method === "GET" && url.pathname === "/leet/search/aql") {
      sendJson(res, 200, config.fixtures.searchByQuery[decodeQuery(url)] ?? []);
      return;
    }

    const entriesMatch = url.pathname.match(/^\/leet\/search\/entries\/([^/]+)\/(\d+)$/);
    if (method === "GET" && entriesMatch) {
      sendJson(res, 200, {
        contentEntry: config.fixtures.entriesByResultKey[resultKey(entriesMatch[1], entriesMatch[2])] ?? [],
      });
      return;
    }

    const binaryMatch = url.pathname.match(/^\/leet\/search\/bin\/([^/]+)\/(\d+)\/(\d+)$/);
    if (method === "GET" && binaryMatch) {
      const binary = config.fixtures.binariesByEntryKey[binaryKey(binaryMatch[1], binaryMatch[2], binaryMatch[3])];
      if (!binary) {
        res.statusCode = 404;
        res.end("missing");
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/octet-stream");
      res.end(Buffer.from(binary));
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  const host = `127.0.0.1:${address.port}`;
  return {
    host,
    baseUrl: `http://${host}`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
};
