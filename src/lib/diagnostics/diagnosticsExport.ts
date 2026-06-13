/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { zipSync, strToU8 } from "fflate";
import { Share } from "@capacitor/share";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
import { variant } from "@/generated/variant";
import { addErrorLog, addLog } from "@/lib/logging";

export type DiagnosticsExportTab = "error-logs" | "logs" | "traces" | "actions";
export type DiagnosticsExportScope = DiagnosticsExportTab | "all";
export type DiagnosticsExportPayload = Record<DiagnosticsExportTab, unknown> & {
  supplemental?: Record<string, unknown>;
};

const DIAGNOSTICS_EXPORT_TABS: DiagnosticsExportTab[] = ["error-logs", "logs", "traces", "actions"];
const SHARE_CANCELLED_MESSAGES = new Set(["Share canceled", "Share cancelled"]);

type DiagnosticsShareOverridePayload = {
  filename: string;
  scope: DiagnosticsExportScope;
  data: unknown;
  zipData: Uint8Array;
};

export type DiagnosticsAutomationExportResult = {
  filename: string;
  path: string;
  directory: Directory;
  scope: DiagnosticsExportScope;
  uri?: string;
  byteLength: number;
};

type DiagnosticsShareOverride = (payload: DiagnosticsShareOverridePayload) => Promise<void> | void;

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return null;
};

const isShareCancelledError = (error: unknown) => {
  const message = getErrorMessage(error);
  return message !== null && SHARE_CANCELLED_MESSAGES.has(message);
};

type DiagnosticsShareOverrideWindow = Window & {
  __c64uDiagnosticsShareOverride?: DiagnosticsShareOverride;
};

type DiagnosticsAutomationExportWindow = Window & {
  __c64uLastDiagnosticsExport?: DiagnosticsAutomationExportResult;
};

const isTestProbeEnabled = () => {
  try {
    if (typeof window !== "undefined") {
      const enabled = (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled;
      if (enabled) return true;
    }
    return import.meta.env.VITE_ENABLE_TEST_PROBES === "1";
  } catch (error) {
    addErrorLog("Diagnostics export test probe check failed", {
      error: (error as Error).message,
    });
    return false;
  }
};

const getShareOverride = (): DiagnosticsShareOverride | null => {
  if (typeof window === "undefined") return null;
  const override = (window as DiagnosticsShareOverrideWindow).__c64uDiagnosticsShareOverride ?? null;
  if (override) return override;
  if (!isTestProbeEnabled()) return null;
  return null;
};

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const parts = typeof result === "string" ? result.split(",") : [];
      if (parts.length < 2 || !parts[1]) {
        reject(new Error("Unexpected data URL format for diagnostics export."));
        return;
      }
      resolve(parts[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const formatTimestampSegment = (value: number) => value.toString().padStart(2, "0");

export const formatDiagnosticsExportTimestamp = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = formatTimestampSegment(date.getUTCMonth() + 1);
  const day = formatTimestampSegment(date.getUTCDate());
  const hours = formatTimestampSegment(date.getUTCHours());
  const minutes = formatTimestampSegment(date.getUTCMinutes());
  const seconds = formatTimestampSegment(date.getUTCSeconds());
  return `${year}-${month}-${day}-${hours}${minutes}-${seconds}Z`;
};

const buildDiagnosticsJsonFilename = (tab: DiagnosticsExportTab, timestamp: string) => `${tab}-${timestamp}.json`;

const buildDiagnosticsZipFilename = (scope: DiagnosticsExportScope, timestamp: string) =>
  `${variant.exportedFileBasename}-diagnostics-${scope}-${timestamp}.zip`;

const buildDiagnosticsAutomationPath = (scope: DiagnosticsExportScope) =>
  `${variant.exportedFileBasename}-diagnostics-${scope}-automation-latest.zip`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isBinaryPayloadBody = (value: unknown) => isRecord(value) && value.type === "binary";

export const sanitizeDiagnosticsExportPayload = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticsExportPayload(item));
  }
  if (!isRecord(value)) return value;

  const sanitized = Object.entries(value).reduce<Record<string, unknown>>((acc, [key, item]) => {
    if (key === "responsePayloadPreview" && "responseBody" in value && !isBinaryPayloadBody(value.responseBody)) {
      return acc;
    }
    if (key === "responsePayloadPreview" && "responsePayload" in value && !isBinaryPayloadBody(value.responsePayload)) {
      return acc;
    }
    acc[key] = sanitizeDiagnosticsExportPayload(item);
    return acc;
  }, {});

  return sanitized;
};

const buildDiagnosticsZipEntries = (scope: DiagnosticsExportScope, data: unknown, timestamp: string) => {
  const payloads =
    scope === "all"
      ? (data as DiagnosticsExportPayload)
      : ({ [scope]: data } as Pick<DiagnosticsExportPayload, DiagnosticsExportTab>);
  const entries = Object.fromEntries(
    DIAGNOSTICS_EXPORT_TABS.filter((tab) => scope === "all" || tab === scope).map((tab) => [
      buildDiagnosticsJsonFilename(tab, timestamp),
      [strToU8(JSON.stringify(sanitizeDiagnosticsExportPayload(payloads[tab] ?? []), null, 2)), {}],
    ]),
  );
  if (scope === "all") {
    const supplemental = (payloads as DiagnosticsExportPayload).supplemental;
    if (supplemental) {
      entries[`supplemental-${timestamp}.json`] = [strToU8(JSON.stringify(supplemental, null, 2)), {}];
    }
  }
  return entries;
};

export const buildDiagnosticsZipData = (scope: DiagnosticsExportScope, data: unknown, timestamp: string) =>
  zipSync(buildDiagnosticsZipEntries(scope, data, timestamp) as Parameters<typeof zipSync>[0]);

export const buildDiagnosticsZipBlob = (scope: DiagnosticsExportScope, data: unknown, timestamp: string) =>
  new Blob([buildDiagnosticsZipData(scope, data, timestamp) as BlobPart], { type: "application/zip" });

const recordDiagnosticsAutomationExport = (result: DiagnosticsAutomationExportResult) => {
  if (typeof window === "undefined") return;
  (window as DiagnosticsAutomationExportWindow).__c64uLastDiagnosticsExport = result;
};

const writeDiagnosticsAutomationExport = async (
  scope: DiagnosticsExportScope,
  filename: string,
  base64Data: string,
  byteLength: number,
) => {
  const path = buildDiagnosticsAutomationPath(scope);
  await Filesystem.writeFile({
    path,
    data: base64Data,
    directory: Directory.Data,
  });

  const uriResult = await Filesystem.getUri({
    path,
    directory: Directory.Data,
  });

  const result: DiagnosticsAutomationExportResult = {
    filename,
    path,
    directory: Directory.Data,
    scope,
    uri: uriResult.uri,
    byteLength,
  };
  recordDiagnosticsAutomationExport(result);
  return result;
};

export const writeDiagnosticsZipForAutomation = async (
  scope: DiagnosticsExportScope,
  data: unknown,
  date = new Date(),
) => {
  try {
    const timestamp = formatDiagnosticsExportTimestamp(date);
    const filename = buildDiagnosticsZipFilename(scope, timestamp);
    const zipData = buildDiagnosticsZipData(scope, data, timestamp);
    const blob = new Blob([zipData as BlobPart], { type: "application/zip" });
    const base64Data = await blobToBase64(blob);
    return await writeDiagnosticsAutomationExport(scope, filename, base64Data, zipData.byteLength);
  } catch (error) {
    addErrorLog("Diagnostics automation export failed", {
      scope,
      error: (error as Error).message,
    });
    throw error;
  }
};

export const writeAllDiagnosticsZipForAutomation = async (data: DiagnosticsExportPayload, date = new Date()) =>
  writeDiagnosticsZipForAutomation("all", data, date);

const downloadDiagnosticsZip = (filename: string, scope: DiagnosticsExportScope, data: unknown, timestamp: string) => {
  const blob = buildDiagnosticsZipBlob(scope, data, timestamp);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
};

const shareDiagnosticsExport = async (scope: DiagnosticsExportScope, data: unknown) => {
  const timestamp = formatDiagnosticsExportTimestamp();
  const filename = buildDiagnosticsZipFilename(scope, timestamp);
  const override = getShareOverride();
  if (override) {
    try {
      const zipData = buildDiagnosticsZipData(scope, data, timestamp);
      await override({ filename, scope, data, zipData });
      return;
    } catch (error) {
      addErrorLog("Diagnostics share override failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }
  if (Capacitor.isNativePlatform()) {
    try {
      const blob = buildDiagnosticsZipBlob(scope, data, timestamp);
      const base64Data = await blobToBase64(blob);

      if (isTestProbeEnabled()) {
        await writeDiagnosticsAutomationExport(scope, filename, base64Data, blob.size);
      }

      await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Cache,
      });

      const uriResult = await Filesystem.getUri({
        path: filename,
        directory: Directory.Cache,
      });

      try {
        await Share.share({
          title: "Diagnostics Export",
          files: [uriResult.uri],
        });
      } catch (error) {
        if (isShareCancelledError(error)) {
          addLog("info", "Diagnostics share cancelled", { scope, filename });
          return;
        }
        throw error;
      }
    } catch (error) {
      addErrorLog("Diagnostics share failed", {
        error: getErrorMessage(error) ?? String(error),
      });
      throw error;
    }
  } else {
    downloadDiagnosticsZip(filename, scope, data, timestamp);
  }
};

export const shareDiagnosticsZip = async (tab: DiagnosticsExportTab, data: unknown) =>
  shareDiagnosticsExport(tab, data);

export const shareAllDiagnosticsZip = async (data: DiagnosticsExportPayload) => shareDiagnosticsExport("all", data);
