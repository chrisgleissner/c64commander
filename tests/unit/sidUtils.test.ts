/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { base64ToUint8, computeSidMd5, createSslPayload, getSidSongCount } from "@/lib/sid/sidUtils";

const toHex = (value: Uint8Array) =>
  Array.from(value)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

describe("sidUtils", () => {
  it("computes md5 for SID data", async () => {
    const data = new TextEncoder().encode("SID").buffer;
    const hash = await computeSidMd5(data);
    expect(hash).toHaveLength(32);
  });

  it("creates SSL payload for duration", () => {
    const payload = createSslPayload(90500);
    expect(toHex(payload)).toBe("0130");
  });

  it("converts base64 to bytes", () => {
    const bytes = base64ToUint8(btoa("C64"));
    expect(Array.from(bytes)).toEqual([67, 54, 52]);
  });

  it("returns a safe song count for short buffers", () => {
    expect(getSidSongCount(new ArrayBuffer(8))).toBe(1);
  });

  it("returns a safe song count for invalid SID headers", () => {
    const buffer = new ArrayBuffer(18);
    const view = new DataView(buffer);
    view.setUint8(0, "B".charCodeAt(0));
    view.setUint8(1, "A".charCodeAt(0));
    view.setUint8(2, "D".charCodeAt(0));
    view.setUint8(3, "0".charCodeAt(0));
    view.setUint16(14, 2, false);
    expect(getSidSongCount(buffer)).toBe(1);
  });

  it("normalizes zero or missing song counts", () => {
    const buffer = new ArrayBuffer(18);
    const view = new DataView(buffer);
    view.setUint8(0, "P".charCodeAt(0));
    view.setUint8(1, "S".charCodeAt(0));
    view.setUint8(2, "I".charCodeAt(0));
    view.setUint8(3, "D".charCodeAt(0));
    view.setUint16(14, 0, false);
    expect(getSidSongCount(buffer)).toBe(1);
  });

  it("reads the declared song count for valid headers", () => {
    const buffer = new ArrayBuffer(18);
    const view = new DataView(buffer);
    view.setUint8(0, "R".charCodeAt(0));
    view.setUint8(1, "S".charCodeAt(0));
    view.setUint8(2, "I".charCodeAt(0));
    view.setUint8(3, "D".charCodeAt(0));
    view.setUint16(14, 5, false);
    expect(getSidSongCount(buffer)).toBe(5);
  });

  it("falls back to one song when parsing fails", () => {
    expect(getSidSongCount(null as unknown as ArrayBuffer)).toBe(1);
  });

  it("HARD12-021: writes the duration to the songNr-1 slot and zero-pads earlier slots", () => {
    // song 3 of 3, duration 90.5s → 0x01 0x30 at offset (3-1)*2 = 4
    const payload = createSslPayload(90500, { songNr: 3 });
    expect(payload.length).toBe(6);
    expect(toHex(payload)).toBe("000000000130");
  });

  it("HARD12-021: writes a single zero-padded slot when songNr is 1", () => {
    const payload = createSslPayload(90500, { songNr: 1 });
    expect(payload.length).toBe(2);
    expect(toHex(payload)).toBe("0130");
  });

  it("HARD12-021: uses per-subsong durationSeconds at songNr-1 slot when provided", () => {
    // 5 slots; subsong 3 has duration 75s → 0x01 0x15 at offset 4
    const payload = createSslPayload(0, {
      songNr: 3,
      subsongDurationsSeconds: [null, null, 75, null, null],
    });
    expect(payload.length).toBe(6);
    expect(toHex(payload)).toBe("000000000115");
  });

  it("HARD12-021: leaves the songNr-1 slot zero when neither per-subsong nor active duration is known", () => {
    const payload = createSslPayload(0, { songNr: 4 });
    expect(payload.length).toBe(8);
    expect(Array.from(payload)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
