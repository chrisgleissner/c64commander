/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { VERTICAL_OWNER_ATTR } from "@/lib/input";
import {
  TONE_BAND_COUNT,
  TONE_BAND_HZ,
  flatBands,
  formatBandHz,
  formatToneDb,
  isFlat,
  withBandGain,
} from "@/lib/audio/tone/toneCurve";
import { buildPlotModel } from "@/lib/audio/tone/toneResponse";
import { useMorphedBands } from "@/lib/audio/tone/useMorphedBands";
import { ToneCurvePlot } from "@/components/sound/ToneCurvePlot";

export const TONE_STEP_DB = 1;
export const TONE_LONG_PRESS_STEP_DB = 3;
const START_BAND = 5;

interface ToneCurveEditorProps {
  bandsDb: readonly number[];
  onChange: (bandsDb: number[]) => void;
  disabled?: boolean;
  /** Morph the curve to a change made elsewhere, such as a preset. */
  animate?: boolean;
  /** The live spectrum behind the curve, as levels from 0 to 1. */
  spectrum?: readonly number[] | null;
}

/**
 * The ten-band tone curve: a plot of the whole response with one draggable point per band. A touch picks
 * the band nearest to it and a drag changes that band's gain only. With keys, Left and Right pick a band;
 * OK starts and ends gain editing, in which Up and Down change the gain (3 dB while a key is held).
 */
export const ToneCurveEditor = ({
  bandsDb,
  onChange,
  disabled = false,
  animate = false,
  spectrum,
}: ToneCurveEditorProps) => {
  const [selected, setSelected] = useState(START_BAND);
  const [editing, setEditing] = useState(false);
  const [focused, setFocused] = useState(false);
  const immediate = useRef(false);
  const shownBands = useMorphedBands(bandsDb, animate, immediate);
  const { freqs, responseDb, targets } = useMemo(() => buildPlotModel(shownBands), [shownBands]);
  const gain = bandsDb[selected] ?? 0;

  const setBand = (band: number, db: number) => {
    immediate.current = true;
    onChange(withBandGain(bandsDb, band, db));
  };
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
      <div className="flex min-h-11 items-center gap-2">
        <h3 className="min-w-0 flex-1 text-base font-medium">Tone curve</h3>
        <p
          className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground"
          role="status"
          aria-live="polite"
          data-testid="sound-tone-readout"
        >
          {readout}
        </p>
        <button
          type="button"
          className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          disabled={disabled || isFlat(bandsDb)}
          onClick={() => onChange(flatBands())}
          aria-label="Reset the tone curve to flat"
          title="Reset to flat"
          data-testid="sound-tone-reset"
        >
          <RotateCcw className="size-5" aria-hidden />
        </button>
      </div>
      <ToneCurvePlot
        responseDb={responseDb}
        freqs={freqs}
        targets={targets}
        selectedBand={selected}
        onChange={setBand}
        onSelect={setSelected}
        spectrum={spectrum}
        emphasis={editing}
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
          className: cn(editing && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-card"),
          onDoubleClick: () => !disabled && onChange(flatBands()),
          onClick: (event) => event.detail === 0 && !disabled && setEditing((value) => !value),
          onKeyDown,
          onFocus: () => setFocused(true),
          onBlur: () => {
            setFocused(false);
            setEditing(false);
          },
        }}
      />
      {focused && !disabled ? (
        <p className="text-sm text-muted-foreground" data-testid="sound-tone-hint">
          {editing
            ? "Up and down change the gain. OK to finish."
            : "Left and right choose a band. OK to adjust its gain."}
        </p>
      ) : null}
    </div>
  );
};
