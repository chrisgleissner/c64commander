/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(path.resolve(process.cwd(), ".github/workflows/stream-gates.yaml"), "utf8");

describe("stream-gates workflow contracts", () => {
  it("benchmarks the parent commit on the same runner instead of the committed baseline", () => {
    expect(workflow).toMatch(/uses: actions\/checkout@v\d+\n\s+with:\n(?:\s+#.*\n)*\s+fetch-depth: 2\n/);
    expect(workflow).toMatch(/run: node scripts\/ci\/stream-gates\.mjs\n\s+env:\n\s+STREAM_BENCH_AGAINST: HEAD\^1\n/);
  });

  it("runs when the benchmark comparison changes", () => {
    expect(workflow).toContain('- "scripts/lib/streamPerfCompare.mjs"');
  });
});
