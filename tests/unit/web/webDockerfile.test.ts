/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment node
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const dockerfilePath = path.join(repoRoot, "web", "Dockerfile");

describe("web Dockerfile", () => {
  it("copies build-time branding inputs before running the web build", () => {
    const dockerfile = fs.readFileSync(dockerfilePath, "utf8");

    expect(dockerfile).toContain(
      "RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*",
    );
    expect(dockerfile).toContain("COPY variants ./variants");
    expect(dockerfile).toContain("COPY docs/img/c64commander.png ./docs/img/c64commander.png");
    expect(dockerfile.indexOf("COPY variants ./variants")).toBeLessThan(
      dockerfile.indexOf("RUN npm run build && npm run build:web-server"),
    );
    expect(dockerfile.indexOf("COPY docs/img/c64commander.png ./docs/img/c64commander.png")).toBeLessThan(
      dockerfile.indexOf("RUN npm run build && npm run build:web-server"),
    );
  });

  /*
   * Every top-level directory a prebuild compiler reads has to be in the image.
   *
   * `search/` was not, and the omission was invisible until the Docker build failed with
   * "ENOENT: no such file or directory, open '/app/search/search-index.yaml'" — the compilers run
   * from `prebuild`, which the Dockerfile invokes through `npm run build`, so a source directory
   * left out of the COPY list fails only there. Derived from package.json rather than listed here,
   * so the next generator added to prebuild is covered without anyone remembering to.
   */
  it("copies every top-level directory the prebuild compilers read", () => {
    const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    const scriptFiles = packageJson.scripts.prebuild
      .split("&&")
      .map((step) => /npm run ([\w:-]+)/.exec(step.trim())?.[1])
      .filter((name): name is string => Boolean(name))
      .map((name) => /node (scripts\/[\w.-]+\.mjs)/.exec(packageJson.scripts[name] ?? "")?.[1])
      .filter((file): file is string => Boolean(file));

    expect(scriptFiles.length).toBeGreaterThan(0);

    const readDirectories = new Set<string>();
    for (const file of scriptFiles) {
      const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
      for (const match of source.matchAll(/join\(REPO_ROOT,\s*"([\w.-]+)"/g)) {
        const entry = match[1];
        // Directories only: a single file (index.html) is copied as `COPY <file> ./`, and `src` is
        // copied wholesale already. Anything generated INTO a directory is an output, not an input.
        if (entry === "src" || entry === "dist") continue;
        const absolute = path.join(repoRoot, entry);
        if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) readDirectories.add(entry);
      }
    }

    for (const directory of readDirectories) {
      expect(dockerfile, `${directory} is read by a prebuild compiler but not copied`).toContain(
        `COPY ${directory} ./${directory}`,
      );
      expect(dockerfile.indexOf(`COPY ${directory} ./${directory}`)).toBeLessThan(
        dockerfile.indexOf("RUN npm run build && npm run build:web-server"),
      );
    }
  });
});
