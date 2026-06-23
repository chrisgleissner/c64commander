/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Layer B resolver — select which captured menu hierarchy (if any) to paint for a
 * given device, mirroring `deriveDeviceCapabilities`.
 *
 * `family + firmwareVersion` choose the hierarchy strictly as a display/labels
 * concern (the capability model declares `family` is "for display/labels only — it
 * is NEVER used as a feature gate"). This resolver NEVER decides WHETHER an item
 * renders — only WHERE/HOW to group it. When it returns `null` the Config page falls
 * back to the live REST-category grouping (Layer A still applies). It never crosses
 * families: a U64/U2/unknown device gets `null`, not the C64U hierarchy.
 */

import type { MenuHierarchy } from "./types";
import { C64U_1_1_0_HIERARCHY } from "./c64u-1.1.0.generated";

interface HierarchyRegistration {
  family: string;
  firmwareVersion: string;
  hierarchy: MenuHierarchy;
}

/**
 * Captured menu hierarchies. Add a row when a new family/firmware menu is compiled
 * (see `.github/skills/menu-mapping-authoring/SKILL.md`). ONLY families with a real
 * captured menu appear here — never fabricate one.
 */
const REGISTRY: HierarchyRegistration[] = [
  { family: "C64U", firmwareVersion: "1.1.0", hierarchy: C64U_1_1_0_HIERARCHY },
];

/** Parse a firmware version into comparable numeric components + a trailing suffix. */
const parseVersion = (version: string): { parts: number[]; suffix: string } => {
  const trimmed = String(version ?? "").trim();
  const parts: number[] = [];
  let suffix = "";
  for (const segment of trimmed.split(".")) {
    const match = segment.match(/^(\d+)(.*)$/);
    if (match) {
      parts.push(Number(match[1]));
      if (match[2]) suffix = match[2];
    } else {
      suffix = segment;
    }
  }
  return { parts, suffix };
};

/**
 * Compare two version suffixes once the numeric parts are equal. Two conventions
 * coexist in C64 Ultimate firmware tags and we honor both:
 *   - A leading `-` marks a SemVer pre-release (`1.1.0-beta`), which sorts BELOW the
 *     bare release (`1.1.0-beta` < `1.1.0`) per SemVer §11.
 *   - Any other suffix is a revision letter in the device's own scheme (`3.14e`), which
 *     sorts ABOVE the bare version (`3.14` < `3.14e`) and alphabetically among siblings.
 * SemVer build metadata (`+…`) does not affect precedence, so it is stripped first.
 * Within the same class the dot-separated identifiers are compared lexically — a
 * pragmatic subset of SemVer pre-release ordering, sufficient for these tags.
 */
const compareSuffix = (a: string, b: string): number => {
  const normalize = (s: string) => s.split("+")[0];
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 0;
  // Class rank: pre-release (-1) < bare release (0) < revision letter (1).
  const rank = (s: string): number => (s === "" ? 0 : s.startsWith("-") ? -1 : 1);
  const ra = rank(na);
  const rb = rank(nb);
  if (ra !== rb) return ra < rb ? -1 : 1;
  return na < nb ? -1 : 1;
};

/** SemVer-ish comparison tolerant of suffixes like "3.14e" and pre-release tags. */
export const compareFirmwareVersions = (a: string, b: string): number => {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  const len = Math.max(va.parts.length, vb.parts.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (va.parts[i] ?? 0) - (vb.parts[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return compareSuffix(va.suffix, vb.suffix);
};

export interface ResolveMenuMappingInput {
  family: string | null | undefined;
  firmwareVersion?: string | null;
}

/**
 * Resolve the menu hierarchy for a device, or `null` to use the REST-grouped layout.
 * Fallback chain (WITHIN the same family only): exact version → nearest lower version
 * → latest version → null.
 */
export const resolveMenuMapping = ({ family, firmwareVersion }: ResolveMenuMappingInput): MenuHierarchy | null => {
  if (!family || family === "unknown") return null;
  const candidates = REGISTRY.filter((registration) => registration.family === family);
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => compareFirmwareVersions(a.firmwareVersion, b.firmwareVersion));

  const target = firmwareVersion ? String(firmwareVersion).trim() : "";
  if (target) {
    const exact = candidates.find((c) => c.firmwareVersion === target);
    if (exact) return exact.hierarchy;
    const lowerOrEqual = sorted.filter((c) => compareFirmwareVersions(c.firmwareVersion, target) <= 0);
    if (lowerOrEqual.length) return lowerOrEqual[lowerOrEqual.length - 1].hierarchy;
  }
  // No version, or the device firmware predates every captured menu → latest in family.
  return sorted[sorted.length - 1].hierarchy;
};

/** Families that currently have a captured menu hierarchy (for diagnostics/tests). */
export const mappedFamilies = (): string[] => Array.from(new Set(REGISTRY.map((r) => r.family)));
