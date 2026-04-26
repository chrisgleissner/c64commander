/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type VersionLabelInput = {
  gitDescribe?: string;
  gitSha?: string;
  fallbackVersion?: string;
};

type BuildVersionLabelInput = {
  generatedVersionLabel?: string;
  gitDescribe?: string;
  gitSha?: string;
  fallbackVersion?: string;
};

const TAGGED_DESCRIBE_PATTERN = /^(?<tag>.+)-(?<distance>\d+)-g(?<sha>[0-9a-f]+)(?<dirty>-dirty)?$/i;
const BARE_SHA_PATTERN = /^(?<sha>[0-9a-f]+)(?<dirty>-dirty)?$/i;
const RELEASE_BASE_PATTERN = /^(?<release>\d+\.\d+\.\d+)(?<suffix>[-+].*)?$/;

const resolveReleaseBaseVersion = (value: string) => {
  const normalizedValue = value.trim();
  const match = normalizedValue.match(RELEASE_BASE_PATTERN);
  return match?.groups?.release ?? normalizedValue;
};

export const shortenGitId = (gitSha: string, length = 5) => gitSha.trim().slice(0, Math.max(0, length));

export const deriveVersionLabel = ({
  gitDescribe = "",
  gitSha = "",
  fallbackVersion = "",
}: VersionLabelInput): string => {
  const normalizedDescribe = gitDescribe.trim();
  const normalizedGitSha = gitSha.trim();
  const normalizedFallback = fallbackVersion.trim();

  const taggedMatch = normalizedDescribe.match(TAGGED_DESCRIBE_PATTERN);
  if (taggedMatch?.groups) {
    const { tag, distance, sha, dirty } = taggedMatch.groups;
    if (Number(distance) === 0 && !dirty) return tag;
    return `${tag}-${shortenGitId(normalizedGitSha || sha)}`;
  }

  const bareShaMatch = normalizedDescribe.match(BARE_SHA_PATTERN);
  if (bareShaMatch?.groups) {
    return normalizedFallback || shortenGitId(normalizedGitSha || bareShaMatch.groups.sha);
  }

  return normalizedDescribe || normalizedFallback || "—";
};

export const resolveBuildVersionLabel = ({
  generatedVersionLabel = "",
  gitDescribe = "",
  gitSha = "",
  fallbackVersion = "",
}: BuildVersionLabelInput): string => {
  const normalizedGenerated = generatedVersionLabel.trim();
  const normalizedFallback = fallbackVersion.trim();
  if (normalizedGenerated) {
    if (!normalizedFallback) return normalizedGenerated;
    if (resolveReleaseBaseVersion(normalizedGenerated) === resolveReleaseBaseVersion(normalizedFallback)) {
      return normalizedGenerated;
    }
  }

  if (normalizedFallback) return normalizedFallback;

  return deriveVersionLabel({
    gitDescribe,
    gitSha,
    fallbackVersion: normalizedFallback,
  });
};
