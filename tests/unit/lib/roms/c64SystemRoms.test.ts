import { describe, expect, it } from "vitest";

import { C64_ROM_BYTES, ROM_SOURCE_ADDRESS, romFingerprint, validateRomImage } from "@/lib/roms/c64SystemRoms";

/**
 * Fixtures are **synthesised**, never real ROM dumps.
 *
 * C64 ROM images are copyrighted and this project does not distribute them —
 * they are read at runtime from the user's own machine. Committing a real dump
 * as a test fixture would be exactly the distribution the whole design avoids,
 * so these build structurally-valid stand-ins instead.
 */

/** Pseudo-random but deterministic, so a fixture has ROM-like byte diversity. */
function noisyImage(seed: number): Uint8Array {
  const bytes = new Uint8Array(C64_ROM_BYTES);
  let state = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[i] = (state >>> 24) & 0xff;
  }
  return bytes;
}

function synthesiseKernal({ resetVector = 0xfce2, revision = 0x03 } = {}): Uint8Array {
  const bytes = noisyImage(0x1234);
  bytes[0xff80 - 0xe000] = revision;
  bytes[0xfffc - 0xe000] = resetVector & 0xff;
  bytes[0xfffc - 0xe000 + 1] = (resetVector >> 8) & 0xff;
  return bytes;
}

function synthesiseBasic({ signature = "CBMBASIC" } = {}): Uint8Array {
  const bytes = noisyImage(0x5678);
  for (let i = 0; i < signature.length; i++) bytes[4 + i] = signature.charCodeAt(i);
  return bytes;
}

describe("romFingerprint", () => {
  it("is stable and differs between images", () => {
    const a = synthesiseKernal();
    expect(romFingerprint(a)).toBe(romFingerprint(a.slice()));
    expect(romFingerprint(a)).not.toBe(romFingerprint(synthesiseBasic()));
  });

  it("is eight lower-case hex digits", () => {
    expect(romFingerprint(synthesiseKernal())).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("validateRomImage", () => {
  it("accepts a structurally valid KERNAL and BASIC", () => {
    const kernal = validateRomImage("kernal", synthesiseKernal());
    expect(kernal.ok).toBe(true);
    const basic = validateRomImage("basic", synthesiseBasic());
    expect(basic.ok).toBe(true);
  });

  it("rejects a wrong length", () => {
    const result = validateRomImage("kernal", new Uint8Array(4096));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("expected 8192 bytes");
  });

  it.each([
    ["all zeros", 0x00],
    ["all $FF", 0xff],
  ])("rejects %s — the classic signature of a read that returned nothing", (_label, fill) => {
    const result = validateRomImage("kernal", new Uint8Array(C64_ROM_BYTES).fill(fill));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not a ROM");
  });

  it("rejects a low-entropy image, which is what a RAM read looks like", () => {
    // A repeating 8-byte pattern: not uniform, so the all-same check misses it,
    // but nothing like a real ROM's byte distribution.
    const bytes = new Uint8Array(C64_ROM_BYTES);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 8;
    const result = validateRomImage("kernal", bytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("looks like RAM");
  });

  it("rejects a KERNAL whose reset vector points outside the KERNAL", () => {
    // This is precisely what a DMA read returns when a cartridge is active or a
    // program has banked ROM out: 8192 plausible-looking bytes that are not ROM.
    const result = validateRomImage("kernal", synthesiseKernal({ resetVector: 0x0801 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("default banking");
  });

  it("rejects a BASIC without the CBMBASIC signature", () => {
    const result = validateRomImage("basic", synthesiseBasic({ signature: "XXXXXXXX" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("CBMBASIC");
  });

  it("accepts an unrecognised KERNAL variant but says so", () => {
    // Variants are legitimate (rev 1/2/3, U64, C128), so validation must not be
    // a whitelist — it only decides whether the dump is structurally a ROM.
    const result = validateRomImage("kernal", synthesiseKernal({ revision: 0x00 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.image.known).toBe(false);
      expect(result.image.description).toContain("rev 2");
      expect(result.image.description).toContain("unrecognised");
    }
  });

  it("reports an unknown revision byte without pretending to identify it", () => {
    const result = validateRomImage("kernal", synthesiseKernal({ revision: 0x7f }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.image.description).toBe("C64 KERNAL (unrecognised variant)");
  });
});

describe("ROM_SOURCE_ADDRESS", () => {
  it("reads the ROMs from where the C64 maps them", () => {
    expect(ROM_SOURCE_ADDRESS.kernal).toBe("e000");
    expect(ROM_SOURCE_ADDRESS.basic).toBe("a000");
  });

  it("does not fetch chargen", () => {
    // $D000 is I/O under default banking, so a plain read returns I/O space, not
    // the character generator — and chargen has no effect on audio anyway.
    expect(Object.keys(ROM_SOURCE_ADDRESS).sort()).toEqual(["basic", "kernal"]);
  });
});
