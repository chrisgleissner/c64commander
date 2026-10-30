/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { TAB_ROUTES } from "@/lib/navigation/tabRoutes";
import { FEATURE_FLAG_IDS } from "@/lib/config/featureFlagsRegistry.generated";
import {
  isSurfaceVisible,
  SURFACE_CLASSIFIED_SCOPES_FOLLOWING_ROUTE,
  SURFACE_CLASSIFIED_SECTION_IDS,
  type SurfaceId,
} from "@/lib/appMode/surfaces";

const SRC = path.resolve(__dirname, "../../../../src");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });

const literalSections = (): string[] => {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(
      /<CollapsibleSection\b[\s\S]{0,400}?\bscope="([\w-]+)"[\s\S]{0,200}?\bid="([\w-]+)"/g,
    )) {
      found.add(`${match[1]}:${match[2]}`);
    }
    for (const match of text.matchAll(/<SettingsSection\b[^>]{0,200}?\bid="([\w-]+)"/g)) {
      found.add(`settings:${match[1]}`);
    }
    for (const match of text.matchAll(/<SettingsSection\s+id="([\w-]+)"/g)) found.add(`settings:${match[1]}`);
  }
  return [...found].sort();
};

describe("surface classification coverage", () => {
  it("SPM-ARCH-03 every Home, Settings and Docs section in the source has a surface classification", () => {
    const unclassified = literalSections().filter((key) => {
      const [scope] = key.split(":");
      if (SURFACE_CLASSIFIED_SCOPES_FOLLOWING_ROUTE.includes(scope)) return false;
      return !SURFACE_CLASSIFIED_SECTION_IDS.includes(key);
    });
    expect(unclassified).toEqual([]);
  });

  it("SPM-ARCH-03 the source scan finds the sections it is meant to guard", () => {
    const found = literalSections();
    expect(found).toEqual(
      expect.arrayContaining(["home:cpu-ram", "settings:appearance", "settings:hvsc", "play:spectrum"]),
    );
  });

  it("SPM-ARCH-03 every tab route and feature flag has a surface classification", () => {
    for (const route of TAB_ROUTES) {
      expect(typeof isSurfaceVisible(`route:${route.path}` as SurfaceId, "sid-player")).toBe("boolean");
    }
    for (const id of FEATURE_FLAG_IDS) {
      expect(typeof isSurfaceVisible(`flag:${id}` as SurfaceId, "sid-player")).toBe("boolean");
    }
  });

  it("SPM-ARCH-03 SID Player shows exactly Play, Settings and Docs among the tab routes", () => {
    const visible = TAB_ROUTES.filter((route) => isSurfaceVisible(`route:${route.path}`, "sid-player")).map(
      (route) => route.path,
    );
    expect(visible).toEqual(["/play", "/settings", "/docs"]);
  });
});
