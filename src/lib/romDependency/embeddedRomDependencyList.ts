/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The SID ROM dependency list that ships inside the app, loaded and checked once.
 *
 * **Replacing the list.** Copy the release's `hvsc<N>-sidromdep-1.bin` and
 * `hvsc<N>-sidromdep-1.manifest.json` over the two files in `./data/` (adjusting the two import
 * names below if N is not 85) and set {@link PINNED_MANIFEST_SHA256} to the manifest SHA-256 that
 * `bun scripts/rom-dependency-list/verify.ts` prints in the sidflow repository. Nothing else changes.
 * The files are byte-exact (`.prettierignore` keeps them out of formatting) because the pin is a
 * hash of the manifest's bytes.
 *
 * The files in `./data/` are the HVSC #85 release list (696 files, 1,556 subtunes, 19,836 bytes),
 * published as sidflow-data release `rom-audit-hvsc85-20261030`. Format: `doc/rom-dependency-list.md`
 * in https://github.com/chrisgleissner/sidflow.
 *
 * **If the list cannot be trusted** (pin mismatch, bad checksum, truncated, an incomplete-source
 * development file) the error is logged and the app plays as if there were no list. A list is a
 * convenience; it must never be the reason a tune does not play.
 */

import { addErrorLog, addLog } from "@/lib/logging";
import { sha256Hex } from "./digest";
import { decodeRomDependencyList, type RomDependencyList } from "./romDependencyList";

/** SHA-256 of `./data/hvsc85-sidromdep-1.manifest.json` (spec §10.2 item 5, §13.3). The one line to update. */
export const PINNED_MANIFEST_SHA256 = "712dcbd2f6aab4c1f39ad774f472b6f9c97cc73ea9b44d6d5bbe97968d77f9c0";

export interface ReferenceRomHashes {
  kernal: string;
  basic: string;
  chargen: string;
}

export interface LoadedRomDependencyList {
  list: RomDependencyList;
  /** SHA-256 of the three authentic reference ROMs, from the pinned manifest (§10.1). */
  referenceRoms: ReferenceRomHashes;
}

export interface RomDependencyAssets {
  bin: Uint8Array;
  manifestText: string;
}

const HEX_SHA256 = /^[0-9a-f]{64}$/;

const decodeDataUri = (uri: string): Uint8Array => {
  const binary = atob(uri.slice(uri.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** The two files, as separate lazy chunks: nothing is fetched until the first SID that needs a verdict. */
const readEmbeddedAssets = async (): Promise<RomDependencyAssets> => {
  const [bin, manifest] = await Promise.all([
    import("./data/hvsc85-sidromdep-1.bin?inline"),
    import("./data/hvsc85-sidromdep-1.manifest.json?raw"),
  ]);
  return { bin: decodeDataUri(bin.default), manifestText: manifest.default };
};

/**
 * Check the manifest against the pin, the binary against the manifest, then decode the binary
 * (§10.2 item 5, §13.1, §13.3). Throws on any mismatch.
 */
export const validateRomDependencyAssets = (
  { bin, manifestText }: RomDependencyAssets,
  pinnedManifestSha256: string = PINNED_MANIFEST_SHA256,
): LoadedRomDependencyList => {
  const manifestSha256 = sha256Hex(new TextEncoder().encode(manifestText));
  if (manifestSha256 !== pinnedManifestSha256) {
    throw new Error(`manifest SHA-256 ${manifestSha256} does not match the pinned ${pinnedManifestSha256}`);
  }
  const manifest = JSON.parse(manifestText) as {
    format?: { id?: string; version?: number };
    complete?: boolean;
    binary?: { sha256?: string; bytes?: number; payloadSha256?: string };
    measuredProfile?: { referenceRoms?: Partial<ReferenceRomHashes> };
  };
  if (manifest.format?.id !== "sidromdep-1" || manifest.format.version !== 1) {
    throw new Error("manifest is not a sidromdep-1 manifest");
  }
  if (manifest.complete !== true) throw new Error("manifest says this list is not a complete release");
  if (manifest.binary?.sha256 !== sha256Hex(bin) || manifest.binary.bytes !== bin.length) {
    throw new Error("binary does not match the SHA-256 and size in the manifest");
  }
  const referenceRoms = manifest.measuredProfile?.referenceRoms;
  if (
    !referenceRoms ||
    !HEX_SHA256.test(referenceRoms.kernal ?? "") ||
    !HEX_SHA256.test(referenceRoms.basic ?? "") ||
    !HEX_SHA256.test(referenceRoms.chargen ?? "")
  ) {
    throw new Error("manifest has no valid reference ROM hashes");
  }
  const list = decodeRomDependencyList(bin);
  if (list.header.incompleteSource) throw new Error("list was made from an incomplete audit (developer file)");
  if (list.header.payloadSha256 !== manifest.binary.payloadSha256) {
    throw new Error("payload SHA-256 differs between the binary and the manifest");
  }
  return { list, referenceRoms: referenceRoms as ReferenceRomHashes };
};

let assetSource: () => Promise<RomDependencyAssets> = readEmbeddedAssets;
let cached: Promise<LoadedRomDependencyList | null> | null = null;
let pinnedSha256 = PINNED_MANIFEST_SHA256;

/** Test seam: replace the assets and the pin, and forget the cached result. */
export const setRomDependencyAssetsForTests = (
  source: (() => Promise<RomDependencyAssets>) | null,
  pin: string = PINNED_MANIFEST_SHA256,
) => {
  assetSource = source ?? readEmbeddedAssets;
  pinnedSha256 = pin;
  cached = null;
};

/**
 * The validated list, or null when there is none. Loaded once; a failure is cached too, so a broken
 * list is logged once rather than on every tune.
 */
export const loadEmbeddedRomDependencyList = (): Promise<LoadedRomDependencyList | null> => {
  cached ??= (async () => {
    try {
      const loaded = validateRomDependencyAssets(await assetSource(), pinnedSha256);
      addLog("info", "SID ROM dependency list loaded", {
        service: "rom-dependency",
        hvscRelease: loaded.list.header.hvscRelease,
        listedFiles: loaded.list.header.fileCount,
        listedSubtunes: loaded.list.header.decisionCount,
      });
      return loaded;
    } catch (error) {
      addErrorLog("SID ROM dependency list rejected; playing without it", {
        service: "rom-dependency",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return null;
    }
  })();
  return cached;
};
