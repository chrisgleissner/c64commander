/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import type { SidAudioPlugin } from "@/lib/native/sidAudio";

/**
 * The binary channel for WASM-rendered PCM on Android: `window.c64SidAudioPort`, installed by
 * `SidAudioPlugin` with `WebViewCompat.addWebMessageListener`.
 *
 * It carries ArrayBuffers, so a chunk reaches the native feed with one copy into the WebView's
 * message and none of the base64 encoding, string building and JSON the Capacitor bridge needs.
 * A message is a 24-byte little-endian header — magic "C64P", kind, session serial, sequence
 * number, frame count, reserved — followed by interleaved stereo S16LE. JavaScript typed arrays are
 * little-endian on every platform Android runs on, so the samples go as they are.
 */
export const PORT_OBJECT_NAME = "c64SidAudioPort";
export const PCM_HEADER_BYTES = 24;
export const PCM_HEADER_SAMPLES = PCM_HEADER_BYTES / 2;
const MAGIC = 0x50343643;
const KIND_PROBE = 0;
const KIND_PCM = 1;
const PROBE_WAIT_MS = 250;
const PROBE_ATTEMPTS = 4;

interface PortObject {
  postMessage(message: ArrayBuffer): void;
}

const portObject = (): PortObject | null => {
  const candidate = (globalThis as Record<string, unknown>)[PORT_OBJECT_NAME] as PortObject | undefined;
  return candidate && typeof candidate.postMessage === "function" ? candidate : null;
};

const writeHeader = (
  buffer: ArrayBuffer,
  offset: number,
  kind: number,
  serial: number,
  seq: number,
  frames: number,
) => {
  const view = new DataView(buffer, offset, PCM_HEADER_BYTES);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, kind, true);
  view.setUint32(8, serial >>> 0, true);
  view.setUint32(12, seq >>> 0, true);
  view.setUint32(16, frames >>> 0, true);
  view.setUint32(20, 0, true);
};

/**
 * Build the message for one chunk. When the chunk was produced with room for the header in front of
 * it (see `pcmHeadroomSamples`), the header is written into that room and the buffer is sent as it
 * is; otherwise the samples are copied once into a new buffer behind a header.
 */
export const pcmMessage = (serial: number, seq: number, pcm: Int16Array): ArrayBuffer => {
  const frames = Math.floor(pcm.length / 2);
  const buffer = pcm.buffer as ArrayBuffer;
  const inPlace = pcm.byteOffset === PCM_HEADER_BYTES && buffer.byteLength === PCM_HEADER_BYTES + frames * 4;
  if (inPlace) {
    writeHeader(buffer, 0, KIND_PCM, serial, seq, frames);
    return buffer;
  }
  const out = new ArrayBuffer(PCM_HEADER_BYTES + frames * 4);
  writeHeader(out, 0, KIND_PCM, serial, seq, frames);
  new Int16Array(out, PCM_HEADER_BYTES, frames * 2).set(pcm.subarray(0, frames * 2));
  return out;
};

let confirmed: Promise<PortObject | null> | null = null;

/**
 * The port, once it has been shown to deliver ArrayBuffers to the native side; null otherwise.
 *
 * Confirmed rather than assumed: the object can exist while the WebView turns ArrayBuffers into
 * something else, so a probe message is sent and the plugin is asked whether it arrived as one.
 * Until the answer is in, and for good if it is no, PCM takes the Capacitor bridge as base64 —
 * which is safe to mix with this channel, because every segment carries its sequence number.
 */
export const confirmedPcmPort = (plugin: SidAudioPlugin): Promise<PortObject | null> => {
  confirmed ??= (async () => {
    const port = portObject();
    if (!port) return null;
    try {
      const before = (await plugin.describe()).binaryPortProbes;
      for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt += 1) {
        const probe = new ArrayBuffer(PCM_HEADER_BYTES);
        writeHeader(probe, 0, KIND_PROBE, 0, attempt, 0);
        port.postMessage(probe);
        await new Promise((resolve) => setTimeout(resolve, PROBE_WAIT_MS));
        const description = await plugin.describe();
        if (description.binaryPortProbes > before) {
          addLog("info", "Native SID audio: binary PCM port confirmed", { service: "local-sid", attempt });
          return port;
        }
      }
      addLog("warn", "Native SID audio: the binary PCM port never delivered; using the Capacitor bridge", {
        service: "local-sid",
      });
    } catch (error) {
      addLog("warn", "Native SID audio: probing the binary PCM port failed; using the Capacitor bridge", {
        service: "local-sid",
        error: (error as Error)?.message ?? String(error),
      });
    }
    return null;
  })();
  return confirmed;
};

/** Test seam. */
export const __resetPcmPortForTests = (): void => {
  confirmed = null;
};
