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

export const isShareCancelled = (error: unknown) => /^Share cancel+ed$/i.test((error as Error)?.message ?? "");

export type FileShareContent = {
  filename: string;
  title: string;
  mimeType: string;
  /** Text is written as UTF-8; a Blob is written as bytes. */
  content: string | Blob;
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error(`Could not read ${blob.size} bytes for sharing`, { cause: reader.error }));
    reader.readAsDataURL(blob);
  });

/**
 * Hand one file to the user: a download in a browser, the system share sheet on a phone. Android's WebView
 * ignores a download link to a blob, so on the phone the file is written to the cache and shared by URI.
 * Resolves "cancelled" when the user dismissed the share sheet.
 */
export const shareFile = async ({
  filename,
  title,
  mimeType,
  content,
}: FileShareContent): Promise<"shared" | "downloaded" | "cancelled"> => {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type: mimeType }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    return "downloaded";
  }
  if (typeof content === "string") {
    await Filesystem.writeFile({ path: filename, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 });
  } else {
    await Filesystem.writeFile({ path: filename, data: await blobToBase64(content), directory: Directory.Cache });
  }
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
  try {
    await Share.share({ title, files: [uri] });
    return "shared";
  } catch (error) {
    if (!isShareCancelled(error)) throw error;
    addLog("info", "File share cancelled", { filename });
    return "cancelled";
  }
};

/** Hand the exported settings to the user. Resolves false when the user dismissed the share sheet. */
export const shareSettingsExport = async (payload: string, filename: string): Promise<boolean> =>
  (await shareFile({ filename, title: "Settings export", mimeType: "application/json", content: payload })) !==
  "cancelled";
