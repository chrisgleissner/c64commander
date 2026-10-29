/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { crc32, sha256Hex } from "@/lib/romDependency/digest";
import { decodeRomDependencyList, laneState, RomDependencyListError } from "@/lib/romDependency/romDependencyList";
import { readFixture, specExampleBin, SYNTHETIC_SID_MD5 } from "../../helpers/romDependencyFixture";

const ascii = (text: string) => new TextEncoder().encode(text);

/** Rewrite the header CRC (and optionally the payload hash) so a test can break exactly one rule. */
const reseal = (bytes: Uint8Array, { payload = true } = {}): Uint8Array => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (payload) bytes.set(Uint8Array.from(Buffer.from(sha256Hex(bytes.subarray(192)), "hex")), 64);
  view.setUint32(52, 0, true);
  view.setUint32(52, crc32(bytes.subarray(0, 192)), true);
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
    expect(list.header).toMatchObject({ hvscRelease: 85, fileCount: 2, decisionCount: 3, incompleteSource: false });
    expect(specExampleBin().length).toBe(232);

    const a = "0123456789abcdef0123456789abcdef";
    const b = "fedcba9876543210fedcba9876543210";
    const one = list.lookup(a, 1);
    expect(one).toEqual({ listed: true, incompatibleMask: 5, unknownMask: 0 });
    expect(laneState(one, "sidliteNone")).toBe("incompatible");
    expect(laneState(one, "residfpNone")).toBe("incompatible");
    expect(laneState(one, "sidliteKernalBasic")).toBe("allowed");
    expect(list.lookup(a, 2).listed).toBe(false);
    const three = list.lookup(a, 3);
    expect(three).toEqual({ listed: true, incompatibleMask: 0, unknownMask: 8 });
    expect(laneState(three, "residfpKernalBasic")).toBe("unknown");
    expect(list.lookup(b, 256)).toEqual({ listed: true, incompatibleMask: 3, unknownMask: 0 });
    expect(list.lookup("00000000000000000000000000000000", 1).listed).toBe(false);
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
    expect(list.lookup(SYNTHETIC_SID_MD5, 2)).toEqual({ listed: true, incompatibleMask: 10, unknownMask: 0 });
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
    ["a damaged header", () => corrupt((b) => void (b[20] ^= 0xff)), /header CRC-32 mismatch/],
    ["a damaged payload", () => corrupt((b) => void (b[200] ^= 0x01)), /payload SHA-256 mismatch/],
    ["a missing last byte", () => corrupt((b) => b.subarray(0, b.length - 1)), /truncated payload/],
    ["a trailing byte", () => corrupt((b) => Uint8Array.from([...b, 0])), /trailing bytes/],
    ["unknown flag bits", () => corrupt((b) => void ((b[12] = 2), reseal(b))), /unknown flag bits/],
    ["a non-zero reserved field", () => corrupt((b) => void ((b[60] = 1), reseal(b))), /reserved field/],
    ["a non-canonical section offset", () => corrupt((b) => void ((b[36] = 0xc1), reseal(b))), /canonical/],
    ["unordered files", () => corrupt((b) => void swapFileRecords(b)), /not strictly ascending/],
    [
      "a lane that is both incompatible and unknown",
      () => corrupt((b) => void ((b[0xe2 + 1] = 0x15), reseal(b))),
      /both incompatible and unknown/,
    ],
    ["a record that says nothing", () => corrupt((b) => void ((b[0xe2 + 1] = 0), reseal(b))), /no non-default lane/],
    ["decision counts that do not sum", () => corrupt((b) => void ((b[0xd0] = 0), reseal(b))), /do not sum/],
  ])("rejects %s", (_name, make, message) => {
    expect(() => decodeRomDependencyList(make())).toThrow(message);
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
  const first = bytes.slice(192, 209);
  bytes.set(bytes.slice(209, 226), 192);
  bytes.set(first, 209);
  reseal(bytes);
}

/** A valid empty list, built by hand: a header with zero counts and a payload hash of nothing. */
function emptyList(): Uint8Array {
  const bytes = new Uint8Array(192);
  const view = new DataView(bytes.buffer);
  bytes.set(ascii("SIDROMDP"), 0);
  view.setUint16(8, 1, true);
  view.setUint16(10, 192, true);
  view.setUint32(16, 85, true);
  view.setUint32(36, 192, true);
  view.setUint32(44, 192, true);
  view.setUint16(56, 17, true);
  view.setUint16(58, 2, true);
  return reseal(bytes);
}
