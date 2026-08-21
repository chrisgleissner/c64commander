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
import { Switch } from "@/components/ui/switch";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { cn } from "@/lib/utils";
import { getC64API } from "@/lib/c64api";
import { addLog } from "@/lib/logging";
import { fetchSystemRomsFromDevice, type RomFetchOutcome } from "@/lib/roms/romFetchService";
import { clearStoredRoms, loadRomSummaries, type RomSummary } from "@/lib/roms/romStore";
import { loadLocalEngineAutoRoms, saveLocalEngineAutoRoms } from "@/lib/config/appSettings";

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
  const [autoRead, setAutoRead] = useState<boolean>(() => loadLocalEngineAutoRoms());
  const { profile } = useDisplayProfile();
  // "Read from C64" is set nowrap and does not shrink, so on the smallest screen it
  // took about 160px of the 232px available and left the description beside it a
  // 61px column, in which most words were broken in half. Stacking the button under
  // the text there gives the description the full width.
  const stacked = profile === "compact";

  const complete = summaries.length === 2;

  const handleFetch = async () => {
    setBusy(true);
    setOutcomes(null);
    try {
      const result = await fetchSystemRomsFromDevice(getC64API(), deviceHost || "connected C64");
      setOutcomes(result.outcomes);
      setSummaries(loadRomSummaries());
    } catch (error) {
      addLog("warn", "Reading the C64 ROMs failed", { error: String(error) });
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
      <div className={cn("flex gap-3 min-w-0", stacked ? "flex-col items-stretch" : "items-start justify-between")}>
        <div className="min-w-0">
          <Label className="text-sm font-medium">C64 ROMs for on-device playback</Label>
          <p className="text-xs text-muted-foreground">
            Needed for accurate on-device playback; without them, tunes fall back to the lighter emulation.
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

      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <Label htmlFor="settings-roms-auto" className="text-sm">
            Read them automatically
          </Label>
          <p className="text-xs text-muted-foreground">
            Fetches them the first time a tune plays here. On by default — without them, accurate playback is silent.
          </p>
        </div>
        <Switch
          id="settings-roms-auto"
          data-testid="settings-roms-auto"
          checked={autoRead}
          onCheckedChange={(next) => {
            setAutoRead(next);
            saveLocalEngineAutoRoms(next);
          }}
        />
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
          No ROMs stored — tunes play here on the lighter SID emulation.
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
