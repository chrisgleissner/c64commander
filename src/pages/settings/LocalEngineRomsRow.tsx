/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getC64API } from "@/lib/c64api";
import { logger } from "@/lib/logging";
import { fetchSystemRomsFromDevice, type RomFetchOutcome } from "@/lib/roms/romFetchService";
import { clearStoredRoms, loadRomSummaries, type RomSummary } from "@/lib/roms/romStore";

/**
 * "C64 ROMs" row for on-device playback (spec §12, Track B).
 *
 * On-device playback cannot work without the C64's own KERNAL and BASIC:
 * libsidplayfp initialises a tune and then never advances it, producing a flat
 * drone (see `docs/plans/sid-station/AUDIO-FIDELITY-TEST.md` §6.2). The images
 * are copyrighted and cannot be shipped, so the user reads them from the machine
 * they are connected to — an explicit, understandable action, never a background
 * grab.
 *
 * The wording below is deliberately in the UI rather than only in code comments:
 * the user carries an obligation here (only connect to machines you own or are
 * permitted to use) and must be told plainly, at the point of action.
 */
export const LocalEngineRomsRow = ({ deviceHost }: { deviceHost: string }) => {
  const [summaries, setSummaries] = useState<RomSummary[]>(() => loadRomSummaries());
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<RomFetchOutcome[] | null>(null);

  const complete = summaries.length === 2;

  const handleFetch = async () => {
    setBusy(true);
    setOutcomes(null);
    try {
      const result = await fetchSystemRomsFromDevice(getC64API(), deviceHost || "connected C64");
      setOutcomes(result.outcomes);
      setSummaries(loadRomSummaries());
    } catch (error) {
      logger.warn("Reading the C64 ROMs failed", { error: String(error) });
      setOutcomes([{ kind: "kernal", ok: false, reason: error instanceof Error ? error.message : String(error) }]);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = () => {
    clearStoredRoms();
    setSummaries([]);
    setOutcomes(null);
  };

  return (
    <div className="space-y-2 rounded-lg border border-border/70 p-3 min-w-0" data-testid="settings-local-engine-roms">
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <Label className="text-sm font-medium">C64 ROMs for on-device playback</Label>
          <p className="text-xs text-muted-foreground">
            On-device playback uses the C64 ROM images from the Ultimate you are connected to. Without them, tunes play
            on the C64 instead.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {complete ? (
            <Button type="button" variant="outline" size="sm" data-testid="settings-roms-remove" onClick={handleRemove}>
              Remove
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="settings-roms-fetch"
            disabled={busy}
            onClick={handleFetch}
          >
            {busy ? "Reading…" : complete ? "Re-read" : "Read from C64"}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Only connect C64 Commander to devices you own or have been given permission to use. ROM images stay on this
        phone and are never shared, uploaded or included in diagnostics.
      </p>

      {complete ? (
        <ul className="space-y-0.5 text-xs text-muted-foreground" data-testid="settings-roms-status">
          {summaries.map((summary) => (
            <li key={summary.kind}>
              <span className="font-medium capitalize text-foreground">{summary.kind}:</span> {summary.description} ·{" "}
              {summary.fingerprint}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="settings-roms-status">
          No ROMs stored — SIDs play on the C64.
        </p>
      )}

      {outcomes ? (
        <ul className="space-y-0.5 text-xs" data-testid="settings-roms-result">
          {outcomes.map((outcome) => (
            <li key={outcome.kind} className={outcome.ok ? "text-muted-foreground" : "text-destructive"}>
              <span className="capitalize">{outcome.kind}</span>: {outcome.ok ? outcome.description : outcome.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};
