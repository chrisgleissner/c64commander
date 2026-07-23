/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer capability E — VIC video stream de-packetize + frame assembly.
 *
 * Wire format (/v1/streams/video, default UDP 11000), 12-byte header then payload,
 * all multi-byte fields little-endian:
 *   u16 seq | u16 frame | u16 lineRaw | u16 width | u8 linesPerPacket | u8 bpp | u16 enc
 * line = lineRaw & 0x7FFF; last-line-of-frame flag = lineRaw & 0x8000. Payload for a
 * line group is written at byte offset line * (384/2). A frame is complete when the
 * last-line flag is seen (~68 packets/frame).
 */

import { VIC_BYTES_PER_FRAME, VIC_FRAME_WIDTH } from "./vicDecode";

export const VIC_HEADER_BYTES = 12;
export const VIC_BYTES_PER_LINE = VIC_FRAME_WIDTH / 2; // 192
export const VIC_LAST_LINE_FLAG = 0x8000;

export interface VicPacketHeader {
  seq: number;
  frame: number;
  line: number;
  lastLine: boolean;
  width: number;
  linesPerPacket: number;
  bpp: number;
  enc: number;
  payloadOffset: number;
}

/** Parse the 12-byte header, or null if the datagram is too short. */
export const parseVicHeader = (packet: Uint8Array): VicPacketHeader | null => {
  if (packet.length < VIC_HEADER_BYTES) return null;
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const lineRaw = view.getUint16(4, true);
  return {
    seq: view.getUint16(0, true),
    frame: view.getUint16(2, true),
    line: lineRaw & 0x7fff,
    lastLine: (lineRaw & VIC_LAST_LINE_FLAG) !== 0,
    width: view.getUint16(6, true),
    linesPerPacket: packet[8],
    bpp: packet[9],
    enc: view.getUint16(10, true),
    payloadOffset: VIC_HEADER_BYTES,
  };
};

export interface VicStreamStats {
  packets: number;
  ignored: number;
  frames: number;
  droppedPackets: number;
}

/**
 * Assembles VIC datagrams into full 52224-byte frames. Call `ingest` per packet;
 * it returns a fresh frame buffer when a frame completes, else null. Guards against
 * malformed packets (wrong width, zero lines, out-of-bounds writes).
 */
export class VicStreamAssembler {
  private readonly frame = new Uint8Array(VIC_BYTES_PER_FRAME);
  private lastSeq: number | null = null;
  readonly stats: VicStreamStats = { packets: 0, ignored: 0, frames: 0, droppedPackets: 0 };

  ingest(packet: Uint8Array): Uint8Array | null {
    const header = parseVicHeader(packet);
    if (!header) {
      this.stats.ignored += 1;
      return null;
    }
    this.stats.packets += 1;

    if (this.lastSeq !== null) {
      const gap = (header.seq - this.lastSeq - 1) & 0xffff;
      if (gap > 0 && gap < 0x8000) this.stats.droppedPackets += gap;
    }
    this.lastSeq = header.seq;

    // Guard: only accept full-width, non-empty line groups.
    if (header.width !== VIC_FRAME_WIDTH || header.linesPerPacket === 0) {
      this.stats.ignored += 1;
      return header.lastLine ? this.completeFrame() : null;
    }

    const writeOffset = header.line * VIC_BYTES_PER_LINE;
    if (writeOffset < VIC_BYTES_PER_FRAME) {
      const available = VIC_BYTES_PER_FRAME - writeOffset;
      const payload = packet.subarray(header.payloadOffset);
      const count = Math.min(payload.length, header.linesPerPacket * VIC_BYTES_PER_LINE, available);
      if (count > 0) this.frame.set(payload.subarray(0, count), writeOffset);
    }

    return header.lastLine ? this.completeFrame() : null;
  }

  private completeFrame(): Uint8Array {
    this.stats.frames += 1;
    return this.frame.slice();
  }

  reset(): void {
    this.frame.fill(0);
    this.lastSeq = null;
    this.stats.packets = 0;
    this.stats.ignored = 0;
    this.stats.frames = 0;
    this.stats.droppedPackets = 0;
  }
}
