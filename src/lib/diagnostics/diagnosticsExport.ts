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
import { addErrorLog } from "@/lib/logging";

export type DiagnosticsExportTab = "error-logs" | "logs" | "traces" | "actions";
export type DiagnosticsExportScope = DiagnosticsExportTab | "all";
export type DiagnosticsExportPayload = Record<DiagnosticsExportTab, unknown>;

const DIAGNOSTICS_EXPORT_TABS: DiagnosticsExportTab[] = ["error-logs", "logs", "traces", "actions"];

type DiagnosticsShareOverridePayload = {
  filename: string;
  scope: DiagnosticsExportScope;
  data: unknown;
  zipData: Uint8Array;
};

type DiagnosticsShareOverride = (payload: DiagnosticsShareOverridePayload) => Promise<void> | void;

type DiagnosticsShareOverrideWindow = Window & {
  __c64uDiagnosticsShareOverride?: DiagnosticsShareOverride;
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
  `c64commander-diagnostics-${scope}-${timestamp}.zip`;

const buildDiagnosticsZipEntries = (scope: DiagnosticsExportScope, data: unknown, timestamp: string) => {
  const payloads =
    scope === "all"
      ? (data as DiagnosticsExportPayload)
      : ({ [scope]: data } as Pick<DiagnosticsExportPayload, DiagnosticsExportTab>);
  return Object.fromEntries(
    DIAGNOSTICS_EXPORT_TABS.filter((tab) => scope === "all" || tab === scope).map((tab) => [
      buildDiagnosticsJsonFilename(tab, timestamp),
      strToU8(JSON.stringify(payloads[tab] ?? [], null, 2)),
    ]),
  );
};

export const buildDiagnosticsZipData = (scope: DiagnosticsExportScope, data: unknown, timestamp: string) =>
  zipSync(buildDiagnosticsZipEntries(scope, data, timestamp));

export const buildDiagnosticsZipBlob = (scope: DiagnosticsExportScope, data: unknown, timestamp: string) =>
  new Blob([buildDiagnosticsZipData(scope, data, timestamp)], { type: "application/zip" });

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

      await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Cache,
      });

      const uriResult = await Filesystem.getUri({
        path: filename,
        directory: Directory.Cache,
      });

      await Share.share({
        title: "Diagnostics Export",
        files: [uriResult.uri],
      });
    } catch (error) {
      addErrorLog("Diagnostics share failed", {
        error: (error as Error).message,
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
