/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { Radio } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  saveSidRadioEnabled,
  saveSidRankingEnabled,
  saveLocalEngineEnabled,
  loadSidEmulationEngine,
  saveSidEmulationEngine,
  loadPlaybackCrossfadeMs,
  savePlaybackCrossfadeMs,
  type SidEmulationEngine,
  DEFAULT_SID_RADIO_MIN_SECONDS,
  loadSidRadioMinSeconds,
  saveSidRadioMinSeconds,
} from "@/lib/config/appSettings";
import { clearAllRankings } from "@/lib/sidRadio/rankingStore";
import { useSidRadioFlags } from "@/lib/sidRadio/useSidRadioFlags";
import { usePlaybackEngine } from "@/lib/playback/usePlaybackEngine";
import {
  SIDCORR_BUNDLE_SHA256,
  SIDCORR_EXPECTED,
  SIDCORR_RELEASE_TAG,
  SIDCORR_SCHEMA_VERSION,
} from "@/lib/sidRadio/sidcorrRelease";
import { loadHvscState } from "@/lib/hvsc/hvscStateStore";
import { useC64Connection } from "@/hooks/useC64Connection";
import { LocalEngineRomsRow } from "./LocalEngineRomsRow";

type ToggleRowProps = {
  id: string;
  testId: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
};

const ToggleRow = ({ id, testId, label, description, checked, onChange }: ToggleRowProps) => (
  <div className="flex items-start justify-between gap-3 rounded-lg border border-border/70 p-3 min-w-0">
    <div className="min-w-0">
      <Label htmlFor={id} className="font-medium">
        {label}
      </Label>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
    <Checkbox id={id} data-testid={testId} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
  </div>
);

/**
 * The "SID Radio" Settings group (spec §6.4): the master + ranking enable
 * toggles and the "Clear my rankings" action. The two-version bundle status
 * line is added in M4.
 */
export const SidRadioSettingsSection = () => {
  const { sidRadioEnabled, sidRankingEnabled } = useSidRadioFlags();
  const { localEngineEnabled, engine: playbackEngine } = usePlaybackEngine();
  const { deviceHost } = useC64Connection();
  const [sidEngine, setSidEngine] = useState<SidEmulationEngine>(() => loadSidEmulationEngine());
  const [minSeconds, setMinSeconds] = useState<number>(loadSidRadioMinSeconds);
  const [crossfadeMs, setCrossfadeMs] = useState<number>(() => loadPlaybackCrossfadeMs());
  // Crossfading needs two tunes sounding at once. The C64 has one SID and
  // renders in real time, so on that engine it is not merely unimplemented --
  // it cannot exist. Reflect that in the control rather than letting the user
  // set a value that silently does nothing.
  const crossfadeUnavailable = playbackEngine === "c64";
  const [cleared, setCleared] = useState(false);

  const handleClear = async () => {
    await clearAllRankings();
    setCleared(true);
    window.setTimeout(() => setCleared(false), 2000);
  };

  return (
    <div
      className="profile-card bg-card border border-border rounded-xl p-4 space-y-4"
      data-testid="settings-sid-radio"
    >
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-primary/10">
          <Radio className="h-5 w-5 text-primary" />
        </div>
        <h2 className="font-medium">SID Radio</h2>
      </div>

      <div className="space-y-3">
        <ToggleRow
          id="sid-radio-enabled"
          testId="settings-sid-radio-enabled"
          label="Enable SID Radio"
          description="Endless stations of similar SIDs from HVSC and the tunes you like."
          checked={sidRadioEnabled}
          onChange={saveSidRadioEnabled}
        />
        {sidRadioEnabled ? (
          <ToggleRow
            id="sid-ranking-enabled"
            testId="settings-sid-ranking-enabled"
            label="Show ♥ / ✕ ranking"
            description="Rate the current tune while it plays; steers your stations."
            checked={sidRankingEnabled}
            onChange={saveSidRankingEnabled}
          />
        ) : null}

        <div
          className="space-y-2 rounded-lg border border-border/70 p-3 min-w-0"
          data-testid="settings-sid-radio-min-seconds"
        >
          <Label htmlFor="settings-sid-radio-min-seconds-input" className="text-sm font-medium">
            Shortest tune to play (seconds)
          </Label>
          <p className="text-xs text-muted-foreground">
            HVSC holds jingles, one-shot sound effects and test tones alongside the music, and a station that serves
            those between pieces feels broken. Anything shorter than this is passed over. The station looks further
            through the similarity graph to make up the difference, so raising it does not make a station run dry.
            Default {DEFAULT_SID_RADIO_MIN_SECONDS} seconds; 0 plays everything.
          </p>
          <Input
            id="settings-sid-radio-min-seconds-input"
            data-testid="settings-sid-radio-min-seconds-input"
            inputMode="numeric"
            className="max-w-28"
            value={String(minSeconds)}
            onChange={(event) => setMinSeconds(Number(event.target.value) || 0)}
            onBlur={() => {
              saveSidRadioMinSeconds(minSeconds);
              setMinSeconds(loadSidRadioMinSeconds());
            }}
          />
        </div>

        <ToggleRow
          id="local-engine-enabled"
          testId="settings-local-engine-enabled"
          label="On-device playback engine (experimental)"
          description="Adds a “Listen on” choice on the Play screen, so a tune can play on your C64 or here. Playing here needs the C64 ROMs from your own machine — add them below."
          checked={localEngineEnabled}
          onChange={saveLocalEngineEnabled}
        />
        {localEngineEnabled ? (
          <div className="space-y-2 rounded-lg border border-border/70 p-3 min-w-0" data-testid="settings-sid-engine">
            <Label className="text-sm font-medium">SID emulation</Label>
            <p className="text-xs text-muted-foreground">
              <strong>Accurate</strong> models the real SID chip cycle by cycle — the closest to a real C64, and the one
              to pick if you want the last word in fidelity. <strong>Light</strong> does roughly a third of the work and
              still sounds good; most listeners will not hear the difference, so it is a fine choice on a slower device
              or to save battery. Takes effect on the next track.
            </p>
            <div className="flex gap-2">
              {(
                [
                  ["residfp", "Accurate (reSIDfp)"],
                  ["sidlite", "Light (SIDLite)"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={sidEngine === value ? "default" : "outline"}
                  data-testid={`settings-sid-engine-${value}`}
                  aria-pressed={sidEngine === value}
                  onClick={() => {
                    setSidEngine(value);
                    saveSidEmulationEngine(value);
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {localEngineEnabled ? (
          <div className="space-y-2 rounded-lg border border-border/70 p-3 min-w-0" data-testid="settings-crossfade">
            <Label className={`text-sm font-medium${crossfadeUnavailable ? " text-muted-foreground" : ""}`}>
              Crossfade
            </Label>
            <p className="text-xs text-muted-foreground">
              {crossfadeUnavailable ? (
                <>
                  Only available with <strong>Listen on</strong> set to <strong>Local</strong>. Crossfading needs two
                  tunes sounding at the same moment, and the C64 plays one tune, live, on its single sound chip.
                </>
              ) : (
                <>
                  Normally one tune stops before the next begins, so you never hear two at once. Turn this up and they
                  overlap instead — the outgoing tune fades down while the next fades in.
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  [0, "Off (clean cut)"],
                  [600, "Short (0.6s)"],
                  [1500, "Medium (1.5s)"],
                  [3000, "Long (3s)"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={crossfadeMs === value ? "default" : "outline"}
                  data-testid={`settings-crossfade-${value}`}
                  aria-pressed={crossfadeMs === value}
                  disabled={crossfadeUnavailable}
                  onClick={() => {
                    setCrossfadeMs(value);
                    savePlaybackCrossfadeMs(value);
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {localEngineEnabled ? <LocalEngineRomsRow deviceHost={deviceHost ?? ""} /> : null}

        <div
          className="space-y-1 rounded-lg border border-border/70 p-3 text-xs"
          data-testid="settings-sid-radio-status"
        >
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Similarity corpus:</span> {SIDCORR_SCHEMA_VERSION} ·{" "}
            {SIDCORR_EXPECTED.fileCount.toLocaleString()} files / {SIDCORR_EXPECTED.trackCount.toLocaleString()} tracks
            · sha {SIDCORR_BUNDLE_SHA256.slice(0, 8)}… · {SIDCORR_RELEASE_TAG}
          </p>
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Installed HVSC:</span> baseline{" "}
            {loadHvscState().installedBaselineVersion ?? "—"} + update {loadHvscState().installedVersion}
          </p>
          <p className="text-muted-foreground">
            The two version lines are decoupled — HVSC self-updates; the corpus re-pins per release. Content-addressing
            (MD5) reconciles any skew.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 p-3 min-w-0">
          <div className="min-w-0">
            <Label className="text-sm font-medium">Clear my rankings</Label>
            <p className="text-xs text-muted-foreground">Remove every ♥ / ✕ you have given.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            data-testid="settings-clear-rankings"
            onClick={handleClear}
          >
            {cleared ? "Cleared" : "Clear"}
          </Button>
        </div>
      </div>
    </div>
  );
};
