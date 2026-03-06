/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readWorkspaceFile = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf-8");

describe("HVSC bridge guardrails", () => {
  it("uses native streaming ingestion plugin in runtime", () => {
    const runtime = readWorkspaceFile("src/lib/hvsc/hvscIngestionRuntime.ts");
    expect(runtime).toContain("canUseNativeHvscIngestion()");
    expect(runtime).toContain("HvscIngestion.ingestHvsc");
  });

  it("blocks large Filesystem.readFile archive bridge reads", () => {
    const download = readWorkspaceFile("src/lib/hvsc/hvscDownload.ts");
    expect(download).toContain("HVSC bridge read blocked for large archive");
  });

  it("does not use eager cached archive read in cached native path", () => {
    const runtime = readWorkspaceFile("src/lib/hvsc/hvscIngestionRuntime.ts");
    expect(runtime).not.toContain(
      "const archiveBuffer = await readArchiveBuffer(cached);",
    );
  });

  it("does not use Filesystem.readFile in native ingestion runtime path", () => {
    const runtime = readWorkspaceFile("src/lib/hvsc/hvscIngestionRuntime.ts");
    expect(runtime).not.toContain("Filesystem.readFile(");
  });
});
