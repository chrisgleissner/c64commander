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

import { VIC_BYTES_PER_FRAME, VIC_FRAME_WIDTH, VIC_PAL_HEIGHT, clampFrameHeight } from "./vicDecode";

export const VIC_HEADER_BYTES = 12;
export const VIC_BYTES_PER_LINE = VIC_FRAME_WIDTH / 2; // 192
export const VIC_LAST_LINE_FLAG = 0x8000;
/** The device always sends 4 lines per packet, 4 bits per pixel (c64stream). */
export const VIC_LINES_PER_PACKET = 4;
export const VIC_BITS_PER_PIXEL = 4;

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
  /** Frames LOST — gaps in the VIC frame-number sequence between consecutively completed frames. */
  lostFrames: number;
}

/**
 * Wrap-safe signed difference of two 16-bit frame numbers (matches c64stream's
 * `(int16_t)(a - b)`): the device's frame counter wraps 65535→0, so a raw subtraction
 * would report a spurious ~65535-frame "gap" at the wrap. Sign-extending to 16 bits makes
 * the wrap a clean +1.
 */
export const frameSeqDiff = (frame: number, prevFrame: number): number => (((frame - prevFrame) & 0xffff) << 16) >> 16;

/**
 * Assembles VIC datagrams into full 52224-byte frames. Call `ingest` per packet;
 * it returns a fresh frame buffer when a frame completes, else null. Guards against
 * malformed packets (wrong width, zero lines, out-of-bounds writes).
 */
export class VicStreamAssembler {
  private readonly frame = new Uint8Array(VIC_BYTES_PER_FRAME);
  private lastSeq: number | null = null;
  /** Frame number of the previous COMPLETED frame, for frame-loss (gap) detection. */
  private prevCompletedFrame: number | null = null;
  /** Height reported by the most recent completed frame — PAL 272 / NTSC 240. */
  frameHeight: number = VIC_PAL_HEIGHT;
  readonly stats: VicStreamStats = { packets: 0, ignored: 0, frames: 0, droppedPackets: 0, lostFrames: 0 };

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

    // Guard: match c64stream's format validation exactly (width 384, 4 lines/packet,
    // 4 bits/pixel). Anything else is a malformed/foreign packet.
    if (
      header.width !== VIC_FRAME_WIDTH ||
      header.linesPerPacket !== VIC_LINES_PER_PACKET ||
      header.bpp !== VIC_BITS_PER_PIXEL
    ) {
      this.stats.ignored += 1;
      return header.lastLine ? this.completeFrame(header) : null;
    }

    const writeOffset = header.line * VIC_BYTES_PER_LINE;
    if (writeOffset < VIC_BYTES_PER_FRAME) {
      const available = VIC_BYTES_PER_FRAME - writeOffset;
      const payload = packet.subarray(header.payloadOffset);
      const count = Math.min(payload.length, header.linesPerPacket * VIC_BYTES_PER_LINE, available);
      if (count > 0) this.frame.set(payload.subarray(0, count), writeOffset);
    }

    return header.lastLine ? this.completeFrame(header) : null;
  }

  private completeFrame(header: VicPacketHeader): Uint8Array {
    // c64stream derives the frame height from the last packet: line + linesPerPacket.
    this.frameHeight = clampFrameHeight(header.line + (header.linesPerPacket || VIC_LINES_PER_PACKET));
    // Frame-loss: a jump of >1 in the frame number between consecutively completed frames means the
    // intervening frame(s) never completed (their last-line packet was lost). Wrap-safe (65535→0).
    if (this.prevCompletedFrame !== null) {
      const gap = frameSeqDiff(header.frame, this.prevCompletedFrame);
      if (gap > 1) this.stats.lostFrames += gap - 1;
    }
    this.prevCompletedFrame = header.frame;
    this.stats.frames += 1;
    return this.frame.slice();
  }

  reset(): void {
    this.frame.fill(0);
    this.lastSeq = null;
    this.prevCompletedFrame = null;
    this.frameHeight = VIC_PAL_HEIGHT;
    this.stats.packets = 0;
    this.stats.ignored = 0;
    this.stats.frames = 0;
    this.stats.droppedPackets = 0;
    this.stats.lostFrames = 0;
  }
}
