/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { getPlatform, isNativePlatform } from "@/lib/native/platform";

import { installKeymapOverrides, matchesDevice, type DeviceIdentity, type KeymapOverrideFile } from "./keymapOverrides";
import { parseKeymapOverride } from "./keymapOverrideSchema";

/** Relative to the app's private files directory (Capacitor `Directory.Data`, Android `filesDir`). */
export const KEYMAP_OVERRIDE_DIRECTORY = "keymaps";

export interface KeymapOverrideReport {
  readonly identity: DeviceIdentity | null;
  readonly applied: readonly string[];
  readonly skipped: readonly { readonly file: string; readonly reason: string }[];
  /** Why nothing could be read at all, when that is the case. */
  readonly unavailable: string | null;
}

export interface KeymapOverrideSource {
  readonly identity: () => Promise<DeviceIdentity>;
  /** File names in the override directory; an empty list when the directory does not exist. */
  readonly list: () => Promise<readonly string[]>;
  readonly read: (name: string) => Promise<string>;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const isMissingPathError = (error: unknown) => /does not exist|no such file|not found/i.test(errorMessage(error));

const createNativeSource = (): KeymapOverrideSource => ({
  identity: async () => {
    const { getNativeDeviceIdentity } = await import("@/lib/native/diagnosticsBridge");
    const { manufacturer, model } = await getNativeDeviceIdentity();
    return { manufacturer, model };
  },
  list: async () => {
    const { Directory, Filesystem } = await import("@capacitor/filesystem");
    try {
      const { files } = await Filesystem.readdir({ path: KEYMAP_OVERRIDE_DIRECTORY, directory: Directory.Data });
      return files.flatMap((entry) => {
        if (typeof entry === "string") return [entry];
        return entry.type === "file" ? [entry.name] : [];
      });
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      addLog("debug", "No keymap override directory", { service: "keymap-overrides", error: errorMessage(error) });
      return [];
    }
  },
  read: async (name) => {
    const { Directory, Encoding, Filesystem } = await import("@capacitor/filesystem");
    const { data } = await Filesystem.readFile({
      path: `${KEYMAP_OVERRIDE_DIRECTORY}/${name}`,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    if (typeof data !== "string") throw new Error(`${name} was not returned as UTF-8 text`);
    return data;
  },
});

let lastReport: KeymapOverrideReport = { identity: null, applied: [], skipped: [], unavailable: "not loaded yet" };
const reportListeners = new Set<() => void>();

export const getKeymapOverrideReport = (): KeymapOverrideReport => lastReport;

export const subscribeKeymapOverrideReport = (listener: () => void): (() => void) => {
  reportListeners.add(listener);
  return () => reportListeners.delete(listener);
};

const publishReport = (report: KeymapOverrideReport) => {
  lastReport = report;
  reportListeners.forEach((listener) => listener());
};

/**
 * Reads every `*.json` in the override directory, keeps the files whose `match` fits this handset,
 * and installs them: files without `match` first, then device-specific ones, each group in name
 * order, so a device file can shadow a generic one. A malformed file is skipped and reported, never
 * half-applied.
 */
export const loadKeymapOverrides = async (
  source: KeymapOverrideSource | null = isNativePlatform() && getPlatform() === "android" ? createNativeSource() : null,
): Promise<KeymapOverrideReport> => {
  if (!source) {
    const report = { identity: null, applied: [], skipped: [], unavailable: "only read on Android" };
    publishReport(report);
    return report;
  }
  let identity: DeviceIdentity | null = null;
  try {
    identity = await source.identity();
  } catch (error) {
    addLog("warn", "Could not read the device identity for keymap overrides", {
      service: "keymap-overrides",
      error: errorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  let names: readonly string[];
  try {
    names = [...(await source.list())].filter((name) => name.toLowerCase().endsWith(".json")).sort();
  } catch (error) {
    addLog("warn", "Could not list keymap override files", {
      service: "keymap-overrides",
      directory: KEYMAP_OVERRIDE_DIRECTORY,
      error: errorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    const report = { identity, applied: [], skipped: [], unavailable: `could not list files: ${errorMessage(error)}` };
    publishReport(report);
    return report;
  }

  const generic: { name: string; file: KeymapOverrideFile }[] = [];
  const specific: { name: string; file: KeymapOverrideFile }[] = [];
  const skipped: { file: string; reason: string }[] = [];
  for (const name of names) {
    let text: string;
    try {
      text = await source.read(name);
    } catch (error) {
      skipped.push({ file: name, reason: `could not be read: ${errorMessage(error)}` });
      continue;
    }
    const parsed = parseKeymapOverride(text);
    if (!parsed.ok) {
      skipped.push({ file: name, reason: parsed.reason });
      continue;
    }
    if (!matchesDevice(parsed.file, identity)) {
      skipped.push({ file: name, reason: "for another device" });
      continue;
    }
    (parsed.file.match ? specific : generic).push({ name, file: parsed.file });
  }

  const ordered = [...generic, ...specific];
  installKeymapOverrides(ordered.map((entry) => entry.file));
  const report = { identity, applied: ordered.map((entry) => entry.name), skipped, unavailable: null };
  for (const entry of skipped) {
    if (entry.reason === "for another device") continue;
    addLog("warn", "Skipped a keymap override file", { service: "keymap-overrides", ...entry });
  }
  if (ordered.length > 0) {
    addLog("info", "Keymap override files applied", { service: "keymap-overrides", files: report.applied, identity });
  }
  publishReport(report);
  return report;
};
