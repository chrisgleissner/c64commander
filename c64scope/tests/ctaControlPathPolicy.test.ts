/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function ctaSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return ctaSourceFiles(entryPath);
      }
      return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
    }),
  );
  return files.flat();
}

describe("CTA runner product control path policy", () => {
  it("does not drive product input through shell keyevents", async () => {
    const sourceRoot = path.join(process.cwd(), "src", "cta");
    const offenders: string[] = [];

    for (const file of await ctaSourceFiles(sourceRoot)) {
      const source = await readFile(file, "utf-8");
      if (/\.shell\([^)]*input\s+keyevent/s.test(source)) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
