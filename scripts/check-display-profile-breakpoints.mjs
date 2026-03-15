import { readFileSync } from 'node:fs';
import path from 'node:path';

const auditedFiles = [
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

const forbiddenPattern = /\b(?:sm|md|lg|xl|2xl):/g;
const violations = [];

for (const relativePath of auditedFiles) {
  const absolutePath = path.resolve(relativePath);
  const source = readFileSync(absolutePath, 'utf8');
  const matches = [...source.matchAll(forbiddenPattern)];
  if (matches.length === 0) {
    continue;
  }

  violations.push({
    path: relativePath,
    matches: matches.map((match) => match[0]),
  });
}

if (violations.length > 0) {
  const summary = violations
    .map(({ path: relativePath, matches }) => `${relativePath}: ${Array.from(new Set(matches)).join(', ')}`)
    .join('\n');
  console.error('Display-profile audited surfaces must not use raw responsive breakpoint prefixes.');
  console.error(summary);
  process.exit(1);
}

console.log('Display-profile breakpoint guard passed.');
