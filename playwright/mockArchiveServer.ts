/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as http from "node:http";
import type { ServerResponse } from "node:http";
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

export type MockArchiveServer = {
  host: string;
  baseUrl: string;
  requests: ArchiveMockRequest[];
  close: () => Promise<void>;
};

const DEFAULT_FIXTURES: ArchiveMockFixtures = {
  presets: [
    { type: "category", description: "Category", values: [{ aqlKey: "apps", name: "Apps" }] },
    {
      type: "type",
      description: "Type",
      values: [
        { aqlKey: "sid", name: "SID" },
        { aqlKey: "d64", name: "D64" },
      ],
    },
    { type: "sort", description: "Sort", values: [{ aqlKey: "name", name: "Name" }] },
    { type: "order", description: "Order", values: [{ aqlKey: "asc", name: "Ascending" }] },
    { type: "date", description: "Date", values: [{ aqlKey: "2024", name: "2024" }] },
  ],
  searchByQuery: {},
  entriesByResultKey: {},
  binariesByEntryKey: {},
};

const sendJson = (res: ServerResponse, status: number, value: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
};

const setCorsHeaders = (res: ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Accept-Encoding, Client-Id, User-Agent");
};

const decodeQuery = (url: URL) => url.searchParams.get("query") ?? "";
const resultKey = (id: string, category: string | number) => `${id}:${category}`;
const binaryKey = (id: string, category: string | number, index: string | number) => `${id}:${category}:${index}`;

export const createMockArchiveServer = async (
  fixtures: Partial<ArchiveMockFixtures> = {},
): Promise<MockArchiveServer> => {
  const mergedFixtures: ArchiveMockFixtures = {
    ...DEFAULT_FIXTURES,
    ...fixtures,
  };
  const requests: ArchiveMockRequest[] = [];
  const server = http.createServer((req, res) => {
    setCorsHeaders(res);
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push({ method, url: url.pathname + url.search, headers: req.headers });

    if (method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (method === "GET" && url.pathname === "/leet/search/aql/presets") {
      sendJson(res, 200, mergedFixtures.presets);
      return;
    }

    if (method === "GET" && url.pathname === "/leet/search/aql") {
      sendJson(res, 200, mergedFixtures.searchByQuery[decodeQuery(url)] ?? []);
      return;
    }

    const entriesMatch = url.pathname.match(/^\/leet\/search\/entries\/([^/]+)\/(\d+)$/);
    if (method === "GET" && entriesMatch) {
      sendJson(res, 200, {
        contentEntry: mergedFixtures.entriesByResultKey[resultKey(entriesMatch[1], entriesMatch[2])] ?? [],
      });
      return;
    }

    const binaryMatch = url.pathname.match(/^\/leet\/search\/bin\/([^/]+)\/(\d+)\/(\d+)$/);
    if (method === "GET" && binaryMatch) {
      const binary = mergedFixtures.binariesByEntryKey[binaryKey(binaryMatch[1], binaryMatch[2], binaryMatch[3])];
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
