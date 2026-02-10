/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";
import { wrapValueChange } from "@/lib/tracing/userTrace";
import {
  clampSliderValue,
  createSliderAsyncQueue,
  resolveMidpointPercent,
  resolveMidpointSnap,
  shouldTriggerMidpointHaptic,
  type SliderAsyncQueue,
} from "@/lib/ui/sliderBehavior";
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

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(
  (
    {
      className,
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
    const min = props.min ?? 0;
    const max = props.max ?? 100;
    const step = props.step;
    const [dragValue, setDragValue] = React.useState<number | null>(null);
    const [valueVisible, setValueVisible] = React.useState(false);
    const lastValueRef = React.useRef<number | null>(null);
    const lastHapticAtRef = React.useRef<number | null>(null);
    const asyncQueueRef = React.useRef<SliderAsyncQueue | null>(null);

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

    const resolveValue = React.useCallback((rawValue: number) => {
      const clamped = clampSliderValue(rawValue, min, max);
      if (!midpoint || midpoint.cling === false) return clamped;
      return resolveMidpointSnap({
        value: clamped,
        min,
        max,
        midpoint: midpoint.value,
        snapRange: midpoint.snapRange,
        step,
      });
    }, [max, min, midpoint, step]);

    const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      if (showValueOnDrag) setValueVisible(true);
      onPointerDown?.(event);
    }, [onPointerDown, showValueOnDrag]);

    const handlePointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      if (showValueOnDrag) setValueVisible(false);
      onPointerUp?.(event);
    }, [onPointerUp, showValueOnDrag]);

    const handlePointerCancel = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      if (showValueOnDrag) setValueVisible(false);
      onPointerCancel?.(event);
    }, [onPointerCancel, showValueOnDrag]);

    const handleValueChange = React.useCallback((values: number[]) => {
      const rawValue = values[0] ?? min;
      const nextValue = resolveValue(rawValue);
      setDragValue(nextValue);
      if (showValueOnDrag) setValueVisible(true);
      if (midpoint?.haptics !== false && midpoint) {
        const now = Date.now();
        if (shouldTriggerMidpointHaptic({
          previous: lastValueRef.current,
          next: nextValue,
          midpoint: midpoint.value,
          nowMs: now,
          lastTriggerMs: lastHapticAtRef.current,
        })) {
          lastHapticAtRef.current = now;
          void triggerSliderHaptic();
        }
      }
      lastValueRef.current = nextValue;
      onValueChange?.([nextValue]);
      asyncQueueRef.current?.schedule(nextValue);
    }, [midpoint, min, onValueChange, resolveValue, showValueOnDrag]);

    const handleValueCommit = React.useCallback((values: number[]) => {
      const rawValue = values[0] ?? min;
      const nextValue = resolveValue(rawValue);
      setDragValue(null);
      if (showValueOnDrag) setValueVisible(false);
      lastValueRef.current = nextValue;
      onValueCommit?.([nextValue]);
      asyncQueueRef.current?.commit(nextValue);
    }, [min, onValueCommit, resolveValue, showValueOnDrag]);

    const tracedChange = React.useMemo(
      () => wrapValueChange(handleValueChange, 'slide', 'Slider', props, 'Slider'),
      [handleValueChange, props],
    );
    const tracedCommit = React.useMemo(
      () => wrapValueChange(handleValueCommit, 'slide', 'Slider', props, 'Slider'),
      [handleValueCommit, props],
    );

    const currentValue = (props.value?.[0] ?? dragValue ?? props.defaultValue?.[0] ?? min);
    const displayValue = dragValue ?? currentValue;
    const formattedValue = valueFormatter ? valueFormatter(displayValue) : `${displayValue}`;
    const showValue = showValueOnDrag && valueVisible;
    const midpointPercent = midpoint ? resolveMidpointPercent(midpoint.value, min, max) : null;

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
      >
        <SliderPrimitive.Track
          className={cn("relative h-2 w-full grow overflow-hidden rounded-full bg-secondary", trackClassName)}
          style={trackStyle}
        >
          <SliderPrimitive.Range
            className={cn("absolute h-full bg-primary", rangeClassName)}
            style={rangeStyle}
          />
          {midpoint && midpoint.notch !== false && midpointPercent !== null ? (
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
            style={{ left: `${resolveMidpointPercent(displayValue, min, max)}%`, transform: 'translateX(-50%)' }}
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
