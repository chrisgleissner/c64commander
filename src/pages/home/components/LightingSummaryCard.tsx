import { useEffect, useMemo, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getLedColorRgb, rgbToCss } from "@/lib/config/ledColors";
import { buildConfigKey, parseNumericValue, readItemDetails, readItemOptions } from "../utils/HomeConfigUtils";
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

const formatLightingPatternLabel = (value: string) => {
  if (normalizeOptionToken(value) === "singlecolor") return "Single Color";
  return formatSelectOptionLabel(value);
};

type LightingSummaryCardProps = {
  category: string;
  config: Record<string, unknown> | undefined;
  isActive: boolean;
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
  operationPrefix,
  sectionLabel,
  selectTriggerClassName,
  successLabel,
  testIdPrefix,
}: LightingSummaryCardProps) {
  const { configWritePending, resolveConfigValue, updateConfigValue } = useSharedConfigActions();
  const { write: interactiveWrite } = useInteractiveConfigWrite({ category });
  const unavailableLabel = "Not available";

  const [fixedColorDraftIndex, setFixedColorDraftIndex] = useState<number | null>(null);
  const [intensityDraft, setIntensityDraft] = useState<number | null>(null);

  const readOptions = (itemName: string) => readItemOptions(config, category, itemName).map((value) => String(value));
  const resolveValue = (itemName: string, fallback: string | number) =>
    String(resolveConfigValue(config, category, itemName, fallback));

  const modeOptions = readOptions("LedStrip Mode");
  const patternOptions = readOptions("LedStrip Pattern");
  const fixedColorOptions = readOptions("Fixed Color");
  const sidSelectOptions = readOptions("LedStrip SID Select");
  const tintOptions = readOptions("Color tint");

  const modeValue = resolveValue("LedStrip Mode", "Off");
  const patternValue = resolveValue("LedStrip Pattern", unavailableLabel);
  const fixedColorValue = resolveValue("Fixed Color", unavailableLabel);
  const sidSelectValue = resolveValue("LedStrip SID Select", unavailableLabel);
  const tintValue = resolveValue("Color tint", "Pure");
  const intensityValue = resolveValue("Strip Intensity", "0");

  const intensityDetails = readItemDetails(config, category, "Strip Intensity");
  const intensityMin = intensityDetails?.min ?? 0;
  const intensityMax = intensityDetails?.max ?? 31;
  const intensityNumber = parseNumericValue(intensityValue, intensityMin);
  const intensityDisplayValue = intensityDraft ?? intensityNumber;

  useEffect(() => {
    setIntensityDraft(null);
  }, [intensityValue]);

  useEffect(() => {
    setFixedColorDraftIndex(null);
  }, [fixedColorValue]);

  const effectiveModeOptions = modeOptions.length ? modeOptions : [modeValue];
  const effectivePatternOptions = patternOptions.length ? patternOptions : [patternValue];
  const effectiveFixedColorOptions = fixedColorOptions.length ? fixedColorOptions : [fixedColorValue];
  const effectiveSidSelectOptions = sidSelectOptions.length ? sidSelectOptions : [sidSelectValue];
  const effectiveTintOptions = tintOptions.length ? tintOptions : [tintValue];

  const modeSelectOptions = normalizeSelectOptions(effectiveModeOptions, modeValue);
  const patternSelectOptions = normalizeSelectOptions(effectivePatternOptions, patternValue);
  const fixedColorSelectOptions = normalizeSelectOptions(effectiveFixedColorOptions, fixedColorValue);
  const sidSelectSelectOptions = normalizeSelectOptions(effectiveSidSelectOptions, sidSelectValue);
  const tintSelectOptions = normalizeSelectOptions(effectiveTintOptions, tintValue);

  const modeSelectValue = normalizeSelectValue(modeValue);
  const patternSelectValue = normalizeSelectValue(patternValue);
  const fixedColorSelectValue = normalizeSelectValue(fixedColorValue);
  const sidSelectSelectValue = normalizeSelectValue(sidSelectValue);
  const tintSelectValue = normalizeSelectValue(tintValue);

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
  const fixedColorDisplayIndex = fixedColorDraftIndex ?? fixedColorSliderIndex;

  const isPending = (itemName: string) => Boolean(configWritePending[buildConfigKey(category, itemName)]);
  const fixedColorSliderDisabled = !isActive || isPending("Fixed Color") || fixedColorSliderMax === 0;

  const updateLightingConfig = (
    itemName: string,
    value: string | number,
    operationSuffix: string,
    successMessage: string,
    options?: { suppressToast?: boolean },
  ) => updateConfigValue(category, itemName, value, `${operationPrefix}_${operationSuffix}`, successMessage, options);

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
          value={[fixedColorDisplayIndex]}
          min={0}
          max={fixedColorSliderMax}
          step={1}
          onValueChange={(values) => {
            const nextIndex = clampToRange(values[0] ?? 0, 0, fixedColorSliderMax);
            setFixedColorDraftIndex(nextIndex);
          }}
          onValueCommit={() => {
            setFixedColorDraftIndex(null);
          }}
          onValueChangeAsync={(nextValue) => {
            const nextIndex = clampToRange(nextValue, 0, fixedColorSliderMax);
            interactiveWrite({ "Fixed Color": resolveFixedColorOption(nextIndex) });
          }}
          onValueCommitAsync={(nextValue) => {
            const nextIndex = clampToRange(nextValue, 0, fixedColorSliderMax);
            interactiveWrite({ "Fixed Color": resolveFixedColorOption(nextIndex) });
          }}
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
            {Math.round(intensityDisplayValue)}
          </span>
        </div>

        <Slider
          value={[clampToRange(intensityDisplayValue, intensityMin, intensityMax)]}
          min={intensityMin}
          max={intensityMax}
          step={1}
          onValueChange={(values) => {
            const nextValue = clampToRange(values[0] ?? intensityMin, intensityMin, intensityMax);
            setIntensityDraft(nextValue);
          }}
          onValueCommit={() => {
            setIntensityDraft(null);
          }}
          onValueChangeAsync={(nextValue) => {
            const clamped = clampToRange(nextValue, intensityMin, intensityMax);
            interactiveWrite({ "Strip Intensity": Math.round(clamped) });
          }}
          onValueCommitAsync={(nextValue) => {
            const clamped = clampToRange(nextValue, intensityMin, intensityMax);
            interactiveWrite({ "Strip Intensity": Math.round(clamped) });
          }}
          disabled={!isActive || isPending("Strip Intensity")}
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
