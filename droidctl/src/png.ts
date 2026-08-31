/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { deflateSync, inflateSync } from "node:zlib";

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, 8 bits per channel, row-major. */
  readonly pixels: Buffer;
}

export interface PngDimensions {
  readonly width: number;
  readonly height: number;
}

const CHANNELS_BY_COLOR_TYPE: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function readPngDimensions(png: Buffer): PngDimensions {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Not a PNG: signature missing.");
  }
  if (png.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Not a PNG: first chunk is not IHDR.");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(png: Buffer): PngImage {
  const { width, height } = readPngDimensions(png);
  const bitDepth = png.readUInt8(24);
  const colorType = png.readUInt8(25);
  const interlace = png.readUInt8(28);
  const channels = CHANNELS_BY_COLOR_TYPE[colorType];

  if (bitDepth !== 8 || channels === undefined || interlace !== 0) {
    throw new Error(
      `Unsupported PNG variant: bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}. ` +
        "droidctl decodes 8-bit non-interlaced greyscale, RGB, greyscale+alpha and RGBA, which is what screencap emits.",
    );
  }

  const idat: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    if (type === "IDAT") {
      idat.push(png.subarray(start, start + length));
    }
    if (type === "IEND") {
      break;
    }
    offset = start + length + 4;
  }
  if (idat.length === 0) {
    throw new Error("PNG has no IDAT chunk.");
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw.readUInt8(rowStart);
    raw.copy(current, 0, rowStart + 1, rowStart + 1 + stride);

    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? current[i - channels]! : 0;
      const up = previous[i]!;
      const upLeft = i >= channels ? previous[i - channels]! : 0;
      const value = current[i]!;
      switch (filter) {
        case 0:
          break;
        case 1:
          current[i] = (value + left) & 0xff;
          break;
        case 2:
          current[i] = (value + up) & 0xff;
          break;
        case 3:
          current[i] = (value + ((left + up) >> 1)) & 0xff;
          break;
        case 4:
          current[i] = (value + paeth(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`Unsupported PNG row filter ${filter} on row ${y}.`);
      }
    }

    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const destination = (y * width + x) * 4;
      if (channels === 1) {
        const grey = current[source]!;
        pixels[destination] = grey;
        pixels[destination + 1] = grey;
        pixels[destination + 2] = grey;
        pixels[destination + 3] = 255;
      } else if (channels === 2) {
        const grey = current[source]!;
        pixels[destination] = grey;
        pixels[destination + 1] = grey;
        pixels[destination + 2] = grey;
        pixels[destination + 3] = current[source + 1]!;
      } else {
        pixels[destination] = current[source]!;
        pixels[destination + 1] = current[source + 1]!;
        pixels[destination + 2] = current[source + 2]!;
        pixels[destination + 3] = channels === 4 ? current[source + 3]! : 255;
      }
    }

    current.copy(previous);
  }

  return { width, height, pixels };
}

function chunk(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length, 0);
  header.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), payload])), 0);
  return Buffer.concat([header, payload, crc]);
}

export function encodePng(image: PngImage): Buffer {
  const { width, height, pixels } = image;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw.writeUInt8(0, y * (stride + 1));
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const DEFAULT_REVIEW_WIDTH = 480;
export const DEFAULT_MAX_DIMENSION = 1999;

export function resolveReviewDimensions(
  source: PngDimensions,
  options: { reviewWidth?: number; maxDimension?: number } = {},
): PngDimensions {
  if (!source.width || !source.height) {
    throw new Error("PNG metadata must include a non-zero width and height.");
  }
  const reviewWidth = normalizeDimension(options.reviewWidth ?? DEFAULT_REVIEW_WIDTH, "reviewWidth");
  const maxDimension = normalizeDimension(options.maxDimension ?? DEFAULT_MAX_DIMENSION, "maxDimension");
  const scale = Math.min(1, reviewWidth / source.width, maxDimension / source.width, maxDimension / source.height);
  return {
    width: Math.max(1, Math.floor(source.width * scale)),
    height: Math.max(1, Math.floor(source.height * scale)),
  };
}

function normalizeDimension(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${name} must be a finite number greater than or equal to 1`);
  }
  return Math.max(1, Math.floor(value));
}

/** Box-average downscale. Averaging rather than sampling keeps thin text legible at 480 px. */
export function resizePng(image: PngImage, target: PngDimensions): PngImage {
  const pixels = Buffer.alloc(target.width * target.height * 4);
  const xRatio = image.width / target.width;
  const yRatio = image.height / target.height;

  for (let y = 0; y < target.height; y += 1) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.max(y0 + 1, Math.min(image.height, Math.ceil((y + 1) * yRatio)));
    for (let x = 0; x < target.width; x += 1) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.max(x0 + 1, Math.min(image.width, Math.ceil((x + 1) * xRatio)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const source = (sy * image.width + sx) * 4;
          r += image.pixels[source]!;
          g += image.pixels[source + 1]!;
          b += image.pixels[source + 2]!;
          a += image.pixels[source + 3]!;
          count += 1;
        }
      }
      const destination = (y * target.width + x) * 4;
      pixels[destination] = Math.round(r / count);
      pixels[destination + 1] = Math.round(g / count);
      pixels[destination + 2] = Math.round(b / count);
      pixels[destination + 3] = Math.round(a / count);
    }
  }

  return { width: target.width, height: target.height, pixels };
}

export function createReviewPng(
  png: Buffer,
  options: { reviewWidth?: number; maxDimension?: number } = {},
): { bytes: Buffer; raw: PngDimensions; review: PngDimensions } {
  const decoded = decodePng(png);
  const target = resolveReviewDimensions(decoded, options);
  const resized = resizePng(decoded, target);
  return {
    bytes: encodePng(resized),
    raw: { width: decoded.width, height: decoded.height },
    review: target,
  };
}
