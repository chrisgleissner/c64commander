/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import fs from "node:fs";
import path from "node:path";

const TEST_FILE = /\.(test|spec)\.tsx?$/;
const SPEC_TITLE = /\b(?:it|test)(?:\.each\([^)]*\))?\(\s*(["`])([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[a-z]?\b[^"`]*?)\1/g;
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "artifacts", "coverage"]);

export const listTestFiles = (root, directories = ["tests", "playwright", "src"]) => {
  const found = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (TEST_FILE.test(entry.name)) found.push(full);
    }
  };
  for (const directory of directories) {
    const full = path.join(root, directory);
    if (fs.existsSync(full)) visit(full);
  }
  return found;
};

/**
 * Titles that start with a spec, hardening or bug id (`HARD27-007`, `BUG-010`, `QW-LS-01`) and appear in
 * more than one test file: one behavior tested twice, so the two copies can drift apart.
 */
export const findDuplicateSpecTitles = (entries) => {
  const filesByTitle = new Map();
  for (const { file, source } of entries) {
    for (const match of source.matchAll(SPEC_TITLE)) {
      const files = filesByTitle.get(match[2]) ?? new Set();
      files.add(file);
      filesByTitle.set(match[2], files);
    }
  }
  return [...filesByTitle]
    .filter(([, files]) => files.size > 1)
    .map(([title, files]) => ({ title, files: [...files].sort() }));
};
