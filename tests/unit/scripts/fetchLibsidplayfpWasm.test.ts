import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  LIBSIDPLAYFP_WASM_RELEASE,
  parseChecksums,
  sha256Hex,
  tarballName,
  tarballUrl,
  verifyExtracted,
} from "../../../scripts/fetch-libsidplayfp-wasm.mjs";

/**
 * The engine used to be a hand-copied binary committed to this repo, with no
 * version, no provenance and no check — which is precisely how it shipped as
 * SIDLite instead of reSIDfp for months without anyone noticing. These tests pin
 * the properties that make the replacement (a checksum-verified release asset
 * fetched at build time) actually safer, rather than just different.
 */
describe("fetch-libsidplayfp-wasm pin", () => {
  it("ships the reSIDfp build, never the SIDLite one", () => {
    // The release tarball carries reSIDfp in the root and SIDLite under
    // `sidlite/`. Taking anything from `sidlite/` would reintroduce the exact
    // defect this whole exercise was about.
    for (const file of LIBSIDPLAYFP_WASM_RELEASE.files) {
      expect(file.startsWith("sidlite/"), `${file} is the SIDLite build`).toBe(false);
    }
    expect(LIBSIDPLAYFP_WASM_RELEASE.files).toContain("libsidplayfp.wasm");
  });

  it("carries the engine's licence with it", () => {
    // libsidplayfp is GPL-2.0-or-later; the licence must travel with the binary.
    expect(LIBSIDPLAYFP_WASM_RELEASE.files).toContain("LICENSE");
  });

  it("resolves a GitHub release download URL from the pin", () => {
    const release = { ...LIBSIDPLAYFP_WASM_RELEASE, tag: "1.2.3" };
    expect(tarballName(release)).toBe("libsidplayfp-wasm-1.2.3.tar.gz");
    expect(tarballUrl(release)).toBe(
      "https://github.com/chrisgleissner/sidflow/releases/download/1.2.3/libsidplayfp-wasm-1.2.3.tar.gz",
    );
  });

  it("requires a checksum pin whenever a tag is pinned", () => {
    // A tag without a checksum would be a download with no integrity check —
    // no better than the committed blob it replaces.
    if (LIBSIDPLAYFP_WASM_RELEASE.tag !== null) {
      expect(LIBSIDPLAYFP_WASM_RELEASE.checksumsSha256, "pin a tag and its SHA256SUMS digest together").toMatch(
        /^[0-9a-f]{64}$/,
      );
    }
  });
});

describe("parseChecksums", () => {
  it("reads a sha256sum file", () => {
    const digest = "a".repeat(64);
    expect(parseChecksums(`${digest}  libsidplayfp.wasm\n${digest} *sidlite/libsidplayfp.wasm\n`)).toEqual({
      "libsidplayfp.wasm": digest,
      "sidlite/libsidplayfp.wasm": digest,
    });
  });

  it("ignores blank and malformed lines rather than inventing entries", () => {
    expect(parseChecksums("\nnot a checksum line\n")).toEqual({});
  });
});

describe("verifyExtracted", () => {
  const digestOf = (text: string) => createHash("sha256").update(Buffer.from(text)).digest("hex");
  const fakeRead = (files: Record<string, string>) => async (absPath: string) => {
    const key = Object.keys(files).find((name) => absPath.endsWith(name));
    if (!key) throw new Error("ENOENT");
    return Buffer.from(files[key]!);
  };

  it("accepts files that match SHA256SUMS", async () => {
    const files = { "libsidplayfp.wasm": "wasm-bytes" };
    const result = await verifyExtracted(
      "/tmp/x",
      { "libsidplayfp.wasm": digestOf("wasm-bytes") },
      ["libsidplayfp.wasm"],
      fakeRead(files),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a file whose contents do not match", async () => {
    const result = await verifyExtracted(
      "/tmp/x",
      { "libsidplayfp.wasm": digestOf("expected") },
      ["libsidplayfp.wasm"],
      fakeRead({ "libsidplayfp.wasm": "tampered" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("sha256");
  });

  it("rejects a file absent from SHA256SUMS rather than trusting it", async () => {
    const result = await verifyExtracted("/tmp/x", {}, ["libsidplayfp.wasm"], fakeRead({ "libsidplayfp.wasm": "x" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("missing from SHA256SUMS");
  });

  it("rejects a file the tarball did not contain", async () => {
    const result = await verifyExtracted(
      "/tmp/x",
      { "libsidplayfp.wasm": digestOf("x") },
      ["libsidplayfp.wasm"],
      () => {
        throw new Error("ENOENT");
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("missing from the tarball");
  });
});

describe("sha256Hex", () => {
  it("matches node's own digest", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe(createHash("sha256").update("abc").digest("hex"));
  });
});
