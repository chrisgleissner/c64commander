/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ConfigFileReference } from "@/lib/config/configFileReference";
import {
  dedupeConfigCandidates,
  type ConfigCandidate,
  type ConfigResolutionOrigin,
  type ConfigValueOverride,
} from "@/lib/config/playbackConfig";

export type ResolvePlaybackConfigOptions = {
  candidates?: ConfigCandidate[] | null;
  manualConfigRef?: ConfigFileReference | null;
  manualNone?: boolean;
  overrides?: ConfigValueOverride[] | null;
};

export type ResolvedPlaybackConfig = {
  configRef: ConfigFileReference | null;
  configOrigin: ConfigResolutionOrigin;
  configCandidates: ConfigCandidate[];
  configOverrides: ConfigValueOverride[] | null;
};

export const resolvePlaybackConfig = ({
  candidates,
  manualConfigRef,
  manualNone,
  overrides,
}: ResolvePlaybackConfigOptions): ResolvedPlaybackConfig => {
  const resolvedCandidates = dedupeConfigCandidates(candidates ?? []);
  if (manualConfigRef) {
    return {
      configRef: manualConfigRef,
      configOrigin: "manual",
      configCandidates: resolvedCandidates,
      configOverrides: overrides ?? null,
    };
  }

  if (manualNone) {
    return {
      configRef: null,
      configOrigin: "manual-none",
      configCandidates: resolvedCandidates,
      configOverrides: null,
    };
  }

  const exactCandidates = resolvedCandidates.filter((candidate) => candidate.strategy === "exact-name");
  if (exactCandidates.length === 1) {
    return {
      configRef: exactCandidates[0]!.ref,
      configOrigin: "auto-exact",
      configCandidates: resolvedCandidates,
      configOverrides: overrides ?? null,
    };
  }

  const directoryCandidates = resolvedCandidates.filter((candidate) => candidate.strategy === "directory");
  if (exactCandidates.length === 0 && directoryCandidates.length === 1) {
    return {
      configRef: directoryCandidates[0]!.ref,
      configOrigin: "auto-directory",
      configCandidates: resolvedCandidates,
      configOverrides: overrides ?? null,
    };
  }

  return {
    configRef: null,
    configOrigin: "none",
    configCandidates: resolvedCandidates,
    configOverrides: overrides ?? null,
  };
};
