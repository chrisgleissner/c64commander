/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import {
  DEFAULT_OUTPUT_PATH,
  DEFAULT_SOURCE_PATH,
  SearchIndexCompileError,
  compileSearchIndex,
  loadIndex,
  renderTs,
} from "../../../scripts/compile-search-index.mjs";

const tempDirs: string[] = [];

const createTempDir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "search-index-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const validEntry = () => ({
  id: "page.test",
  title_key: "search.page.test",
  title: "Test page",
  group: "page",
  target: { kind: "route", path: "/test" },
});

const validConfig = (entries: unknown[] = [validEntry()]) => ({ version: 1, entries });

const writeYaml = (dir: string, config: unknown) => {
  const yamlPath = path.join(dir, "search-index.yaml");
  writeFileSync(yamlPath, yaml.dump(config), "utf8");
  return yamlPath;
};

const loadFrom = (config: unknown) => loadIndex({ yamlPath: writeYaml(createTempDir(), config) });

describe("compile-search-index", () => {
  describe("validation", () => {
    it("accepts a well-formed index", () => {
      expect(loadFrom(validConfig()).entries).toHaveLength(1);
    });

    it("rejects an unsupported version", () => {
      expect(() => loadFrom({ ...validConfig(), version: 2 })).toThrow(/unsupported version/);
    });

    it("rejects an index with no entries", () => {
      expect(() => loadFrom({ version: 1, entries: [] })).toThrow(/declares no entries/);
    });

    it("rejects a duplicate id", () => {
      expect(() => loadFrom(validConfig([validEntry(), validEntry()]))).toThrow(/duplicate entry id/);
    });

    it("rejects an id that is not dotted lowercase", () => {
      expect(() => loadFrom(validConfig([{ ...validEntry(), id: "PageTest" }]))).toThrow(/must be dotted lowercase/);
    });

    it("rejects an unknown group", () => {
      expect(() => loadFrom(validConfig([{ ...validEntry(), group: "everything" }]))).toThrow(/group must be one of/);
    });

    it("rejects an unknown target kind", () => {
      expect(() => loadFrom(validConfig([{ ...validEntry(), target: { kind: "teleport", path: "/x" } }]))).toThrow(
        /kind must be one of/,
      );
    });

    it("rejects a target missing a field its kind needs", () => {
      expect(() =>
        loadFrom(validConfig([{ ...validEntry(), target: { kind: "section", path: "/x", scope: "home" } }])),
      ).toThrow(/is missing: id/);
    });

    it("rejects a target carrying a field its kind does not have", () => {
      expect(() =>
        loadFrom(validConfig([{ ...validEntry(), target: { kind: "route", path: "/x", scope: "home" } }])),
      ).toThrow(/has unknown field\(s\): scope/);
    });

    it("rejects a path that is not absolute", () => {
      expect(() => loadFrom(validConfig([{ ...validEntry(), target: { kind: "route", path: "test" } }]))).toThrow(
        /must start with "\/"/,
      );
    });

    it("rejects an unknown requirement kind", () => {
      expect(() => loadFrom(validConfig([{ ...validEntry(), requires: [{ kind: "vibes" }] }]))).toThrow(
        /kind must be one of/,
      );
    });

    it("rejects a capability requirement with no capability", () => {
      expect(() => loadFrom(validConfig([{ ...validEntry(), requires: [{ kind: "capability" }] }]))).toThrow(
        /is missing: capability/,
      );
    });

    it("rejects a subtitle without its translation key", () => {
      expect(() => loadFrom(validConfig([{ ...validEntry(), subtitle: "No key" }]))).toThrow(
        /subtitle and subtitle_key must be given together/,
      );
    });

    it("rejects duplicate keywords on one entry", () => {
      expect(() => loadFrom(validConfig([{ ...validEntry(), keywords: ["a", "A"] }]))).toThrow(
        /keywords has duplicates/,
      );
    });

    it("rejects an unknown field on an entry", () => {
      expect(() => loadFrom(validConfig([{ ...validEntry(), colour: "red" }]))).toThrow(
        /has unknown field\(s\): colour/,
      );
    });
  });

  describe("rendering", () => {
    it("collects the distinct handler ids the index names, sorted", () => {
      const config = loadFrom(
        validConfig([
          { ...validEntry(), id: "action.b", group: "action", target: { kind: "action", handlerId: "zed" } },
          { ...validEntry(), id: "action.a", group: "action", target: { kind: "action", handlerId: "alpha" } },
          { ...validEntry(), id: "action.c", group: "action", target: { kind: "action", handlerId: "alpha" } },
        ]),
      );
      const output = renderTs(config);
      expect(output).toContain('REFERENCED_SEARCH_HANDLER_IDS: readonly string[] = [\n  "alpha",\n  "zed"\n]');
    });

    it("omits an absent subtitle, keyword list and requirement rather than emitting undefined", () => {
      const output = renderTs(loadFrom(validConfig()));
      expect(output).not.toContain("subtitleKey");
      expect(output).not.toContain("keywords");
      expect(output).not.toContain("requires");
    });
  });

  describe("drift", () => {
    it("reports the committed file as up to date", async () => {
      await expect(compileSearchIndex({ check: true })).resolves.toMatchObject({ changed: false });
    });

    it("fails --check on a hand-edited generated file", async () => {
      const dir = createTempDir();
      const outputPath = path.join(dir, "searchIndex.ts");
      writeFileSync(outputPath, readFileSync(DEFAULT_OUTPUT_PATH, "utf8").replace("page.home", "page.hom"), "utf8");
      await expect(compileSearchIndex({ yamlPath: DEFAULT_SOURCE_PATH, outputPath, check: true })).rejects.toThrow(
        SearchIndexCompileError,
      );
    });

    it("fails --check when the generated file does not exist at all", async () => {
      const outputPath = path.join(createTempDir(), "missing.ts");
      await expect(compileSearchIndex({ yamlPath: DEFAULT_SOURCE_PATH, outputPath, check: true })).rejects.toThrow(
        /generated file is out of date/,
      );
    });
  });
});
