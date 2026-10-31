/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { crc32, sha256Hex } from "@/lib/romDependency/digest";
import { decodeRomDependencyList, laneGrade, RomDependencyListError } from "@/lib/romDependency/romDependencyList";
import { readFixture, specExampleBin, SYNTHETIC_SID_MD5 } from "../../helpers/romDependencyFixture";

const ascii = (text: string) => new TextEncoder().encode(text);

/** Rewrite the header CRC (and optionally the payload hash) so a test can break exactly one rule. */
const reseal = (bytes: Uint8Array, { payload = true } = {}): Uint8Array => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (payload) bytes.set(Uint8Array.from(Buffer.from(sha256Hex(bytes.subarray(224)), "hex")), 64);
  view.setUint32(52, 0, true);
  view.setUint32(52, crc32(bytes.subarray(0, 224)), true);
  return bytes;
};

describe("digest", () => {
  it("computes SHA-256 test vectors, including a multi-block input", () => {
    expect(sha256Hex(ascii(""))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex(ascii("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(ascii("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("computes the CRC-32 check value", () => {
    expect(crc32(ascii("123456789"))).toBe(0xcbf43926);
  });
});

describe("decodeRomDependencyList", () => {
  it("decodes the specification's worked example and answers its lookup table (§14)", () => {
    const list = decodeRomDependencyList(specExampleBin());
    expect(list.header).toMatchObject({
      hvscRelease: 85,
      fileCount: 2,
      decisionCount: 3,
      listingCeiling: 191,
      recommendedMinGrade: 128,
      incompleteSource: false,
    });
    expect(specExampleBin().length).toBe(273);

    const a = "0123456789abcdef0123456789abcdef";
    const b = "fedcba9876543210fedcba9876543210";
    const one = list.lookup(a, 1);
    expect(one.listed).toBe(true);
    expect(one.grades).toEqual({ sidliteNone: 0, sidliteKernalBasic: 254, residfpNone: 120, residfpKernalBasic: 253 });
    expect(laneGrade(one, "residfpNone")).toBe(120);
    expect(list.lookup(a, 2).listed).toBe(false);
    expect(list.lookup(a, 3).grades).toEqual({
      sidliteNone: 255,
      sidliteKernalBasic: 255,
      residfpNone: 150,
      residfpKernalBasic: 255,
    });
    expect(list.lookup(b, 256).grades.sidliteNone).toBe(191); // exactly the ceiling: listed
    expect(list.lookup("00000000000000000000000000000000", 1).listed).toBe(false);
  });

  it("reports every lane of an unlisted subtune as ceiling+1, a lower bound that is never a restriction", () => {
    const unlisted = decodeRomDependencyList(specExampleBin()).lookup("0123456789abcdef0123456789abcdef", 2);
    expect(unlisted).toEqual({
      listed: false,
      grades: { sidliteNone: 192, sidliteKernalBasic: 192, residfpNone: 192, residfpKernalBasic: 192 },
    });
  });

  it("matches the full MD5 only, never a prefix, and treats subtunes outside 1..256 as unlisted", () => {
    const list = decodeRomDependencyList(specExampleBin());
    expect(list.lookup("0123456789abcdef0123456789abcdee", 1).listed).toBe(false);
    for (const subtune of [0, 257, -1, 1.5, Number.NaN]) {
      expect(list.lookup("0123456789abcdef0123456789abcdef", subtune).listed).toBe(false);
    }
    expect(() => list.lookup("0123", 1)).toThrow(RomDependencyListError);
  });

  it("decodes the reference-encoded synthetic list", () => {
    const list = decodeRomDependencyList(readFixture("synthetic-sidromdep-1.bin"));
    expect(list.header.fileCount).toBe(3);
    expect(list.lookup(SYNTHETIC_SID_MD5, 2).grades).toEqual({
      sidliteNone: 254,
      sidliteKernalBasic: 100,
      residfpNone: 255,
      residfpKernalBasic: 127,
    });
  });

  it("decodes a list with no entries", () => {
    const list = decodeRomDependencyList(emptyList());
    expect(list.header).toMatchObject({ fileCount: 0, decisionCount: 0 });
    expect(list.lookup(SYNTHETIC_SID_MD5, 1).listed).toBe(false);
  });

  const corrupt = (mutate: (bytes: Uint8Array) => Uint8Array | void) => {
    const bytes = Uint8Array.from(specExampleBin());
    return mutate(bytes) ?? bytes;
  };

  it.each([
    ["shorter than the header", () => corrupt((b) => b.subarray(0, 100)), /truncated header/],
    ["a bad magic", () => corrupt((b) => void (b[0] = 0x58)), /bad magic/],
    [
      "another format version",
      () => corrupt((b) => void (reseal(b, { payload: false }), (b[8] = 2), reseal(b))),
      /unsupported format version 2/,
    ],
    [
      "a header size other than 224 bytes",
      () => corrupt((b) => void ((b[10] = 0xe1), reseal(b))),
      /header_bytes must be 224/,
    ],
    ["a damaged header", () => corrupt((b) => void (b[20] ^= 0xff)), /header CRC-32 mismatch/],
    ["a damaged payload", () => corrupt((b) => void (b[270] ^= 0x01)), /payload SHA-256 mismatch/],
    ["a missing last byte", () => corrupt((b) => b.subarray(0, b.length - 1)), /truncated payload/],
    ["a trailing byte", () => corrupt((b) => Uint8Array.from([...b, 0])), /trailing bytes/],
    ["unknown flag bits", () => corrupt((b) => void ((b[12] = 2), reseal(b))), /unknown flag bits/],
    ["a non-zero reserved field", () => corrupt((b) => void ((b[62] = 1), reseal(b))), /reserved field/],
    ["a listing ceiling of 0", () => corrupt((b) => void ((b[60] = 0), reseal(b))), /listing_ceiling/],
    ["a listing ceiling above 253", () => corrupt((b) => void ((b[60] = 254), reseal(b))), /listing_ceiling/],
    ["a recommended minimum grade of 0", () => corrupt((b) => void ((b[61] = 0), reseal(b))), /recommended_min_grade/],
    [
      "a recommended minimum grade above ceiling+1",
      () => corrupt((b) => void ((b[61] = 193), reseal(b))),
      /recommended_min_grade/,
    ],
    ["a hvsc_release of 0", () => corrupt((b) => void (b.fill(0, 16, 20), reseal(b))), /hvsc_release must be >= 1/],
    [
      "a file record size other than 17 bytes",
      () => corrupt((b) => void ((b[56] = 18), reseal(b))),
      /unsupported record sizes/,
    ],
    [
      "a decision record size other than 5 bytes",
      () => corrupt((b) => void ((b[58] = 6), reseal(b))),
      /unsupported record sizes/,
    ],
    ["a non-canonical section offset", () => corrupt((b) => void ((b[36] = 0xe1), reseal(b))), /canonical/],
    ["unordered files", () => corrupt((b) => void swapFileRecords(b)), /not strictly ascending/],
    [
      "a record whose lanes are all above the ceiling, which must be unlisted",
      () => corrupt((b) => void (b.set([192, 255, 254, 255], 259), reseal(b))),
      /must be unlisted/,
    ],
    [
      "subtunes that are not ascending",
      () => corrupt((b) => void ((b[258 + 5] = 0), reseal(b))),
      /not strictly ascending/,
    ],
    ["decision counts that do not sum", () => corrupt((b) => void ((b[0xf0] = 0), reseal(b))), /do not sum/],
  ])("rejects %s", (_name, make, message) => {
    expect(() => decodeRomDependencyList(make())).toThrow(message);
  });

  it("accepts the boundaries: a lane exactly at the ceiling, a threshold of ceiling+1, a ceiling of 253", () => {
    const atCeiling = corrupt((b) => void (b.set([191, 255, 255, 255], 259), reseal(b)));
    expect(decodeRomDependencyList(atCeiling).lookup("0123456789abcdef0123456789abcdef", 1).grades.sidliteNone).toBe(
      191,
    );
    expect(() => decodeRomDependencyList(corrupt((b) => void ((b[61] = 192), reseal(b))))).not.toThrow();
    const wide = decodeRomDependencyList(corrupt((b) => void ((b[60] = 253), reseal(b))));
    expect(wide.lookup("0123456789abcdef0123456789abcdef", 2).grades.sidliteNone).toBe(254);
  });

  it("rejects a truncated file at every length without returning a partial list", () => {
    const full = specExampleBin();
    for (let length = 0; length < full.length; length += 13) {
      expect(() => decodeRomDependencyList(full.subarray(0, length))).toThrow(RomDependencyListError);
    }
  });
});

/** Exchange the two 17-byte FILE_TABLE records and reseal, so only the ordering rule is broken. */
function swapFileRecords(bytes: Uint8Array) {
  const first = bytes.slice(224, 241);
  bytes.set(bytes.slice(241, 258), 224);
  bytes.set(first, 241);
  reseal(bytes);
}

/** A valid empty list, built by hand: a header with zero counts and a payload hash of nothing. */
function emptyList(): Uint8Array {
  const bytes = new Uint8Array(224);
  const view = new DataView(bytes.buffer);
  bytes.set(ascii("SIDROMDP"), 0);
  view.setUint16(8, 1, true);
  view.setUint16(10, 224, true);
  view.setUint32(16, 85, true);
  view.setUint32(36, 224, true);
  view.setUint32(44, 224, true);
  view.setUint16(56, 17, true);
  view.setUint16(58, 5, true);
  bytes[60] = 191;
  bytes[61] = 128;
  return reseal(bytes);
}
