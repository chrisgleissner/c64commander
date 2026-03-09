/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  ensureWithinRoot,
  getParentPathWithinRoot,
  isPathWithinRoot,
  normalizeSourcePath,
} from "@/lib/sourceNavigation/paths";

describe("normalizeSourcePath", () => {
  it("returns / for empty string (BRDA:10 TRUE)", () => {
    expect(normalizeSourcePath("")).toBe("/");
  });

  it("prepends / when missing", () => {
    expect(normalizeSourcePath("games")).toBe("/games");
  });

  it("collapses multiple slashes", () => {
    expect(normalizeSourcePath("/games//level1//file")).toBe("/games/level1/file");
  });

  it("trims whitespace", () => {
    expect(normalizeSourcePath("  /games/file  ")).toBe("/games/file");
  });
});

describe("isPathWithinRoot", () => {
  it("returns true for any absolute path when root is empty (BRDA:17 right-side of ||)", () => {
    // normalizeRoot('') calls normalizeSourcePath('' || '/') = normalizeSourcePath('/') = '/'
    // so isPathWithinRoot('/path', '') checks path.startsWith('/') → TRUE
    expect(isPathWithinRoot("/games/file", "")).toBe(true);
  });

  it("returns true when path equals root without trailing slash", () => {
    expect(isPathWithinRoot("/games", "/games/")).toBe(true);
  });

  it("returns false for path outside root", () => {
    expect(isPathWithinRoot("/other", "/games/")).toBe(false);
  });

  it("returns true for root / and any absolute path", () => {
    expect(isPathWithinRoot("/any/path", "/")).toBe(true);
  });
});

describe("getParentPathWithinRoot", () => {
  it("returns root when path equals normalizedRoot without trailing slash (BRDA:32 TRUE)", () => {
    // normalizedPath='/games', normalizedRoot='/games/'
    // normalizedPath === normalizedRoot.slice(0,-1) → '/games'==='/games' → TRUE
    expect(getParentPathWithinRoot("/games", "/games/")).toBe("/games/");
  });

  it("returns / when top-level file is in root / (BRDA:36 TRUE, idx<=0)", () => {
    // path='/file.sid', root='/', trimmed='/file.sid', idx=lastIndexOf('/')=0 → idx<=0 → return '/'
    expect(getParentPathWithinRoot("/file.sid", "/")).toBe("/");
  });

  it("returns root when path is outside root", () => {
    expect(getParentPathWithinRoot("/other/path", "/games/")).toBe("/games/");
  });

  it("returns parent directory for nested path", () => {
    expect(getParentPathWithinRoot("/games/level1/file.sid", "/games/")).toBe("/games/level1/");
  });

  it("returns root when parent directory is outside root (line 38 TRUE branch)", () => {
    // path "/games/level1/file.sid" is within root "/games/level1/"
    // but parent "/games/" is NOT within root "/games/level1/" → returns root
    expect(getParentPathWithinRoot("/games/level1/file.sid", "/games/level1/")).toBe("/games/level1/");
  });
});

describe("ensureWithinRoot", () => {
  it("returns normalized path when within root", () => {
    expect(ensureWithinRoot("/games/file", "/games/")).toBe("/games/file");
  });

  it("returns root when path is outside root", () => {
    expect(ensureWithinRoot("/other/file", "/games/")).toBe("/games/");
  });
});
