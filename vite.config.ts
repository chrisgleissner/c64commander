/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import istanbul from 'vite-plugin-istanbul';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

const pkg = JSON.parse(
  fs.readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
);

type RunGitOptions = {
  quiet?: boolean;
  suppressStderrPattern?: RegExp;
};

const runGit = (args: string[], label: string, options: RunGitOptions = {}) => {
  const result = spawnSync('git', args, { encoding: 'utf-8' });
  if (result.status === 0) return result.stdout.trim();
  const stderr = result.stderr?.trim() || '';
  const shouldSuppress = Boolean(
    options.suppressStderrPattern &&
    stderr &&
    options.suppressStderrPattern.test(stderr),
  );
  if (options.quiet || shouldSuppress) return '';
  if (result.error) {
    console.warn(`[build] ${label} failed: ${result.error.message}`);
  } else if (stderr) {
    console.warn(`[build] ${label} failed: ${stderr}`);
  }
  return '';
};

const EXPECTED_GIT_DESCRIBE_NO_TAGS =
  /(?:No names found|cannot describe anything|no tag exactly matches)/i;

const gitTagFromEnv =
  (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME) || '';

const resolveGitSha = () =>
  process.env.VITE_GIT_SHA ||
  process.env.GIT_SHA ||
  process.env.GITHUB_SHA ||
  runGit(['rev-parse', 'HEAD'], 'git rev-parse');

const resolveExactGitTag = () =>
  gitTagFromEnv ||
  runGit(
    ['describe', '--tags', '--exact-match'],
    'git describe --exact-match',
    {
      suppressStderrPattern: EXPECTED_GIT_DESCRIBE_NO_TAGS,
    },
  );

const resolveLatestGitTag = () =>
  runGit(['describe', '--tags', '--abbrev=0'], 'git describe --abbrev=0', {
    suppressStderrPattern: EXPECTED_GIT_DESCRIBE_NO_TAGS,
  });

const resolveAppVersion = (gitShaValue: string) => {
  const envVersion =
    process.env.VITE_APP_VERSION || process.env.VERSION_NAME || '';
  const gitShaShort = gitShaValue ? gitShaValue.slice(0, 8) : '';
  const exactTag = resolveExactGitTag();
  const latestTag = exactTag || resolveLatestGitTag();

  if (latestTag) {
    if (exactTag) return latestTag;
    if (gitShaShort) return `${latestTag}-${gitShaShort}`;
    return latestTag;
  }

  if (envVersion) return envVersion;
  return pkg.version || '';
};

const gitSha = resolveGitSha();
const appVersion = resolveAppVersion(gitSha);
const buildTime = process.env.VITE_BUILD_TIME || new Date().toISOString();
const enableCoverageInstrumentation = ['1', 'true'].includes(
  (process.env.VITE_COVERAGE || '').toLowerCase(),
);

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: '::',
    port: 8064,
    hmr: {
      overlay: false,
    },
  },
  assetsInclude: ['**/*.yaml', '**/*.yml'],
  build: {
    outDir: 'dist',
    // Adjust warning threshold to avoid noisy chunk warnings while keeping defaults.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router-dom/') ||
            id.includes('/scheduler/')
          ) {
            return 'vendor-react';
          }
          if (
            id.includes('/@radix-ui/') ||
            id.includes('/framer-motion/') ||
            id.includes('/lucide-react/')
          ) {
            return 'vendor-ui';
          }
          if (id.includes('/7z-wasm/') || id.includes('/fflate/')) {
            return 'vendor-hvsc';
          }
          return 'vendor';
        },
      },
    },
  },
  plugins: [
    react(),
    ...(enableCoverageInstrumentation
      ? [
          istanbul({
            include: 'src/**/*',
            exclude: ['node_modules', 'test/', 'tests/', 'playwright/'],
            extension: ['.js', '.ts', '.tsx'],
            requireEnv: true,
            envName: 'VITE_COVERAGE',
            forceBuildInstrument: true,
          }),
        ]
      : []),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __GIT_SHA__: JSON.stringify(gitSha),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      module: path.resolve(__dirname, './src/lib/polyfills/module.ts'),
    },
  },
}));
