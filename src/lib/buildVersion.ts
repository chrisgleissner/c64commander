/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type BuildVersionInput = {
  env?: Record<string, string | undefined>;
  packageVersion?: string;
};

const TAG_REF_PREFIX = "refs/tags/";

export const normalizeReleaseVersion = (value: string) => value.trim();

const resolveTagRefName = (env: Record<string, string | undefined>) => {
  const ref = env.GITHUB_REF?.trim();
  if (!ref?.startsWith(TAG_REF_PREFIX)) return "";
  return ref.slice(TAG_REF_PREFIX.length);
};

export const resolveBuildTagName = (env: Record<string, string | undefined> = {}) => {
  const refType = env.GITHUB_REF_TYPE?.trim();
  const explicitTagRefName = refType === "tag" ? env.GITHUB_REF_NAME?.trim() || "" : "";
  const fallbackTagRefName = resolveTagRefName(env);
  return explicitTagRefName || fallbackTagRefName;
};

export const hasInjectedBuildVersion = (env: Record<string, string | undefined> = {}) => {
  const explicitVersion = env.VITE_APP_VERSION?.trim() || env.VERSION_NAME?.trim() || env.APP_VERSION?.trim();
  return Boolean(explicitVersion || resolveBuildTagName(env));
};

export const resolveBuildAppVersion = ({ env = {}, packageVersion = "" }: BuildVersionInput): string => {
  const explicitVersion = env.VITE_APP_VERSION?.trim() || env.VERSION_NAME?.trim() || env.APP_VERSION?.trim();
  if (explicitVersion) return normalizeReleaseVersion(explicitVersion);

  const tagRefName = resolveBuildTagName(env);
  if (tagRefName) {
    return normalizeReleaseVersion(tagRefName);
  }

  return packageVersion.trim();
};
