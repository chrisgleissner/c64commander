/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { cn } from "@/lib/utils";
import { SKIP_ATTR } from "@/lib/input";
import { pairVars, inkOn, type ThemePair } from "@/lib/audio/tone/soundPalette";
import {
  nearestNotch,
  notchValueText,
  positionCss,
  repeatStep,
  snapToNotch,
  stepNotch,
  valueAtPosition,
  type Notch,
} from "@/lib/ui/notchedSlider";

const THUMB_RADIUS_PX = 13;
const DRAG_THRESHOLD_PX = 3;

export interface NotchedSliderProps {
  label: string;
  notches: readonly Notch[];
  value: number;
  onChange: (value: number) => void;
  /** The effect's color: the filled track, the thumb's core and the active notch label. */
  accent: ThemePair;
  min?: number;
  max?: number;
  disabled?: boolean;
  testIdPrefix: string;
}

const useWidth = <T extends HTMLElement>() => {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
};

/**
 * A continuous amount with named notches. The thumb snaps to a notch it comes close to, tapping a notch
 * label jumps there, and Left and Right jump between notches; holding either moves in steps of 5.
 */
export const NotchedSlider = ({
  label,
  notches,
  value,
  onChange,
  accent,
  min = 0,
  max = 100,
  disabled = false,
  testIdPrefix,
}: NotchedSliderProps) => {
  const labelId = useId();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startX: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pulse, setPulse] = useState(0);
  const [rowRef, rowWidth] = useWidth<HTMLDivElement>();
  const [nameRef, nameWidth] = useWidth<HTMLSpanElement>();
  const [readoutRef, readoutWidth] = useWidth<HTMLSpanElement>();

  const active = nearestNotch(value, notches);
  const valueText = notchValueText(value, notches);

  const commit = (next: number, snapped: boolean) => {
    if (next === value) return;
    if (snapped) setPulse((count) => count + 1);
    onChange(next);
  };

  const fromPointer = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box) return;
    const raw = valueAtPosition(clientX - box.left, box.width, THUMB_RADIUS_PX, min, max);
    const snap = snapToNotch(raw, notches, min, max);
    commit(snap.value, snap.notch !== null && snap.value !== value);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { startX: event.clientX, moved: false };
    fromPointer(event.clientX);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    if (!current.moved && Math.abs(event.clientX - current.startX) >= DRAG_THRESHOLD_PX) {
      current.moved = true;
      setDragging(true);
    }
    if (current.moved) fromPointer(event.clientX);
  };

  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (disabled) return;
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (direction !== 0) {
      event.preventDefault();
      const next = event.repeat ? repeatStep(value, direction, min, max) : stepNotch(value, notches, direction);
      commit(next, !event.repeat && next !== value);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      commit(event.key === "Home" ? min : max, false);
    }
  };

  const thumbLeft = positionCss(value, min, max, THUMB_RADIUS_PX);
  const motion = dragging ? "" : "snd-jump";
  const thumbCentre =
    THUMB_RADIUS_PX + ((value - min) / (max - min || 1)) * Math.max(0, rowWidth - 2 * THUMB_RADIUS_PX);
  const readoutCentre =
    rowWidth > 0
      ? Math.min(rowWidth - readoutWidth / 2, Math.max(nameWidth + 12 + readoutWidth / 2, thumbCentre))
      : null;

  return (
    <div
      className={cn("snd-hue min-w-0", disabled && "grayscale")}
      style={{
        ...pairVars("hue", accent),
        ...pairVars("hue-ink", { light: inkOn(accent.light), dark: inkOn(accent.dark) }),
      }}
      data-testid={testIdPrefix}
    >
      <div ref={rowRef} className="relative flex h-6 items-end">
        <span
          ref={nameRef}
          id={labelId}
          className="text-base font-medium leading-6"
          data-testid={`${testIdPrefix}-label`}
        >
          {label}
        </span>
        <span
          ref={readoutRef}
          aria-hidden="true"
          className={cn("absolute bottom-0 whitespace-nowrap text-sm font-semibold leading-6 tabular-nums", motion)}
          style={{
            left: readoutCentre === null ? thumbLeft : `${readoutCentre}px`,
            transform: "translateX(-50%)",
            color: "var(--hue)",
          }}
          data-testid={`${testIdPrefix}-readout`}
        >
          {valueText}
        </span>
      </div>
      <div
        ref={trackRef}
        className={cn("relative h-11 touch-pan-y select-none", disabled ? "pointer-events-none" : "cursor-pointer")}
        data-swipe-exclude="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/[0.12]"
          style={{ left: THUMB_RADIUS_PX - 3, right: THUMB_RADIUS_PX - 3 }}
          aria-hidden="true"
        >
          <div
            className={cn("absolute inset-y-0 left-0 rounded-full", motion)}
            style={{
              width: `calc(3px + (100% - 6px) * ${((value - min) / (max - min || 1)).toFixed(4)})`,
              background: "var(--hue)",
            }}
          />
        </div>
        {notches
          .filter((notch) => notch.value > min && notch.value < max)
          .map((notch) => (
            <span
              key={notch.id}
              aria-hidden="true"
              className={cn(
                "absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
                notch.value <= value ? "bg-[var(--hue-ink)] opacity-70" : "bg-foreground/35",
              )}
              style={{ left: positionCss(notch.value, min, max, THUMB_RADIUS_PX) }}
              data-testid={`${testIdPrefix}-tick-${notch.id}`}
            />
          ))}
        <span
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-labelledby={labelId}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={valueText}
          aria-disabled={disabled || undefined}
          aria-orientation="horizontal"
          onKeyDown={onKeyDown}
          className={cn(
            "absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none",
            "before:absolute before:-inset-[9px] before:content-['']",
            "focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-card",
            motion,
          )}
          style={{ left: thumbLeft, width: THUMB_RADIUS_PX * 2, height: THUMB_RADIUS_PX * 2 }}
          data-testid={`${testIdPrefix}-thumb`}
          data-snapped={notches.some((notch) => notch.value === value) ? "true" : "false"}
        >
          <span
            key={pulse}
            className={cn(
              "flex size-full items-center justify-center rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.3),0_3px_10px_rgb(0_0_0/0.18)]",
              pulse > 0 && "snd-pulse",
            )}
            data-pulse={pulse}
          >
            <span className="size-2.5 rounded-full" style={{ background: "var(--hue)" }} />
          </span>
        </span>
      </div>
      <div className="relative h-11" {...{ [SKIP_ATTR]: "true" }}>
        {notches.map((notch, index) => {
          const first = index === 0 && notch.value === min;
          const last = index === notches.length - 1 && notch.value === max;
          const isActive = notch.id === active.id;
          return (
            <button
              key={notch.id}
              type="button"
              tabIndex={-1}
              {...{ [SKIP_ATTR]: "true" }}
              disabled={disabled}
              onClick={() => commit(notch.value, notch.value !== value)}
              className={cn(
                "absolute top-0 flex h-11 min-w-11 items-start pt-0.5 text-sm",
                first ? "justify-start" : last ? "justify-end" : "-translate-x-1/2 justify-center px-1",
                isActive ? "font-semibold" : "text-muted-foreground",
              )}
              style={{
                left: first ? 0 : last ? undefined : positionCss(notch.value, min, max, THUMB_RADIUS_PX),
                right: last ? 0 : undefined,
                color: isActive ? "var(--hue)" : undefined,
              }}
              aria-label={`${label}: ${notch.label}`}
              aria-pressed={isActive && notch.value === value}
              data-testid={`${testIdPrefix}-notch-${notch.id}`}
            >
              {notch.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
