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
import { useFocusItem, useFocusNavigationContext } from "@/hooks/useFocusNavigation";
import { normalizeKeyEvent, setInputModality } from "@/lib/input";
import { emitUiTraceMarker, wrapValueChange } from "@/lib/tracing/userTrace";
import {
  clampSliderValue,
  resolveMidpointPercent,
  resolveMidpointSnap,
  shouldTriggerMidpointHaptic,
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
  nativeInputMode?: "none" | "overlay";
  nativeInputAriaLabel?: string;
  nativeInputTestId?: string;
  nativeInputClassName?: string;
  /**
   * When set, registers this slider's thumb into the keypad focus ring (the
   * `keypad_input_enabled` feature) so it is reachable by d-pad traversal. Inert
   * unless the feature flag is on; the thumb is already `tabIndex=0` today, so
   * registration adds NO new affordance (Prime Directive states 1–2).
   */
  keypadFocusId?: string;
  /** Lower sorts earlier in keypad d-pad traversal. Defaults to 0. */
  keypadFocusOrder?: number;
  keypadFocusGroup?: string;
  keypadFocusParentId?: string;
  /** Force the ring to skip this slider (in addition to `disabled`). */
  keypadFocusDisabled?: boolean;
};

/**
 * Debounce window for coalescing a key-repeat burst into a SINGLE device write.
 * Each Left/Right press updates the draft (label + aria-valuenow) immediately;
 * the commit (the device write) fires once the burst settles, mirroring a drag
 * release — so repeated presses never bypass the `useDeviceBoundSlider` throttle.
 */
export const SLIDER_KEY_COMMIT_DEBOUNCE_MS = 400;

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
      thumbClassName,
      trackClassName,
      rangeClassName,
      trackStyle,
      rangeStyle,
      valueFormatter,
      valueLabelClassName,
      showValueOnDrag = true,
      midpoint,
      nativeInputMode = "none",
      nativeInputAriaLabel,
      nativeInputTestId,
      nativeInputClassName,
      keypadFocusId,
      keypadFocusOrder = 0,
      keypadFocusGroup,
      keypadFocusParentId,
      keypadFocusDisabled,
      onPointerDown,
      onPointerUp,
      onPointerCancel,
      onBlur,
      onKeyDown,
      ...props
    },
    ref,
  ) => {
    const min: number = Number.isFinite(props.min) ? (props.min as number) : 0;
    const resolvedMax: number = Number.isFinite(props.max) ? Math.max(props.max as number, min) : Math.max(min, 100);
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
    // Keypad focus-ring participation (HAZARD 1). `keypadActive` is false unless a
    // `keypadFocusId` is set AND the feature flag is on, so everything below is
    // inert at baseline. The thumb (registered element) is already `tabIndex=0`,
    // so registration adds no new affordance.
    const focusNav = useFocusNavigationContext();
    const keypadActive = Boolean(keypadFocusId) && Boolean(focusNav?.enabled);
    const keypadThumbRef = useFocusItem<HTMLSpanElement>({
      id: keypadFocusId ?? "",
      order: keypadFocusOrder,
      group: keypadFocusGroup,
      parentId: keypadFocusParentId,
      disabled: Boolean(props.disabled) || Boolean(keypadFocusDisabled),
    });
    // Key-driven horizontal stepping coalesces a burst into ONE commit (device
    // write) via this debounce, reusing the existing onValueChange/onValueCommit
    // throttle path — no separate key-repeat write lane.
    const keyCommitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const keyDraftRef = React.useRef<number | null>(null);
    const clearKeyCommitTimer = React.useCallback(() => {
      if (keyCommitTimerRef.current === null) return;
      clearTimeout(keyCommitTimerRef.current);
      keyCommitTimerRef.current = null;
    }, []);
    // Stable handle to `flushKeyCommit` (defined below) so the earlier
    // `handlePointerDown` can flush a pending key-driven value without a forward
    // reference. Assigned during render after `flushKeyCommit` exists.
    const flushKeyCommitRef = React.useRef<() => void>(() => {});

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
        // A pointer interaction supersedes any in-flight key-driven step. FLUSH the
        // pending key commit first (so a value adjusted by Left/Right just before
        // the touch is committed, not silently dropped — e.g. a thumb tap with no
        // drag); the pointer's own change/commit then becomes authoritative. (The
        // global capture listener flips modality to pointer + clears the highlight.)
        flushKeyCommitRef.current();
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
    const handleNativeInput = React.useCallback(
      (event: React.FormEvent<HTMLInputElement>) => {
        const nextValue = Number(event.currentTarget.value);
        if (!Number.isFinite(nextValue)) return;
        handleValueChange([nextValue]);
      },
      [handleValueChange],
    );
    const handleNativeChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const nextValue = Number(event.currentTarget.value);
        if (!Number.isFinite(nextValue)) return;
        handleValueCommit([nextValue]);
      },
      [handleValueCommit],
    );
    const fallbackValue = normalizedDefaultValue?.[0] ?? min;
    const currentValue = normalizedValue?.[0] ?? normalizeSliderValue(dragValue ?? fallbackValue, min, max);
    const displayValue = normalizeSliderValue(dragValue ?? currentValue, min, max);
    const formattedValue = valueFormatter ? valueFormatter(displayValue) : `${displayValue}`;
    const showValue = showValueOnDrag && popupState !== "Hidden";
    const midpointPercent = normalizedMidpoint ? resolveMidpointPercent(normalizedMidpoint.value, min, max) : null;
    const handleNativeBlur = React.useCallback(() => {
      if (dragValue === null) return;
      handleValueCommit([displayValue]);
    }, [displayValue, dragValue, handleValueCommit]);
    const handleBlur = React.useCallback(
      (event: React.FocusEvent<HTMLSpanElement>) => {
        if (dragValue !== null) {
          handleValueCommit([displayValue]);
        }
        onBlur?.(event);
      },
      [displayValue, dragValue, handleValueCommit, onBlur],
    );
    const flushKeyCommit = React.useCallback(() => {
      clearKeyCommitTimer();
      const pending = keyDraftRef.current;
      keyDraftRef.current = null;
      if (pending !== null) {
        handleValueCommit([pending]);
      }
    }, [clearKeyCommitTimer, handleValueCommit]);
    flushKeyCommitRef.current = flushKeyCommit;

    const scheduleKeyCommit = React.useCallback(
      (nextValue: number) => {
        keyDraftRef.current = nextValue;
        clearKeyCommitTimer();
        keyCommitTimerRef.current = setTimeout(() => {
          keyCommitTimerRef.current = null;
          flushKeyCommit();
        }, SLIDER_KEY_COMMIT_DEBOUNCE_MS);
      },
      [clearKeyCommitTimer, flushKeyCommit],
    );

    const handleKeypadKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLSpanElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (!keypadActive || !focusNav || props.disabled) return;
        const { action } = normalizeKeyEvent(event, focusNav.keymap);
        if (action === "dpadUp" || action === "dpadDown") {
          // Suppress Radix's value step on Up/Down (composeEventHandlers skips its
          // internal handler once we preventDefault); the global handler still
          // moves focus (Up/Down → focusPrevious/Next). Value-only ⊥ focus-only.
          event.preventDefault();
          flushKeyCommit();
          return;
        }
        if (action === "dpadLeft" || action === "dpadRight") {
          const stepSize = Number.isFinite(step) && step ? (step as number) : 1;
          const base = keyDraftRef.current ?? displayValue;
          const direction = action === "dpadRight" ? 1 : -1;
          const next = normalizeSliderValue(base + direction * stepSize, min, max);
          if (next === base) return; // at the edge → no effect → don't preventDefault / flip modality
          event.preventDefault(); // we own horizontal stepping; routes through onValueChange/Commit
          keyDraftRef.current = next;
          setInputModality("key-navigation");
          handleValueChange([next]); // draft + popup + consumer onValueChange (label + aria-valuenow)
          scheduleKeyCommit(next); // one coalesced commit per burst
        }
      },
      [
        displayValue,
        flushKeyCommit,
        focusNav,
        handleValueChange,
        keypadActive,
        max,
        min,
        onKeyDown,
        props.disabled,
        scheduleKeyCommit,
        step,
      ],
    );

    React.useEffect(() => () => clearKeyCommitTimer(), [clearKeyCommitTimer]);

    return (
      <SliderPrimitive.Root
        ref={ref}
        onValueChange={tracedChange}
        onValueCommit={tracedCommit}
        onBlur={handleBlur}
        onKeyDown={handleKeypadKeyDown}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className={cn("relative flex w-full touch-none select-none items-center", className)}
        data-swipe-exclude="true"
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
        {nativeInputMode === "overlay" ? (
          <input
            type="range"
            min={min}
            max={max}
            step={Number.isFinite(step) && step ? step : 1}
            value={displayValue}
            onInput={handleNativeInput}
            onChange={handleNativeChange}
            onBlur={handleNativeBlur}
            aria-label={nativeInputAriaLabel}
            data-testid={nativeInputTestId}
            disabled={props.disabled}
            className={cn(
              "absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0",
              nativeInputClassName,
            )}
          />
        ) : null}
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
          ref={keypadThumbRef}
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
