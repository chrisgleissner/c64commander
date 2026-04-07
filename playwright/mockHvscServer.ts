/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { strToU8, zipSync } from "fflate";
import { ensureValidSidBase64 } from "./sidFixture";

export type HvscFixture = {
  version: number;
  songs: Array<{
    virtualPath: string;
    fileName: string;
    dataBase64: string;
    durationSeconds?: number;
    durations?: number[];
  }>;
};

export interface MockHvscServer {
  baseUrl: string;
  close: () => Promise<void>;
  baseline: HvscFixture;
  update: HvscFixture;
  clearRequestLog: () => void;
  getRequestLog: () => MockHvscRequestLogEntry[];
}

export type MockHvscRequestLogEntry = {
  method: string;
  path: string;
  statusCode: number;
  bytesSent: number;
  contentLength: number;
  durationMs: number;
  startedAt: string;
  endedAt: string;
};

export type MockHvscServerOptions = {
  baselineFixtureName?: string;
  updateFixtureName?: string;
  baselineArchivePath?: string;
  updateArchivePath?: string;
  bytesPerSecond?: number;
  chunkSizeBytes?: number;
  logRequests?: boolean;
};

const readFixture = <T>(name: string): T => {
  const filePath = path.resolve("playwright/fixtures/hvsc", name);
  const fixture = JSON.parse(fs.readFileSync(filePath, "utf8")) as HvscFixture;
  return {
    ...fixture,
    songs: fixture.songs.map((song) => ({
      ...song,
      dataBase64: ensureValidSidBase64(song.dataBase64, song.durations?.length ?? 1),
    })),
  } as T;
};

const readArchiveBuffer = (archivePath: string | undefined, fallbackFactory: () => Buffer) => {
  if (!archivePath) return fallbackFactory();
  return fs.readFileSync(path.resolve(archivePath));
};

const buildVersionedArchiveName = (prefix: "HVSC" | "HVSC_Update", version: number) =>
  prefix === "HVSC" ? `HVSC_${version}-all-of-them.7z` : `HVSC_Update_${version}.7z`;

const buildArchiveBody = (fixture: HvscFixture) => {
  const formatDuration = (seconds?: number) => {
    const total = Math.max(0, seconds ?? 0);
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return `${minutes}:${String(secs).padStart(2, "0")}`;
  };
  const buildArchive = (fixture: HvscFixture) => {
    const files: Record<string, Uint8Array> = {};
    fixture.songs.forEach((song) => {
      const pathPart = song.virtualPath.replace(/^\//, "");
      files[`HVSC/${pathPart}`] = Buffer.from(song.dataBase64, "base64");
    });
    const songlengths = fixture.songs
      .map((song) => {
        const path = song.virtualPath.replace(/^\//, "");
        if (song.durations?.length) {
          return `${path}= ${song.durations.map((d) => formatDuration(d)).join(" ")}`;
        }
        return `${path} ${formatDuration(song.durationSeconds)}`;
      })
      .join("\n");
    files["C64Music/DOCUMENTS/Songlengths.txt"] = strToU8(songlengths);
    return Buffer.from(zipSync(files));
  };
  return buildArchive(fixture);
};

const writeArchiveResponse = async (
  res: http.ServerResponse,
  body: Buffer,
  options: { bytesPerSecond?: number; chunkSizeBytes?: number },
) => {
  const configuredBytesPerSecond = options.bytesPerSecond;
  if (configuredBytesPerSecond !== undefined && !Number.isFinite(configuredBytesPerSecond)) {
    throw new TypeError(`Invalid bytesPerSecond value: ${String(configuredBytesPerSecond)}`);
  }

  const bytesPerSecond = configuredBytesPerSecond ?? 0;
  if (!bytesPerSecond || bytesPerSecond <= 0 || body.byteLength === 0) {
    res.end(body);
    return body.byteLength;
  }

  const chunkSize = Math.max(1024, (options.chunkSizeBytes ?? Math.floor(bytesPerSecond / 10)) || 1024);
  const intervalMs = Math.max(10, Math.floor((chunkSize / bytesPerSecond) * 1000));

  return await new Promise<number>((resolve) => {
    let offset = 0;
    const timer = setInterval(() => {
      if (offset >= body.byteLength) {
        clearInterval(timer);
        res.end();
        resolve(body.byteLength);
        return;
      }
      const nextOffset = Math.min(body.byteLength, offset + chunkSize);
      res.write(body.subarray(offset, nextOffset));
      offset = nextOffset;
      if (offset >= body.byteLength) {
        clearInterval(timer);
        res.end();
        resolve(body.byteLength);
      }
    }, intervalMs);
  });
};

export function createMockHvscServer(options: MockHvscServerOptions = {}): Promise<MockHvscServer> {
  if (options.bytesPerSecond !== undefined && !Number.isFinite(options.bytesPerSecond)) {
    throw new TypeError(`Invalid bytesPerSecond value: ${String(options.bytesPerSecond)}`);
  }

  const baseline = readFixture<HvscFixture>(options.baselineFixtureName ?? "baseline.json");
  const update = readFixture<HvscFixture>(options.updateFixtureName ?? "update.json");
  const baselineArchive = readArchiveBuffer(options.baselineArchivePath, () => buildArchiveBody(baseline));
  const updateArchive = readArchiveBuffer(options.updateArchivePath, () => buildArchiveBody(update));
  const requestLog: MockHvscRequestLogEntry[] = [];
  const logRequest = (entry: MockHvscRequestLogEntry) => {
    requestLog.push(entry);
    if (options.logRequests) {
      process.stdout.write(
        `[mock-hvsc] ${entry.method} ${entry.path} ${entry.statusCode} ${entry.bytesSent}B ${entry.durationMs.toFixed(1)}ms\n`,
      );
    }
  };

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };

  const sendJson = (res: http.ServerResponse, statusCode: number, body: unknown) => {
    res.writeHead(statusCode, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify(body));
  };

  const sendBuffer = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    statusCode: number,
    buffer: Buffer,
    contentType: string,
  ) => {
    res.writeHead(statusCode, {
      "Content-Type": contentType,
      "Content-Length": String(buffer.byteLength),
      ...corsHeaders,
    });
    if (req.method === "HEAD") {
      res.end();
      return 0;
    }
    return await writeArchiveResponse(res, buffer, {
      bytesPerSecond: options.bytesPerSecond,
      chunkSizeBytes: options.chunkSizeBytes,
    });
  };

  const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const startedAtMs = performance.now();
    const startedAt = new Date().toISOString();
    const url = req.url ?? "/";
    let statusCode = 500;
    let bytesSent = 0;
    let contentLength = 0;

    if (req.method === "OPTIONS") {
      statusCode = 204;
      res.writeHead(204, corsHeaders);
      res.end();
    } else if (url === "/" || url === "/hvsc" || url === "/hvsc/") {
      statusCode = 200;
      const baselineArchiveName = buildVersionedArchiveName("HVSC", baseline.version);
      const updateArchiveName = buildVersionedArchiveName("HVSC_Update", update.version);
      const html = `
        <html>
          <a href="${baselineArchiveName}">${baselineArchiveName}</a>
          <a href="${updateArchiveName}">${updateArchiveName}</a>
        </html>
      `;
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Content-Length": String(Buffer.byteLength(html)),
        ...corsHeaders,
      });
      if (req.method === "HEAD") {
        res.end();
      } else {
        res.end(html);
        bytesSent = Buffer.byteLength(html);
      }
      contentLength = Buffer.byteLength(html);
    } else if (url.startsWith(`/hvsc/${buildVersionedArchiveName("HVSC", baseline.version)}`)) {
      statusCode = 200;
      bytesSent = await sendBuffer(req, res, 200, baselineArchive, "application/x-7z-compressed");
      contentLength = baselineArchive.byteLength;
    } else if (url.startsWith(`/hvsc/${buildVersionedArchiveName("HVSC_Update", update.version)}`)) {
      statusCode = 200;
      bytesSent = await sendBuffer(req, res, 200, updateArchive, "application/x-7z-compressed");
      contentLength = updateArchive.byteLength;
    } else if (url.startsWith("/hvsc/archive/baseline")) {
      statusCode = 200;
      bytesSent = await sendBuffer(req, res, 200, baselineArchive, "application/x-7z-compressed");
      contentLength = baselineArchive.byteLength;
    } else if (url.startsWith("/hvsc/archive/update")) {
      statusCode = 200;
      bytesSent = await sendBuffer(req, res, 200, updateArchive, "application/x-7z-compressed");
      contentLength = updateArchive.byteLength;
    } else if (url.startsWith("/hvsc/fixtures/baseline.json")) {
      statusCode = 200;
      sendJson(res, 200, baseline);
    } else if (url.startsWith("/hvsc/fixtures/update.json")) {
      statusCode = 200;
      sendJson(res, 200, update);
    } else {
      statusCode = 404;
      sendJson(res, 404, { error: "Not found" });
    }

    const endedAt = new Date().toISOString();
    logRequest({
      method: req.method ?? "GET",
      path: url,
      statusCode,
      bytesSent,
      contentLength,
      durationMs: Number((performance.now() - startedAtMs).toFixed(3)),
      startedAt,
      endedAt,
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("Unexpected server address");
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        baseUrl,
        baseline,
        update,
        clearRequestLog: () => {
          requestLog.splice(0, requestLog.length);
        },
        getRequestLog: () => requestLog.map((entry) => ({ ...entry })),
        close: () => new Promise((resClose) => server.close(() => resClose())),
      });
    });
  });
}
