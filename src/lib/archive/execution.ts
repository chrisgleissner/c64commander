/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getC64API } from "@/lib/c64api";
import { addLog } from "@/lib/logging";
import { FileTypeDetector, validateFileBytes } from "@/lib/fileValidation";
import { getPlayCategory } from "@/lib/playback/fileTypes";
import { executePlayPlan, type LocalPlayFile, type PlayPlan } from "@/lib/playback/playbackRouter";
import type { ArchiveBinary, ArchiveEntry, ArchiveSearchResult } from "./types";

const FILE_TYPE_TO_EXTENSION: Record<string, string> = {
  crt: "crt",
  d64: "d64",
  d71: "d71",
  d81: "d81",
  mod: "mod",
  prg: "prg",
  sid: "sid",
};

const toRuntimeFile = (binary: ArchiveBinary): LocalPlayFile => ({
  name: binary.fileName,
  lastModified: Date.now(),
  arrayBuffer: async () =>
    binary.bytes.buffer.slice(binary.bytes.byteOffset, binary.bytes.byteOffset + binary.bytes.byteLength),
});

const ensureExecutableName = (fileName: string, detectedType: string) => {
  if (fileName.includes(".")) return fileName;
  const extension = FILE_TYPE_TO_EXTENSION[detectedType];
  return extension ? `${fileName}.${extension}` : fileName;
};

export const getArchiveEntryActionLabel = (fileName: string) => {
  const category = getPlayCategory(fileName);
  if (category === "disk") return "Mount & run";
  if (category === "sid" || category === "mod") return "Play";
  if (category === "prg" || category === "crt") return "Run";
  return "Execute";
};

export const buildArchivePlayPlan = (binary: ArchiveBinary): PlayPlan => {
  const preferredCategory = getPlayCategory(binary.fileName);
  const detectedType = FileTypeDetector.detect(binary.bytes, preferredCategory ?? undefined);
  const validation = validateFileBytes(binary.bytes, detectedType === "unknown" ? undefined : detectedType);
  if (!validation.ok) {
    throw new Error(`Unsupported archive file ${binary.fileName}: ${validation.reason}`);
  }
  const resolvedPath = ensureExecutableName(binary.fileName, validation.detectedType);
  const category = getPlayCategory(resolvedPath);
  if (!category) {
    throw new Error(`Unsupported archive file ${binary.fileName}`);
  }
  addLog("debug", "Archive file execution prepared", {
    fileName: binary.fileName,
    resolvedPath,
    detectedType: validation.detectedType,
    byteCount: binary.bytes.byteLength,
  });
  return {
    category,
    source: "local",
    path: resolvedPath,
    file: toRuntimeFile(binary),
    mountType: category === "disk" ? resolvedPath.split(".").pop()?.toLowerCase() : undefined,
  };
};

export const executeArchiveEntry = async (params: {
  result: ArchiveSearchResult;
  entry: ArchiveEntry;
  binary: ArchiveBinary;
}) => {
  const api = getC64API();
  const plan = buildArchivePlayPlan(params.binary);
  addLog("info", "Archive execution started", {
    resultId: params.result.id,
    resultCategory: params.result.category,
    entryId: params.entry.id,
    entryPath: params.entry.path,
    action: getArchiveEntryActionLabel(params.entry.path),
  });
  await executePlayPlan(api, plan);
};
