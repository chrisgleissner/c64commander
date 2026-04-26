import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { deriveVersionLabel } from '../src/lib/versionLabel';

const SEMVER_PREFIX_PATTERN = /^(?<release>\d+\.\d+\.\d+)(?<suffix>[-+].*)?$/;
const SEMVER_WITH_OPTIONAL_PRERELEASE_PATTERN = /\d+\.\d+\.\d+(?:-[0-9A-Za-z._-]+)?/;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveReleaseBaseVersion = (version: string) => {
  const normalizedVersion = version.trim();
  const match = normalizedVersion.match(SEMVER_PREFIX_PATTERN);
  return match?.groups?.release ?? normalizedVersion;
};

type ResolveExpectedVersionsOptions = {
  env?: Record<string, string | undefined>;
  runGit?: (args: string[]) => string;
  readPackageVersion?: () => string;
};

const defaultRunGit = (args: string[]) => {
  const result = spawnSync('git', args, { encoding: 'utf-8' });
  return result.status === 0 ? result.stdout.trim() : '';
};

const defaultReadPackageVersion = () => {
  try {
    const pkgContent = fs.readFileSync(path.resolve('package.json'), 'utf-8');
    return (JSON.parse(pkgContent) as { version?: string }).version || '';
  } catch {
    return '';
  }
};

export const resolveExpectedVersions = ({
  env = process.env,
  runGit = defaultRunGit,
  readPackageVersion = defaultReadPackageVersion,
}: ResolveExpectedVersionsOptions = {}) => {
  const envVersion = env.VITE_APP_VERSION || env.VERSION_NAME || '';
  if (envVersion) return [envVersion];

  if (env.GITHUB_REF_TYPE === 'tag' && env.GITHUB_REF_NAME) {
    return [env.GITHUB_REF_NAME];
  }

  const tagFromRef = (() => {
    const ref = env.GITHUB_REF?.trim() ?? '';
    return ref.startsWith('refs/tags/') ? ref.slice('refs/tags/'.length) : '';
  })();
  if (tagFromRef) return [tagFromRef];

  const fallbackVersion = readPackageVersion();
  const gitSha = env.CI_SHA || env.GITHUB_SHA || runGit(['rev-parse', 'HEAD']);
  const gitDescribe = runGit(['describe', '--tags', '--long', '--dirty', '--always']);
  const latestTag = runGit(['describe', '--tags', '--abbrev=0']);
  const derivedFromGit = deriveVersionLabel({
    gitDescribe,
    gitSha,
    fallbackVersion,
  });

  const candidates = new Set<string>();
  if (latestTag) {
    candidates.add(latestTag);
    const latestReleaseBaseVersion = resolveReleaseBaseVersion(latestTag);
    if (latestReleaseBaseVersion) {
      candidates.add(latestReleaseBaseVersion);
    }
  }
  if (derivedFromGit) {
    candidates.add(derivedFromGit);
    const derivedReleaseBaseVersion = resolveReleaseBaseVersion(derivedFromGit);
    if (derivedReleaseBaseVersion) {
      candidates.add(derivedReleaseBaseVersion);
    }
  }
  if (fallbackVersion) {
    candidates.add(fallbackVersion);
  }
  if (!gitDescribe && gitSha) {
    const releaseBaseVersion = resolveReleaseBaseVersion(fallbackVersion);
    if (releaseBaseVersion) {
      candidates.add(`${releaseBaseVersion}-${gitSha.trim().slice(0, 5)}`);
    }
  }

  return [...candidates].filter(Boolean);
};

export const resolveExpectedVersionPattern = (options: ResolveExpectedVersionsOptions = {}) => {
  const patterns = resolveExpectedVersions(options).map(escapeRegExp);
  const env = options.env ?? process.env;
  const runGit = options.runGit ?? defaultRunGit;
  const gitSha = (env.CI_SHA || env.GITHUB_SHA || runGit(['rev-parse', 'HEAD'])).trim().slice(0, 5);
  const gitDescribe = runGit(['describe', '--tags', '--long', '--dirty']);

  if (!gitDescribe && gitSha) {
    patterns.push(`${SEMVER_WITH_OPTIONAL_PRERELEASE_PATTERN.source}-${escapeRegExp(gitSha)}`);
  }

  return patterns.length === 0 ? null : new RegExp(`^(?:${patterns.join('|')})$`);
};