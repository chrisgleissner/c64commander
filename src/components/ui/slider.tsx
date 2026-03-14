/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";
import { emitUiTraceMarker, wrapValueChange } from "@/lib/tracing/userTrace";
import {
  clampSliderValue,
  createSliderAsyncQueue,
  resolveMidpointPercent,
  resolveMidpointSnap,
  shouldTriggerMidpointHaptic,
  type SliderAsyncQueue,
} from "@/lib/ui/sliderBehavior";
import {
  reduceSliderPopupState,
  resolveSliderPopupCloseDelayMs,
  type SliderPopupEvent,
  type SliderPopupState,
} from "@/lib/ui/sliderPopupStateMachine";
import { triggerSliderHaptic } from "@/lib/ui/sliderHaptics";

type SliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
  thumbClassName?: string;
  trackClassName?: string;
  rangeClassName?: string;
  trackStyle?: React.CSSProperties;
  rangeStyle?: React.CSSProperties;
  valueFormatter?: (value: number) => string;
  valueLabelClassName?: string;
  showValueOnDrag?: boolean;
  midpoint?: {
    value: number;
    snapRange?: number;
    cling?: boolean;
    haptics?: boolean;
    notch?: boolean;
  };
  onValueChangeAsync?: (value: number) => void;
  onValueCommitAsync?: (value: number) => void;
  asyncThrottleMs?: number;
};

const normalizeSliderValue = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? clampSliderValue(value, min, max) : min;

const normalizeSliderMidpoint = (midpoint: SliderProps["midpoint"], min: number, max: number) => {
  if (!midpoint || !Number.isFinite(midpoint.value)) return undefined;
  return {
    ...midpoint,
    value: normalizeSliderValue(midpoint.value, min, max),
  };
};

const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  (
    {
      className,
      value,
      defaultValue,
      onValueChange,
      onValueCommit,
      onValueChangeAsync,
      onValueCommitAsync,
      asyncThrottleMs,
      thumbClassName,
      trackClassName,
      rangeClassName,
      trackStyle,
      rangeStyle,
      valueFormatter,
      valueLabelClassName,
      showValueOnDrag = true,
      midpoint,
      onPointerDown,
      onPointerUp,
      onPointerCancel,
      ...props
    },
    ref,
  ) => {
    const min = Number.isFinite(props.min) ? props.min : 0;
    const resolvedMax = Number.isFinite(props.max) ? Math.max(props.max, min) : Math.max(min, 100);
    const max = resolvedMax <= min ? min + 1 : resolvedMax;
    const step = props.step;
    const [dragValue, setDragValue] = React.useState<number | null>(null);
    const [popupState, setPopupState] = React.useState<SliderPopupState>("Hidden");
    const popupStateRef = React.useRef<SliderPopupState>("Hidden");
    const popupOpenAtRef = React.useRef<number | null>(null);
    const popupLastInteractionAtRef = React.useRef<number | null>(null);
    const popupCloseTimerRef = React.useRef<number | null>(null);
    const popupSessionOpenRef = React.useRef(false);
    const lastValueRef = React.useRef<number | null>(null);
    const lastHapticAtRef = React.useRef<number | null>(null);
    const asyncQueueRef = React.useRef<SliderAsyncQueue | null>(null);

    const normalizedMidpoint = React.useMemo(() => normalizeSliderMidpoint(midpoint, min, max), [max, midpoint, min]);
    const normalizedValue = React.useMemo(
      () => value?.map((entry) => normalizeSliderValue(entry, min, max)),
      [max, min, value],
    );
    const normalizedDefaultValue = React.useMemo(
      () => defaultValue?.map((entry) => normalizeSliderValue(entry, min, max)),
      [defaultValue, max, min],
    );

    const clearPopupCloseTimer = React.useCallback(() => {
      if (popupCloseTimerRef.current === null) return;
      window.clearTimeout(popupCloseTimerRef.current);
      popupCloseTimerRef.current = null;
    }, []);

    const setPopupHidden = React.useCallback(() => {
      clearPopupCloseTimer();
      if (popupStateRef.current === "Hidden") return;
      popupStateRef.current = "Hidden";
      setPopupState("Hidden");
      popupOpenAtRef.current = null;
      popupLastInteractionAtRef.current = null;
      if (popupSessionOpenRef.current) {
        emitUiTraceMarker("SliderPopupClosed");
        popupSessionOpenRef.current = false;
      }
    }, [clearPopupCloseTimer]);

    const applyPopupEvent = React.useCallback((event: SliderPopupEvent) => {
      const previousState = popupStateRef.current;
      const nextState = reduceSliderPopupState(previousState, event);
      if (nextState === previousState) return;
      popupStateRef.current = nextState;
      setPopupState(nextState);
      if (previousState === "Hidden" && nextState !== "Hidden" && !popupSessionOpenRef.current) {
        popupSessionOpenRef.current = true;
        emitUiTraceMarker("SliderPopupOpened");
      }
    }, []);

    const schedulePopupClose = React.useCallback(() => {
      if (!showValueOnDrag) return;
      if (popupOpenAtRef.current === null || popupLastInteractionAtRef.current === null) return;
      clearPopupCloseTimer();
      const delay = resolveSliderPopupCloseDelayMs(
        popupOpenAtRef.current,
        popupLastInteractionAtRef.current,
        Date.now(),
      );
      popupCloseTimerRef.current = window.setTimeout(() => {
        applyPopupEvent("idle-timeout");
        setPopupHidden();
      }, delay);
    }, [applyPopupEvent, clearPopupCloseTimer, setPopupHidden, showValueOnDrag]);

    const registerPopupInteraction = React.useCallback(
      (event: SliderPopupEvent) => {
        if (!showValueOnDrag) return;
        const now = Date.now();
        if (popupOpenAtRef.current === null) {
          popupOpenAtRef.current = now;
        }
        popupLastInteractionAtRef.current = now;
        applyPopupEvent(event);
        schedulePopupClose();
      },
      [applyPopupEvent, schedulePopupClose, showValueOnDrag],
    );

    React.useEffect(() => {
      if (showValueOnDrag) return;
      setPopupHidden();
    }, [setPopupHidden, showValueOnDrag]);

    React.useEffect(() => {
      return () => {
        clearPopupCloseTimer();
        if (popupSessionOpenRef.current) {
          emitUiTraceMarker("SliderPopupClosed");
          popupSessionOpenRef.current = false;
        }
      };
    }, [clearPopupCloseTimer]);

    React.useEffect(() => {
      if (!onValueChangeAsync && !onValueCommitAsync) {
        asyncQueueRef.current?.cancel();
        asyncQueueRef.current = null;
        return undefined;
      }
      const queue = createSliderAsyncQueue({
        onChange: onValueChangeAsync,
        onCommit: onValueCommitAsync,
        throttleMs: asyncThrottleMs,
      });
      asyncQueueRef.current = queue;
      return () => {
        queue.cancel();
      };
    }, [asyncThrottleMs, onValueChangeAsync, onValueCommitAsync]);

    const resolveValue = React.useCallback(
      (rawValue: number) => {
        const clamped = normalizeSliderValue(rawValue, min, max);
        if (!normalizedMidpoint || normalizedMidpoint.cling === false) return clamped;
        return resolveMidpointSnap({
          value: clamped,
          min,
          max,
          midpoint: normalizedMidpoint.value,
          snapRange: normalizedMidpoint.snapRange,
          step,
        });
      },
      [max, min, normalizedMidpoint, step],
    );

    const handlePointerDown = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        registerPopupInteraction("interaction-start");
        onPointerDown?.(event);
      },
      [onPointerDown, registerPopupInteraction],
    );

    const handlePointerUp = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        registerPopupInteraction("interaction-end");
        onPointerUp?.(event);
      },
      [onPointerUp, registerPopupInteraction],
    );

    const handlePointerCancel = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        registerPopupInteraction("interaction-end");
        onPointerCancel?.(event);
      },
      [onPointerCancel, registerPopupInteraction],
    );

    const handleValueChange = React.useCallback(
      (values: number[]) => {
        const rawValue = values[0] ?? min;
        const nextValue = resolveValue(rawValue);
        setDragValue(nextValue);
        registerPopupInteraction("interaction-update");
        if (normalizedMidpoint && normalizedMidpoint.haptics !== false) {
          const now = Date.now();
          if (
            shouldTriggerMidpointHaptic({
              previous: lastValueRef.current,
              next: nextValue,
              midpoint: normalizedMidpoint.value,
              nowMs: now,
              lastTriggerMs: lastHapticAtRef.current,
            })
          ) {
            lastHapticAtRef.current = now;
            void triggerSliderHaptic();
          }
        }
        lastValueRef.current = nextValue;
        onValueChange?.([nextValue]);
        asyncQueueRef.current?.schedule(nextValue);
      },
      [min, normalizedMidpoint, onValueChange, registerPopupInteraction, resolveValue],
    );

    const handleValueCommit = React.useCallback(
      (values: number[]) => {
        const rawValue = values[0] ?? min;
        const nextValue = resolveValue(rawValue);
        setDragValue(null);
        registerPopupInteraction("interaction-end");
        lastValueRef.current = nextValue;
        onValueCommit?.([nextValue]);
        asyncQueueRef.current?.commit(nextValue);
      },
      [min, onValueCommit, registerPopupInteraction, resolveValue],
    );

    const tracedChange = React.useMemo(
      () => wrapValueChange(handleValueChange, "slide", "Slider", props, "Slider"),
      [handleValueChange, props],
    );
    const tracedCommit = React.useMemo(
      () => wrapValueChange(handleValueCommit, "slide", "Slider", props, "Slider"),
      [handleValueCommit, props],
    );

    const fallbackValue = normalizedDefaultValue?.[0] ?? min;
    const currentValue = normalizedValue?.[0] ?? normalizeSliderValue(dragValue ?? fallbackValue, min, max);
    const displayValue = normalizeSliderValue(dragValue ?? currentValue, min, max);
    const formattedValue = valueFormatter ? valueFormatter(displayValue) : `${displayValue}`;
    const showValue = showValueOnDrag && popupState !== "Hidden";
    const midpointPercent = normalizedMidpoint ? resolveMidpointPercent(normalizedMidpoint.value, min, max) : null;

    return (
      <SliderPrimitive.Root
        ref={ref}
        onValueChange={tracedChange}
        onValueCommit={tracedCommit}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className={cn("relative flex w-full touch-none select-none items-center", className)}
        {...props}
        min={min}
        max={max}
        value={normalizedValue}
        defaultValue={normalizedDefaultValue}
      >
        <SliderPrimitive.Track
          className={cn("relative h-2 w-full grow overflow-hidden rounded-full bg-secondary", trackClassName)}
          style={trackStyle}
        >
          <SliderPrimitive.Range className={cn("absolute h-full bg-primary", rangeClassName)} style={rangeStyle} />
          {normalizedMidpoint && normalizedMidpoint.notch !== false && midpointPercent !== null ? (
            <span
              aria-hidden="true"
              className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-foreground/40"
              style={{ left: `${midpointPercent}%` }}
            />
          ) : null}
        </SliderPrimitive.Track>
        {showValue ? (
          <div
            data-testid="slider-value-display"
            className={cn(
              "pointer-events-none absolute -top-7 text-[11px] font-semibold text-foreground transition-opacity duration-150 opacity-100",
              valueLabelClassName,
            )}
            style={{
              left: `${resolveMidpointPercent(displayValue, min, max)}%`,
              transform: "translateX(-50%)",
            }}
          >
            {formattedValue}
          </div>
        ) : null}
        <SliderPrimitive.Thumb
          className={cn(
            "block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
            thumbClassName,
          )}
        />
      </SliderPrimitive.Root>
    );
  },
);
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
