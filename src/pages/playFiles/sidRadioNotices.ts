/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { toast } from "@/hooks/use-toast";
import { addLog } from "@/lib/logging";

export type SidRadioNotice = "no-radio-for-tune" | "no-radio" | "no-hvsc" | "station-ended" | "start-failed";

export const SID_RADIO_NOTICE_TEXT: Record<SidRadioNotice, string> = {
  "no-radio-for-tune": "No radio for this tune yet — try a style or your likes.",
  "no-radio": "No radio available yet — like a few tunes to seed one.",
  "no-hvsc": "No HVSC music is installed yet. Install HVSC, then any station will play.",
  "station-ended": "This station has played everything it could find — pick another to keep going.",
  "start-failed": "SID Radio could not start this station. The diagnostics log has the details.",
};

/**
 * A station is started from a sheet that closes on the tap, so the Play page notice alone can be
 * out of view. A start that cannot run is therefore also toasted and logged.
 */
export const reportStationNotStarted = (notice: SidRadioNotice, context: Record<string, unknown>) => {
  addLog("warn", "SID Radio: the station did not start", { notice, ...context });
  toast({ title: "SID Radio", description: SID_RADIO_NOTICE_TEXT[notice] });
};
