/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { addLog } from "@/lib/logging";

const isShareCancelled = (error: unknown) => /^Share cancel+ed$/i.test((error as Error)?.message ?? "");

/**
 * Hand the exported settings to the user: a download in a browser, the system share sheet on a phone.
 * Android's WebView ignores a download link to a blob, so on the phone the old path saved nothing while
 * the app said the export was ready. Resolves false when the user dismissed the share sheet.
 */
export const shareSettingsExport = async (payload: string, filename: string): Promise<boolean> => {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  }
  await Filesystem.writeFile({ path: filename, data: payload, directory: Directory.Cache, encoding: Encoding.UTF8 });
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
  try {
    await Share.share({ title: "Settings export", files: [uri] });
    return true;
  } catch (error) {
    if (!isShareCancelled(error)) throw error;
    addLog("info", "Settings export share cancelled", { filename });
    return false;
  }
};
