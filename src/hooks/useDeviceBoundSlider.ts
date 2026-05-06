/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP_SETTINGS_KEYS, loadVolumeSliderPreviewIntervalMs } from "@/lib/config/appSettings";
import { clampSliderValue } from "@/lib/ui/sliderBehavior";

type SliderDomainValue = string | number;

export type DeviceBoundSliderDomain<T extends SliderDomainValue> = {
  toSliderValue: (value: T) => number;
  fromSliderValue: (sliderValue: number) => T;
  clampSliderValue: (sliderValue: number) => number;
  equals?: (left: T, right: T) => boolean;
};

export type DeviceBoundSliderPreviewMode = "commitOnly" | "throttled";

type WritePhase = "preview" | "commit";

type UseDeviceBoundSliderOptions<T extends SliderDomainValue> = {
  deviceValue: T;
  domain: DeviceBoundSliderDomain<T>;
  previewMode: DeviceBoundSliderPreviewMode;
  commit: (value: T) => Promise<void> | void;
  preview?: (value: T) => Promise<void> | void;
  onDraftChange?: (value: T) => void;
  previewThrottleMs?: number;
  watchdogMs?: number;
  onError?: (error: unknown, context: { phase: WritePhase; value: T }) => void;
};

type PendingIntent<T extends SliderDomainValue> = {
  sliderValue: number;
  value: T;
};

const parseComparableNumber = (value: SliderDomainValue) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
};

export const areDeviceBoundSliderValuesEqual = <T extends SliderDomainValue>(left: T, right: T) => {
  const leftNumber = parseComparableNumber(left);
  const rightNumber = parseComparableNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    return Object.is(leftNumber, rightNumber);
  }
  return String(left).trim() === String(right).trim();
};

export const createIndexedSliderDomain = <T extends SliderDomainValue>(
  values: readonly T[],
): DeviceBoundSliderDomain<T> => {
  const maxIndex = Math.max(values.length - 1, 0);
  const resolveIndex = (value: T) => {
    const exactIndex = values.findIndex((entry) => Object.is(entry, value));
    if (exactIndex >= 0) {
      return exactIndex;
    }
    const comparableIndex = values.findIndex((entry) => areDeviceBoundSliderValuesEqual(entry, value));
    return comparableIndex >= 0 ? comparableIndex : 0;
  };

  return {
    toSliderValue: (value) => resolveIndex(value),
    fromSliderValue: (sliderValue) => values[clampSliderValue(Math.round(sliderValue), 0, maxIndex)] ?? values[0],
    clampSliderValue: (sliderValue) => clampSliderValue(Math.round(sliderValue), 0, maxIndex),
    equals: areDeviceBoundSliderValuesEqual,
  };
};

export const createNumericSliderDomain = (params: {
  min: number;
  max: number;
  round?: (value: number) => number;
}): DeviceBoundSliderDomain<number> => {
  const normalize = (value: number) => {
    const rounded = params.round ? params.round(value) : value;
    return clampSliderValue(rounded, params.min, params.max);
  };

  return {
    toSliderValue: (value) => normalize(value),
    fromSliderValue: (sliderValue) => normalize(sliderValue),
    clampSliderValue: (sliderValue) => normalize(sliderValue),
    equals: areDeviceBoundSliderValuesEqual,
  };
};

const DEFAULT_WATCHDOG_MS = 2000;

export function useDeviceBoundSlider<T extends SliderDomainValue>({
  deviceValue,
  domain,
  previewMode,
  commit,
  preview,
  onDraftChange,
  previewThrottleMs,
  watchdogMs = DEFAULT_WATCHDOG_MS,
  onError,
}: UseDeviceBoundSliderOptions<T>) {
  const [draftSliderValue, setDraftSliderValue] = useState<number | null>(null);
  const [pendingIntent, setPendingIntent] = useState<PendingIntent<T> | null>(null);
  const [defaultPreviewThrottleMs, setDefaultPreviewThrottleMs] = useState(() => loadVolumeSliderPreviewIntervalMs());
  const isDraggingRef = useRef(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPreviewSliderValueRef = useRef<number | null>(null);
  const lastPreviewSentAtRef = useRef<number | null>(null);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const equals = domain.equals ?? areDeviceBoundSliderValuesEqual;
  const deviceSliderValue = useMemo(
    () => domain.clampSliderValue(domain.toSliderValue(deviceValue)),
    [deviceValue, domain],
  );
  const resolvedPreviewThrottleMs = previewThrottleMs ?? defaultPreviewThrottleMs;

  const clearPreviewTimer = useCallback(() => {
    if (previewTimerRef.current !== null) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }, []);

  const clearWatchdogTimer = useCallback(() => {
    if (watchdogTimerRef.current !== null) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  }, []);

  const flushPreview = useCallback(
    (sliderValue: number) => {
      if (previewMode !== "throttled" || !preview) {
        return;
      }
      const clampedSliderValue = domain.clampSliderValue(sliderValue);
      const nextValue = domain.fromSliderValue(clampedSliderValue);
      lastPreviewSentAtRef.current = Date.now();
      pendingPreviewSliderValueRef.current = null;
      void Promise.resolve(preview(nextValue)).catch((error) => {
        setDraftSliderValue(null);
        onError?.(error, {
          phase: "preview",
          value: nextValue,
        });
      });
    },
    [domain, onError, preview, previewMode],
  );

  const schedulePreview = useCallback(
    (sliderValue: number) => {
      if (previewMode !== "throttled" || !preview) {
        return;
      }

      const clampedSliderValue = domain.clampSliderValue(sliderValue);
      pendingPreviewSliderValueRef.current = clampedSliderValue;
      const now = Date.now();
      const lastSentAt = lastPreviewSentAtRef.current;
      if (lastSentAt === null || now - lastSentAt >= resolvedPreviewThrottleMs) {
        clearPreviewTimer();
        flushPreview(clampedSliderValue);
        return;
      }

      if (previewTimerRef.current !== null) {
        return;
      }

      const delayMs = Math.max(0, resolvedPreviewThrottleMs - (now - lastSentAt));
      previewTimerRef.current = setTimeout(() => {
        previewTimerRef.current = null;
        const nextSliderValue = pendingPreviewSliderValueRef.current;
        if (nextSliderValue === null) {
          return;
        }
        flushPreview(nextSliderValue);
      }, delayMs);
    },
    [clearPreviewTimer, domain, flushPreview, preview, previewMode, resolvedPreviewThrottleMs],
  );

  const armWatchdog = useCallback(() => {
    clearWatchdogTimer();
    watchdogTimerRef.current = setTimeout(() => {
      setDraftSliderValue(null);
      setPendingIntent(null);
      clearWatchdogTimer();
    }, watchdogMs);
  }, [clearWatchdogTimer, watchdogMs]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { key?: string } | undefined;
      if (detail?.key !== APP_SETTINGS_KEYS.VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY) return;
      setDefaultPreviewThrottleMs(loadVolumeSliderPreviewIntervalMs());
    };

    window.addEventListener("c64u-app-settings-updated", handler as EventListener);
    return () => window.removeEventListener("c64u-app-settings-updated", handler as EventListener);
  }, []);

  useEffect(() => {
    if (pendingIntent && equals(deviceValue, pendingIntent.value)) {
      setPendingIntent(null);
      clearWatchdogTimer();
    }
  }, [clearWatchdogTimer, deviceValue, equals, pendingIntent]);

  useEffect(() => {
    return () => {
      clearPreviewTimer();
      clearWatchdogTimer();
    };
  }, [clearPreviewTimer, clearWatchdogTimer]);

  const onValueChange = useCallback(
    (values: number[]) => {
      if (values.length === 0 || !Number.isFinite(values[0])) {
        return;
      }
      const nextSliderValue = domain.clampSliderValue(values[0] ?? deviceSliderValue);
      const nextValue = domain.fromSliderValue(nextSliderValue);
      isDraggingRef.current = true;
      setDraftSliderValue(nextSliderValue);
      onDraftChange?.(nextValue);
      schedulePreview(nextSliderValue);
    },
    [deviceSliderValue, domain, onDraftChange, schedulePreview],
  );

  const onValueCommit = useCallback(
    (values: number[]) => {
      if (values.length === 0 || !Number.isFinite(values[0])) {
        return;
      }
      const nextSliderValue = domain.clampSliderValue(values[0] ?? deviceSliderValue);
      const nextValue = domain.fromSliderValue(nextSliderValue);
      isDraggingRef.current = false;
      clearPreviewTimer();
      pendingPreviewSliderValueRef.current = null;
      lastPreviewSentAtRef.current = null;
      setDraftSliderValue(null);
      if (equals(deviceValue, nextValue)) {
        clearWatchdogTimer();
        setPendingIntent(null);
        return;
      }
      setPendingIntent({
        sliderValue: nextSliderValue,
        value: nextValue,
      });
      armWatchdog();
      void Promise.resolve(commit(nextValue)).catch((error) => {
        clearWatchdogTimer();
        setDraftSliderValue(null);
        setPendingIntent(null);
        onError?.(error, {
          phase: "commit",
          value: nextValue,
        });
      });
    },
    [
      armWatchdog,
      clearPreviewTimer,
      clearWatchdogTimer,
      commit,
      deviceSliderValue,
      deviceValue,
      domain,
      equals,
      onError,
    ],
  );

  const sliderValue = draftSliderValue ?? pendingIntent?.sliderValue ?? deviceSliderValue;
  const displayValue = useMemo(() => domain.fromSliderValue(sliderValue), [domain, sliderValue]);

  return {
    sliderValue,
    displayValue,
    isAwaitingReconciliation: pendingIntent !== null,
    onValueChange,
    onValueCommit,
  };
}
