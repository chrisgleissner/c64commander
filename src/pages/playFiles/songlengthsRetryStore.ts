/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Folders whose songlengths file was not looked for because the device did not answer during an add, by
 * saved device. The Play page asks for them again once the device answers.
 */
const foldersByDevice = new Map<string, Set<string>>();
const listeners = new Set<() => void>();

export const subscribeSkippedSonglengthsFolders = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const recordSkippedSonglengthsFolders = (deviceId: string, folders: readonly string[]) => {
  if (!folders.length) return;
  const stored = foldersByDevice.get(deviceId) ?? new Set<string>();
  folders.forEach((folder) => stored.add(folder));
  foldersByDevice.set(deviceId, stored);
  listeners.forEach((listener) => listener());
};

export const getSkippedSonglengthsFolders = (deviceId: string): string[] => [...(foldersByDevice.get(deviceId) ?? [])];

export const resolveSkippedSonglengthsFolders = (deviceId: string, folders: readonly string[]) => {
  const stored = foldersByDevice.get(deviceId);
  if (!stored) return;
  folders.forEach((folder) => stored.delete(folder));
  if (!stored.size) foldersByDevice.delete(deviceId);
};

export const clearSkippedSonglengthsFolders = (deviceId?: string) => {
  if (deviceId === undefined) foldersByDevice.clear();
  else foldersByDevice.delete(deviceId);
};

export const pruneSkippedSonglengthsFolders = (keepDeviceIds: ReadonlySet<string>) => {
  [...foldersByDevice.keys()].forEach((deviceId) => {
    if (!keepDeviceIds.has(deviceId)) foldersByDevice.delete(deviceId);
  });
};
