#!/usr/bin/env node
/*
 * Fails the build when a display-profile audited surface uses a raw Tailwind
 * responsive breakpoint prefix.
 *
 * Those surfaces size themselves from the display profile the app resolved, not from
 * the viewport width Tailwind sees, so an `sm:` or `lg:` prefix on one of them
 * reintroduces a second, disagreeing source of layout.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const AUDITED_FILES = [
  'src/components/lists/SelectableActionList.tsx',
  'src/components/QuickActionCard.tsx',
  'src/components/ConfigItemRow.tsx',
  'src/pages/home/components/DriveManager.tsx',
  'src/pages/home/DriveCard.tsx',
  'src/pages/home/components/StreamStatus.tsx',
  'src/pages/home/dialogs/SnapshotManagerDialog.tsx',
  'src/pages/playFiles/components/PlaybackControlsCard.tsx',
  'src/pages/playFiles/components/VolumeControls.tsx',
  'src/pages/SettingsPage.tsx',
];

/** No `g` flag: `lastIndex` would persist between calls and skip files. */
export const FORBIDDEN_PATTERN = /\b(?:sm|md|lg|xl|2xl):/;

export const findViolations = (files) =>
  files.flatMap(({ path: relativePath, source }) => {
    const matches = [...source.matchAll(new RegExp(FORBIDDEN_PATTERN, 'g'))].map((match) => match[0]);
    return matches.length === 0 ? [] : [{ path: relativePath, matches }];
  });

/**
 * Reads the audited list. A missing entry is reported rather than skipped: a surface
 * that was renamed out of the list would otherwise stop being audited in silence.
 */
export const readAuditedFiles = (root = process.cwd()) => {
  const missing = AUDITED_FILES.filter((relativePath) => !existsSync(path.resolve(root, relativePath)));
  if (missing.length > 0) {
    const error = new Error(`Audited display-profile surfaces no longer exist: ${missing.join(', ')}`);
    error.missing = missing;
    throw error;
  }
  return AUDITED_FILES.map((relativePath) => ({
    path: relativePath,
    source: readFileSync(path.resolve(root, relativePath), 'utf8'),
  }));
};

const main = () => {
  let files;
  try {
    files = readAuditedFiles();
  } catch (error) {
    console.error(error.message);
    console.error('Update AUDITED_FILES in scripts/check-display-profile-breakpoints.mjs to the new path.');
    process.exit(2);
  }

  const violations = findViolations(files);
  if (violations.length > 0) {
    const summary = violations
      .map(({ path: relativePath, matches }) => `${relativePath}: ${Array.from(new Set(matches)).join(', ')}`)
      .join('\n');
    console.error('Display-profile audited surfaces must not use raw responsive breakpoint prefixes.');
    console.error(summary);
    process.exit(1);
  }

  console.log(`Display-profile breakpoint guard passed: ${files.length} audited surfaces.`);
};

if (import.meta.url === `file://${process.argv[1]}`) main();
