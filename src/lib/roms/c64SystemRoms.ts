/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Validation and identification of C64 KERNAL/BASIC ROM images (spec §12, Track B).
 *
 * **Why these images exist at all.** On-device SID playback needs the C64's own
 * ROMs. Measured against real hardware, libsidplayfp without them initialises a
 * tune and then never advances it — the output is a flat drone, envelope
 * correlation ~0.008 against the machine; with them it reaches 0.625 (see
 * `docs/plans/sid-station/AUDIO-FIDELITY-TEST.md` §6.2). So ROMs are a
 * *prerequisite* for the Local engine, not an RSID-only unlock.
 *
 * **Where they come from.** They are read at the user's explicit request from
 * the C64 the app is connected to, over `GET /v1/machine:readmem` — documented
 * as a DMA read on the cartridge bus. The app never bundles, ships or
 * distributes ROM images; they stay in that user's own app-private storage.
 * The user is responsible for only connecting to devices they own or have
 * permission to use.
 *
 * **Why validation is not optional.** A DMA read reflects the machine's *current
 * banking*. If a cartridge is active, or a program has banked ROM out, the read
 * returns RAM — which is still 8192 bytes and still looks like a plausible blob.
 * Accepting that would silently poison playback in a way that is very hard to
 * diagnose from the audio. Every dump is therefore checked structurally, and a
 * dump that fails is rejected rather than stored.
 */

/** The system ROM images the local engine can use. Chargen is not needed for audio. */
export type C64RomKind = "kernal" | "basic";

/** Both C64 system ROMs are 8 KiB. */
export const C64_ROM_BYTES = 8192;

/**
 * Fingerprints of the images verified byte-for-byte against the canonical dumps
 * during the Track B fidelity work. Used to *name* a dump, never to gate it:
 * KERNAL revisions differ (rev 1/2/3) and a U64 or C128 may present different
 * images, all of which are legitimate. Structural validation decides
 * acceptance; this table only decides what we call it.
 */
const KNOWN_FINGERPRINTS: Record<string, string> = {
  "0d9b7e21": "C64 KERNAL rev 3 (901227-03)",
  "3dd934ed": "C64 BASIC V2 (901226-01)",
};

/** KERNAL revision marker at $FF80. */
const KERNAL_REVISION_OFFSET = 0xff80 - 0xe000;
const KERNAL_REVISIONS: Record<number, string> = {
  0xaa: "rev 1",
  0x00: "rev 2",
  0x03: "rev 3",
};

/** The 6502 reset vector at $FFFC/$FFFD must point into the KERNAL itself. */
const RESET_VECTOR_OFFSET = 0xfffc - 0xe000;

/** BASIC V2 carries "CBMBASIC" in its cold-start header. */
const BASIC_SIGNATURE = "CBMBASIC";
const BASIC_SIGNATURE_OFFSET = 4;

/**
 * A ROM read back as RAM is usually uniform or near-uniform. Real ROM images use
 * essentially the whole byte range (both canonical dumps use 255 distinct
 * values), so this cheaply rejects blank or patterned RAM without rejecting a
 * legitimate variant.
 */
const MIN_DISTINCT_BYTES = 64;

export interface C64RomImage {
  kind: C64RomKind;
  bytes: Uint8Array;
  /** Stable 32-bit FNV-1a fingerprint, lower-case hex. */
  fingerprint: string;
  /** Human-readable identification, surfaced in Settings and Diagnostics. */
  description: string;
  /** True when the fingerprint matches an image we have verified ourselves. */
  known: boolean;
}

export type C64RomValidation = { ok: true; image: C64RomImage } | { ok: false; reason: string };

/** FNV-1a (32-bit). Deterministic, dependency-free, and runs anywhere. */
export function romFingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    // Multiply mod 2^32 without overflowing the float mantissa.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function countDistinctBytes(bytes: Uint8Array): number {
  const seen = new Uint8Array(256);
  let distinct = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (seen[bytes[i]!] === 0) {
      seen[bytes[i]!] = 1;
      distinct++;
    }
  }
  return distinct;
}

function describeKernal(bytes: Uint8Array, fingerprint: string): string {
  const known = KNOWN_FINGERPRINTS[fingerprint];
  if (known) return known;
  const revision = KERNAL_REVISIONS[bytes[KERNAL_REVISION_OFFSET]!];
  return revision ? `C64 KERNAL ${revision} (unrecognised variant)` : "C64 KERNAL (unrecognised variant)";
}

function describeBasic(fingerprint: string): string {
  return KNOWN_FINGERPRINTS[fingerprint] ?? "C64 BASIC (unrecognised variant)";
}

/**
 * Accept a dump only if it is structurally a ROM of the requested kind.
 *
 * Deliberately permissive about *which* ROM (variants are legitimate) and strict
 * about *whether* it is one (a RAM read must never be stored as a ROM).
 */
export function validateRomImage(kind: C64RomKind, bytes: Uint8Array): C64RomValidation {
  if (bytes.length !== C64_ROM_BYTES) {
    return { ok: false, reason: `expected ${C64_ROM_BYTES} bytes, got ${bytes.length}` };
  }

  const first = bytes[0]!;
  let uniform = true;
  for (let i = 1; i < bytes.length; i++) {
    if (bytes[i] !== first) {
      uniform = false;
      break;
    }
  }
  if (uniform) {
    return { ok: false, reason: `every byte is 0x${first.toString(16).padStart(2, "0")} — this is not a ROM` };
  }

  const distinct = countDistinctBytes(bytes);
  if (distinct < MIN_DISTINCT_BYTES) {
    return {
      ok: false,
      reason:
        `only ${distinct} distinct byte values — this looks like RAM, not a ROM. Reset the ` +
        `machine and make sure no cartridge is active, then try again.`,
    };
  }

  if (kind === "kernal") {
    const resetVector = bytes[RESET_VECTOR_OFFSET]! | (bytes[RESET_VECTOR_OFFSET + 1]! << 8);
    if (resetVector < 0xe000) {
      return {
        ok: false,
        reason:
          `reset vector points at $${resetVector.toString(16).padStart(4, "0")}, outside the ` +
          `KERNAL — the machine was not in its default banking when this was read.`,
      };
    }
  } else {
    const signature = Array.from(bytes.slice(BASIC_SIGNATURE_OFFSET, BASIC_SIGNATURE_OFFSET + BASIC_SIGNATURE.length))
      .map((byte) => String.fromCharCode(byte))
      .join("");
    if (signature !== BASIC_SIGNATURE) {
      return {
        ok: false,
        reason:
          `missing the "${BASIC_SIGNATURE}" signature — the machine was not in its default ` +
          `banking when this was read.`,
      };
    }
  }

  const fingerprint = romFingerprint(bytes);
  return {
    ok: true,
    image: {
      kind,
      bytes,
      fingerprint,
      description: kind === "kernal" ? describeKernal(bytes, fingerprint) : describeBasic(fingerprint),
      known: KNOWN_FINGERPRINTS[fingerprint] !== undefined,
    },
  };
}

/** Where each ROM lives in the C64 address space, for `machine:readmem`. */
export const ROM_SOURCE_ADDRESS: Record<C64RomKind, string> = {
  kernal: "e000",
  basic: "a000",
};
