/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");

const extractSection = (heading: string, nextHeading: string) => {
  const start = readme.indexOf(heading);
  const end = readme.indexOf(nextHeading, start + heading.length);
  if (start < 0 || end < 0) {
    throw new Error(`Could not extract README section ${heading}`);
  }
  return readme.slice(start, end);
};

const extractImageSources = (markdown: string) =>
  Array.from(markdown.matchAll(/<img\s+[^>]*src="([^"]+)"[^>]*>/g)).map((match) => match[1]);

describe("README screenshot coverage", () => {
  it("documents intro, light Home top, dark Home top, and full Home-page section coverage", () => {
    const homeSection = extractSection("### Home", "### Play");
    const sources = extractImageSources(homeSection);

    expect(sources).toEqual(
      expect.arrayContaining([
        "docs/img/app/home/00-overview-light.png",
        "docs/img/app/home/sections/01-system-info-to-cpu-ram.png",
        "docs/img/app/home/01-overview-dark.png",
        "docs/img/app/home/sections/02-quick-config-to-keyboard-light.png",
        "docs/img/app/home/sections/03-quick-config-to-printers.png",
        "docs/img/app/home/sections/04-printers-to-sid.png",
        "docs/img/app/home/sections/05-sid-to-config.png",
      ]),
    );

    expect(homeSection).toContain('alt="C64 Commander intro"');
    expect(homeSection).toContain('alt="Home top row and quick actions (Light)"');
    expect(homeSection).toContain('alt="Home top row and quick actions (Dark)"');

    for (const source of sources) {
      expect(existsSync(join(repoRoot, source)), source).toBe(true);
    }
  });
});
