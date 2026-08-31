/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The fixtures were produced by sharp, an encoder droidctl does not use, so the
 * decoder is checked against a second implementation rather than against itself.
 */

import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  PNG_SIGNATURE,
  createReviewPng,
  decodePng,
  encodePng,
  readPngDimensions,
  resizePng,
  resolveReviewDimensions,
} from "../src/png.js";

/** 4x2 RGBA: red, green, blue, white / black, grey, half-transparent red, cyan. */
const RGBA_FIXTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVQI12P4z8DwHwwZ/oMBAxD8b2hoALEaQGIAJh0R8SVk4w0AAAAASUVORK5CYII=",
  "base64",
);

/** The same image with the alpha channel removed, so colour type 2. */
const RGB_FIXTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGElEQVQImWP4z8DAAMb//4MohoaGBggXAIClCnjiBhYkAAAAAElFTkSuQmCC",
  "base64",
);

function pixelAt(image: { width: number; pixels: Buffer }, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [...image.pixels.subarray(offset, offset + 4)];
}

describe("png decoding", () => {
  it("reads dimensions from the IHDR chunk", () => {
    expect(readPngDimensions(RGBA_FIXTURE)).toEqual({ width: 4, height: 2 });
  });

  it("rejects a payload that is not a PNG", () => {
    expect(() => readPngDimensions(Buffer.from("not a png at all really"))).toThrow(/signature missing/);
  });

  it("decodes an RGBA image to the exact pixels sharp encoded", () => {
    const image = decodePng(RGBA_FIXTURE);
    expect(image.width).toBe(4);
    expect(image.height).toBe(2);
    expect(pixelAt(image, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(image, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(image, 2, 0)).toEqual([0, 0, 255, 255]);
    expect(pixelAt(image, 3, 0)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(image, 0, 1)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(image, 1, 1)).toEqual([128, 128, 128, 255]);
    expect(pixelAt(image, 2, 1)).toEqual([255, 0, 0, 128]);
    expect(pixelAt(image, 3, 1)).toEqual([0, 255, 255, 255]);
  });

  it("decodes a three-channel image and fills alpha", () => {
    const image = decodePng(RGB_FIXTURE);
    expect(pixelAt(image, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(image, 3, 1)).toEqual([0, 255, 255, 255]);
  });

  it("refuses a variant it cannot decode rather than returning wrong pixels", () => {
    const sixteenBit = Buffer.from(RGBA_FIXTURE);
    sixteenBit.writeUInt8(16, 24);
    expect(() => decodePng(sixteenBit)).toThrow(/Unsupported PNG variant/);
  });
});

describe("png encoding", () => {
  it("round-trips every pixel through encode and decode", () => {
    const source = decodePng(RGBA_FIXTURE);
    const encoded = encodePng(source);
    expect(encoded.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    const decoded = decodePng(encoded);
    expect(decoded.width).toBe(source.width);
    expect(decoded.height).toBe(source.height);
    expect(decoded.pixels).toEqual(source.pixels);
  });
});

describe("review downscale", () => {
  it("keeps 480 px wide and caps either dimension at 1999", () => {
    expect(resolveReviewDimensions({ width: 1080, height: 2280 })).toEqual({ width: 480, height: 1013 });
    expect(resolveReviewDimensions({ width: 320, height: 240 })).toEqual({ width: 320, height: 240 });
    expect(resolveReviewDimensions({ width: 4000, height: 8000 }, { reviewWidth: 4000 })).toEqual({
      width: 999,
      height: 1999,
    });
  });

  it("rejects a nonsensical review width", () => {
    expect(() => resolveReviewDimensions({ width: 100, height: 100 }, { reviewWidth: 0 })).toThrow(/reviewWidth/);
    expect(() => resolveReviewDimensions({ width: 0, height: 0 })).toThrow(/non-zero/);
  });

  it("averages the source block rather than sampling one pixel", () => {
    const source = decodePng(RGBA_FIXTURE);
    const halved = resizePng(source, { width: 2, height: 1 });
    // Left half averages red, green, black and grey; a nearest-neighbour sample
    // would return one of those four unchanged.
    expect(pixelAt(halved, 0, 0)).toEqual([96, 96, 32, 255]);
    expect(pixelAt(halved, 1, 0)).toEqual([128, 128, 191, 223]);
  });

  it("produces a decodable review PNG with the computed dimensions", () => {
    const grey = encodePng({ width: 1080, height: 2280, pixels: Buffer.alloc(1080 * 2280 * 4, 200) });
    const review = createReviewPng(grey);
    expect(review.raw).toEqual({ width: 1080, height: 2280 });
    expect(review.review).toEqual({ width: 480, height: 1013 });
    expect(readPngDimensions(review.bytes)).toEqual({ width: 480, height: 1013 });
    expect(pixelAt(decodePng(review.bytes), 10, 10)).toEqual([200, 200, 200, 200]);
  });
});

/** Builds a PNG by hand so each row filter and colour type can be decoded on purpose. */
function buildPng(options: {
  width: number;
  height: number;
  colorType: number;
  channels: number;
  rows: number[][];
  filters: number[];
  omitIdat?: boolean;
}): Buffer {
  const stride = options.width * options.channels;
  const raw = Buffer.alloc((stride + 1) * options.height);
  options.rows.forEach((row, y) => {
    raw.writeUInt8(options.filters[y]!, y * (stride + 1));
    Buffer.from(row).copy(raw, y * (stride + 1) + 1);
  });

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const chunk = (type: string, payload: Buffer) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(payload.length, 0);
    header.write(type, 4, "ascii");
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([header.subarray(4), payload])) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
    return Buffer.concat([header, payload, tail]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(options.width, 0);
  ihdr.writeUInt32BE(options.height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(options.colorType, 9);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("tEXt", Buffer.from("note\0ignored")),
    ...(options.omitIdat ? [] : [chunk("IDAT", deflateSync(raw))]),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("png row filters and colour types", () => {
  it("reverses all five row filters", () => {
    const png = buildPng({
      width: 2,
      height: 5,
      colorType: 2,
      channels: 3,
      filters: [0, 1, 2, 3, 4],
      rows: [
        [10, 20, 30, 40, 50, 60],
        [1, 1, 1, 1, 1, 1],
        [5, 5, 5, 5, 5, 5],
        [2, 2, 2, 2, 2, 2],
        [3, 3, 3, 3, 3, 3],
      ],
    });
    const image = decodePng(png);
    expect(image.width).toBe(2);
    expect(image.height).toBe(5);
    const row = (index: number) => [...image.pixels.subarray(index * 8, index * 8 + 8)];
    expect(row(0)).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
    // Sub adds the pixel to the left, Up the pixel above, then Average and Paeth.
    expect(row(1)).toEqual([1, 1, 1, 255, 2, 2, 2, 255]);
    expect(row(2)).toEqual([6, 6, 6, 255, 7, 7, 7, 255]);
    expect(row(3)).toEqual([5, 5, 5, 255, 8, 8, 8, 255]);
    expect(row(4)).toEqual([8, 8, 8, 255, 11, 11, 11, 255]);
  });

  it("expands greyscale and greyscale-with-alpha into RGBA", () => {
    const grey = decodePng(
      buildPng({ width: 2, height: 1, colorType: 0, channels: 1, filters: [0], rows: [[7, 200]] }),
    );
    expect([...grey.pixels]).toEqual([7, 7, 7, 255, 200, 200, 200, 255]);

    const greyAlpha = decodePng(
      buildPng({ width: 2, height: 1, colorType: 4, channels: 2, filters: [0], rows: [[7, 128, 200, 64]] }),
    );
    expect([...greyAlpha.pixels]).toEqual([7, 7, 7, 128, 200, 200, 200, 64]);
  });

  it("rejects an unknown row filter and a PNG with no IDAT", () => {
    expect(() =>
      decodePng(buildPng({ width: 1, height: 1, colorType: 2, channels: 3, filters: [9], rows: [[1, 2, 3]] })),
    ).toThrow(/Unsupported PNG row filter 9/);
    expect(() =>
      decodePng(
        buildPng({ width: 1, height: 1, colorType: 2, channels: 3, filters: [0], rows: [[1, 2, 3]], omitIdat: true }),
      ),
    ).toThrow(/no IDAT chunk/);
  });

  it("rejects a payload whose first chunk is not IHDR and one too short to hold a header", () => {
    const png = Buffer.from(
      buildPng({ width: 1, height: 1, colorType: 2, channels: 3, filters: [0], rows: [[1, 2, 3]] }),
    );
    png.write("IHDX", 12, "ascii");
    expect(() => readPngDimensions(png)).toThrow(/first chunk is not IHDR/);
    expect(() => readPngDimensions(Buffer.alloc(4))).toThrow(/signature missing/);
  });
});
