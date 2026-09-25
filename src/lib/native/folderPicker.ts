/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin } from "@capacitor/core";
import { addLog } from "@/lib/logging";
import { getPlatform } from "@/lib/native/platform";
import { getActiveAction } from "@/lib/tracing/actionTrace";
import { resolveNativeTraceContext, type NativeTraceContext } from "@/lib/native/nativeTraceContext";

export type PickedFolderEntry = {
  uri: string;
  name: string;
  path: string;
};

export type SafFolderEntry = {
  type: "file" | "dir";
  name: string;
  path: string;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
};

export type SafPersistedUri = {
  uri: string;
  read: boolean;
  write: boolean;
  persistedAt?: number | null;
};

export type FolderPickerDirectoryResult = {
  treeUri?: string;
  rootName?: string | null;
  permissionPersisted?: boolean;
  files?: PickedFolderEntry[];
  uri?: string;
};

export type FolderPickerFileResult = {
  uri?: string;
  name?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  permissionPersisted?: boolean;
  parentTreeUri?: string | null;
  parentRootName?: string | null;
};

type FolderPickerPlugin = {
  pickDirectory: (options?: {
    extensions?: string[];
    initialUri?: string;
    traceContext?: NativeTraceContext;
  }) => Promise<FolderPickerDirectoryResult>;
  pickFile: (options?: {
    extensions?: string[];
    mimeTypes?: string[];
    initialUri?: string;
    traceContext?: NativeTraceContext;
  }) => Promise<FolderPickerFileResult>;
  listChildren: (options: {
    treeUri: string;
    path?: string;
    traceContext?: NativeTraceContext;
  }) => Promise<{ entries: SafFolderEntry[] }>;
  getPersistedUris: (options?: { traceContext?: NativeTraceContext }) => Promise<{ uris: SafPersistedUri[] }>;
  releasePersistedUris: (options?: { traceContext?: NativeTraceContext }) => Promise<{ released: SafPersistedUri[] }>;
  readFile: (options: { uri: string; traceContext?: NativeTraceContext }) => Promise<{ data: string }>;
  readFileFromTree: (options: {
    treeUri: string;
    path: string;
    traceContext?: NativeTraceContext;
  }) => Promise<{ data: string }>;
  canPickDocuments: (options?: {
    traceContext?: NativeTraceContext;
  }) => Promise<{ directories: boolean; files: boolean }>;
  writeFileToTree: (options: {
    treeUri: string;
    path: string;
    data: string;
    mimeType?: string;
    overwrite?: boolean;
    traceContext?: NativeTraceContext;
  }) => Promise<{ uri: string; sizeBytes: number; modifiedAt?: string | null }>;
};

type FolderPickerOverride = Partial<FolderPickerPlugin>;

const allowAndroidOverride = () => {
  if (typeof window === "undefined") return false;
  const testProbeEnabled =
    import.meta.env.VITE_ENABLE_TEST_PROBES === "1" ||
    (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled === true;
  return (
    testProbeEnabled &&
    (window as Window & { __c64uAllowAndroidFolderPickerOverride?: boolean }).__c64uAllowAndroidFolderPickerOverride ===
      true
  );
};

const resolveOverride = (): FolderPickerOverride | null => {
  if (typeof window === "undefined") return null;
  const candidate = (window as Window & { __c64uFolderPickerOverride?: FolderPickerOverride })
    .__c64uFolderPickerOverride;
  return candidate ?? null;
};

const resolveOverrideMethod = <K extends keyof FolderPickerPlugin>(method: K) => {
  const override = resolveOverride();
  const candidate = override?.[method];
  if (!candidate) return null;
  if (getPlatform() !== "android" || allowAndroidOverride()) return candidate;
  addLog("debug", "Android SAF override blocked", { method });
  throw new Error("Android SAF picker is required.");
};

const withTraceContext = <T extends Record<string, unknown> | undefined>(
  options: T,
): T & { traceContext: NativeTraceContext } =>
  ({
    ...(options ?? {}),
    traceContext: resolveNativeTraceContext(getActiveAction()),
  }) as T & { traceContext: NativeTraceContext };

const plugin = registerPlugin<FolderPickerPlugin>("FolderPicker");

/*
 * A device can have no document picker at all. Keypad handsets built without Google Mobile
 * Services are the case that matters here: there is no DocumentsUI to open, the native plugin
 * rejects with NO_PICKER_AVAILABLE, and every caller would otherwise show a raw plugin string.
 */
export const NO_DOCUMENT_PICKER_MESSAGE =
  "This device has no file picker, so files on its own storage cannot be chosen here.";

export class NoDocumentPickerError extends Error {
  constructor() {
    super(NO_DOCUMENT_PICKER_MESSAGE);
    this.name = "NoDocumentPickerError";
  }
}

export const isNoDocumentPickerError = (error: unknown): boolean =>
  error instanceof NoDocumentPickerError || (error instanceof Error && error.message.includes("NO_PICKER_AVAILABLE"));

const withPickerAvailability = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (isNoDocumentPickerError(error)) throw new NoDocumentPickerError();
    throw error;
  }
};

export const FolderPicker: FolderPickerPlugin = {
  pickDirectory: (options) => {
    const override = resolveOverrideMethod("pickDirectory");
    const withTrace = withTraceContext(options);
    if (override) return override(withTrace);
    return withPickerAvailability(() => plugin.pickDirectory(withTrace));
  },
  pickFile: (options) => {
    const override = resolveOverrideMethod("pickFile");
    const withTrace = withTraceContext(options);
    if (override) return override(withTrace);
    return withPickerAvailability(() => plugin.pickFile(withTrace));
  },
  listChildren: (options) => {
    const override = resolveOverrideMethod("listChildren");
    const withTrace = withTraceContext(options);
    if (override) return override(withTrace);
    return plugin.listChildren(withTrace);
  },
  getPersistedUris: (options) => {
    const override = resolveOverrideMethod("getPersistedUris");
    const withTrace = withTraceContext(options);
    if (override) return override(withTrace);
    return plugin.getPersistedUris(withTrace);
  },
  releasePersistedUris: (options) => {
    const override = resolveOverrideMethod("releasePersistedUris");
    const withTrace = withTraceContext(options);
    if (override) return override(withTrace);
    return plugin.releasePersistedUris(withTrace);
  },
  readFile: (options) => {
    const override = resolveOverrideMethod("readFile");
    const withTrace = withTraceContext(options);
    if (override) return override(withTrace);
    return plugin.readFile(withTrace);
  },
  readFileFromTree: (options) => {
    const override = resolveOverrideMethod("readFileFromTree");
    const withTrace = withTraceContext(options);
    if (override) return override(withTrace);
    return plugin.readFileFromTree(withTrace);
  },
  canPickDocuments: (options) => {
    const override = resolveOverrideMethod("canPickDocuments");
    const withTrace = withTraceContext(options);
    if (override) return override(withTrace);
    return plugin.canPickDocuments(withTrace);
  },
  writeFileToTree: (options) => {
    const override = resolveOverrideMethod("writeFileToTree");
    const withTrace = withTraceContext(options);
    if (override) return override(withTrace);
    return plugin.writeFileToTree(withTrace);
  },
};

/*
 * Whether this device can put a document picker in front of the user.
 *
 * Asked once and remembered: the answer is a property of the installed system apps and cannot
 * change while the app is running. The browser build has no native plugin and answers yes, because
 * there the picker is the file input. A plugin call that fails also answers yes, but is logged and
 * not remembered, so the next call asks again: hiding a source that works is worse than offering
 * one that turns out to be unavailable.
 */
type DocumentPickerSupport = { directories: boolean; files: boolean };
const ASSUMED_DOCUMENT_PICKER_SUPPORT: DocumentPickerSupport = { directories: true, files: true };
let documentPickerSupport: Promise<DocumentPickerSupport> | null = null;

export const canPickDocuments = (): Promise<DocumentPickerSupport> => {
  if (documentPickerSupport) return documentPickerSupport;
  if (getPlatform() === "web" && !resolveOverride()?.canPickDocuments) {
    documentPickerSupport = Promise.resolve(ASSUMED_DOCUMENT_PICKER_SUPPORT);
    return documentPickerSupport;
  }
  const query: Promise<DocumentPickerSupport> = FolderPicker.canPickDocuments()
    .then((result) => ({ directories: result?.directories !== false, files: result?.files !== false }))
    .catch((error: unknown) => {
      if (documentPickerSupport === query) documentPickerSupport = null;
      addLog("warn", "Document picker support check failed; offering local sources anyway", {
        error: error instanceof Error ? error.message : String(error),
      });
      return ASSUMED_DOCUMENT_PICKER_SUPPORT;
    });
  documentPickerSupport = query;
  return query;
};

/** Test seam: the cached answer is per process, and a test needs to change the device under it. */
export const resetDocumentPickerSupport = () => {
  documentPickerSupport = null;
};
