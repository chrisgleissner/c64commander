#!/usr/bin/env node

import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

const resolveTagRefName = (env) => {
  const ref = env.GITHUB_REF?.trim() || '';
  return ref.startsWith('refs/tags/') ? ref.slice('refs/tags/'.length) : '';
};

const resolveBuildVersion = (env) => {
  const explicitVersion = env.VITE_APP_VERSION?.trim() || env.VERSION_NAME?.trim() || env.APP_VERSION?.trim();
  if (explicitVersion) return explicitVersion;

  if (env.GITHUB_REF_TYPE?.trim() === 'tag' && env.GITHUB_REF_NAME?.trim()) {
    return env.GITHUB_REF_NAME.trim();
  }

  const tagRef = resolveTagRefName(env);
  if (tagRef) return tagRef;

  return String(packageJson.version || '').trim();
};

process.stdout.write(resolveBuildVersion(process.env));
