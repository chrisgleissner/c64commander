/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VERTICAL_OWNER_ATTR } from "@/lib/input";
import {
  TONE_BAND_COUNT,
  TONE_BAND_HZ,
  dbToFraction,
  flatBands,
  formatBandHz,
  formatToneDb,
  fractionToDb,
  frequencyToFraction,
  isFlat,
  nearestBandAtFraction,
  sampleCurve,
  withBandGain,
} from "@/lib/audio/tone/toneCurve";

export const TONE_STEP_DB = 1;
export const TONE_LONG_PRESS_STEP_DB = 3;
const AXIS_LABEL_BANDS = [0, 3, 5, 7, 9];
const AXIS_LABELS: Record<number, string> = { 0: "31", 3: "250", 5: "1k", 7: "4k", 9: "16k" };
const CURVE_POINTS = 96;
const START_BAND = 5;

interface ToneCurveEditorProps {
  bandsDb: readonly number[];
  onChange: (bandsDb: number[]) => void;
  disabled?: boolean;
}

const curvePath = (bandsDb: readonly number[]): string =>
  sampleCurve(bandsDb, CURVE_POINTS)
    .map(({ fraction, db }, index) => {
      const y = Math.min(100, Math.max(0, dbToFraction(db) * 100));
      return `${index === 0 ? "M" : "L"}${(fraction * 100).toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

/**
 * The ten-band tone curve: a plot of the whole response with one draggable point per band. A touch picks
 * the band nearest to it and a drag changes that band's gain only. With keys, Left and Right pick a band;
 * OK starts and ends gain editing, in which Up and Down change the gain (3 dB while a key is held).
 */
export const ToneCurveEditor = ({ bandsDb, onChange, disabled = false }: ToneCurveEditorProps) => {
  const [selected, setSelected] = useState(START_BAND);
  const [editing, setEditing] = useState(false);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const gain = bandsDb[selected] ?? 0;

  const dragTo = (band: number, clientY: number) => {
    const box = plotRef.current?.getBoundingClientRect();
    if (!box || box.height === 0) return;
    onChange(withBandGain(bandsDb, band, fractionToDb((clientY - box.top) / box.height)));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const box = plotRef.current?.getBoundingClientRect();
    if (disabled || !box || box.width === 0) return;
    const band = nearestBandAtFraction((event.clientX - box.left) / box.width);
    setSelected(band);
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragTo(band, event.clientY);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) dragTo(selected, event.clientY);
  };

  const endDrag = () => {
    dragging.current = false;
  };

  const step = (delta: number) => onChange(withBandGain(bandsDb, selected, gain + delta));

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

  const band = TONE_BAND_HZ[selected];
  const readout = `${formatBandHz(band)}, ${formatToneDb(gain)}`;

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
      <div
        ref={plotRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Tone curve"
        aria-orientation="vertical"
        aria-disabled={disabled}
        aria-valuemin={-12}
        aria-valuemax={12}
        aria-valuenow={gain}
        aria-valuetext={readout}
        data-key-nav-horizontal=""
        {...{ [VERTICAL_OWNER_ATTR]: editing ? "true" : "false" }}
        data-editing={editing ? "true" : "false"}
        data-selected-band={selected}
        data-testid="sound-tone-plot"
        className={cn(
          "relative h-44 w-full touch-none select-none rounded-panel border bg-background",
          editing ? "border-primary" : "border-border",
          disabled && "opacity-50",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => !disabled && onChange(flatBands())}
        onClick={(event) => event.detail === 0 && !disabled && setEditing((value) => !value)}
        onKeyDown={onKeyDown}
        onBlur={() => setEditing(false)}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {TONE_BAND_HZ.map((hz) => (
            <line
              key={hz}
              x1={frequencyToFraction(hz) * 100}
              x2={frequencyToFraction(hz) * 100}
              y1="0"
              y2="100"
              className="stroke-border"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {[25, 50, 75].map((y) => (
            <line
              key={y}
              x1="0"
              x2="100"
              y1={y}
              y2={y}
              className={y === 50 ? "stroke-muted-foreground" : "stroke-border"}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path
            d={curvePath(bandsDb)}
            fill="none"
            className="stroke-primary"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
            data-testid="sound-tone-curve"
          />
        </svg>
        {TONE_BAND_HZ.map((hz, index) => (
          <span
            key={hz}
            aria-hidden="true"
            data-testid={`sound-tone-point-${index}`}
            data-gain={bandsDb[index] ?? 0}
            className={cn(
              "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background",
              index === selected ? "size-4 bg-primary" : "size-3",
            )}
            style={{
              left: `${frequencyToFraction(hz) * 100}%`,
              top: `${dbToFraction(bandsDb[index] ?? 0) * 100}%`,
            }}
          />
        ))}
      </div>
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
