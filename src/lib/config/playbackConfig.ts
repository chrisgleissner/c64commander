/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ConfigFileReference } from "@/lib/config/configFileReference";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";

export type ConfigDiscoveryStrategy = "exact-name" | "directory" | "parent-directory";

export type ConfigConfidence = "high" | "medium" | "low";

export type ConfigResolutionOrigin = "manual" | "manual-none" | "auto-exact" | "auto-directory" | "none";

export type ConfigCandidate = {
  ref: ConfigFileReference;
  strategy: ConfigDiscoveryStrategy;
  distance: number;
  confidence: ConfigConfidence;
};

export type ConfigValueOverride = {
  category: string;
  item: string;
  value: string | number;
};

export type ConfigPreviewChange = {
  category: string;
  item: string;
  before: string | number | null;
  after: string | number;
};

export type ConfigPreview = {
  generatedAt: string;
  changes: ConfigPreviewChange[];
};

export type PlaybackConfigState = {
  configRef: ConfigFileReference | null;
  configOrigin: ConfigResolutionOrigin;
  configOverrides: ConfigValueOverride[] | null;
  configCandidates?: ConfigCandidate[] | null;
  configPreview?: ConfigPreview | null;
};

export type PlaybackConfigUiState = "none" | "candidates" | "resolved" | "edited" | "declined";

export const DEFAULT_CONFIG_ORIGIN: ConfigResolutionOrigin = "none";

export const areConfigReferencesEqual = (
  left: ConfigFileReference | null | undefined,
  right: ConfigFileReference | null | undefined,
) => {
  if (!left && !right) return true;
  if (!left || !right) return false;
  if (left.kind !== right.kind) return false;
  if (left.fileName !== right.fileName) return false;
  if (left.kind === "ultimate" && right.kind === "ultimate") {
    return normalizeSourcePath(left.path) === normalizeSourcePath(right.path);
  }
  if (left.kind === "local" && right.kind === "local") {
    return (
      normalizeSourcePath(left.path ?? left.fileName) === normalizeSourcePath(right.path ?? right.fileName) &&
      (left.sourceId ?? null) === (right.sourceId ?? null) &&
      (left.uri ?? null) === (right.uri ?? null)
    );
  }
  return false;
};

export const buildConfigReferenceKey = (ref: ConfigFileReference) => {
  if (ref.kind === "ultimate") {
    return `ultimate:${normalizeSourcePath(ref.path)}`;
  }
  return `local:${ref.sourceId ?? ""}:${ref.uri ?? ""}:${normalizeSourcePath(ref.path ?? ref.fileName)}`;
};

export const compareConfigCandidates = (left: ConfigCandidate, right: ConfigCandidate) => {
  const strategyOrder: Record<ConfigDiscoveryStrategy, number> = {
    "exact-name": 0,
    directory: 1,
    "parent-directory": 2,
  };
  if (left.distance !== right.distance) {
    return left.distance - right.distance;
  }
  if (strategyOrder[left.strategy] !== strategyOrder[right.strategy]) {
    return strategyOrder[left.strategy] - strategyOrder[right.strategy];
  }
  return buildConfigReferenceKey(left.ref).localeCompare(buildConfigReferenceKey(right.ref));
};

export const dedupeConfigCandidates = (candidates: ConfigCandidate[]) => {
  const byKey = new Map<string, ConfigCandidate>();
  [...candidates].sort(compareConfigCandidates).forEach((candidate) => {
    const key = buildConfigReferenceKey(candidate.ref);
    if (!byKey.has(key)) {
      byKey.set(key, candidate);
    }
  });
  return [...byKey.values()].sort(compareConfigCandidates);
};

export const resolveStoredConfigOrigin = (
  configRef: ConfigFileReference | null | undefined,
  configOrigin: ConfigResolutionOrigin | null | undefined,
): ConfigResolutionOrigin => {
  if (configOrigin) return configOrigin;
  return configRef ? "manual" : DEFAULT_CONFIG_ORIGIN;
};

export const resolvePlaybackConfigUiState = ({
  configRef,
  configOrigin,
  configOverrides,
  configCandidates,
}: Pick<
  PlaybackConfigState,
  "configRef" | "configOrigin" | "configOverrides" | "configCandidates"
>): PlaybackConfigUiState => {
  if (configOrigin === "manual-none") return "declined";
  if (configOverrides?.length) return "edited";
  if (configRef) return "resolved";
  if ((configCandidates?.length ?? 0) > 0) return "candidates";
  return "none";
};

export const describeConfigOrigin = (origin: ConfigResolutionOrigin) => {
  switch (origin) {
    case "manual":
      return "Manual";
    case "manual-none":
      return "No config";
    case "auto-exact":
      return "Auto: same name";
    case "auto-directory":
      return "Auto: same folder";
    case "none":
      return "Unresolved";
  }
};

export const summarizeConfigChangeCategories = (overrides: ConfigValueOverride[] | null | undefined) => {
  if (!overrides?.length) return [] as string[];
  return [...new Set(overrides.map((override) => override.category))];
};

export const upsertConfigOverride = (
  overrides: ConfigValueOverride[] | null | undefined,
  nextOverride: ConfigValueOverride,
) => {
  const next = [...(overrides ?? [])];
  const existingIndex = next.findIndex(
    (override) => override.category === nextOverride.category && override.item === nextOverride.item,
  );
  if (existingIndex >= 0) {
    next[existingIndex] = nextOverride;
  } else {
    next.push(nextOverride);
  }
  return next;
};

export const removeConfigOverride = (
  overrides: ConfigValueOverride[] | null | undefined,
  target: Pick<ConfigValueOverride, "category" | "item">,
) => {
  const next = (overrides ?? []).filter(
    (override) => override.category !== target.category || override.item !== target.item,
  );
  return next.length ? next : null;
};

export const groupConfigOverrides = (overrides: ConfigValueOverride[] | null | undefined) => {
  return (overrides ?? []).reduce<Record<string, ConfigValueOverride[]>>((groups, override) => {
    const bucket = groups[override.category] ?? (groups[override.category] = []);
    bucket.push(override);
    return groups;
  }, {});
};

export const buildPlaybackConfigSignature = (
  configRef: ConfigFileReference | null | undefined,
  overrides: ConfigValueOverride[] | null | undefined,
) => {
  return JSON.stringify({
    configRef: configRef
      ? {
          key: buildConfigReferenceKey(configRef),
          fileName: configRef.fileName,
        }
      : null,
    overrides: (overrides ?? []).map((override) => ({
      category: override.category,
      item: override.item,
      value: override.value,
    })),
  });
};
