/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import dgram from "node:dgram";
import dns from "node:dns/promises";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { StreamCapturePacket, StreamCaptureResult, StreamType } from "./types.js";
import { analyzeAudioPackets, analyzeVideoPackets } from "./analysis.js";

const DEFAULT_STREAM_PORT: Record<StreamType, number> = {
  video: 11000,
  audio: 11001,
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
  const bindAddress = input.bindAddress ?? "0.0.0.0";
  const bindPort = input.bindPort ?? DEFAULT_STREAM_PORT[input.streamType];
  const destinationIp = input.destinationIp ?? (await resolveLocalAddressForHost(input.c64uHost));
  const destination = `${destinationIp}:${bindPort}`;

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
    destination,
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
  destination: string;
  bindAddress: string;
  bindPort: number;
  durationMs: number;
}): Promise<StreamCapturePacket[]> {
  const socket = dgram.createSocket("udp4");
  const packets: StreamCapturePacket[] = [];
  const startMs = Date.now();
  let startSucceeded = false;
  let runError: Error | undefined;
  let stopError: Error | undefined;

  const started = new Promise<void>((resolve, reject) => {
    socket.once("error", (err) => {
      reject(new Error(`UDP capture socket error: ${err.message}`));
    });

    socket.bind(input.bindPort, input.bindAddress, () => {
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
    await setC64uStream(input.c64uHost, input.streamType, "start", input.destination);
    startSucceeded = true;
    await sleep(input.durationMs);
  } catch (error: unknown) {
    runError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (startSucceeded) {
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
  if (stopError) {
    throw stopError;
  }

  return packets;
}

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
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`C64U stream ${action} failed (${response.status}): ${body.slice(0, 300)}`);
  }
}

async function resolveLocalAddressForHost(host: string): Promise<string> {
  const resolved = await dns.lookup(host, { family: 4 });
  const socket = dgram.createSocket("udp4");

  const address = await new Promise<string>((resolve, reject) => {
    socket.once("error", reject);
    socket.connect(80, resolved.address, () => {
      const localAddress = socket.address();
      if (typeof localAddress === "string") {
        reject(new Error("Unexpected unix socket address while resolving local IP"));
        return;
      }
      resolve(localAddress.address);
    });
  });

  socket.close();
  return address;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
