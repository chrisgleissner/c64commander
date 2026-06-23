/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { compileMenuMapping, CompileError } from "../../../scripts/compile-menu-mapping.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ASSOCIATION_REL = "src/lib/config/menuMapping/c64u-1.1.0.association.yaml";

const tmpRoot = mkdtempSync(join(tmpdir(), "menu-mapping-test-"));
let counter = 0;

interface Association {
  family: string;
  firmwareVersion: string;
  sources: { menu: string; config: string };
  nonConfigPages: string[];
  mappings: Array<{ path: string[]; category: string; item: string; formatter?: string; alias?: boolean }>;
  menuOnly: string[][];
  intentionallyUnmapped: Array<{ category: string; item: string }>;
}

const loadCommitted = (): Association =>
  yaml.load(readFileSync(resolve(REPO_ROOT, ASSOCIATION_REL), "utf8")) as Association;

/** Serialize a (mutated) association to a temp file and return a single-target list. */
const mutatedTarget = (mutate: (a: Association) => void) => {
  const association = loadCommitted();
  mutate(association);
  const path = join(tmpRoot, `assoc-${(counter += 1)}.yaml`);
  writeFileSync(path, yaml.dump(association));
  return [
    {
      family: "C64U",
      firmwareVersion: "1.1.0",
      association: path.replace(`${REPO_ROOT}/`, ""),
      output: join(tmpRoot, `out-${counter}.generated.ts`).replace(`${REPO_ROOT}/`, ""),
      constPrefix: "TEST",
    },
  ];
};

describe("menu-mapping compile :check — committed state is drift-free", () => {
  it("passes --check for the committed C64U 1.1.0 mapping (no drift)", () => {
    expect(() => compileMenuMapping({ check: true })).not.toThrow();
  });
});

describe("menu-mapping compile — the drift checker bites", () => {
  it("fails when a menu leaf has neither a mapping nor a menuOnly flag", () => {
    const targets = mutatedTarget((a) => {
      a.mappings = a.mappings.filter((m) => m.item !== "Kernal ROM");
    });
    expect(() => compileMenuMapping({ check: true, targets })).toThrow(/neither a mapping nor a menuOnly/);
  });

  it("fails on a stale mapping path (not a leaf in the menu YAML)", () => {
    const targets = mutatedTarget((a) => {
      a.mappings.push({ path: ["Nonexistent page", "Phantom item"], category: "Audio Mixer", item: "Vol UltiSid 1" });
    });
    expect(() => compileMenuMapping({ check: true, targets })).toThrow(/stale mapping path/);
  });

  it("fails when a mapping points at a REST item absent from the config sample", () => {
    const targets = mutatedTarget((a) => {
      const node = a.mappings.find((m) => m.item === "System Mode")!;
      node.item = "No Such Item";
    });
    expect(() => compileMenuMapping({ check: true, targets })).toThrow(/absent from/);
  });

  it("fails when a config item is neither mapped nor intentionallyUnmapped (completeness)", () => {
    const targets = mutatedTarget((a) => {
      a.intentionallyUnmapped = a.intentionallyUnmapped.filter((e) => e.item !== "C64U Model");
    });
    expect(() => compileMenuMapping({ check: true, targets })).toThrow(/neither mapped nor intentionallyUnmapped/);
  });

  it("reports a missing generated output as a CompileError", () => {
    // Valid association but output path that does not exist yet → :check must fail.
    const targets = mutatedTarget(() => {});
    expect(() => compileMenuMapping({ check: true, targets })).toThrow(CompileError);
  });
});
