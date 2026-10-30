/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { toast } from "@/hooks/use-toast";
import { isShareCancelled } from "@/lib/config/settingsExportShare";
import { addLog } from "@/lib/logging";
import type { TuneSharePayload } from "@/lib/playback/tuneShare";

export type ShareTuneOutcome = "shared" | "copied" | "cancelled" | "failed";

const SHARE_FAILED_TITLE = "Could not share this tune";

const isDismissed = (error: unknown): boolean => isShareCancelled(error) || (error as Error)?.name === "AbortError";

const copyToClipboard = async ({ text, url }: TuneSharePayload): Promise<ShareTuneOutcome> => {
  if (!navigator.clipboard) throw new Error("Neither sharing nor the clipboard is available in this browser");
  await navigator.clipboard.writeText(`${text}\n${url}`);
  toast({ title: "Link copied", alwaysVisible: true });
  return "copied";
};

const shareThroughPlatform = async (payload: TuneSharePayload): Promise<ShareTuneOutcome> => {
  const { title, text, url } = payload;
  if (Capacitor.isNativePlatform()) {
    await Share.share({ title, text, url, dialogTitle: "Share tune" });
    return "shared";
  }
  if (typeof navigator.share === "function") {
    await navigator.share({ title, text, url });
    return "shared";
  }
  return copyToClipboard(payload);
};

/**
 * Hand one tune to the system share sheet, or copy its link where a browser has no share sheet.
 * Nothing here contacts DeepSID: the link is only text handed to the user.
 */
export const shareTune = async (payload: TuneSharePayload): Promise<ShareTuneOutcome> => {
  try {
    return await shareThroughPlatform(payload);
  } catch (error) {
    if (isDismissed(error)) {
      addLog("info", "Tune share cancelled", { path: payload.path });
      return "cancelled";
    }
    addLog("error", "Tune share failed", {
      path: payload.path,
      url: payload.url,
      error: (error as Error)?.message ?? String(error),
      stack: (error as Error)?.stack,
    });
    toast({ title: SHARE_FAILED_TITLE, variant: "destructive" });
    return "failed";
  }
};
