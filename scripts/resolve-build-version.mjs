#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SAFE_VERSION_TOKEN_PATTERN = /^[0-9A-Za-z._-]+$/;
const VERSION_PATTERN = /^[^\s]+(-[0-9a-f]{5})?$/;

const loadPackageVersion = (repoRoot) => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
  return String(packageJson.version || "").trim();
};

const resolveTagRefName = (env) => {
  const ref = env.GITHUB_REF?.trim() || "";
  return ref.startsWith("refs/tags/") ? ref.slice("refs/tags/".length) : "";
};

const runGit = (repoRoot, args) => {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : "";
};

const runGitStatus = (repoRoot, args) =>
  spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
  }).status;

const validateVersionToken = (value, label) => {
  if (!SAFE_VERSION_TOKEN_PATTERN.test(value)) {
    throw new Error(`${label} '${value}' contains unsafe characters. Only [0-9A-Za-z._-] are allowed.`);
  }
};

const validateVersion = (value) => {
  if (!VERSION_PATTERN.test(value)) {
    throw new Error(`Computed version '${value}' does not match expected format.`);
  }
};

export const resolveBuildVersion = (env = process.env, repoRoot = DEFAULT_REPO_ROOT) => {
  const explicitVersion = env.VITE_APP_VERSION?.trim() || env.VERSION_NAME?.trim() || env.APP_VERSION?.trim();
  if (explicitVersion) return explicitVersion;

  if (env.GITHUB_REF_TYPE?.trim() === "tag" && env.GITHUB_REF_NAME?.trim()) {
    return env.GITHUB_REF_NAME.trim();
  }

  const tagRef = resolveTagRefName(env);
  if (tagRef) return tagRef;

  const inGitRepo = Boolean(runGit(repoRoot, ["rev-parse", "--show-toplevel"]));
  if (inGitRepo) {
    runGit(repoRoot, ["fetch", "--tags", "--quiet"]);

    let tag = runGit(repoRoot, ["describe", "--tags", "--abbrev=0"]);
    const isShallow = runGit(repoRoot, ["rev-parse", "--is-shallow-repository"]);
    if (!tag && isShallow === "true") {
      runGit(repoRoot, ["fetch", "--unshallow", "--tags", "--quiet"]);
      tag = runGit(repoRoot, ["describe", "--tags", "--abbrev=0"]);
    }

    if (tag) {
      validateVersionToken(tag, "Git tag");
      const sha = runGit(repoRoot, ["rev-parse", "HEAD"]).slice(0, 5).toLowerCase();
      const exactTag = runGit(repoRoot, ["describe", "--tags", "--exact-match", "HEAD"]);
      const dirtyStatus = runGitStatus(repoRoot, ["diff", "--quiet", "HEAD", "--"]);
      const version = dirtyStatus === 0 && exactTag === tag ? tag : `${tag}-${sha}`;
      validateVersion(version);
      return version;
    }
  }

  const fallbackVersion = loadPackageVersion(repoRoot);
  if (!fallbackVersion) {
    throw new Error("No git tag or package.json version found. Create a tag before building.");
  }
  validateVersionToken(fallbackVersion, "package.json version");
  validateVersion(fallbackVersion);
  return fallbackVersion;
};

const isCli = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isCli) {
  try {
    process.stdout.write(resolveBuildVersion(process.env));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
