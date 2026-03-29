/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { FolderPickerFileResult } from "@/lib/native/folderPicker";
import { createLocalSourceFromFileList, setLocalSourceRuntimeFiles } from "@/lib/sourceNavigation/localSourcesStore";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import type { SelectedItem, SourceLocation } from "@/lib/sourceNavigation/types";
import type { ConfigFileReference, LocalConfigFileReference } from "./configFileReference";

export const isConfigFileName = (name: string) => name.trim().toLowerCase().endsWith(".cfg");

const requireConfigFileName = (name?: string | null) => {
  const trimmed = name?.trim() ?? "";
  if (!trimmed || !isConfigFileName(trimmed)) {
    throw new Error("Select a .cfg file.");
  }
  return trimmed;
};

export const buildConfigReferenceFromBrowserSelection = (
  source: SourceLocation,
  selection: SelectedItem,
): ConfigFileReference => {
  if (selection.type !== "file") {
    throw new Error("Select a .cfg file.");
  }

  const fileName = requireConfigFileName(selection.name);
  if (source.type === "ultimate") {
    return {
      kind: "ultimate",
      fileName,
      path: normalizeSourcePath(selection.path),
      modifiedAt: selection.modifiedAt ?? null,
      sizeBytes: selection.sizeBytes ?? null,
    };
  }

  if (source.type === "local") {
    return {
      kind: "local",
      fileName,
      path: normalizeSourcePath(selection.path),
      sourceId: source.id,
      modifiedAt: selection.modifiedAt ?? null,
      sizeBytes: selection.sizeBytes ?? null,
    };
  }

  throw new Error("Only local or C64U config files can be attached.");
};

export const buildLocalConfigReferenceFromAndroidPicker = (
  result: FolderPickerFileResult,
): LocalConfigFileReference => {
  if (!result.permissionPersisted || !result.uri) {
    throw new Error("Config file access was not granted.");
  }

  const fileName = requireConfigFileName(result.name);
  return {
    kind: "local",
    fileName,
    path: normalizeSourcePath(`/${fileName}`),
    uri: result.uri,
    modifiedAt: result.modifiedAt ?? null,
    sizeBytes: result.sizeBytes ?? null,
  };
};

export const buildLocalConfigReferenceFromWebFile = (file: File): LocalConfigFileReference => {
  const fileName = requireConfigFileName(file.name);
  const { source, runtimeFiles } = createLocalSourceFromFileList([file]);
  const entry = source.entries?.[0];
  if (!entry) {
    throw new Error("Selected config file is unavailable.");
  }

  setLocalSourceRuntimeFiles(source.id, runtimeFiles);
  return {
    kind: "local",
    fileName,
    path: normalizeSourcePath(entry.relativePath),
    sourceId: source.id,
    modifiedAt: entry.modifiedAt ?? null,
    sizeBytes: entry.sizeBytes ?? null,
  };
};
