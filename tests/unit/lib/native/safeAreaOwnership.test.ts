/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Capacitor's SystemBars plugin writes these as INLINE styles on <html>, which outranks any :root
 * rule: a value the app composes from a property it maintains itself is discarded on Android. The
 * app used to maintain such a property (`--native-safe-area-inset-*`), and it went stale.
 */

const repoRoot = process.cwd();

const capacitorSystemBarsSource = readFileSync(
  path.join(
    repoRoot,
    "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/SystemBars.java",
  ),
  "utf8",
);

/** The property names Capacitor claims, read from the plugin that writes them. */
const capacitorOwnedProperties = [...capacitorSystemBarsSource.matchAll(/setProperty\("(--[a-z-]+)"/g)].map(
  (match) => match[1],
);

const indexCss = readFileSync(path.join(repoRoot, "src/index.css"), "utf8");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|css)$/.test(entry) ? [full] : [];
  });

/** A `g` flag would carry `lastIndex` between `.test()` calls, so this pattern has none. */
const SECOND_WRITER = /setProperty\(\s*["'`]--(native-)?safe-area-inset-/;

describe("safe-area custom property ownership", () => {
  it("reads the owned property names out of the Capacitor plugin that writes them", () => {
    expect(capacitorOwnedProperties).toEqual([
      "--safe-area-inset-top",
      "--safe-area-inset-right",
      "--safe-area-inset-bottom",
      "--safe-area-inset-left",
    ]);
  });

  it("declares each owned property as a plain env() fallback that composes nothing", () => {
    for (const property of capacitorOwnedProperties) {
      const declarations = [...indexCss.matchAll(new RegExp(`\\${property}:([^;]*);`, "g"))].map((m) => m[1].trim());
      expect(declarations, `${property} must be declared exactly once in src/index.css`).toHaveLength(1);
      const edge = property.replace("--safe-area-inset-", "");
      expect(declarations[0], `${property} must not be composed from another custom property`).toBe(
        `env(safe-area-inset-${edge}, 0px)`,
      );
    }
  });

  // The next guard asserts that a filtered list is empty, so it passes having read
  // nothing if the walk stops finding files. These two check that the walk still
  // covers src/ and that the pattern still recognises a second writer.
  it("walks the src tree it claims to cover", () => {
    const srcRoot = path.join(repoRoot, "src");
    expect(existsSync(srcRoot), "src is not a directory, so this guard scans nothing").toBe(true);
    const files = sourceFiles(srcRoot);
    expect(files.length, "the src walk found no source file").toBeGreaterThan(100);
    expect(
      files.some((file) => path.relative(srcRoot, file).includes(path.sep)),
      "the walk did not descend into src subdirectories",
    ).toBe(true);
  });

  it("recognises a planted second writer of a safe-area inset property", () => {
    const planted = [
      'document.documentElement.style.setProperty("--safe-area-inset-top", "0px");',
      "el.style.setProperty(\n  '--native-safe-area-inset-bottom',\n  value,\n);",
      'element.style.setProperty("--c64-unrelated", value);',
    ];
    expect(planted.map((source) => SECOND_WRITER.test(source))).toEqual([true, true, false]);
  });

  it("has no second writer of a safe-area inset property anywhere under src/", () => {
    const offenders = sourceFiles(path.join(repoRoot, "src"))
      .filter((file) => SECOND_WRITER.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(repoRoot, file));
    expect(offenders, "only Capacitor's SystemBars plugin may write the safe-area insets").toEqual([]);
  });

  it("keeps no leftover --native-safe-area-inset-* property in the stylesheet", () => {
    expect(indexCss).not.toContain("--native-safe-area-inset-");
  });
});
