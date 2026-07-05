/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { createIndexedSliderDomain, useDeviceBoundSlider } from "@/hooks/useDeviceBoundSlider";
import { useInteractiveConfigWrite } from "@/hooks/useInteractiveConfigWrite";
import { logger } from "@/lib/diagnostics/logger";
import { addLog, buildErrorLogDetails } from "@/lib/logging";
import { isSmokeModeEnabled } from "@/lib/smoke/smokeMode";
import { createHomeCpuSpeedSliderProbeSnapshot, formatHomeCpuSpeedSliderProbe } from "./homeCpuSpeedSliderProbe";
import { resolveTurboControlValue } from "../utils/HomeConfigUtils";

const normalizeControlToken = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

type HomeCpuSpeedSliderProps = {
  isActive: boolean;
  cpuSpeedOptions: string[];
  cpuSpeedValue: string;
  keypadFocusParentId?: string;
  turboControlOptions: string[];
  turboControlValue: string;
};

export function HomeCpuSpeedSlider({
  isActive,
  cpuSpeedOptions,
  cpuSpeedValue,
  keypadFocusParentId,
  turboControlOptions,
  turboControlValue,
}: HomeCpuSpeedSliderProps) {
  const { write: interactiveWrite } = useInteractiveConfigWrite({ category: "U64 Specific Settings" });
  // The permitted CPU speeds come from the device (see useDeviceConfigOptionDomains). Until the
  // device has reported them, present the current value alone rather than a guessed range.
  const sliderOptions = cpuSpeedOptions.length ? cpuSpeedOptions : [cpuSpeedValue.trim() || "1"];
  const domain = createIndexedSliderDomain(sliderOptions);
  const resolveCpuSpeedOption = (index: number) => sliderOptions[Math.round(index)] ?? sliderOptions[0] ?? "1";
  const normalizedCpuSpeedValue = cpuSpeedValue.trim();
  const smokeModeEnabled = isSmokeModeEnabled();
  const [probeSnapshot, setProbeSnapshot] = useState(() =>
    createHomeCpuSpeedSliderProbeSnapshot(normalizedCpuSpeedValue),
  );

  const { sliderValue, displayValue, onValueChange, onValueCommit } = useDeviceBoundSlider({
    deviceValue: cpuSpeedValue,
    domain,
    previewMode: "commitOnly",
    commit: async (nextCpuSpeed) => {
      const nextTurboControl = resolveTurboControlValue(
        nextCpuSpeed,
        turboControlOptions.length ? turboControlOptions : [turboControlValue],
        turboControlValue,
      );
      const releasedAtMs = Date.now();
      const releasedAtIso = new Date(releasedAtMs).toISOString();
      setProbeSnapshot((current) =>
        createHomeCpuSpeedSliderProbeSnapshot(current.authoritativeValue, {
          ...current,
          completedAtIso: null,
          displayValue: nextCpuSpeed,
          durationMs: null,
          errorMessage: null,
          phase: "pending",
          releasedAtIso,
          targetValue: nextCpuSpeed,
        }),
      );
      logger.info("C64U_HOME_CPU_SPEED_SLIDER_RELEASE", {
        component: "HomeCpuSpeedSlider",
        details: {
          releasedAtIso,
          targetValue: nextCpuSpeed,
          turboControlValue: nextTurboControl,
        },
      });
      try {
        const updates: Record<string, string> =
          normalizeControlToken(nextTurboControl) === normalizeControlToken(turboControlValue)
            ? { "CPU Speed": nextCpuSpeed }
            : { "Turbo Control": nextTurboControl, "CPU Speed": nextCpuSpeed };
        await interactiveWrite(updates);
        const completedAtMs = Date.now();
        const completedAtIso = new Date(completedAtMs).toISOString();
        const durationMs = Math.max(0, completedAtMs - releasedAtMs);
        setProbeSnapshot((current) =>
          createHomeCpuSpeedSliderProbeSnapshot(current.authoritativeValue, {
            ...current,
            completedAtIso,
            displayValue: nextCpuSpeed,
            durationMs,
            errorMessage: null,
            phase: "success",
            releasedAtIso,
            targetValue: nextCpuSpeed,
          }),
        );
        logger.info("C64U_HOME_CPU_SPEED_SLIDER_REST_COMPLETED", {
          component: "HomeCpuSpeedSlider",
          details: {
            completedAtIso,
            durationMs,
            releasedAtIso,
            targetValue: nextCpuSpeed,
            turboControlValue: nextTurboControl,
          },
        });
      } catch (error) {
        const completedAtMs = Date.now();
        const completedAtIso = new Date(completedAtMs).toISOString();
        const durationMs = Math.max(0, completedAtMs - releasedAtMs);
        const message = error instanceof Error ? error.message : String(error);
        setProbeSnapshot((current) =>
          createHomeCpuSpeedSliderProbeSnapshot(current.authoritativeValue, {
            ...current,
            completedAtIso,
            displayValue: nextCpuSpeed,
            durationMs,
            errorMessage: message,
            phase: "error",
            releasedAtIso,
            targetValue: nextCpuSpeed,
          }),
        );
        logger.warn("C64U_HOME_CPU_SPEED_SLIDER_REST_FAILED", {
          component: "HomeCpuSpeedSlider",
          details: {
            completedAtIso,
            durationMs,
            error: message,
            releasedAtIso,
            targetValue: nextCpuSpeed,
            turboControlValue: nextTurboControl,
          },
        });
        throw error;
      }
    },
    onError: (error, context) => {
      addLog(
        "warn",
        "Home CPU speed commit failed",
        buildErrorLogDetails(error as Error, {
          category: "U64 Specific Settings",
          itemName: "CPU Speed",
          turboControlValue,
          value: context.value,
        }),
      );
    },
  });
  const probeText = useMemo(() => formatHomeCpuSpeedSliderProbe(probeSnapshot), [probeSnapshot]);

  useEffect(() => {
    setProbeSnapshot((current) =>
      createHomeCpuSpeedSliderProbeSnapshot(normalizedCpuSpeedValue, {
        ...current,
        authoritativeValue: normalizedCpuSpeedValue,
        displayValue,
      }),
    );
  }, [displayValue, normalizedCpuSpeedValue]);

  return (
    <div className="space-y-2 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">CPU Speed</span>
        <span className="text-xs font-semibold text-foreground" data-testid="home-cpu-speed-value">
          {displayValue}
        </span>
      </div>
      {smokeModeEnabled ? (
        <p
          id="home-cpu-speed-probe"
          aria-label="CPU slider probe"
          className="break-all font-mono text-[8px] leading-tight text-muted-foreground"
          data-testid="home-cpu-speed-probe"
          role="status"
        >
          {probeText}
        </p>
      ) : null}
      <Slider
        value={[sliderValue]}
        min={0}
        max={Math.max(sliderOptions.length - 1, 0)}
        step={1}
        disabled={!isActive || sliderOptions.length <= 1}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
        valueFormatter={(index) => resolveCpuSpeedOption(index)}
        aria-label="CPU Speed slider"
        data-testid="home-cpu-speed-slider"
        keypadFocusId="home-cpu-speed-slider"
        keypadFocusGroup="home-controls"
        keypadFocusOrder={50}
        keypadFocusParentId={keypadFocusParentId}
      />
    </div>
  );
}
