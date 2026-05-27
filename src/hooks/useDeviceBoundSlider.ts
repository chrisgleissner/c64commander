/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSavedDevices } from "@/hooks/useSavedDevices";
import { APP_SETTINGS_KEYS, loadVolumeSliderPreviewIntervalMs } from "@/lib/config/appSettings";
import { pollingPauseRegistry, type PollingPauseHandle } from "@/lib/query/c64PollingGovernance";
import { clampSliderValue } from "@/lib/ui/sliderBehavior";
import { addLog } from "@/lib/logging";

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
  debugName?: string;
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
const POLLING_PAUSE_TAIL_GRACE_MS = 250;

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";

export function useDeviceBoundSlider<T extends SliderDomainValue>({
  debugName = "device-bound-slider",
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
  const { selectedDeviceId } = useSavedDevices();
  const [draftSliderValue, setDraftSliderValue] = useState<number | null>(null);
  const draftSliderValueRef = useRef<number | null>(null);
  const [pendingIntent, setPendingIntent] = useState<PendingIntent<T> | null>(null);
  const [defaultPreviewThrottleMs, setDefaultPreviewThrottleMs] = useState(() => loadVolumeSliderPreviewIntervalMs());
  const isDraggingRef = useRef(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPreviewSliderValueRef = useRef<number | null>(null);
  const previewInFlightRef = useRef(false);
  const previewGenerationRef = useRef(0);
  const lastPreviewSentAtRef = useRef<number | null>(null);
  const lastIgnoredDeviceValueRef = useRef<string | null>(null);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseTailGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Drives/info polling pauses while the user is dragging or while we are
  // waiting for the device to echo back the committed value. Pause is
  // released on commit + reconciliation settle (or on watchdog expiry, or
  // on commit error).
  const pollingPauseHandleRef = useRef<PollingPauseHandle | null>(null);

  const acquirePollingPauseIfNeeded = useCallback(() => {
    if (pollingPauseHandleRef.current) return;
    pollingPauseHandleRef.current = pollingPauseRegistry.acquirePause();
  }, []);

  const releasePollingPause = useCallback(() => {
    pollingPauseHandleRef.current?.release();
    pollingPauseHandleRef.current = null;
  }, []);

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

  const clearPauseTailGraceTimer = useCallback(() => {
    if (pauseTailGraceTimerRef.current !== null) {
      clearTimeout(pauseTailGraceTimerRef.current);
      pauseTailGraceTimerRef.current = null;
    }
  }, []);

  const flushPreview = useCallback(
    (sliderValue: number) => {
      if (previewMode !== "throttled" || !preview) {
        return;
      }
      const clampedSliderValue = domain.clampSliderValue(sliderValue);
      if (previewInFlightRef.current) {
        pendingPreviewSliderValueRef.current = clampedSliderValue;
        addLog("debug", "Device-bound slider coalesced write", {
          slider: debugName,
          phase: "preview",
          supersededBySliderValue: clampedSliderValue,
          priority: "user",
          coalescing: "throttled-latest",
        });
        return;
      }
      const nextValue = domain.fromSliderValue(clampedSliderValue);
      const generation = previewGenerationRef.current;
      previewInFlightRef.current = true;
      lastPreviewSentAtRef.current = Date.now();
      pendingPreviewSliderValueRef.current = null;
      addLog("debug", "Device-bound slider queued write", {
        slider: debugName,
        phase: "preview",
        value: nextValue,
        sliderValue: clampedSliderValue,
        priority: "user",
        coalescing: "throttled-latest",
      });
      const handlePreviewError = (error: unknown) => {
        if (previewGenerationRef.current !== generation) {
          return;
        }
        setDraftSliderValue(null);
        onError?.(error, {
          phase: "preview",
          value: nextValue,
        });
      };
      const finishPreview = () => {
        if (previewGenerationRef.current !== generation) {
          return;
        }
        previewInFlightRef.current = false;
        const trailingSliderValue = pendingPreviewSliderValueRef.current;
        if (trailingSliderValue !== null) {
          const now = Date.now();
          const lastSentAt = lastPreviewSentAtRef.current;
          if (lastSentAt === null || now - lastSentAt >= resolvedPreviewThrottleMs) {
            flushPreview(trailingSliderValue);
            return;
          }
          if (previewTimerRef.current === null) {
            previewTimerRef.current = setTimeout(
              () => {
                previewTimerRef.current = null;
                const nextSliderValue = pendingPreviewSliderValueRef.current;
                if (nextSliderValue !== null) {
                  flushPreview(nextSliderValue);
                }
              },
              Math.max(0, resolvedPreviewThrottleMs - (now - lastSentAt)),
            );
          }
        }
      };
      try {
        const result = preview(nextValue);
        if (isPromiseLike(result)) {
          void Promise.resolve(result).catch(handlePreviewError).finally(finishPreview);
          return;
        }
        finishPreview();
      } catch (error) {
        handlePreviewError(error);
        finishPreview();
      }
    },
    [debugName, domain, onError, preview, previewMode, resolvedPreviewThrottleMs],
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
        addLog("debug", "Device-bound slider coalesced write", {
          slider: debugName,
          phase: "preview",
          supersededBySliderValue: clampedSliderValue,
          priority: "user",
          coalescing: "throttled-latest",
        });
        return;
      }

      const delayMs = Math.max(0, resolvedPreviewThrottleMs - (now - lastSentAt));
      addLog("debug", "Device-bound slider write delayed", {
        slider: debugName,
        phase: "preview",
        delayMs,
        priority: "user",
        coalescing: "throttled-latest",
      });
      previewTimerRef.current = setTimeout(() => {
        previewTimerRef.current = null;
        const nextSliderValue = pendingPreviewSliderValueRef.current;
        if (nextSliderValue === null) {
          return;
        }
        flushPreview(nextSliderValue);
      }, delayMs);
    },
    [clearPreviewTimer, debugName, domain, flushPreview, preview, previewMode, resolvedPreviewThrottleMs],
  );

  const armWatchdog = useCallback(() => {
    clearWatchdogTimer();
    watchdogTimerRef.current = setTimeout(() => {
      clearWatchdogTimer();
      clearPauseTailGraceTimer();
      releasePollingPause();
    }, watchdogMs);
  }, [clearPauseTailGraceTimer, clearWatchdogTimer, releasePollingPause, watchdogMs]);

  const schedulePollingPauseRelease = useCallback(() => {
    clearPauseTailGraceTimer();
    pauseTailGraceTimerRef.current = setTimeout(() => {
      pauseTailGraceTimerRef.current = null;
      releasePollingPause();
    }, POLLING_PAUSE_TAIL_GRACE_MS);
  }, [clearPauseTailGraceTimer, releasePollingPause]);

  const clearLatchedState = useCallback(() => {
    previewGenerationRef.current += 1;
    previewInFlightRef.current = false;
    isDraggingRef.current = false;
    draftSliderValueRef.current = null;
    setDraftSliderValue(null);
    setPendingIntent(null);
    clearPreviewTimer();
    clearWatchdogTimer();
    clearPauseTailGraceTimer();
    pendingPreviewSliderValueRef.current = null;
    lastPreviewSentAtRef.current = null;
    releasePollingPause();
  }, [clearPauseTailGraceTimer, clearPreviewTimer, clearWatchdogTimer, releasePollingPause]);

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
      addLog("debug", "Device-bound slider latest intent confirmed", {
        slider: debugName,
        value: pendingIntent.value,
        sliderValue: pendingIntent.sliderValue,
      });
      setPendingIntent(null);
      clearWatchdogTimer();
      lastIgnoredDeviceValueRef.current = null;
      return;
    }
    if (pendingIntent) {
      const ignoredSignature = `${String(deviceValue)}->${String(pendingIntent.value)}`;
      if (lastIgnoredDeviceValueRef.current !== ignoredSignature) {
        lastIgnoredDeviceValueRef.current = ignoredSignature;
        addLog("debug", "Device-bound slider stale device value ignored", {
          slider: debugName,
          deviceValue,
          pendingValue: pendingIntent.value,
          pendingSliderValue: pendingIntent.sliderValue,
        });
      }
    }
  }, [clearWatchdogTimer, debugName, deviceValue, equals, pendingIntent]);

  const didMountResetBoundaryRef = useRef(false);

  useEffect(() => {
    if (!didMountResetBoundaryRef.current) {
      didMountResetBoundaryRef.current = true;
      return;
    }

    clearLatchedState();
  }, [clearLatchedState, selectedDeviceId]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearLatchedState();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", clearLatchedState);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", clearLatchedState);
    };
  }, [clearLatchedState]);

  useEffect(() => {
    return () => {
      clearPreviewTimer();
      clearWatchdogTimer();
      clearPauseTailGraceTimer();
      pendingPreviewSliderValueRef.current = null;
      lastPreviewSentAtRef.current = null;
      releasePollingPause();
    };
  }, [clearPauseTailGraceTimer, clearPreviewTimer, clearWatchdogTimer, releasePollingPause]);

  const onValueChange = useCallback(
    (values: number[]) => {
      if (values.length === 0 || !Number.isFinite(values[0])) {
        return;
      }
      const nextSliderValue = domain.clampSliderValue(values[0] ?? deviceSliderValue);
      const nextValue = domain.fromSliderValue(nextSliderValue);
      addLog("debug", "Device-bound slider local intent changed", {
        slider: debugName,
        value: nextValue,
        sliderValue: nextSliderValue,
        priority: "user",
      });
      // First drag tick: pause drives/info polling so the round-trip noise
      // does not steal frames from the slider preview.
      if (!isDraggingRef.current) {
        clearPauseTailGraceTimer();
        acquirePollingPauseIfNeeded();
      }
      isDraggingRef.current = true;
      draftSliderValueRef.current = nextSliderValue;
      setDraftSliderValue(nextSliderValue);
      onDraftChange?.(nextValue);
      schedulePreview(nextSliderValue);
    },
    [
      acquirePollingPauseIfNeeded,
      clearPauseTailGraceTimer,
      debugName,
      deviceSliderValue,
      domain,
      onDraftChange,
      schedulePreview,
    ],
  );

  const onValueCommit = useCallback(
    (values: number[]) => {
      if (values.length === 0 || !Number.isFinite(values[0])) {
        return;
      }
      const nextSliderValue = domain.clampSliderValue(draftSliderValueRef.current ?? values[0] ?? deviceSliderValue);
      const nextValue = domain.fromSliderValue(nextSliderValue);
      addLog("debug", "Device-bound slider final intent committed", {
        slider: debugName,
        value: nextValue,
        sliderValue: nextSliderValue,
        priority: "user",
      });
      isDraggingRef.current = false;
      previewGenerationRef.current += 1;
      clearPreviewTimer();
      pendingPreviewSliderValueRef.current = null;
      previewInFlightRef.current = false;
      lastPreviewSentAtRef.current = null;
      draftSliderValueRef.current = null;
      setDraftSliderValue(null);
      if (equals(deviceValue, nextValue)) {
        clearLatchedState();
        return;
      }
      setPendingIntent({
        sliderValue: nextSliderValue,
        value: nextValue,
      });
      addLog("debug", "Device-bound slider queued write", {
        slider: debugName,
        phase: "commit",
        value: nextValue,
        sliderValue: nextSliderValue,
        priority: "user",
        coalescing: "latest-intent",
      });
      armWatchdog();
      void Promise.resolve(commit(nextValue))
        .then(() => {
          schedulePollingPauseRelease();
        })
        .catch((error) => {
          clearLatchedState();
          onError?.(error, {
            phase: "commit",
            value: nextValue,
          });
        });
    },
    [
      armWatchdog,
      clearLatchedState,
      clearPreviewTimer,
      commit,
      debugName,
      deviceSliderValue,
      deviceValue,
      domain,
      equals,
      onError,
      schedulePollingPauseRelease,
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
