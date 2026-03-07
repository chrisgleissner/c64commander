/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import dgram from "node:dgram";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { StreamCapturePacket, StreamCaptureResult, StreamType } from "./types.js";
import { analyzeAudioPackets, analyzeVideoPackets } from "./analysis.js";

const DEFAULT_STREAM_PORT: Record<StreamType, number> = {
  video: 11000,
  audio: 11001,
};

const DEFAULT_STREAM_DESTINATION: Record<StreamType, string> = {
  video: "239.0.1.64:11000",
  audio: "239.0.1.65:11001",
};

export interface CaptureAndAnalyzeInput {
  streamType: StreamType;
  c64uHost: string;
  artifactDir: string;
  durationMs: number;
  bindAddress?: string;
  bindPort?: number;
  destinationIp?: string;
}

export interface CaptureAndAnalyzeResult {
  capture: StreamCaptureResult;
  analysisPath: string;
  packetsPath: string;
  analysis: Record<string, unknown>;
}

export async function captureAndAnalyzeStream(input: CaptureAndAnalyzeInput): Promise<CaptureAndAnalyzeResult> {
  const destination = resolveStreamDestination(input.streamType, input.destinationIp, input.bindPort);
  const bindAddress = input.bindAddress ?? "0.0.0.0";
  const bindPort = input.bindPort ?? destination.port;

  const packets = await captureUdpPackets({
    streamType: input.streamType,
    c64uHost: input.c64uHost,
    destination,
    bindAddress,
    bindPort,
    durationMs: input.durationMs,
  });

  const capture: StreamCaptureResult = {
    streamType: input.streamType,
    durationMs: input.durationMs,
    bindAddress,
    bindPort,
    destination: destination.endpoint,
    packets,
  };

  const analysis = input.streamType === "audio" ? analyzeAudioPackets(packets) : analyzeVideoPackets(packets);

  const analysisPath = path.join(input.artifactDir, `${input.streamType}-stream-analysis.json`);
  const packetsPath = path.join(input.artifactDir, `${input.streamType}-stream-packets.bin`);

  await writeFile(analysisPath, JSON.stringify(analysis, null, 2), "utf-8");
  await writeFile(packetsPath, Buffer.concat(packets.map((packet) => packet.payload)));

  return {
    capture,
    analysisPath,
    packetsPath,
    analysis: analysis as unknown as Record<string, unknown>,
  };
}

async function captureUdpPackets(input: {
  streamType: StreamType;
  c64uHost: string;
  destination: StreamDestination;
  bindAddress: string;
  bindPort: number;
  durationMs: number;
}): Promise<StreamCapturePacket[]> {
  const socket = dgram.createSocket("udp4");
  const packets: StreamCapturePacket[] = [];
  const startMs = Date.now();
  let startSucceeded = false;
  let startRecoverableError: Error | undefined;
  let runError: Error | undefined;
  let stopError: Error | undefined;

  const started = new Promise<void>((resolve, reject) => {
    socket.once("error", (err) => {
      reject(new Error(`UDP capture socket error: ${err.message}`));
    });

    socket.bind(input.bindPort, input.bindAddress, () => {
      if (input.destination.isMulticast) {
        if (input.bindAddress === "0.0.0.0") {
          socket.addMembership(input.destination.host);
        } else {
          socket.addMembership(input.destination.host, input.bindAddress);
        }
      }
      resolve();
    });

    socket.on("message", (msg) => {
      packets.push({
        receivedAtMs: Date.now() - startMs,
        payload: Buffer.from(msg),
      });
    });
  });

  try {
    await started;
    try {
      await setC64uStream(input.c64uHost, input.streamType, "start", input.destination.endpoint);
      startSucceeded = true;
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (isRecoverableStartError(normalized)) {
        startRecoverableError = normalized;
      } else {
        throw normalized;
      }
    }
    await sleep(input.durationMs);
  } catch (error: unknown) {
    runError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (startSucceeded || startRecoverableError) {
      try {
        await setC64uStream(input.c64uHost, input.streamType, "stop");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        stopError = new Error(`Failed to stop C64U ${input.streamType} stream: ${message}`);
      }
    }
    socket.close();
  }

  if (runError) {
    throw runError;
  }
  if (packets.length === 0) {
    if (startRecoverableError) {
      throw new Error(
        `No UDP packets captured after recoverable stream start response (${startRecoverableError.message}). ` +
        `Destination was ${input.destination.endpoint} bound to ${input.bindAddress}:${input.bindPort}.`,
      );
    }
    throw new Error(
      `No UDP packets captured for ${input.streamType} stream on ${input.bindAddress}:${input.bindPort} ` +
      `(destination ${input.destination.endpoint}) during ${input.durationMs}ms.`,
    );
  }
  if (stopError) {
    throw stopError;
  }

  return packets;
}

function isRecoverableStartError(error: Error): boolean {
  if (error.name === "TimeoutError") {
    return true;
  }
  return (
    error.message.includes("C64U stream start failed (404)") &&
    error.message.toLowerCase().includes("network host resolve error")
  );
}

const STREAM_REQUEST_TIMEOUT_MS = 5000;

async function setC64uStream(
  c64uHost: string,
  streamType: StreamType,
  action: "start" | "stop",
  destination?: string,
): Promise<void> {
  const endpoint =
    action === "start"
      ? `http://${c64uHost}/v1/streams/${encodeURIComponent(streamType)}:start?ip=${encodeURIComponent(destination ?? "")}`
      : `http://${c64uHost}/v1/streams/${encodeURIComponent(streamType)}:stop`;

  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(STREAM_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`C64U stream ${action} failed (${response.status}): ${body.slice(0, 300)}`);
  }
}

interface StreamDestination {
  host: string;
  port: number;
  endpoint: string;
  isMulticast: boolean;
}

function resolveStreamDestination(
  streamType: StreamType,
  destinationIp?: string,
  overridePort?: number,
): StreamDestination {
  const raw = destinationIp?.trim() || DEFAULT_STREAM_DESTINATION[streamType];
  const parsed = parseHostPort(raw, DEFAULT_STREAM_PORT[streamType]);
  const port = overridePort ?? parsed.port;
  const endpoint = `${parsed.host}:${port}`;
  return {
    host: parsed.host,
    port,
    endpoint,
    isMulticast: isMulticastIpv4(parsed.host),
  };
}

function parseHostPort(value: string, defaultPort: number): { host: string; port: number } {
  const trimmed = value.trim();
  const idx = trimmed.lastIndexOf(":");
  if (idx <= 0 || idx === trimmed.length - 1) {
    return { host: trimmed, port: defaultPort };
  }
  const host = trimmed.slice(0, idx);
  const maybePort = Number.parseInt(trimmed.slice(idx + 1), 10);
  if (!Number.isFinite(maybePort) || maybePort < 1 || maybePort > 65535) {
    return { host: trimmed, port: defaultPort };
  }
  return { host, port: maybePort };
}

function isMulticastIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const first = Number.parseInt(parts[0] ?? "", 10);
  return Number.isFinite(first) && first >= 224 && first <= 239;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
