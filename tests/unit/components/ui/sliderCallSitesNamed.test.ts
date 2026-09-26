/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(__dirname, "../../../../src");

const listTsxSources = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return listTsxSources(full);
    return full.endsWith(".tsx") && !full.includes(".test.") ? [full] : [];
  });

const findUnnamedSliders = () =>
  listTsxSources(SRC_ROOT).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const unnamed: string[] = [];
    for (const match of source.matchAll(/<Slider\b/g)) {
      const start = match.index ?? 0;
      const element = source.slice(start, source.indexOf("/>", start));
      if (!/\baria-label(ledby)?=/.test(element)) {
        unnamed.push(`${path.relative(SRC_ROOT, file)}:${source.slice(0, start).split("\n").length}`);
      }
    }
    return unnamed;
  });

describe("Slider call sites", () => {
  it("give every slider an accessible name, which the component puts on the role=slider thumb", () => {
    expect(findUnnamedSliders()).toEqual([]);
  });
});
