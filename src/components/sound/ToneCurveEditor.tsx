/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { SKIP_ATTR, VERTICAL_OWNER_ATTR } from "@/lib/input";
import { useInputModality } from "@/hooks/useInputModality";
import {
  TONE_BAND_COUNT,
  TONE_BAND_HZ,
  TONE_MAX_DB,
  TONE_MIN_DB,
  flatBands,
  formatBandHz,
  formatToneDb,
  isFlat,
  withBandGain,
} from "@/lib/audio/tone/toneCurve";
import { plotTargets } from "@/lib/audio/tone/toneResponse";
import { useMorphedBands } from "@/lib/audio/tone/useMorphedBands";
import { ToneCurvePlot } from "@/components/sound/ToneCurvePlot";

export const TONE_STEP_DB = 1;
export const TONE_LONG_PRESS_STEP_DB = 3;
const START_BAND = 5;

const NUDGE_CLASS =
  "flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-foreground transition-colors hover:bg-foreground/10 disabled:opacity-40";

interface NudgeProps {
  label: string;
  testId: string;
  disabled: boolean;
  onPress: () => void;
  children: ReactNode;
}

const Nudge = ({ label, testId, disabled, onPress, children }: NudgeProps) => (
  <button
    type="button"
    tabIndex={-1}
    {...{ [SKIP_ATTR]: "true" }}
    className={NUDGE_CLASS}
    disabled={disabled}
    onClick={onPress}
    aria-label={label}
    title={label}
    data-testid={testId}
  >
    {children}
  </button>
);

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
 * The ten-band tone curve: one draggable point per band and a smooth curve through all of them. A touch
 * picks the band nearest to it and a drag changes that band's gain only; a double tap puts it back to 0 dB.
 * With keys, Left and Right pick a band; OK starts and ends gain editing, in which Up and Down change the
 * gain (3 dB while a key is held). The key hint shows only while keys are in use. Ten bands do not fit
 * 44 px columns on a phone, so four 44 px buttons pick the band and nudge its gain for a touch.
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
  const targets = useMemo(() => plotTargets(shownBands), [shownBands]);
  const keypad = useInputModality() === "key-navigation";
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
        targets={targets}
        selectedBand={selected}
        onChange={setBand}
        onSelect={setSelected}
        onResetBand={(band) => setBand(band, 0)}
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
          onClick: (event) => event.detail === 0 && !disabled && setEditing((value) => !value),
          onKeyDown,
          onFocus: () => setFocused(true),
          onBlur: () => {
            setFocused(false);
            setEditing(false);
          },
        }}
      />
      <div className="flex items-center gap-2" data-testid="sound-tone-nudges">
        <Nudge
          label="Previous band"
          testId="sound-tone-band-prev"
          disabled={disabled || selected === 0}
          onPress={() => setSelected((band) => Math.max(0, band - 1))}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Nudge>
        <Nudge
          label="Next band"
          testId="sound-tone-band-next"
          disabled={disabled || selected === TONE_BAND_COUNT - 1}
          onPress={() => setSelected((band) => Math.min(TONE_BAND_COUNT - 1, band + 1))}
        >
          <ChevronRight className="size-5" aria-hidden />
        </Nudge>
        <span className="ml-auto" />
        <Nudge
          label="Lower gain"
          testId="sound-tone-gain-down"
          disabled={disabled || gain <= TONE_MIN_DB}
          onPress={() => step(-TONE_STEP_DB)}
        >
          <Minus className="size-5" aria-hidden />
        </Nudge>
        <Nudge
          label="Raise gain"
          testId="sound-tone-gain-up"
          disabled={disabled || gain >= TONE_MAX_DB}
          onPress={() => step(TONE_STEP_DB)}
        >
          <Plus className="size-5" aria-hidden />
        </Nudge>
      </div>
      {focused && keypad && !disabled ? (
        <p className="text-sm text-muted-foreground" data-testid="sound-tone-hint">
          {editing ? "Up and down set the gain, OK to finish" : "Left and right pick a band, OK to adjust"}
        </p>
      ) : null}
    </div>
  );
};
