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

const TAGGED_DESCRIBE_PATTERN = /^(?<tag>.+)-(?<distance>\d+)-g(?<sha>[0-9a-f]+)(?<dirty>-dirty)?$/i;
const BARE_SHA_PATTERN = /^(?<sha>[0-9a-f]+)(?<dirty>-dirty)?$/i;

export const shortenGitId = (gitSha: string, length = 3) => gitSha.trim().slice(0, Math.max(0, length));

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
