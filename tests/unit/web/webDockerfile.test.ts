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
  it("copies variants before running the web build", () => {
    const dockerfile = fs.readFileSync(dockerfilePath, "utf8");

    expect(dockerfile).toContain("COPY variants ./variants");
    expect(dockerfile.indexOf("COPY variants ./variants")).toBeLessThan(
      dockerfile.indexOf("RUN npm run build && npm run build:web-server"),
    );
  });
});
