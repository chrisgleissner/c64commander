/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const copyIfExists = async (source: string, destination: string) => {
  try {
    const stat = await fs.stat(source);
    if (!stat.isFile() || stat.size === 0) return false;
    await fs.copyFile(source, destination);
    return true;
  } catch {
    return false;
  }
};

const sanitizeSegment = (value: string) => {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'untitled';
};

const parseTestId = (videoFile: string) => {
  const match = videoFile.match(/^([a-f0-9-]+)-retry(\d+)-/);
  if (!match) return null;
  return { testId: match[1], retry: match[2] };
};

export default async function globalTeardown() {
  const playwrightDir = path.resolve(process.cwd(), 'test-results', 'playwright');
  const evidenceRoot = path.resolve(process.cwd(), 'test-results', 'evidence');

  try {
    const entries = await fs.readdir(playwrightDir, { withFileTypes: true });
    const videoFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.webm'));

    for (const videoFile of videoFiles) {
      const parsed = parseTestId(videoFile.name);
      if (!parsed) continue;

      const evidenceFolders = await fs.readdir(evidenceRoot, { withFileTypes: true });
      for (const folder of evidenceFolders) {
        if (!folder.isDirectory()) continue;
        const evidenceDir = path.join(evidenceRoot, folder.name);
        const videoTarget = path.join(evidenceDir, 'video.webm');
        const videoSource = path.join(playwrightDir, videoFile.name);
        
        try {
          await fs.stat(videoTarget);
        } catch {
          await copyIfExists(videoSource, videoTarget);
          break;
        }
      }
    }
  } catch (error) {
    console.error('Global teardown failed:', error);
  }
}
