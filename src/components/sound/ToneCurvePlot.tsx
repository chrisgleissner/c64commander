/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useId, useLayoutEffect, useRef, useState, type HTMLAttributes, type PointerEvent, type Ref } from "react";

import { cn } from "@/lib/utils";
import {
  TONE_BAND_HZ,
  formatBandHz,
  fractionToDb,
  frequencyToFraction,
  nearestBandAtFraction,
} from "@/lib/audio/tone/toneCurve";
import {
  crispLine,
  curvePixels,
  handlePosition,
  smoothPath,
  thinAxisLabels,
  xForHz,
  yForDb,
  type ToneTarget,
} from "@/lib/audio/tone/toneGeometry";
import { CUT_FILL, PITCH_STOPS, inkOn, pairVars, pitchPair } from "@/lib/audio/tone/soundPalette";
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
  spectrum?: readonly number[] | null;
  /** A fixed height in CSS px; by default the plot is about 16:9, at least 200 px and at most 300 px high. */
  height?: number;
  /** Shows the value bubble on the selected handle, as while the gain is being edited with keys. */
  emphasis?: boolean;
  disabled?: boolean;
  plotRef?: Ref<HTMLDivElement>;
  /** Focus, key and ARIA attributes owned by the editor logic. */
  rootProps?: HTMLAttributes<HTMLDivElement> & Record<string, unknown>;
}

const VIEW = 100;
const GUTTER_LEFT_PX = 44;
const GUTTER_RIGHT_PX = 12;
const PAD_TOP_PX = 14;
const PAD_BOTTOM_PX = 34;
const GRID_DB = [12, 6, 0, -6, -12] as const;
const AXIS_BANDS = [0, 2, 4, 6, 8, 9] as const;
const AXIS_LABELS = ["31", "125", "500", "2k", "8k", "16k"] as const;

const dbLabel = (db: number) => (db > 0 ? `+${db}` : db < 0 ? `−${-db}` : "0");

const LOW_HZ = TONE_BAND_HZ[0];
const HIGH_HZ = TONE_BAND_HZ[TONE_BAND_HZ.length - 1];

const spectrumPath = (levels: readonly number[]): string => {
  const points = levels.map((level, i) => ({
    x: xForHz(Math.min(HIGH_HZ, SPECTRUM_LOW_HZ * 2 ** (((i + 0.5) * SPECTRUM_OCTAVES) / levels.length)), VIEW),
    y: VIEW - level * VIEW,
  }));
  return `${smoothPath([{ x: xForHz(LOW_HZ, VIEW), y: VIEW }, ...points, { x: xForHz(HIGH_HZ, VIEW), y: VIEW }])} Z`;
};

const formatBubbleDb = (db: number) => {
  const shown = Math.round(db * 10) / 10;
  return `${shown > 0 ? "+" : shown < 0 ? "−" : ""}${Math.abs(shown).toFixed(1)} dB`;
};

const useBox = (ref: { current: HTMLElement | null }) => {
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setBox((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return box;
};

/** Guide lines in CSS pixels, each placed on whole device pixels so it stays sharp at any density. */
const Grid = ({ width, height }: { width: number; height: number }) => {
  if (width <= 0 || height <= 0) return null;
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return (
    <svg className="absolute inset-0 overflow-visible" width={width} height={height} aria-hidden="true">
      {AXIS_BANDS.map((band) => {
        const line = crispLine(xForHz(TONE_BAND_HZ[band], width), ratio);
        return (
          <line
            key={band}
            x1={line.at}
            x2={line.at}
            y1={0}
            y2={height}
            className="stroke-foreground/[0.14]"
            strokeWidth={line.width}
            strokeDasharray="1 3"
          />
        );
      })}
      {GRID_DB.map((db) => {
        const line = crispLine(yForDb(db, height), ratio);
        const zero = db === 0;
        return (
          <line
            key={db}
            x1={0}
            x2={width}
            y1={line.at}
            y2={line.at}
            className={zero ? "stroke-foreground/40" : "stroke-foreground/[0.16]"}
            strokeWidth={line.width}
            strokeDasharray={zero ? undefined : "1 3"}
            data-testid={zero ? "sound-tone-zero" : undefined}
          />
        );
      })}
    </svg>
  );
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
  emphasis = false,
  disabled = false,
  plotRef,
  rootProps,
}: ToneCurvePlotProps) => {
  const ids = useId();
  const areaRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<number | null>(null);
  const [dragBand, setDragBand] = useState<number | null>(null);
  const area = useBox(areaRef);
  const axisRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [hiddenAxis, setHiddenAxis] = useState<readonly number[]>([]);
  useLayoutEffect(() => {
    const spans = axisRefs.current.map((span) => span?.getBoundingClientRect() ?? null);
    const hidden = thinAxisLabels(spans.map((rect) => (rect ? { left: rect.left, right: rect.right } : null)));
    setHiddenAxis((current) =>
      current.length === hidden.length && current.every((value, index) => value === hidden[index]) ? current : hidden,
    );
  }, [area.width]);
  const setRootRef = (element: HTMLDivElement | null) => {
    if (typeof plotRef === "function") plotRef(element);
    else if (plotRef) (plotRef as { current: HTMLDivElement | null }).current = element;
  };

  const dbAt = (clientY: number) => {
    const box = areaRef.current?.getBoundingClientRect();
    return box && box.height > 0 ? fractionToDb((clientY - box.top) / box.height) : null;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const box = areaRef.current?.getBoundingClientRect();
    if (disabled || !box || box.width === 0) return;
    const band = nearestBandAtFraction((event.clientX - box.left) / box.width);
    onSelect(band);
    dragging.current = band;
    setDragBand(band);
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
    setDragBand(null);
  };

  const inBands = freqs.flatMap((hz, index) => (hz > LOW_HZ && hz < HIGH_HZ ? [index] : []));
  const curve = smoothPath(
    curvePixels(
      inBands.map((index) => freqs[index]),
      inBands.map((index) => responseDb[index]),
      targets,
      VIEW,
      VIEW,
    ),
  );
  const zeroY = yForDb(0, VIEW);
  const fill = `${curve} L${xForHz(HIGH_HZ, VIEW).toFixed(3)} ${zeroY} L${xForHz(LOW_HZ, VIEW).toFixed(3)} ${zeroY} Z`;
  const gradient = `${ids}-pitch`;
  const boostMask = `${ids}-boost`;
  const cutMask = `${ids}-cut`;
  const selected = targets.find((target) => target.band === selectedBand);
  const showBubble = !disabled && selected !== undefined && (emphasis || dragBand !== null);

  return (
    <div
      {...rootProps}
      ref={setRootRef}
      style={height ? { height } : undefined}
      className={cn(
        "snd-plot-surface relative w-full touch-none select-none rounded-xl outline-none",
        height ? undefined : "aspect-[16/9] max-h-[300px] min-h-[200px]",
        "focus-visible:ring-2 focus-visible:ring-foreground/70 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        rootProps?.className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {GRID_DB.map((db) => (
        <span
          key={db}
          aria-hidden="true"
          className={cn(
            "absolute -translate-y-1/2 whitespace-nowrap text-right text-sm leading-none tabular-nums",
            db === 0 ? "text-foreground/70" : "text-muted-foreground",
          )}
          style={{
            right: `calc(100% - ${GUTTER_LEFT_PX - 8}px)`,
            top: `calc(${PAD_TOP_PX}px + (100% - ${PAD_TOP_PX + PAD_BOTTOM_PX}px) * ${(yForDb(db, VIEW) / VIEW).toFixed(4)})`,
          }}
        >
          {dbLabel(db)}
        </span>
      ))}
      {AXIS_BANDS.map((band, index) => {
        const last = index === AXIS_BANDS.length - 1;
        return (
          <span
            key={band}
            ref={(element) => {
              axisRefs.current[index] = element;
            }}
            aria-hidden="true"
            className={cn(
              "absolute bottom-2.5 whitespace-nowrap text-sm leading-none tabular-nums text-muted-foreground",
              last ? "right-[3px]" : "-translate-x-1/2",
              hiddenAxis.includes(index) && "invisible",
            )}
            data-hidden={hiddenAxis.includes(index) ? "true" : undefined}
            style={
              last
                ? undefined
                : {
                    left: `calc(${GUTTER_LEFT_PX}px + (100% - ${GUTTER_LEFT_PX + GUTTER_RIGHT_PX}px) * ${frequencyToFraction(TONE_BAND_HZ[band]).toFixed(4)})`,
                  }
            }
            data-testid={`sound-tone-axis-${AXIS_LABELS[index]}`}
          >
            {AXIS_LABELS[index]}
          </span>
        );
      })}
      <div
        ref={areaRef}
        className="absolute"
        style={{ left: GUTTER_LEFT_PX, right: GUTTER_RIGHT_PX, top: PAD_TOP_PX, bottom: PAD_BOTTOM_PX }}
        data-testid="sound-tone-area"
      >
        <Grid width={area.width} height={area.height} />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={VIEW} y2="0">
              {PITCH_STOPS.map((stop) => (
                <stop
                  key={stop.hz}
                  offset={frequencyToFraction(stop.hz).toFixed(4)}
                  className="snd-hue"
                  style={{ ...pairVars("hue", pitchPair(stop.hz)), stopColor: "var(--hue)" }}
                />
              ))}
            </linearGradient>
            <linearGradient id={`${boostMask}-fade`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={VIEW}>
              <stop offset="0" stopColor="#fff" />
              <stop offset={(zeroY / VIEW).toFixed(3)} stopColor="#000" />
            </linearGradient>
            <linearGradient id={`${cutMask}-fade`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={VIEW}>
              <stop offset={(zeroY / VIEW).toFixed(3)} stopColor="#000" />
              <stop offset="1" stopColor="#fff" />
            </linearGradient>
            <linearGradient id={`${ids}-backdrop-fade`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={VIEW}>
              <stop offset="0.2" stopColor="#fff" />
              <stop offset="1" stopColor="#000" />
            </linearGradient>
            <mask id={`${ids}-backdrop`} maskUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="120">
              <rect x="-10" y="-10" width="120" height="120" fill={`url(#${ids}-backdrop-fade)`} />
            </mask>
            <mask id={boostMask} maskUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="120">
              <rect x="-10" y="-10" width="120" height="120" fill={`url(#${boostMask}-fade)`} />
            </mask>
            <mask id={cutMask} maskUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="120">
              <rect x="-10" y="-10" width="120" height="120" fill={`url(#${cutMask}-fade)`} />
            </mask>
          </defs>
          {spectrum && spectrum.length > 0 ? (
            <path
              d={spectrumPath(spectrum)}
              fill={`url(#${gradient})`}
              mask={`url(#${ids}-backdrop)`}
              className="opacity-[0.12] dark:opacity-[0.14]"
              data-testid="sound-tone-spectrum"
            />
          ) : null}
          <path
            d={fill}
            fill={`url(#${gradient})`}
            className="opacity-70 dark:opacity-55"
            mask={`url(#${boostMask})`}
            data-testid="sound-tone-boost"
          />
          <path
            d={fill}
            className="snd-hue"
            style={{ ...pairVars("hue", CUT_FILL), fill: "var(--hue)" }}
            fillOpacity="0.4"
            mask={`url(#${cutMask})`}
          />
        </svg>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="snd-glow pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          aria-hidden="true"
        >
          <path
            d={curve}
            fill="none"
            stroke={`url(#${gradient})`}
            strokeWidth="6"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden="true"
        >
          <path
            d={curve}
            fill="none"
            stroke={`url(#${gradient})`}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            data-testid="sound-tone-curve"
          />
        </svg>
        {dragBand !== null && selected ? (
          <span
            aria-hidden="true"
            className="snd-hue pointer-events-none absolute bottom-0 w-px -translate-x-1/2"
            style={{
              ...pairVars("hue", pitchPair(selected.freq)),
              left: `${handlePosition(selected, 100, 100).x}%`,
              top: `${handlePosition(selected, 100, 100).y}%`,
              backgroundImage: "linear-gradient(to bottom, var(--hue), transparent)",
            }}
            data-testid="sound-tone-guide"
          />
        ) : null}
        {selected && !disabled ? (
          <span
            aria-hidden="true"
            className="snd-hue pointer-events-none absolute size-10 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20"
            style={{
              ...pairVars("hue", pitchPair(selected.freq)),
              left: `${handlePosition(selected, 100, 100).x}%`,
              top: `${handlePosition(selected, 100, 100).y}%`,
              background: "var(--hue)",
            }}
            data-testid="sound-tone-halo"
          />
        ) : null}
        {targets.map((target) => {
          const at = handlePosition(target, 100, 100);
          const hue = pitchPair(target.freq);
          const isSelected = target.band === selectedBand;
          return (
            <span
              key={target.band}
              aria-hidden="true"
              data-testid={`sound-tone-point-${target.band}`}
              data-gain={Math.round(target.db * 10) / 10}
              data-x={at.x}
              data-y={at.y}
              data-selected={isSelected ? "true" : "false"}
              className={cn(
                "snd-hue snd-handle pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white",
                isSelected
                  ? "size-[22px] shadow-[0_2px_6px_rgb(0_0_0/0.35)]"
                  : "size-[14px] shadow-[0_1px_3px_rgb(0_0_0/0.3)]",
              )}
              style={{ ...pairVars("hue", hue), left: `${at.x}%`, top: `${at.y}%`, background: "var(--hue)" }}
            />
          );
        })}
        {showBubble && selected ? <BandBubble target={selected} /> : null}
      </div>
    </div>
  );
};

const BandBubble = ({ target }: { target: ToneTarget }) => {
  const at = handlePosition(target, 100, 100);
  const hue = pitchPair(target.freq);
  const below = at.y < 28;
  const shift = at.x < 16 ? "-14px" : at.x > 84 ? "calc(-100% + 14px)" : "-50%";
  return (
    <span
      aria-hidden="true"
      className="snd-hue pointer-events-none absolute z-10 flex items-baseline gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-sm font-semibold leading-none tabular-nums shadow-[0_2px_8px_rgb(0_0_0/0.25)]"
      style={{
        ...pairVars("hue", hue),
        ...pairVars("hue-ink", { light: inkOn(hue.light), dark: inkOn(hue.dark) }),
        left: `${at.x}%`,
        top: `${at.y}%`,
        transform: `translate(${shift}, ${below ? "18px" : "calc(-100% - 18px)"})`,
        background: "var(--hue)",
        color: "var(--hue-ink)",
      }}
      data-testid="sound-tone-bubble"
    >
      <span>{formatBandHz(target.freq)}</span>
      <span>{formatBubbleDb(target.db)}</span>
    </span>
  );
};
