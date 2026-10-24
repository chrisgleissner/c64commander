/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useRef, type HTMLAttributes, type PointerEvent, type Ref } from "react";

import { cn } from "@/lib/utils";
import { TONE_BAND_HZ, fractionToDb, nearestBandAtFraction } from "@/lib/audio/tone/toneCurve";
import { curvePixels, handlePosition, smoothPath, xForHz, type ToneTarget } from "@/lib/audio/tone/toneGeometry";
import { SPECTRUM_LOW_HZ, SPECTRUM_OCTAVES } from "@/lib/audio/spectrum/spectrumBands";

export interface ToneCurvePlotProps {
  /** The true cascade response in dB at each of {@link freqs}. */
  responseDb: readonly number[];
  freqs: readonly number[];
  /** One handle per band, already on the curve: the value shown is the value the curve reaches. */
  targets: readonly ToneTarget[];
  selectedBand: number;
  onChange: (band: number, db: number) => void;
  onSelect: (band: number) => void;
  /** Optional backdrop: levels from 0 to 1 over log-spaced bands from 31.25 Hz. */
  spectrum?: readonly number[];
  height: number;
  theme?: "light" | "dark";
  disabled?: boolean;
  plotRef?: Ref<HTMLDivElement>;
  /** Focus, key and ARIA attributes owned by the editor logic. */
  rootProps?: HTMLAttributes<HTMLDivElement> & Record<string, unknown>;
}

const VIEW = 100;

const spectrumPath = (levels: readonly number[]): string => {
  const top = levels.map((level, i) => {
    const hz = SPECTRUM_LOW_HZ * 2 ** (((i + 0.5) * SPECTRUM_OCTAVES) / levels.length);
    return `L${xForHz(hz, VIEW).toFixed(2)} ${(VIEW - level * VIEW).toFixed(2)}`;
  });
  return `M0 ${VIEW} ${top.join(" ")} L${VIEW} ${VIEW} Z`;
};

/**
 * The presentational tone plot. It draws the given response and handles and reports pointer input as
 * (band, db); it holds no tone logic, so its rendering can be replaced without touching the editor.
 */
export const ToneCurvePlot = ({
  responseDb,
  freqs,
  targets,
  selectedBand,
  onChange,
  onSelect,
  spectrum,
  height,
  theme,
  disabled = false,
  plotRef,
  rootProps,
}: ToneCurvePlotProps) => {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<number | null>(null);
  const setRefs = (element: HTMLDivElement | null) => {
    innerRef.current = element;
    if (typeof plotRef === "function") plotRef(element);
    else if (plotRef) (plotRef as { current: HTMLDivElement | null }).current = element;
  };

  const dbAt = (clientY: number) => {
    const box = innerRef.current?.getBoundingClientRect();
    return box && box.height > 0 ? fractionToDb((clientY - box.top) / box.height) : null;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const box = innerRef.current?.getBoundingClientRect();
    if (disabled || !box || box.width === 0) return;
    const band = nearestBandAtFraction((event.clientX - box.left) / box.width);
    onSelect(band);
    dragging.current = band;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const db = dbAt(event.clientY);
    if (db !== null) onChange(band, db);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current === null) return;
    const db = dbAt(event.clientY);
    if (db !== null) onChange(dragging.current, db);
  };

  const endDrag = () => {
    dragging.current = null;
  };

  const path = smoothPath(curvePixels(freqs, responseDb, targets, VIEW, VIEW));

  return (
    <div
      {...rootProps}
      ref={setRefs}
      data-theme-hint={theme}
      style={{ height }}
      className={cn("relative w-full touch-none select-none rounded-panel border bg-background", rootProps?.className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
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
            x1={xForHz(hz, VIEW)}
            x2={xForHz(hz, VIEW)}
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
        {spectrum && spectrum.length > 0 ? (
          <path
            d={spectrumPath(spectrum)}
            className="fill-muted-foreground"
            fillOpacity="0.15"
            data-testid="sound-tone-spectrum"
          />
        ) : null}
        <path
          d={path}
          fill="none"
          className="stroke-primary"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
          data-testid="sound-tone-curve"
        />
      </svg>
      {targets.map((target) => {
        const at = handlePosition(target, 100, 100);
        return (
          <span
            key={target.band}
            aria-hidden="true"
            data-testid={`sound-tone-point-${target.band}`}
            data-gain={Math.round(target.db * 10) / 10}
            data-x={at.x}
            data-y={at.y}
            className={cn(
              "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background",
              target.band === selectedBand ? "size-4 bg-primary" : "size-3",
            )}
            style={{ left: `${at.x}%`, top: `${at.y}%` }}
          />
        );
      })}
    </div>
  );
};
