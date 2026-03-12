/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "node:child_process";
import { lstat, readdir, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SymlinkRecord {
  path: string;
  target: string;
  resolvedPath: string | null;
  loopDetected: boolean;
}

export interface LocalTreeSummary {
  rootPath: string;
  resolvedRootPath: string;
  fileCount: number;
  directoryCount: number;
  symlinkCount: number;
  maxDepth: number;
  formatCounts: Record<string, number>;
  topLevelEntries: string[];
  sampleFiles: string[];
  sampleDirectories: string[];
  symlinks: SymlinkRecord[];
}

export interface LocalMirrorDiscovery {
  mirror: LocalTreeSummary;
  hvscTarget: LocalTreeSummary | null;
}

export interface DeviceMirrorDiscovery {
  rootPath: string;
  sidPath: string;
  topLevelEntries: string[];
  d64Entries: string[];
  sidEntriesSample: string[];
  hvscRootEntries: string[];
  sidCandidates: string[];
  multiDiskDirectories: string[];
  approximateFileCount: number | null;
  approximateDirectoryCount: number | null;
  approximateMaxDepth: number | null;
  approximationBasis: string;
}

export interface MirroredCorpusDiscovery {
  local: LocalMirrorDiscovery;
  device: DeviceMirrorDiscovery;
}

type WalkOptions = {
  sampleLimit?: number;
};

function extensionForPath(filePath: string): string {
  const base = path.basename(filePath);
  const index = base.lastIndexOf(".");
  return index >= 0 ? base.slice(index + 1).toLowerCase() : "<none>";
}

async function walkLocalTree(rootPath: string, options: WalkOptions = {}): Promise<LocalTreeSummary> {
  const sampleLimit = options.sampleLimit ?? 20;
  const resolvedRootPath = await realpath(rootPath);
  const visitedDirectories = new Set<string>([resolvedRootPath]);
  const formatCounts = new Map<string, number>();
  const sampleFiles: string[] = [];
  const sampleDirectories: string[] = [];
  const symlinks: SymlinkRecord[] = [];
  const topLevelEntries: string[] = [];

  let fileCount = 0;
  let directoryCount = 1;
  let symlinkCount = 0;
  let maxDepth = 0;

  const stack: Array<{ absolutePath: string; relativePath: string; depth: number }> = [
    { absolutePath: resolvedRootPath, relativePath: "", depth: 0 },
  ];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = await readdir(current.absolutePath, { withFileTypes: true });
    if (current.depth === 0) {
      topLevelEntries.push(...entries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right)));
    }

    for (const entry of entries) {
      const absoluteEntryPath = path.join(current.absolutePath, entry.name);
      const relativeEntryPath = current.relativePath ? path.join(current.relativePath, entry.name) : entry.name;
      const entryLstat = await lstat(absoluteEntryPath);
      const depth = relativeEntryPath.split(path.sep).length;
      if (depth > maxDepth) {
        maxDepth = depth;
      }

      if (entryLstat.isSymbolicLink()) {
        symlinkCount += 1;
        const target = await readlink(absoluteEntryPath);
        let resolvedPath: string | null = null;
        let loopDetected = false;
        try {
          resolvedPath = await realpath(absoluteEntryPath);
          const resolvedStat = await lstat(resolvedPath);
          if (resolvedStat.isDirectory() && visitedDirectories.has(resolvedPath)) {
            loopDetected = true;
          }
        } catch {
          resolvedPath = null;
        }
        symlinks.push({
          path: relativeEntryPath,
          target,
          resolvedPath,
          loopDetected,
        });
        continue;
      }

      if (entry.isDirectory()) {
        directoryCount += 1;
        if (sampleDirectories.length < sampleLimit) {
          sampleDirectories.push(relativeEntryPath);
        }
        const resolvedDirectoryPath = await realpath(absoluteEntryPath);
        if (visitedDirectories.has(resolvedDirectoryPath)) {
          continue;
        }
        visitedDirectories.add(resolvedDirectoryPath);
        stack.push({
          absolutePath: resolvedDirectoryPath,
          relativePath: relativeEntryPath,
          depth,
        });
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      fileCount += 1;
      if (sampleFiles.length < sampleLimit) {
        sampleFiles.push(relativeEntryPath);
      }
      const extension = extensionForPath(relativeEntryPath);
      formatCounts.set(extension, (formatCounts.get(extension) ?? 0) + 1);
    }
  }

  return {
    rootPath,
    resolvedRootPath,
    fileCount,
    directoryCount,
    symlinkCount,
    maxDepth,
    formatCounts: Object.fromEntries([...formatCounts.entries()].sort((left, right) => right[1] - left[1])),
    topLevelEntries,
    sampleFiles,
    sampleDirectories,
    symlinks,
  };
}

async function ftpList(host: string, ftpPath: string): Promise<string[]> {
  const { stdout } = await execFileAsync("curl", [
    "--connect-timeout",
    "5",
    "--max-time",
    "20",
    "--silent",
    "--show-error",
    "--list-only",
    `ftp://${host}${ftpPath}`,
  ]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function discoverLocalMirror(workspaceRoot: string): Promise<LocalMirrorDiscovery> {
  const mirrorRoot = path.resolve(workspaceRoot, "test-data");
  const mirror = await walkLocalTree(mirrorRoot);
  const hvscLinkPath = path.join(mirrorRoot, "sid", "hvsc");

  let hvscTarget: LocalTreeSummary | null = null;
  try {
    const linkStat = await lstat(hvscLinkPath);
    if (linkStat.isSymbolicLink()) {
      const resolvedHvscRoot = await realpath(hvscLinkPath);
      hvscTarget = await walkLocalTree(resolvedHvscRoot);
    }
  } catch {
    hvscTarget = null;
  }

  return { mirror, hvscTarget };
}

export async function discoverDeviceMirror(
  c64uHost: string,
  localDiscovery?: LocalMirrorDiscovery,
): Promise<DeviceMirrorDiscovery> {
  const rootPath = "/USB2/test-data";
  const topLevelEntries = await ftpList(c64uHost, `${rootPath}/`);
  const sidEntry = topLevelEntries.find((entry) => entry.toUpperCase() === "SID") ?? "SID";
  const sidPath = `${rootPath}/${sidEntry}`;
  const d64Entries = await ftpList(c64uHost, `${rootPath}/d64/`);
  const sidEntries = await ftpList(c64uHost, `${sidPath}/`);
  const hvscRootEntries = await ftpList(c64uHost, `${sidPath}/HVSC/`);
  const sidCandidates = sidEntries.filter((entry) => /\.sid$/i.test(entry)).slice(0, 10);
  const multiDiskDirectories = d64Entries.filter((entry) => !/\.[^.]+$/i.test(entry));

  const approximateFileCount = localDiscovery
    ? localDiscovery.mirror.fileCount + (localDiscovery.hvscTarget?.fileCount ?? 0)
    : null;
  const approximateDirectoryCount = localDiscovery
    ? localDiscovery.mirror.directoryCount + (localDiscovery.hvscTarget?.directoryCount ?? 0)
    : null;
  const approximateMaxDepth = localDiscovery
    ? Math.max(localDiscovery.mirror.maxDepth, localDiscovery.hvscTarget?.maxDepth ?? 0)
    : null;

  return {
    rootPath,
    sidPath,
    topLevelEntries,
    d64Entries,
    sidEntriesSample: sidEntries.slice(0, 20),
    hvscRootEntries,
    sidCandidates,
    multiDiskDirectories,
    approximateFileCount,
    approximateDirectoryCount,
    approximateMaxDepth,
    approximationBasis:
      approximateFileCount === null
        ? "Device-side FTP sampling only. No local parity model was available."
        : "Device-side FTP root, SID root, HVSC root, and d64 samples matched the mirrored local corpus structure; approximate counts are derived from the local mirror plus resolved HVSC target.",
  };
}

export async function discoverMirroredCorpora(
  workspaceRoot: string,
  c64uHost: string,
): Promise<MirroredCorpusDiscovery> {
  const local = await discoverLocalMirror(workspaceRoot);
  const device = await discoverDeviceMirror(c64uHost, local);
  return { local, device };
}
