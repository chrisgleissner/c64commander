/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useMemo, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VERTICAL_OWNER_ATTR } from "@/lib/input";
import {
  TONE_BAND_COUNT,
  TONE_BAND_HZ,
  flatBands,
  formatBandHz,
  formatToneDb,
  frequencyToFraction,
  isFlat,
  withBandGain,
} from "@/lib/audio/tone/toneCurve";
import { buildPlotModel } from "@/lib/audio/tone/toneResponse";
import { ToneCurvePlot } from "@/components/sound/ToneCurvePlot";

export const TONE_STEP_DB = 1;
export const TONE_LONG_PRESS_STEP_DB = 3;
const AXIS_LABEL_BANDS = [0, 3, 5, 7, 9];
const AXIS_LABELS: Record<number, string> = { 0: "31", 3: "250", 5: "1k", 7: "4k", 9: "16k" };
const PLOT_HEIGHT_PX = 176;
const START_BAND = 5;

interface ToneCurveEditorProps {
  bandsDb: readonly number[];
  onChange: (bandsDb: number[]) => void;
  disabled?: boolean;
}

/**
 * The ten-band tone curve: a plot of the whole response with one draggable point per band. A touch picks
 * the band nearest to it and a drag changes that band's gain only. With keys, Left and Right pick a band;
 * OK starts and ends gain editing, in which Up and Down change the gain (3 dB while a key is held).
 */
export const ToneCurveEditor = ({ bandsDb, onChange, disabled = false }: ToneCurveEditorProps) => {
  const [selected, setSelected] = useState(START_BAND);
  const [editing, setEditing] = useState(false);
  const { freqs, responseDb, targets } = useMemo(() => buildPlotModel(bandsDb), [bandsDb]);
  const gain = bandsDb[selected] ?? 0;

  const setBand = (band: number, db: number) => onChange(withBandGain(bandsDb, band, db));
  const step = (delta: number) => setBand(selected, gain + delta);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const size = event.repeat ? TONE_LONG_PRESS_STEP_DB : TONE_STEP_DB;
    const handled = () => event.preventDefault();
    switch (event.key) {
      case "ArrowLeft":
        setSelected((band) => Math.max(0, band - 1));
        return handled();
      case "ArrowRight":
        setSelected((band) => Math.min(TONE_BAND_COUNT - 1, band + 1));
        return handled();
      case "ArrowUp":
      case "ArrowDown":
        if (!editing) return;
        step(event.key === "ArrowUp" ? size : -size);
        return handled();
      case "PageUp":
        step(TONE_LONG_PRESS_STEP_DB);
        return handled();
      case "PageDown":
        step(-TONE_LONG_PRESS_STEP_DB);
        return handled();
      case "Enter":
        if (!event.defaultPrevented) setEditing((value) => !value);
        return handled();
      case "Escape":
        if (!editing) return;
        setEditing(false);
        return handled();
      default:
    }
  };

  const shown = Math.round(targets[selected].db * 10) / 10;
  const readout = `${formatBandHz(TONE_BAND_HZ[selected])}, ${formatToneDb(shown)}`;

  return (
    <div className="space-y-2" data-testid="sound-tone-editor">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <p
          className="min-w-0 text-sm font-medium tabular-nums"
          role="status"
          aria-live="polite"
          data-testid="sound-tone-readout"
        >
          {readout}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11 min-w-[5.5rem] text-sm"
          disabled={disabled || isFlat(bandsDb)}
          onClick={() => onChange(flatBands())}
          data-testid="sound-tone-reset"
        >
          Reset
        </Button>
      </div>
      <ToneCurvePlot
        responseDb={responseDb}
        freqs={freqs}
        targets={targets}
        selectedBand={selected}
        onChange={setBand}
        onSelect={setSelected}
        height={PLOT_HEIGHT_PX}
        disabled={disabled}
        rootProps={{
          role: "slider",
          tabIndex: disabled ? -1 : 0,
          "aria-label": "Tone curve",
          "aria-orientation": "vertical",
          "aria-disabled": disabled,
          "aria-valuemin": -12,
          "aria-valuemax": 12,
          "aria-valuenow": shown,
          "aria-valuetext": readout,
          "data-key-nav-horizontal": "",
          [VERTICAL_OWNER_ATTR]: editing ? "true" : "false",
          "data-editing": editing ? "true" : "false",
          "data-selected-band": selected,
          "data-testid": "sound-tone-plot",
          className: cn(editing ? "border-primary" : "border-border", disabled && "opacity-50"),
          onDoubleClick: () => !disabled && onChange(flatBands()),
          onClick: (event) => event.detail === 0 && !disabled && setEditing((value) => !value),
          onKeyDown,
          onBlur: () => setEditing(false),
        }}
      />
      <div className="relative h-5 text-sm text-muted-foreground" aria-hidden="true">
        {AXIS_LABEL_BANDS.map((index) => (
          <span
            key={index}
            className="absolute -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${frequencyToFraction(TONE_BAND_HZ[index]) * 100}%` }}
          >
            {AXIS_LABELS[index]}
          </span>
        ))}
      </div>
      <p className="text-sm text-muted-foreground" data-testid="sound-tone-hint">
        {editing
          ? "Up and down change the gain. OK to finish."
          : "Left and right choose a band. OK to adjust its gain."}
      </p>
    </div>
  );
};
