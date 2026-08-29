/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STATIC_SEARCH_ENTRIES } from "@/generated/searchIndex";
import { deriveDeviceCapabilities } from "@/lib/deviceCapabilities";
import { resolveEntry, resolveRequirement, type RequirementContext } from "@/lib/search/requirements";
import type { SearchEntry, SearchRequirement } from "@/lib/search/types";

/**
 * One sample per member of SearchRequirement, in a state where the requirement is MET. The
 * exhaustiveness test below drives every one of them, so a kind added to the union without a
 * resolver arm shows up here rather than as a row that is silently always enabled.
 */
const EVERY_REQUIREMENT_KIND: readonly SearchRequirement[] = [
  { kind: "device" },
  { kind: "capability", capability: "supportsStreaming" },
  { kind: "productFamily", families: ["U64", "U64E", "U64E2", "C64U"] },
  { kind: "telnet" },
  { kind: "flag", flag: "live_view_enabled" },
  { kind: "variant", variant: "c64commander" },
  { kind: "hvsc" },
  { kind: "session" },
];

const satisfyingContext = (): RequirementContext => ({
  deviceConnected: true,
  capabilities: deriveDeviceCapabilities({ product: "Ultimate 64", coreVersion: "1.44", restReachable: true }),
  telnetAvailable: true,
  flagValue: () => true,
  variantId: "c64commander",
  hvscReady: true,
  hasRestorableSession: true,
});

const denyingContext = (): RequirementContext => ({
  deviceConnected: false,
  capabilities: deriveDeviceCapabilities({}),
  telnetAvailable: false,
  flagValue: () => false,
  variantId: "some-other-variant",
  hvscReady: false,
  hasRestorableSession: false,
});

describe("search requirement resolver", () => {
  it("covers every member of the SearchRequirement union", () => {
    /*
     * Read out of types.ts, not written out again here.
     *
     * The earlier version compared EVERY_REQUIREMENT_KIND against a hardcoded list of the same
     * strings thirty lines below it, so adding a ninth member to the union changed neither side and
     * the test stayed green — while its own comment claimed the opposite. A type does not exist at
     * run time, so the source is the only place the union can be read from.
     */
    const source = readFileSync(join(process.cwd(), "src/lib/search/types.ts"), "utf8");
    const start = source.indexOf("export type SearchRequirement");
    // To the blank line that ends the declaration. Not to the first semicolon: the members are
    // object types and several carry one of their own, e.g. `{ kind: "capability"; capability: ... }`.
    const union = source.slice(start, source.indexOf("\n\n", start));
    const declared = [...union.matchAll(/kind:\s*"([a-zA-Z]+)"/g)].map((match) => match[1]).sort();
    expect(declared.length).toBeGreaterThan(0);

    const covered = [...new Set(EVERY_REQUIREMENT_KIND.map((requirement) => requirement.kind))].sort();
    expect(covered).toEqual(declared);
  });

  it.each(EVERY_REQUIREMENT_KIND.map((requirement) => [requirement.kind, requirement] as const))(
    "resolves %s as met when its condition holds",
    (_kind, requirement) => {
      const verdict = resolveRequirement(requirement, satisfyingContext());
      expect(verdict.met).toBe(true);
      expect(verdict.reason).toBe("");
    },
  );

  it.each(EVERY_REQUIREMENT_KIND.map((requirement) => [requirement.kind, requirement] as const))(
    "resolves %s as unmet with a non-empty reason when its condition fails",
    (_kind, requirement) => {
      const verdict = resolveRequirement(requirement, denyingContext());
      expect(verdict.met).toBe(false);
      expect(verdict.reason.length).toBeGreaterThan(0);
    },
  );

  it("points a device requirement at the Connection settings so the reason is actionable", () => {
    const verdict = resolveRequirement({ kind: "device" }, denyingContext());
    expect(verdict.remedyTarget).toEqual({ kind: "section", path: "/settings", scope: "settings", id: "connection" });
  });

  it("points a feature-flag requirement at the chapter that holds the switch", () => {
    const verdict = resolveRequirement({ kind: "flag", flag: "live_view_enabled" }, denyingContext());
    expect(verdict.remedyTarget).toEqual({
      kind: "section",
      path: "/settings",
      scope: "settings",
      id: "feature-group-stable",
    });
    expect(verdict.reason).toContain("turned off in Settings");
  });

  it("points the SID Radio switch at its own Settings chapter", () => {
    const verdict = resolveRequirement({ kind: "flag", flag: "sid_radio_enabled" }, denyingContext());
    expect(verdict.remedyTarget).toEqual({ kind: "section", path: "/settings", scope: "settings", id: "sid-radio" });
  });

  it("treats a capability as unmet with the connection reason when nothing is connected", () => {
    const verdict = resolveRequirement({ kind: "capability", capability: "supportsStreaming" }, denyingContext());
    expect(verdict.reason).toBe("Needs a connected C64 Ultimate");
  });

  it("names the capability when a connected device does not have it", () => {
    const ctx: RequirementContext = {
      ...satisfyingContext(),
      capabilities: deriveDeviceCapabilities({ product: "Ultimate-II+", restReachable: true }),
    };
    const verdict = resolveRequirement({ kind: "capability", capability: "supportsStreaming" }, ctx);
    expect(verdict.met).toBe(false);
    expect(verdict.reason).toBe("This model cannot stream picture or sound");
  });
});

describe("resolveEntry", () => {
  const entryWith = (requires: readonly SearchRequirement[]): SearchEntry => ({
    id: "test.entry",
    titleKey: "test.entry",
    titleDefault: "Test entry",
    group: "action",
    target: { kind: "route", path: "/" },
    requires,
  });

  it("enables an entry whose every requirement is met", () => {
    const resolved = resolveEntry(entryWith(EVERY_REQUIREMENT_KIND), satisfyingContext());
    expect(resolved.enabled).toBe(true);
    expect(resolved.disabledReason).toBeNull();
  });

  it("reports the FIRST unmet requirement, so the reason is the first thing to change", () => {
    const resolved = resolveEntry(entryWith([{ kind: "device" }, { kind: "hvsc" }]), denyingContext());
    expect(resolved.enabled).toBe(false);
    expect(resolved.disabledReason).toBe("Needs a connected C64 Ultimate");
  });

  it("enables an entry with no requirements at all", () => {
    const resolved = resolveEntry({ ...entryWith([]), requires: undefined }, denyingContext());
    expect(resolved.enabled).toBe(true);
  });

  it.each(
    STATIC_SEARCH_ENTRIES.filter((entry) => (entry.requires?.length ?? 0) > 0).map(
      (entry) => [entry.id, entry] as const,
    ),
  )("lists %s disabled with a stated reason when nothing is available", (_id, entry) => {
    const resolved = resolveEntry(entry, denyingContext());
    expect(resolved.enabled).toBe(false);
    expect(resolved.disabledReason).toBeTruthy();
  });
});
