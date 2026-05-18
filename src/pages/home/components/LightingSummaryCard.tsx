/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  createIndexedSliderDomain,
  createNumericSliderDomain,
  useDeviceBoundSlider,
} from "@/hooks/useDeviceBoundSlider";
import { addLog, buildErrorLogDetails } from "@/lib/logging";
import { getLedColorRgb, rgbToCss } from "@/lib/config/ledColors";
import {
  buildConfigKey,
  parseNumericValue,
  readItemDetails,
  readItemOptions,
  readItemValue,
} from "../utils/HomeConfigUtils";
import {
  clampToRange,
  formatSelectOptionLabel,
  normalizeOptionToken,
  normalizeSelectOptions,
  normalizeSelectValue,
  resolveSelectValue,
} from "../utils/uiLogic";
import { useSharedConfigActions } from "../hooks/ConfigActionsContext";
import { useInteractiveConfigWrite } from "@/hooks/useInteractiveConfigWrite";
import { SummaryConfigControlRow } from "./SummaryConfigCard";
import {
  LIGHTING_HOME_AUTO_SID_OPTIONS,
  LIGHTING_HOME_FIXED_COLOR_OPTIONS,
  LIGHTING_HOME_INTENSITY_RANGE,
  LIGHTING_HOME_MODE_OPTIONS,
  LIGHTING_HOME_PATTERN_OPTIONS,
  LIGHTING_HOME_SID_SELECT_OPTIONS,
  LIGHTING_HOME_TINT_OPTIONS,
} from "@/lib/lighting/constants";

const formatLightingPatternLabel = (value: string) => {
  if (normalizeOptionToken(value) === "singlecolor") return "Single Color";
  return formatSelectOptionLabel(value);
};

type LightingSummaryCardProps = {
  category: string;
  config: Record<string, unknown> | undefined;
  isActive: boolean;
  onManualLightingChange?: () => void;
  operationPrefix: string;
  sectionLabel: string;
  selectTriggerClassName: string;
  successLabel: string;
  testIdPrefix: string;
};

export function LightingSummaryCard({
  category,
  config,
  isActive,
  onManualLightingChange,
  operationPrefix,
  sectionLabel,
  selectTriggerClassName,
  successLabel,
  testIdPrefix,
}: LightingSummaryCardProps) {
  const { configWritePending, resolveConfigValue, updateConfigValue } = useSharedConfigActions();
  const { write: interactiveWrite } = useInteractiveConfigWrite({ category });
  const unavailableLabel = "Not available";

  const readOptions = (itemName: string) => readItemOptions(config, category, itemName).map((value) => String(value));
  const resolveValue = (itemName: string, fallback: string | number) =>
    String(resolveConfigValue(config, category, itemName, fallback));

  const modeOptions = readOptions("LedStrip Mode");
  const patternOptions = readOptions("LedStrip Pattern");
  const fixedColorOptions = readOptions("Fixed Color");
  const autoSidModeOptions = readOptions("LedStrip Auto SID Mode");
  const sidSelectOptions = readOptions("LedStrip SID Select");
  const tintOptions = readOptions("Color tint");

  const modeValue = resolveValue("LedStrip Mode", "Off");
  const autoSidModeValue = resolveValue("LedStrip Auto SID Mode", "Disabled");
  const patternValue = resolveValue("LedStrip Pattern", unavailableLabel);
  const fixedColorValue = resolveValue("Fixed Color", unavailableLabel);
  const sidSelectValue = resolveValue("LedStrip SID Select", unavailableLabel);
  const tintValue = resolveValue("Color tint", "Pure");
  const intensityValue = resolveValue("Strip Intensity", "0");

  const intensityDetails = readItemDetails(config, category, "Strip Intensity");
  const intensityMin = intensityDetails?.min ?? LIGHTING_HOME_INTENSITY_RANGE.min;
  const intensityMax = intensityDetails?.max ?? LIGHTING_HOME_INTENSITY_RANGE.max;
  const intensityNumber = parseNumericValue(intensityValue, intensityMin);

  const effectiveModeOptions = modeOptions.length ? modeOptions : [...LIGHTING_HOME_MODE_OPTIONS];
  const effectivePatternOptions = patternOptions.length ? patternOptions : [...LIGHTING_HOME_PATTERN_OPTIONS];
  const effectiveFixedColorOptions = fixedColorOptions.length
    ? fixedColorOptions
    : [...LIGHTING_HOME_FIXED_COLOR_OPTIONS];
  const effectiveSidSelectOptions = sidSelectOptions.length ? sidSelectOptions : [...LIGHTING_HOME_SID_SELECT_OPTIONS];
  const effectiveTintOptions = tintOptions.length ? tintOptions : [...LIGHTING_HOME_TINT_OPTIONS];

  const modeSelectOptions = normalizeSelectOptions(effectiveModeOptions, modeValue);
  const patternSelectOptions = normalizeSelectOptions(effectivePatternOptions, patternValue);
  const fixedColorSelectOptions = normalizeSelectOptions(effectiveFixedColorOptions, fixedColorValue);
  const autoSidModeSelectOptions = normalizeSelectOptions(
    autoSidModeOptions.length ? autoSidModeOptions : [...LIGHTING_HOME_AUTO_SID_OPTIONS],
    autoSidModeValue,
  );
  const sidSelectSelectOptions = normalizeSelectOptions(effectiveSidSelectOptions, sidSelectValue);
  const tintSelectOptions = normalizeSelectOptions(effectiveTintOptions, tintValue);

  const modeSelectValue = normalizeSelectValue(modeValue);
  const patternSelectValue = normalizeSelectValue(patternValue);
  const fixedColorSelectValue = normalizeSelectValue(fixedColorValue);
  const sidSelectSelectValue = normalizeSelectValue(sidSelectValue);
  const tintSelectValue = normalizeSelectValue(tintValue);
  const showAutoSidMode =
    autoSidModeOptions.length > 0 || readItemValue(config, category, "LedStrip Auto SID Mode") !== undefined;

  const fixedColorSliderOptions = fixedColorSelectOptions.length ? fixedColorSelectOptions : [fixedColorValue];
  const fixedColorSliderMax = Math.max(0, fixedColorSliderOptions.length - 1);
  const fixedColorSliderIndex = Math.max(
    0,
    fixedColorSliderOptions.findIndex((option) => option === fixedColorValue),
  );
  const fixedColorGradient = useMemo(() => {
    const colors = fixedColorSliderOptions.map((option) => getLedColorRgb(option));
    if (colors.length < 2 || colors.some((value) => !value)) return null;
    const segmentSize = 100 / colors.length;
    const stops = colors.map((rgb, index) => {
      const color = rgbToCss(rgb!);
      const start = index * segmentSize;
      const end = (index + 1) * segmentSize;
      return `${color} ${start}%, ${color} ${end}%`;
    });
    return `linear-gradient(90deg, ${stops.join(", ")})`;
  }, [fixedColorSliderOptions]);
  const resolveFixedColorOption = (index: number) =>
    fixedColorSliderOptions[Math.round(index)] ?? fixedColorSliderOptions[0] ?? "";
  const fixedColorDomain = createIndexedSliderDomain(fixedColorSliderOptions);
  const intensityDomain = createNumericSliderDomain({ min: intensityMin, max: intensityMax, round: Math.round });

  const isPending = (itemName: string) => Boolean(configWritePending[buildConfigKey(category, itemName)]);
  const fixedColorSliderDisabled = !isActive || fixedColorSliderMax === 0;

  const updateLightingConfig = (
    itemName: string,
    value: string | number,
    operationSuffix: string,
    successMessage: string,
    options?: { suppressToast?: boolean },
  ) => {
    onManualLightingChange?.();
    return updateConfigValue(
      category,
      itemName,
      value,
      `${operationPrefix}_${operationSuffix}`,
      successMessage,
      options,
    );
  };

  const writeLightingSliderValue = (itemName: string, value: string | number) => {
    onManualLightingChange?.();
    return Promise.resolve(interactiveWrite({ [itemName]: value })).catch((error) => {
      addLog(
        "warn",
        "Lighting summary slider write failed",
        buildErrorLogDetails(error as Error, {
          category,
          itemName,
          value,
        }),
      );
      throw error;
    });
  };
  const fixedColorSlider = useDeviceBoundSlider({
    deviceValue: fixedColorValue,
    domain: fixedColorDomain,
    previewMode: "throttled",
    preview: (nextColor) => writeLightingSliderValue("Fixed Color", nextColor),
    commit: (nextColor) => writeLightingSliderValue("Fixed Color", nextColor),
  });
  const intensitySlider = useDeviceBoundSlider({
    deviceValue: intensityNumber,
    domain: intensityDomain,
    previewMode: "throttled",
    preview: (nextIntensity) => writeLightingSliderValue("Strip Intensity", nextIntensity),
    commit: (nextIntensity) => writeLightingSliderValue("Strip Intensity", nextIntensity),
  });

  return (
    <div
      className="bg-card border border-border rounded-xl p-3 space-y-2"
      data-section-label={sectionLabel}
      data-testid={`${testIdPrefix}-summary`}
    >
      <p className="text-xs font-semibold text-primary uppercase tracking-wider">{sectionLabel}</p>
      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Mode</span>
          <Select
            value={modeSelectValue}
            onValueChange={(value) =>
              void updateLightingConfig(
                "LedStrip Mode",
                resolveSelectValue(value),
                "MODE",
                `${successLabel} mode updated`,
              )
            }
            disabled={!isActive || isPending("LedStrip Mode")}
          >
            <SelectTrigger className={selectTriggerClassName} data-testid={`${testIdPrefix}-mode`}>
              <SelectValue placeholder={modeValue} />
            </SelectTrigger>
            <SelectContent>
              {modeSelectOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {formatSelectOptionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {showAutoSidMode ? (
          <SummaryConfigControlRow
            disabled={!isActive || isPending("LedStrip Auto SID Mode")}
            label="Auto SID"
            options={autoSidModeSelectOptions}
            selectTriggerClassName={selectTriggerClassName}
            testId={`${testIdPrefix}-auto-sid`}
            value={autoSidModeValue}
            onValueChange={(value) =>
              void updateLightingConfig(
                "LedStrip Auto SID Mode",
                resolveSelectValue(value),
                "AUTO_SID_MODE",
                `${successLabel} Auto SID updated`,
              )
            }
          />
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Pattern</span>
          <Select
            value={patternSelectValue}
            onValueChange={(value) =>
              void updateLightingConfig(
                "LedStrip Pattern",
                resolveSelectValue(value),
                "PATTERN",
                `${successLabel} pattern updated`,
              )
            }
            disabled={!isActive || isPending("LedStrip Pattern")}
          >
            <SelectTrigger className={selectTriggerClassName} data-testid={`${testIdPrefix}-pattern`}>
              <span>{formatLightingPatternLabel(patternValue)}</span>
            </SelectTrigger>
            <SelectContent>
              {patternSelectOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {formatLightingPatternLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Color</span>
          <Select
            value={fixedColorSelectValue}
            onValueChange={(value) =>
              void updateLightingConfig(
                "Fixed Color",
                resolveSelectValue(value),
                "COLOR",
                `${successLabel} color updated`,
              )
            }
            disabled={!isActive || isPending("Fixed Color")}
          >
            <SelectTrigger className={selectTriggerClassName} data-testid={`${testIdPrefix}-color`}>
              <div className="flex items-center gap-2">
                {(() => {
                  const rgb = getLedColorRgb(fixedColorValue);
                  return rgb ? (
                    <div
                      className="w-4 h-4 rounded-sm border border-border/50 shrink-0"
                      style={{ backgroundColor: rgbToCss(rgb) }}
                      aria-hidden="true"
                    />
                  ) : null;
                })()}
                <span>{formatSelectOptionLabel(fixedColorValue)}</span>
              </div>
            </SelectTrigger>
            <SelectContent>
              {fixedColorSelectOptions.map((option) => {
                const optionRgb = getLedColorRgb(option);
                return (
                  <SelectItem key={option} value={option}>
                    <div className="flex items-center gap-2">
                      {optionRgb ? (
                        <div
                          className="w-4 h-4 rounded-sm border border-border/50 shrink-0"
                          style={{ backgroundColor: rgbToCss(optionRgb) }}
                          aria-hidden="true"
                        />
                      ) : null}
                      <span>{formatSelectOptionLabel(option)}</span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <Slider
          value={[fixedColorSlider.sliderValue]}
          min={0}
          max={fixedColorSliderMax}
          step={1}
          onValueChange={fixedColorSlider.onValueChange}
          onValueCommit={fixedColorSlider.onValueCommit}
          disabled={fixedColorSliderDisabled}
          valueFormatter={(value) => formatSelectOptionLabel(resolveFixedColorOption(value))}
          trackClassName={fixedColorGradient ? "bg-transparent" : undefined}
          rangeClassName={fixedColorGradient ? "bg-transparent" : undefined}
          trackStyle={fixedColorGradient ? { backgroundImage: fixedColorGradient } : undefined}
          data-testid={`${testIdPrefix}-color-slider`}
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Brightness</span>
          <span className="text-xs font-semibold text-foreground" data-testid={`${testIdPrefix}-intensity-value`}>
            {Math.round(intensitySlider.displayValue)}
          </span>
        </div>

        <Slider
          value={[clampToRange(intensitySlider.sliderValue, intensityMin, intensityMax)]}
          min={intensityMin}
          max={intensityMax}
          step={1}
          onValueChange={intensitySlider.onValueChange}
          onValueCommit={intensitySlider.onValueCommit}
          disabled={!isActive}
          data-testid={`${testIdPrefix}-intensity-slider`}
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Tint</span>
          <Select
            value={tintSelectValue}
            onValueChange={(value) =>
              void updateLightingConfig("Color tint", resolveSelectValue(value), "TINT", `${successLabel} tint updated`)
            }
            disabled={!isActive || isPending("Color tint")}
          >
            <SelectTrigger className={selectTriggerClassName} data-testid={`${testIdPrefix}-tint`}>
              <SelectValue placeholder={tintValue} />
            </SelectTrigger>
            <SelectContent>
              {tintSelectOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {formatSelectOptionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">SID Select</span>
          <Select
            value={sidSelectSelectValue}
            onValueChange={(value) =>
              void updateLightingConfig(
                "LedStrip SID Select",
                resolveSelectValue(value),
                "SID_SELECT",
                `${successLabel} SID select updated`,
              )
            }
            disabled={!isActive || isPending("LedStrip SID Select")}
          >
            <SelectTrigger className={selectTriggerClassName} data-testid={`${testIdPrefix}-sid-select`}>
              <SelectValue placeholder={sidSelectValue} />
            </SelectTrigger>
            <SelectContent>
              {sidSelectSelectOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {formatSelectOptionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
