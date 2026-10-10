/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { VIC_BYTES_PER_FRAME } from "./vicDecode";
import { VIC_BYTES_PER_LINE } from "./vicStream";

type Base64Decoder = (base64: string) => Uint8Array;

const decodeWithAtob: Base64Decoder = (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const nativeFromBase64 = (Uint8Array as unknown as { fromBase64?: Base64Decoder }).fromBase64;

/** `Uint8Array.fromBase64` where the WebView has it (Chrome 140+), the `atob` loop otherwise. */
export const base64ToBytes: Base64Decoder = nativeFromBase64
  ? (base64) => nativeFromBase64.call(Uint8Array, base64)
  : decodeWithAtob;

export const WHOLE_FRAME = -1;

export type VideoFrameSpan = {
  data: string;
  /** First line the payload covers. Absent from plugin builds that always send the whole frame. */
  firstLine?: number;
  /** Lines in the payload: {@link WHOLE_FRAME} for a whole frame, 0 when nothing changed. */
  lineCount?: number;
};

/**
 * Rebuilds each presented frame from the span of lines the native assembler sent for it.
 *
 * A frame is a new array whenever any line changed, so a consumer that keeps the previous frame to compare against
 * still holds what it saw. A frame with no changed lines is the previous array itself.
 */
export class VideoFrameDeltaDecoder {
  private latest: Uint8Array | null = null;
  private waitingForWholeFrame = false;

  constructor(private readonly decode: Base64Decoder = base64ToBytes) {}

  /** The frame this span completes, or null when there is no whole frame yet to apply it to. */
  apply(span: VideoFrameSpan): Uint8Array | null {
    const lineCount = span.lineCount ?? WHOLE_FRAME;
    if (lineCount === WHOLE_FRAME) {
      if (this.waitingForWholeFrame) addLog("info", "Live View received a whole video frame and shows changes again");
      this.waitingForWholeFrame = false;
      this.latest = this.decode(span.data);
      return this.latest;
    }
    if (!this.latest) {
      if (!this.waitingForWholeFrame) {
        addLog("warn", "Live View received changed video lines before a whole frame, and waits for the next one", {
          firstLine: span.firstLine,
          lineCount,
        });
      }
      this.waitingForWholeFrame = true;
      return null;
    }
    if (lineCount === 0) return this.latest;
    const lines = this.decode(span.data);
    const offset = (span.firstLine ?? 0) * VIC_BYTES_PER_LINE;
    if (lines.length !== lineCount * VIC_BYTES_PER_LINE || offset < 0 || offset + lines.length > VIC_BYTES_PER_FRAME) {
      throw new Error(
        `Video frame span out of range: firstLine=${span.firstLine} lineCount=${lineCount} bytes=${lines.length}`,
      );
    }
    const next = this.latest.slice();
    next.set(lines, offset);
    this.latest = next;
    return next;
  }
}
