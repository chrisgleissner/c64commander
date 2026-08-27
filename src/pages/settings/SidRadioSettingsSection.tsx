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
  loadLocalSidModel,
  saveLocalSidModel,
  loadLocalSidModelFromDevice,
  saveLocalSidModelFromDevice,
  LOCAL_SID_MODELS,
  type LocalSidModel,
  type SidEmulationEngine,
  DEFAULT_SID_RADIO_MIN_SECONDS,
  loadSidRadioMinSeconds,
  saveSidRadioMinSeconds,
} from "@/lib/config/appSettings";
import { clearAllRankings } from "@/lib/sidRadio/rankingStore";
import { useSidRadioFlags } from "@/lib/sidRadio/useSidRadioFlags";
import { usePlaybackEngine } from "@/lib/playback/usePlaybackEngine";
import { useLearnedDeviceSidModel, useLocalSidModel } from "@/lib/playback/useLocalSidModel";
import {
  SIDCORR_BUNDLE_SHA256,
  SIDCORR_EXPECTED,
  SIDCORR_RELEASE_TAG,
  SIDCORR_SCHEMA_VERSION,
} from "@/lib/sidRadio/sidcorrRelease";
import { loadHvscState } from "@/lib/hvsc/hvscStateStore";
import { useC64Connection } from "@/hooks/useC64Connection";
import { LocalEngineRomsRow } from "./LocalEngineRomsRow";
import { SettingsSection } from "./SettingsSection";

type ToggleRowProps = {
  id: string;
  testId: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
};

const ToggleRow = ({ id, testId, label, description, checked, onChange }: ToggleRowProps) => (
  // Wraps, and the text column keeps a floor. At the largest Text size on a 320px screen the
  // checkbox beside it left "(experimental)" a line narrower than the word, so it was split
  // mid-word. With a floor the checkbox drops to its own line instead.
  <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/70 p-3 min-w-0">
    <div className="min-w-[9rem] flex-1">
      {/* min-h-11 gives the label the 44px target size. Pressing it toggles the
          checkbox, so the label is what the user aims at, not the small box. */}
      <Label htmlFor={id} className="flex min-h-11 items-center font-medium">
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
export interface SidRadioSettingsSectionProps {
  /**
   * Whether the developer-only controls are shown.
   *
   * The section as a whole is not developer-only any more: SID Radio reached GA, so the shortest-tune
   * setting — which decides what a station will even offer — has to be reachable by the people using
   * it. The engine internals below it are a different matter and stay behind the flag.
   */
  developerMode?: boolean;
}

export const SidRadioSettingsSection = ({ developerMode = false }: SidRadioSettingsSectionProps = {}) => {
  const { sidRadioEnabled, sidRankingEnabled } = useSidRadioFlags();
  const { localEngineEnabled, engine: playbackEngine } = usePlaybackEngine();
  const { deviceHost } = useC64Connection();
  const [sidEngine, setSidEngine] = useState<SidEmulationEngine>(() => loadSidEmulationEngine());
  const [sidModelFromDevice, setSidModelFromDevice] = useState(loadLocalSidModelFromDevice);
  const [sidModelFallback, setSidModelFallback] = useState<LocalSidModel>(loadLocalSidModel);
  // Read through the store rather than from the two pieces of local state: the chip in use may
  // also have been learned from the machine while this screen was open.
  const effectiveSidModel = useLocalSidModel();
  const learnedSidModel = useLearnedDeviceSidModel();
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
    <SettingsSection
      id="sid-radio"
      title="SID Radio"
      summary="Stations, crossfade, SID chip and emulation, C64 ROMs"
      icon={Radio}
      testId="settings-sid-radio"
    >
      <div className="space-y-3">
        {developerMode ? (
          <ToggleRow
            id="sid-radio-enabled"
            testId="settings-sid-radio-enabled"
            label="Enable SID Radio"
            description="Endless stations of similar SIDs from HVSC and the tunes you like."
            checked={sidRadioEnabled}
            onChange={saveSidRadioEnabled}
          />
        ) : null}
        {developerMode && sidRadioEnabled ? (
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
            Skips tracks shorter than this (jingles, effects, etc). Default {DEFAULT_SID_RADIO_MIN_SECONDS}s; 0 plays
            everything.
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

        {developerMode ? (
          <ToggleRow
            id="local-engine-enabled"
            testId="settings-local-engine-enabled"
            label="On-device playback engine (experimental)"
            description="Adds an output choice on Play: your C64, or here. Needs your own C64 ROMs — add below."
            checked={localEngineEnabled}
            onChange={saveLocalEngineEnabled}
          />
        ) : null}
        {developerMode && localEngineEnabled ? (
          <div className="space-y-2 rounded-lg border border-border/70 p-3 min-w-0" data-testid="settings-sid-engine">
            <Label className="text-sm font-medium">SID emulation</Label>
            <p className="text-xs text-muted-foreground">
              <strong>Accurate</strong> models the chip cycle-by-cycle for best fidelity. <strong>Light</strong> uses
              about a third the CPU and sounds close. Takes effect next track.
            </p>
            {/* Wraps rather than shrinks: both labels are set nowrap, so on the
                smallest screen the two buttons squeezed each other and each label was
                cut off inside its own button. On a second line they are both whole. */}
            <div className="flex flex-wrap gap-2">
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
          <div className="space-y-3 rounded-lg border border-border/70 p-3 min-w-0" data-testid="settings-sid-chip">
            <Label className="text-sm font-medium">SID chip for tunes that do not name one</Label>
            <p className="text-xs text-muted-foreground">
              <strong>6581</strong> has a thick, uneven filter; <strong>8580</strong> is cleaner and quieter. Most SID
              files name their chip and always play on it — this is for the ones that do not.
            </p>
            <ToggleRow
              id="sid-chip-from-device"
              testId="settings-sid-chip-from-device"
              label="Match my Commodore 64"
              description={
                learnedSidModel
                  ? `Learned once from your machine, then keeps applying even when it's off. Last read: ${learnedSidModel}.`
                  : "Learned once from your machine, then keeps applying even when it's off. Nothing read yet — using the choice below."
              }
              checked={sidModelFromDevice}
              onChange={(next) => {
                setSidModelFromDevice(next);
                saveLocalSidModelFromDevice(next);
              }}
            />
            <div className="space-y-2">
              <Label className="text-sm font-medium">Otherwise use</Label>
              <p className="text-xs text-muted-foreground">
                Used when the setting above is off, or when no Commodore 64 has been read yet.
              </p>
              <div className="flex gap-2">
                {LOCAL_SID_MODELS.map((model) => (
                  <Button
                    key={model}
                    type="button"
                    size="sm"
                    variant={sidModelFallback === model ? "default" : "outline"}
                    data-testid={`settings-sid-chip-${model}`}
                    aria-pressed={sidModelFallback === model}
                    onClick={() => {
                      setSidModelFallback(model);
                      saveLocalSidModel(model);
                    }}
                  >
                    {model}
                  </Button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="settings-sid-chip-effective">
              Tunes that don&apos;t name a chip play on the <strong>{effectiveSidModel}</strong>. Takes effect next
              track — the current one keeps playing.
            </p>
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
                  Only available with the Play page's output set to <strong>Here</strong> — the C64 has one sound chip
                  and can&apos;t play two tunes at once.
                </>
              ) : (
                <>Overlaps the outgoing and incoming tune instead of a hard cut.</>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  [0, "Off (clean cut)"],
                  [600, "Short (0.6s)"],
                  [1500, "Medium (1.5s)"],
                  [3000, "Long (3s)"],
                  [4000, "Longest (4s)"],
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
        {developerMode && localEngineEnabled ? <LocalEngineRomsRow deviceHost={deviceHost ?? ""} /> : null}

        {developerMode ? (
          <div
            className="space-y-1 rounded-lg border border-border/70 p-3 text-xs"
            data-testid="settings-sid-radio-status"
          >
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Similarity corpus:</span> {SIDCORR_SCHEMA_VERSION} ·{" "}
              {SIDCORR_EXPECTED.fileCount.toLocaleString()} files / {SIDCORR_EXPECTED.trackCount.toLocaleString()}{" "}
              tracks · sha {SIDCORR_BUNDLE_SHA256.slice(0, 8)}… · {SIDCORR_RELEASE_TAG}
            </p>
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Installed HVSC:</span> baseline{" "}
              {loadHvscState().installedBaselineVersion ?? "—"} + update {loadHvscState().installedVersion}
            </p>
            <p className="text-muted-foreground">
              The two version lines are decoupled — HVSC self-updates; the corpus re-pins per release.
              Content-addressing (MD5) reconciles any skew.
            </p>
          </div>
        ) : null}

        {/* Kept visible: ranking is a feature people use, so undoing it is not a developer concern. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 p-3 min-w-0">
          <div className="min-w-[9rem] flex-1">
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
    </SettingsSection>
  );
};
