/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  createNumericSliderDomain,
  type DeviceBoundSliderPreviewMode,
  useDeviceBoundSlider,
} from "@/hooks/useDeviceBoundSlider";
import { cn } from "@/lib/utils";
import { getOnOffButtonClass } from "@/lib/ui/buttonStyles";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";

export interface SidCardProps {
  name: string;
  power: boolean;
  onPowerToggle?: () => void;
  powerPending?: boolean;

  // Row 2: Identity/Filter
  identityLabel: string; // "SID" or "Filter"
  identityValue: string;
  identityOptions?: string[];
  onIdentityChange?: (value: string) => void;
  identityPending?: boolean;
  isIdentityReadOnly?: boolean;

  // Row 2: Address
  addressValue: string;
  addressOptions: string[];
  onAddressChange: (value: string) => void;
  addressPending?: boolean;

  // Row 3: Shaping Controls
  shapingControls: {
    label: string;
    value: string;
    options?: string[]; // If undefined, read-only text
    onChange?: (value: string) => void;
    pending?: boolean;
  }[];

  // Row 4: Volume & Pan
  volume: number;
  volumeMax: number;
  volumeStep?: number;
  onVolumeChange?: (value: number) => void;
  onVolumeCommit: (value: number) => Promise<void> | void;
  onVolumePreview?: (value: number) => Promise<void> | void;
  volumePreviewMode?: DeviceBoundSliderPreviewMode;
  volumePreviewThrottleMs?: number;
  volumeRound?: (value: number) => number;
  volumeValueFormatter?: (value: number) => string;
  volumeMidpoint?: number | null;

  pan: number;
  panMax: number;
  panStep?: number;
  onPanChange?: (value: number) => void;
  onPanCommit: (value: number) => Promise<void> | void;
  onPanPreview?: (value: number) => Promise<void> | void;
  panPreviewMode?: DeviceBoundSliderPreviewMode;
  panPreviewThrottleMs?: number;
  panRound?: (value: number) => number;
  panValueFormatter?: (value: number) => string;
  panMidpoint?: number | null;

  isConnected: boolean;
  className?: string;
  testIdSuffix: string;
}

const inlineSelectTriggerClass =
  "h-auto w-auto border-0 bg-transparent px-0 py-0 text-xs font-semibold text-foreground shadow-none focus:ring-0 focus:ring-offset-0 [&>svg]:hidden";

export function SidCard({
  name,
  power,
  onPowerToggle,
  powerPending,
  identityLabel,
  identityValue,
  identityOptions,
  onIdentityChange,
  identityPending,
  isIdentityReadOnly,
  addressValue,
  addressOptions,
  onAddressChange,
  addressPending,
  shapingControls,
  volume,
  volumeMax,
  volumeStep,
  onVolumeChange,
  onVolumeCommit,
  onVolumePreview,
  volumePreviewMode = "throttled",
  volumePreviewThrottleMs,
  volumeRound,
  volumeValueFormatter,
  volumeMidpoint,
  pan,
  panMax,
  panStep,
  onPanChange,
  onPanCommit,
  onPanPreview,
  panPreviewMode = "throttled",
  panPreviewThrottleMs,
  panRound,
  panValueFormatter,
  panMidpoint,
  isConnected,
  className,
  testIdSuffix,
}: SidCardProps) {
  const { profile } = useDisplayProfile();
  const formatSelectOptionLabel = (value: string) => (value === "" ? "Default" : value);
  const volumeDomain = React.useMemo(
    () => createNumericSliderDomain({ min: 0, max: volumeMax, round: volumeRound }),
    [volumeMax, volumeRound],
  );
  const panDomain = React.useMemo(
    () => createNumericSliderDomain({ min: 0, max: panMax, round: panRound }),
    [panMax, panRound],
  );
  const volumeSlider = useDeviceBoundSlider({
    deviceValue: volume,
    domain: volumeDomain,
    previewMode: volumePreviewMode,
    preview: onVolumePreview,
    previewThrottleMs: volumePreviewThrottleMs,
    commit: onVolumeCommit,
    onDraftChange: onVolumeChange,
  });
  const panSlider = useDeviceBoundSlider({
    deviceValue: pan,
    domain: panDomain,
    previewMode: panPreviewMode,
    preview: onPanPreview,
    previewThrottleMs: panPreviewThrottleMs,
    commit: onPanCommit,
    onDraftChange: onPanChange,
  });

  return (
    <div
      className={cn("bg-card border border-border rounded-xl p-3 space-y-2", className)}
      data-testid={`home-sid-entry-${testIdSuffix}`}
    >
      {/* Row 1: Name and Power */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-primary uppercase tracking-wide">{name}</p>
        {onPowerToggle ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onPowerToggle}
            disabled={!isConnected || powerPending}
            className={cn("h-6 px-2 text-xs", getOnOffButtonClass(power))}
            data-testid={`home-sid-toggle-${testIdSuffix}`}
          >
            {power ? "ON" : "OFF"}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={true}
            className={cn("h-6 px-2 text-xs", getOnOffButtonClass(power))}
            data-testid={`home-sid-toggle-${testIdSuffix}`}
          >
            {power ? "ON" : "OFF"}
          </Button>
        )}
      </div>

      {/* Row 2: Identity and Address */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground whitespace-nowrap">{identityLabel}</span>
          {isIdentityReadOnly ? (
            <span className="font-medium text-muted-foreground" data-testid={`home-sid-type-${testIdSuffix}`}>
              {identityValue}
            </span>
          ) : (
            <Select value={identityValue} onValueChange={onIdentityChange} disabled={!isConnected || identityPending}>
              <SelectTrigger className={inlineSelectTriggerClass} data-testid={`home-sid-type-${testIdSuffix}`}>
                <SelectValue placeholder={identityValue} />
              </SelectTrigger>
              <SelectContent>
                {identityOptions?.map((option) => (
                  <SelectItem key={option} value={option}>
                    {formatSelectOptionLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2 justify-end">
          <span className="text-muted-foreground whitespace-nowrap">Address</span>
          <Select value={addressValue} onValueChange={onAddressChange} disabled={!isConnected || addressPending}>
            <SelectTrigger className={inlineSelectTriggerClass} data-testid={`home-sid-address-${testIdSuffix}`}>
              <SelectValue placeholder={addressValue} />
            </SelectTrigger>
            <SelectContent>
              {addressOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {formatSelectOptionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Row 3: Shaping Controls */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        {shapingControls.map((control, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="text-muted-foreground whitespace-nowrap">{control.label}</span>
            {control.options && control.onChange ? (
              <Select value={control.value} onValueChange={control.onChange} disabled={!isConnected || control.pending}>
                <SelectTrigger
                  className={inlineSelectTriggerClass}
                  data-testid={`home-sid-shaping-${testIdSuffix}-${index}`}
                >
                  <SelectValue placeholder={control.value} />
                </SelectTrigger>
                <SelectContent>
                  {control.options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {formatSelectOptionLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="font-medium" data-testid={`home-sid-shaping-${testIdSuffix}-${index}-readonly`}>
                {control.value}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Row 4: Volume and Pan */}
      <div className={cn("pt-1", profile === "compact" ? "grid grid-cols-1 gap-2" : "grid grid-cols-2 gap-4")}>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "font-medium text-muted-foreground shrink-0 whitespace-nowrap",
              profile === "compact" ? "text-xs w-8" : "text-[10px] w-6",
            )}
          >
            Vol
          </span>
          <Slider
            value={[volumeSlider.sliderValue]}
            min={0}
            max={volumeMax}
            step={volumeStep ?? 1}
            onValueChange={volumeSlider.onValueChange}
            onValueCommit={volumeSlider.onValueCommit}
            valueFormatter={volumeValueFormatter}
            midpoint={
              volumeMidpoint !== null && volumeMidpoint !== undefined
                ? { value: volumeMidpoint, haptics: true, notch: true }
                : undefined
            }
            disabled={!isConnected}
            className="flex-1"
            data-testid={`home-sid-volume-${testIdSuffix}`}
          />
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "font-medium text-muted-foreground shrink-0 whitespace-nowrap",
              profile === "compact" ? "text-xs w-8" : "text-[10px] w-6",
            )}
          >
            Pan
          </span>
          <Slider
            value={[panSlider.sliderValue]}
            min={0}
            max={panMax}
            step={panStep ?? 1}
            onValueChange={panSlider.onValueChange}
            onValueCommit={panSlider.onValueCommit}
            valueFormatter={panValueFormatter}
            midpoint={
              panMidpoint !== null && panMidpoint !== undefined
                ? { value: panMidpoint, haptics: true, notch: true }
                : undefined
            }
            disabled={!isConnected}
            className="flex-1"
            data-testid={`home-sid-pan-${testIdSuffix}`}
          />
        </div>
      </div>
    </div>
  );
}
