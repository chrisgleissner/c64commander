/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import fs from "node:fs";
import path from "node:path";
import type { WriteStream } from "node:fs";
import type { ReplayManifest, ReplayRequest, RestRequestEntry, RestResponseEntry, TraceEntry } from "./traceSchema.js";

export function writeTraceLine(stream: WriteStream, entry: TraceEntry): void {
  const serialized = JSON.stringify(entry, (_key, value) => {
    if (typeof value === "bigint") {
      return `${String(value)}n`;
    }
    return value;
  });
  stream.write(`${serialized}\n`);
}

export function writeTraceMd(outDir: string, entries: readonly TraceEntry[]): void {
  const grouped = new Map<string, TraceEntry[]>();
  for (const entry of [...entries].sort((left, right) => left.globalSeq - right.globalSeq)) {
    const bucket = grouped.get(entry.correlationId) ?? [];
    bucket.push(entry);
    grouped.set(entry.correlationId, bucket);
  }

  const sections: string[] = [];
  for (const group of grouped.values()) {
    const first = group[0];
    if (!first) {
      continue;
    }
    const request = group.find((entry): entry is RestRequestEntry => entry.protocol === "REST" && entry.direction === "request");
    const response = group.find((entry): entry is RestResponseEntry => entry.protocol === "REST" && entry.direction === "response");
    if (request && response) {
      sections.push(renderRestGroup(request, response));
      continue;
    }
    sections.push(renderFtpGroup(group));
  }

  fs.writeFileSync(path.join(outDir, "trace.md"), `${sections.join("\n\n")}\n`, "utf8");
}

export function writeReplayManifest(outDir: string, entries: readonly TraceEntry[], baseUrl: string): void {
  const requests = buildReplayRequests(entries);
  const manifest: ReplayManifest = {
    runSessionId: entries[0]?.runSessionId ?? "unknown-run",
    generatedAt: new Date().toISOString(),
    baseUrl,
    totalEntries: entries.length,
    requests,
  };

  const replayDir = path.join(outDir, "replay");
  fs.mkdirSync(replayDir, { recursive: true });
  fs.writeFileSync(path.join(replayDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(replayDir, "device-replay.http"), `${renderRestClientReplay(requests)}\n`, "utf8");
  fs.writeFileSync(path.join(replayDir, "device-replay.sh"), `${renderCurlReplay(requests)}\n`, "utf8");
}

function buildReplayRequests(entries: readonly TraceEntry[]): ReplayRequest[] {
  return [...entries]
    .sort((left, right) => left.globalSeq - right.globalSeq)
    .flatMap((entry) => {
      if (entry.protocol === "REST" && entry.direction === "request") {
        return [
          {
            globalSeq: entry.globalSeq,
            protocol: "REST" as const,
            clientId: entry.clientId,
            launchedAtMs: entry.launchedAtMs,
            stageId: entry.stageId,
            method: entry.method,
            url: entry.url,
            headers: entry.headers,
            body: entry.body,
          },
        ];
      }
      if (entry.protocol === "FTP" && entry.direction === "command") {
        return [
          {
            globalSeq: entry.globalSeq,
            protocol: "FTP" as const,
            clientId: entry.clientId,
            launchedAtMs: entry.launchedAtMs,
            stageId: entry.stageId,
            ftpSessionId: entry.ftpSessionId,
            commandVerb: entry.commandVerb,
            rawCommand: entry.rawCommand,
          },
        ];
      }
      if (entry.protocol === "FTP" && entry.direction === "data" && entry.transferDirection === "upload") {
        return [
          {
            globalSeq: entry.globalSeq,
            protocol: "FTP" as const,
            clientId: entry.clientId,
            launchedAtMs: entry.launchedAtMs,
            stageId: entry.stageId,
            ftpSessionId: entry.ftpSessionId,
            transferDirection: entry.transferDirection,
            byteCount: entry.byteCount,
          },
        ];
      }
      return [];
    });
}

function renderRestGroup(request: RestRequestEntry, response: RestResponseEntry): string {
  const requestPath = safePathname(request.url);
  const requestHeaders = renderHeaders(request.headers);
  const responseHeaders = renderHeaders(response.headers);
  const bodyPreview = truncatePreview(JSON.stringify(response.body));
  return [
    `## [${request.globalSeq}] REST ${request.method} ${requestPath} - correlationId: ${request.correlationId}`,
    "",
    `**Stage**: ${request.stageId ?? "none"}  |  **Test type**: ${request.testType ?? "none"}`,
    `**Launched**: ${request.timestamp}  |  **Latency**: ${response.latencyMs} ms  |  **Client**: ${request.clientId}`,
    "",
    "### Request",
    `${request.method} ${request.url}`,
    requestHeaders,
    "",
    "### Response",
    `${response.status} ${response.status === 200 ? "OK" : ""}`.trim(),
    responseHeaders,
    `Body (preview): ${bodyPreview}`,
    "",
    "---",
  ].join("\n");
}

function renderFtpGroup(group: TraceEntry[]): string {
  const first = group[0];
  const title = first.direction === "command" ? `${first.protocol} ${(first as { rawCommand?: string }).rawCommand ?? ""}` : `${first.protocol} exchange`;
  const lines = [
    `## [${first.globalSeq}] ${title} - correlationId: ${first.correlationId}`,
    "",
    `**Stage**: ${first.stageId ?? "none"}  |  **Test type**: ${first.testType ?? "none"}`,
    `**Launched**: ${first.timestamp}  |  **Client**: ${first.clientId}`,
    "",
  ];
  for (const entry of group) {
    if (entry.protocol === "FTP" && entry.direction === "command") {
      lines.push(`### Command\n${entry.rawCommand}`);
      continue;
    }
    if (entry.protocol === "FTP" && entry.direction === "response") {
      lines.push(`### Response\n${entry.code}\n${truncatePreview(entry.rawResponse)}`);
      continue;
    }
    if (entry.protocol === "FTP" && entry.direction === "data") {
      lines.push(
        `### Data\n${entry.transferDirection} ${entry.byteCount} bytes in ${entry.durationMs} ms\nHex: ${truncatePreview(entry.first256Hex)}\nASCII: ${truncatePreview(entry.first256Ascii)}`,
      );
    }
  }
  lines.push("", "---");
  return lines.join("\n");
}

function renderHeaders(headers: Record<string, string>): string {
  const lines = Object.entries(headers).map(([key, value]) => `${key}: ${value}`);
  return lines.length > 0 ? lines.join("\n") : "(no headers)";
}

function truncatePreview(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value.length > 512 ? `${value.slice(0, 512)}...` : value;
}

function safePathname(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}

function renderRestClientReplay(requests: readonly ReplayRequest[]): string {
  const blocks = requests
    .filter((request) => request.protocol === "REST")
    .map((request) => {
      const method = request.method ?? "GET";
      const url = request.url ?? "";
      const headers = Object.entries(request.headers ?? {})
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");
      const authComment = Object.keys(request.headers ?? {}).some((key) => key.toLowerCase() === "authorization")
        ? "# X-Password: SET_PASSWORD_HERE\n"
        : "";
      const body = request.body === undefined ? "" : `\n${JSON.stringify(request.body, null, 2)}`;
      return [`### seq ${request.globalSeq} client ${request.clientId}`, `${authComment}${method} ${url}`, headers, body]
        .filter(Boolean)
        .join("\n");
    });
  return blocks.join("\n\n");
}

function renderCurlReplay(requests: readonly ReplayRequest[]): string {
  const restRequests = requests.filter((request) => request.protocol === "REST");
  const lines = ["#!/usr/bin/env bash", "set -euo pipefail", ""];
  for (const [index, request] of requests.entries()) {
    if (request.protocol !== "REST") {
      lines.push(`# FTP seq ${request.globalSeq}: ${request.rawCommand ?? request.commandVerb ?? "data"}`);
      continue;
    }
    lines.push(`# REST seq ${request.globalSeq} client ${request.clientId}`);
    lines.push("# X-Password: SET_PASSWORD_HERE");
    const curlParts = ["curl", "--silent", "--show-error", "--fail-with-body", "-X", shellQuote(request.method ?? "GET")];
    for (const [key, value] of Object.entries(request.headers ?? {})) {
      curlParts.push("-H", shellQuote(`${key}: ${value}`));
    }
    if (request.body !== undefined) {
      curlParts.push("--data-binary", shellQuote(JSON.stringify(request.body)));
    }
    curlParts.push(shellQuote(request.url ?? ""));
    lines.push(curlParts.join(" "));

    const nextRest = restRequests.find((candidate) => candidate.globalSeq > request.globalSeq);
    if (nextRest) {
      const delayMs = Math.min(5000, Math.max(0, nextRest.launchedAtMs - request.launchedAtMs));
      lines.push(`sleep ${(delayMs / 1000).toFixed(3)}`);
    }
    if (index < requests.length - 1) {
      lines.push("");
    }
  }
  return lines.join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}