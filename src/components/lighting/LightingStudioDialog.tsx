/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { Copy, Info, MapPinned, PauseCircle, Pin, PinOff, PlayCircle, Save, Sparkles, Trash2 } from "lucide-react";
import {
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetFooter,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { resolveAppSheetTopClearancePx, assertOverlayRespectsBadgeSafeZone } from "@/components/ui/interstitialStyles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { useLightingStudio } from "@/hooks/useLightingStudio";
import { getLedColorRgb, rgbToCss } from "@/lib/config/ledColors";
import { formatLightingColor, normalizeSurfaceStateForCapability } from "@/lib/lighting/capabilities";
import { searchLightingCities } from "@/lib/lighting/cityDataset";
import { LIGHTING_COMPOSE_PRESET_LABELS, LIGHTING_SOURCE_BUCKET_LABELS } from "@/lib/lighting/constants";
import { C64_PREVIEW_LAYOUT, type C64PreviewBounds, type C64PreviewRect } from "@/lib/lighting/c64PreviewLayout";
import type {
  LightingComposePreset,
  LightingConnectionSentinelState,
  LightingDeviceCapability,
  LightingLinkMode,
  LightingSurface,
  LightingSurfaceState,
} from "@/lib/lighting/types";
import { cn } from "@/lib/utils";

const CONNECTION_STATE_LABELS: Record<LightingConnectionSentinelState, string> = {
  connected: "Connected",
  connecting: "Connecting",
  retrying: "Retrying",
  disconnected: "Disconnected",
  demo: "Demo",
  error: "Error",
};

const FALLBACK_SURFACE_RGB = { r: 99, g: 102, b: 120 };
const DEFAULT_STUDIO_INTENSITY = 18;
const DEFAULT_STUDIO_COLOR_PREFERENCE = ["Amber", "Orange", "Yellow", "White"] as const;

const buildDraftFromCurrent = (
  surfaces: Partial<Record<LightingSurface, LightingSurfaceState>>,
): Partial<Record<LightingSurface, LightingSurfaceState>> => JSON.parse(JSON.stringify(surfaces));

const mirrorNamedColor = (value: string) => {
  const swaps: Record<string, string> = {
    Red: "Light Red",
    Green: "Light Green",
    Blue: "Light Blue",
    Yellow: "Orange",
    Orange: "Yellow",
    Purple: "Fuchsia",
    Fuchsia: "Purple",
  };
  return swaps[value] ?? value;
};

const applyPreset = (
  preset: LightingComposePreset,
  current: Partial<Record<LightingSurface, LightingSurfaceState>>,
): Partial<Record<LightingSurface, LightingSurfaceState>> => {
  const caseState = current.case ?? {};
  const keyboardState = current.keyboard ?? current.case ?? {};
  switch (preset) {
    case "mirror":
      return { case: caseState, keyboard: buildDraftFromCurrent({ case: caseState }).case };
    case "contrast":
      return {
        case: {
          ...caseState,
          color:
            caseState.color?.kind === "named"
              ? { kind: "named" as const, value: mirrorNamedColor(caseState.color.value) }
              : caseState.color,
        },
        keyboard: {
          ...keyboardState,
          color:
            keyboardState.color?.kind === "named"
              ? { kind: "named" as const, value: mirrorNamedColor(keyboardState.color.value) }
              : keyboardState.color,
        },
      };
    case "keyboard-focus":
      return {
        case: { ...caseState, intensity: Math.max(4, (caseState.intensity ?? 12) - 6) },
        keyboard: { ...keyboardState, intensity: Math.min(31, (keyboardState.intensity ?? 12) + 6) },
      };
    case "case-halo":
      return {
        case: { ...caseState, intensity: Math.min(31, (caseState.intensity ?? 12) + 6) },
        keyboard: { ...keyboardState, intensity: Math.max(2, (keyboardState.intensity ?? 12) - 6) },
      };
  }
};

const composeSurfaceSwatchStyle = (surface: LightingSurfaceState | undefined) => {
  if (!surface?.color) {
    return { background: "linear-gradient(135deg, rgb(51 65 85), rgb(100 116 139))" };
  }
  if (surface.color.kind === "named") {
    const rgb = getLedColorRgb(surface.color.value);
    return rgb ? { backgroundColor: rgbToCss(rgb) } : { backgroundColor: "#64748b" };
  }
  return { backgroundColor: `rgb(${surface.color.r}, ${surface.color.g}, ${surface.color.b})` };
};

const resolveSurfaceRgb = (surface: LightingSurfaceState | undefined) => {
  if (!surface?.color) return FALLBACK_SURFACE_RGB;
  if (surface.color.kind === "rgb") return surface.color;
  return getLedColorRgb(surface.color.value) ?? FALLBACK_SURFACE_RGB;
};

const findPreferredColorName = (supportedNamedColors: string[]) =>
  DEFAULT_STUDIO_COLOR_PREFERENCE.find((preferred) =>
    supportedNamedColors.some((option) => option.toLowerCase() === preferred.toLowerCase()),
  ) ?? supportedNamedColors[0];

const buildStudioFallbackSurface = (capability: LightingDeviceCapability): LightingSurfaceState | undefined => {
  if (!capability.supported) return undefined;

  const fallback: LightingSurfaceState = {
    mode: capability.supportedModes.includes("Fixed Color") ? "Fixed Color" : capability.supportedModes[0],
    pattern: capability.supportedPatterns[0],
    intensity: Math.min(
      capability.intensityRange.max,
      Math.max(capability.intensityRange.min, DEFAULT_STUDIO_INTENSITY),
    ),
    tint: capability.supportsTint
      ? (capability.supportedTints.find((option) => option.toLowerCase() === "warm") ?? capability.supportedTints[0])
      : undefined,
    sidSelect: capability.supportsSidSelect ? capability.supportedSidSelects[0] : undefined,
  };

  if (capability.colorEncoding === "named") {
    const preferred = findPreferredColorName(capability.supportedNamedColors);
    if (preferred) {
      fallback.color = { kind: "named", value: preferred };
    }
  } else if (capability.colorEncoding === "rgb") {
    const preferredRgb =
      DEFAULT_STUDIO_COLOR_PREFERENCE.map((name) => getLedColorRgb(name)).find((value) => value !== null) ??
      FALLBACK_SURFACE_RGB;
    fallback.color = { kind: "rgb", r: preferredRgb.r, g: preferredRgb.g, b: preferredRgb.b };
  }

  return fallback;
};

const buildStudioDraftBase = (
  surfaces: Partial<Record<LightingSurface, LightingSurfaceState>> | null | undefined,
  capabilities: Record<LightingSurface, LightingDeviceCapability>,
) =>
  (["case", "keyboard"] as const).reduce<Partial<Record<LightingSurface, LightingSurfaceState>>>((result, surface) => {
    const capability = capabilities[surface];
    if (!capability) {
      return result;
    }
    const normalized = normalizeSurfaceStateForCapability(capability, surfaces?.[surface]) ?? undefined;
    const fallback = buildStudioFallbackSurface(capability);
    if (normalized ?? fallback) {
      result[surface] = normalized ?? fallback;
    }
    return result;
  }, {});

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const scaleGlowAlpha = (intensity: number | undefined, max = 0.9, min = 0.18) =>
  min + (max - min) * clamp01((intensity ?? 0) / 31);

const toRgba = (rgb: { r: number; g: number; b: number }, alpha: number) =>
  `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;

const LIGHTING_PREVIEW_CELL_WIDTH = 9.4;
const LIGHTING_PREVIEW_CELL_HEIGHT = 18.2;
const LIGHTING_PREVIEW_TRANSFORM = `translate(188 142) skewX(-16) scale(${LIGHTING_PREVIEW_CELL_WIDTH} ${LIGHTING_PREVIEW_CELL_HEIGHT})`;
const LIGHTING_PREVIEW_CASE_BASE = "#BFBBAF";
const LIGHTING_PREVIEW_KEYBOARD_BASE = "#111111";
const LIGHTING_PREVIEW_LED_FILL = "#F5F5F5";
const LIGHTING_PREVIEW_LED_FILL_OPACITY = 0.94;
const LIGHTING_PREVIEW_LED_GLOW_OPACITY = 0.2;

const scaleLightingAlpha = (intensity: number | undefined, min: number, max: number) =>
  min + (max - min) * clamp01((intensity ?? 0) / 31);

const boundsInset = (bounds: C64PreviewBounds, inset = 0.18): C64PreviewBounds => ({
  x: bounds.x + inset,
  y: bounds.y + inset,
  width: Math.max(0.45, bounds.width - inset * 2),
  height: Math.max(0.45, bounds.height - inset * 2),
});

const renderPreviewRects = (rects: C64PreviewRect[], props: React.SVGProps<SVGRectElement>, keyPrefix: string) =>
  rects.map((rect, index) => (
    <rect
      key={`${keyPrefix}-${rect.x}-${rect.y}-${rect.width}-${rect.height}-${index}`}
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      shapeRendering="geometricPrecision"
      {...props}
    />
  ));

const isFiniteCoordinate = (value: string) => value.trim().length > 0 && Number.isFinite(Number(value));

const validateLatitude = (value: string) => {
  if (!isFiniteCoordinate(value)) return "Enter a latitude.";
  const numeric = Number(value);
  if (numeric < -90 || numeric > 90) return "Latitude must be between -90 and 90.";
  return null;
};

const validateLongitude = (value: string) => {
  if (!isFiniteCoordinate(value)) return "Enter a longitude.";
  const numeric = Number(value);
  if (numeric < -180 || numeric > 180) return "Longitude must be between -180 and 180.";
  return null;
};

function SurfaceEditor({
  surface,
  draft,
  onChange,
  compact = false,
}: {
  surface: LightingSurface;
  draft: LightingSurfaceState | undefined;
  onChange: (next: LightingSurfaceState) => void;
  compact?: boolean;
}) {
  const { capabilities } = useLightingStudio();
  const capability = capabilities[surface];
  const normalized = normalizeSurfaceStateForCapability(capability, draft) ?? draft ?? {};
  const rgbColor = normalized.color?.kind === "rgb" ? normalized.color : null;

  if (!capability.supported) return null;

  return (
    <div
      className={cn("space-y-3 rounded-xl border border-border/60 bg-card/60 p-3", compact && "space-y-2.5")}
      data-testid={`lighting-editor-${surface}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{surface === "case" ? "Case" : "Keys"}</p>
          <p className="text-xs text-muted-foreground">
            {capability.colorEncoding === "rgb" ? "Legacy RGB device" : "Named-color device"}
          </p>
        </div>
        <div className="h-10 w-10 rounded-full border border-border/50" style={composeSurfaceSwatchStyle(normalized)} />
      </div>

      {capability.supportedModes.length > 0 ? (
        <div className="space-y-1.5">
          <Label>Mode</Label>
          <Select
            value={normalized.mode ?? capability.supportedModes[0]}
            onValueChange={(value) => onChange({ ...normalized, mode: value })}
          >
            <SelectTrigger data-testid={`lighting-${surface}-mode`} className={compact ? "h-9" : undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {capability.supportedModes.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {capability.supportedPatterns.length > 0 ? (
        <div className="space-y-1.5">
          <Label>Pattern</Label>
          <Select
            value={normalized.pattern ?? capability.supportedPatterns[0]}
            onValueChange={(value) => onChange({ ...normalized, pattern: value })}
          >
            <SelectTrigger data-testid={`lighting-${surface}-pattern`} className={compact ? "h-9" : undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {capability.supportedPatterns.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {capability.colorEncoding === "named" ? (
        <div className="space-y-1.5">
          <Label>Color</Label>
          <Select
            value={normalized.color?.kind === "named" ? normalized.color.value : capability.supportedNamedColors[0]}
            onValueChange={(value) => onChange({ ...normalized, color: { kind: "named", value } })}
          >
            <SelectTrigger data-testid={`lighting-${surface}-color`} className={compact ? "h-9" : undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {capability.supportedNamedColors.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {capability.colorEncoding === "rgb" && rgbColor ? (
        <div className="grid grid-cols-3 gap-2">
          {(["r", "g", "b"] as const).map((channel) => (
            <div key={channel} className="space-y-1">
              <Label>{channel.toUpperCase()}</Label>
              <Input
                type="number"
                min={0}
                max={255}
                value={rgbColor[channel]}
                onChange={(event) =>
                  onChange({
                    ...normalized,
                    color: {
                      ...rgbColor,
                      [channel]: Math.max(0, Math.min(255, Number(event.target.value || 0))),
                    },
                  })
                }
                data-testid={`lighting-${surface}-rgb-${channel}`}
              />
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Brightness</Label>
          <span className="text-xs text-muted-foreground">{normalized.intensity ?? capability.intensityRange.max}</span>
        </div>
        <Slider
          value={[normalized.intensity ?? capability.intensityRange.max]}
          min={capability.intensityRange.min}
          max={capability.intensityRange.max}
          step={1}
          onValueChange={(values) => onChange({ ...normalized, intensity: values[0] ?? capability.intensityRange.max })}
          data-testid={`lighting-${surface}-intensity`}
        />
      </div>

      {capability.supportsTint ? (
        <div className="space-y-1.5">
          <Label>Tint</Label>
          <Select
            value={normalized.tint ?? capability.supportedTints[0]}
            onValueChange={(value) => onChange({ ...normalized, tint: value })}
          >
            <SelectTrigger data-testid={`lighting-${surface}-tint`} className={compact ? "h-9" : undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {capability.supportedTints.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {capability.supportsSidSelect ? (
        <div className="space-y-1.5">
          <Label>SID Select</Label>
          <Select
            value={normalized.sidSelect ?? capability.supportedSidSelects[0]}
            onValueChange={(value) => onChange({ ...normalized, sidSelect: value })}
          >
            <SelectTrigger data-testid={`lighting-${surface}-sid-select`} className={compact ? "h-9" : undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {capability.supportedSidSelects.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}

function LightingDeviceMockup({
  draft,
  selectedSurface,
  keyboardSupported,
  onSelectSurface,
}: {
  draft: Partial<Record<LightingSurface, LightingSurfaceState>>;
  selectedSurface: LightingSurface;
  keyboardSupported: boolean;
  onSelectSurface: (surface: LightingSurface) => void;
}) {
  const caseRgb = resolveSurfaceRgb(draft.case);
  const keyboardRgb = resolveSurfaceRgb(draft.keyboard ?? draft.case);
  const caseGlowAlpha = scaleGlowAlpha(draft.case?.intensity, 0.78, 0.18);
  const caseOverlayAlpha = scaleLightingAlpha(draft.case?.intensity, 0.14, 0.46);
  const keyboardOverlayAlpha = scaleLightingAlpha(draft.keyboard?.intensity ?? draft.case?.intensity, 0.16, 0.62);
  const caseSelected = selectedSurface === "case";
  const keyboardSelected = keyboardSupported && selectedSurface === "keyboard";
  const caseStroke = caseSelected ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.18)";
  const keyboardStroke = keyboardSelected ? "rgba(255,255,255,0.84)" : "rgba(255,255,255,0.22)";
  const mainKeyboardBounds = boundsInset(C64_PREVIEW_LAYOUT.keyboardMain.bounds);
  const functionKeyboardBounds = C64_PREVIEW_LAYOUT.keyboardFunction
    ? boundsInset(C64_PREVIEW_LAYOUT.keyboardFunction.bounds)
    : null;
  const caseInteractiveBounds = boundsInset(
    { x: 0, y: 0, width: C64_PREVIEW_LAYOUT.width, height: C64_PREVIEW_LAYOUT.height },
    0.1,
  );
  const keyboardGraphicFill = toRgba(keyboardRgb, Math.min(0.78, keyboardOverlayAlpha + 0.12));

  return (
    <div
      className="space-y-3 overflow-visible rounded-2xl border border-border/60 bg-card/70 p-4"
      data-testid="lighting-device-mockup"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Device preview</p>
          <p className="text-xs text-muted-foreground">Tap the shell or keys to edit that surface.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={selectedSurface === "case" ? "default" : "outline"}
            onClick={() => onSelectSurface("case")}
            data-testid="lighting-select-surface-case"
          >
            Case
          </Button>
          {keyboardSupported ? (
            <Button
              type="button"
              size="sm"
              variant={selectedSurface === "keyboard" ? "default" : "outline"}
              onClick={() => onSelectSurface("keyboard")}
              data-testid="lighting-select-surface-keyboard"
            >
              Keys
            </Button>
          ) : null}
        </div>
      </div>

      <div className="overflow-visible rounded-[28px] border border-border/60 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.07),_transparent_58%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.94))] px-3 py-5 sm:p-5">
        <div className="mx-auto w-full max-w-[34rem] overflow-visible px-2 pb-2 pt-2">
          <svg
            viewBox="0 0 1000 620"
            className="h-auto w-full overflow-visible drop-shadow-[0_28px_48px_rgba(15,23,42,0.52)]"
            aria-label="Commodore 64 lighting preview"
          >
            <ellipse cx="500" cy="545" rx="316" ry="26" fill={toRgba(caseRgb, caseGlowAlpha * 0.36)} />
            <ellipse cx="500" cy="560" rx="286" ry="18" fill="rgba(15,23,42,0.35)" />

            <g id="c64-root" transform={LIGHTING_PREVIEW_TRANSFORM}>
              <g id="case-shell">
                <g data-testid="lighting-mockup-case-base">
                  {renderPreviewRects(
                    C64_PREVIEW_LAYOUT.regions.case.rects,
                    { fill: LIGHTING_PREVIEW_CASE_BASE },
                    "case-base",
                  )}
                </g>
                <g data-testid="lighting-mockup-case-overlay">
                  {renderPreviewRects(
                    C64_PREVIEW_LAYOUT.regions.case.rects,
                    { fill: toRgba(caseRgb, caseOverlayAlpha) },
                    "case-overlay",
                  )}
                </g>
                <rect
                  x={caseInteractiveBounds.x}
                  y={caseInteractiveBounds.y}
                  width={caseInteractiveBounds.width}
                  height={caseInteractiveBounds.height}
                  rx={1.2}
                  fill="transparent"
                  stroke={caseStroke}
                  strokeWidth={caseSelected ? 0.75 : 0.34}
                  vectorEffect="non-scaling-stroke"
                  data-testid="lighting-mockup-case-shell"
                  aria-label="Edit case lighting"
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectSurface("case")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectSurface("case");
                    }
                  }}
                  className="cursor-pointer focus:outline-none"
                />
              </g>

              <g id="keyboard-area" data-testid="lighting-mockup-keyboard-layout">
                <g data-testid="lighting-mockup-keyboard-bed">
                  {renderPreviewRects(
                    C64_PREVIEW_LAYOUT.regions.keyboard.rects,
                    { fill: LIGHTING_PREVIEW_KEYBOARD_BASE },
                    "keyboard-base",
                  )}
                </g>
                <g data-testid="lighting-mockup-keyboard-overlay">
                  {renderPreviewRects(
                    C64_PREVIEW_LAYOUT.regions.keyboard.rects,
                    { fill: toRgba(keyboardRgb, keyboardOverlayAlpha) },
                    "keyboard-overlay",
                  )}
                </g>

                <g
                  id="main-keys"
                  aria-label="Edit main keyboard lighting"
                  role="button"
                  tabIndex={keyboardSupported ? 0 : -1}
                  onClick={() => keyboardSupported && onSelectSurface("keyboard")}
                  onKeyDown={(event) => {
                    if (!keyboardSupported) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectSurface("keyboard");
                    }
                  }}
                  className={cn("cursor-pointer", !keyboardSupported && "cursor-default opacity-80")}
                >
                  <rect
                    x={mainKeyboardBounds.x}
                    y={mainKeyboardBounds.y}
                    width={mainKeyboardBounds.width}
                    height={mainKeyboardBounds.height}
                    rx={0.9}
                    fill="transparent"
                    stroke={keyboardStroke}
                    strokeWidth={keyboardSelected ? 0.62 : 0.32}
                    vectorEffect="non-scaling-stroke"
                    data-testid="lighting-mockup-main-block"
                  />
                  <rect
                    x={mainKeyboardBounds.x + 1.4}
                    y={mainKeyboardBounds.y + mainKeyboardBounds.height - 0.7}
                    width={Math.max(2, mainKeyboardBounds.width - 2.8)}
                    height={0.28}
                    rx={0.14}
                    fill={keyboardGraphicFill}
                    data-testid="lighting-mockup-main-graphic"
                  />
                </g>

                {functionKeyboardBounds ? (
                  <g
                    id="function-keys"
                    aria-label="Edit function keyboard lighting"
                    role="button"
                    tabIndex={keyboardSupported ? 0 : -1}
                    onClick={() => keyboardSupported && onSelectSurface("keyboard")}
                    onKeyDown={(event) => {
                      if (!keyboardSupported) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectSurface("keyboard");
                      }
                    }}
                    className={cn("cursor-pointer", !keyboardSupported && "cursor-default opacity-80")}
                  >
                    <rect
                      x={functionKeyboardBounds.x}
                      y={functionKeyboardBounds.y}
                      width={functionKeyboardBounds.width}
                      height={functionKeyboardBounds.height}
                      rx={0.9}
                      fill="transparent"
                      stroke={keyboardStroke}
                      strokeWidth={keyboardSelected ? 0.62 : 0.32}
                      vectorEffect="non-scaling-stroke"
                      data-testid="lighting-mockup-function-block"
                    />
                    <rect
                      x={functionKeyboardBounds.x + 0.65}
                      y={functionKeyboardBounds.y + functionKeyboardBounds.height - 0.65}
                      width={Math.max(1.2, functionKeyboardBounds.width - 1.3)}
                      height={0.28}
                      rx={0.14}
                      fill={keyboardGraphicFill}
                      data-testid="lighting-mockup-function-graphic"
                    />
                  </g>
                ) : null}
              </g>

              <g id="led-layer" data-testid="lighting-mockup-led-region">
                {renderPreviewRects(
                  C64_PREVIEW_LAYOUT.ledStrip.rects.map((rect) => ({
                    x: rect.x - 0.18,
                    y: rect.y - 0.18,
                    width: rect.width + 0.36,
                    height: rect.height + 0.36,
                  })),
                  { fill: "#FFFFFF", fillOpacity: LIGHTING_PREVIEW_LED_GLOW_OPACITY },
                  "led-glow",
                )}
                {C64_PREVIEW_LAYOUT.ledStrip.rects.map((rect, index) => (
                  <rect
                    key={`led-strip-${rect.x}-${rect.y}-${index}`}
                    x={rect.x}
                    y={rect.y}
                    width={rect.width}
                    height={rect.height}
                    fill={LIGHTING_PREVIEW_LED_FILL}
                    fillOpacity={LIGHTING_PREVIEW_LED_FILL_OPACITY}
                    data-testid="lighting-mockup-led-strip"
                  />
                ))}
              </g>
            </g>
          </svg>
        </div>
      </div>

      <div className={cn("grid gap-3", keyboardSupported ? "md:grid-cols-2" : "grid-cols-1")}>
        {(["case", "keyboard"] as const)
          .filter((surface) => surface === "case" || keyboardSupported)
          .map((surface) => {
            const state = draft[surface] ?? draft.case;
            return (
              <button
                key={surface}
                type="button"
                onClick={() => onSelectSurface(surface)}
                className={cn(
                  "rounded-xl border p-3 text-left transition",
                  selectedSurface === surface ? "border-primary bg-primary/5" : "border-border/60 bg-background/70",
                )}
                data-testid={`lighting-device-summary-${surface}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{surface === "case" ? "Case" : "Keys"}</p>
                    <p className="truncate text-xs text-muted-foreground">{formatLightingColor(state?.color)}</p>
                  </div>
                  <div
                    className="h-8 w-8 rounded-full border border-border/60"
                    style={composeSurfaceSwatchStyle(state)}
                  />
                </div>
              </button>
            );
          })}
      </div>
    </div>
  );
}

export function LightingAutomationCue({
  label,
  onOpenStudio,
  onOpenContextLens,
  className,
}: {
  label: string;
  onOpenStudio: () => void;
  onOpenContextLens?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border border-border/60 bg-card/70 px-3 py-1.5 text-xs",
        className,
      )}
      data-testid="lighting-automation-cue"
    >
      <Sparkles className="h-3.5 w-3.5 text-primary" />
      <span className="font-medium">{label}</span>
      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onOpenStudio}>
        Studio
      </Button>
      {onOpenContextLens ? (
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onOpenContextLens}>
          Why
        </Button>
      ) : null}
    </div>
  );
}

function LightingContextLensDialog() {
  const { contextLensOpen, closeContextLens, resolved } = useLightingStudio();

  return (
    <AppSheet open={contextLensOpen} onOpenChange={(open) => (open ? undefined : closeContextLens())}>
      <AppSheetContent
        className="overflow-hidden p-0 sm:w-[min(100vw-2rem,36rem)]"
        data-testid="lighting-context-lens-sheet"
      >
        <AppSheetHeader>
          <AppSheetTitle>Context Lens</AppSheetTitle>
          <AppSheetDescription>Which resolver layer currently owns each lighting surface.</AppSheetDescription>
        </AppSheetHeader>
        <AppSheetBody className="space-y-2 px-4 py-4 sm:px-5">
          {resolved.contextLens.map((entry) => (
            <div
              key={`${entry.surface}-${entry.owner}`}
              className="flex items-start justify-between gap-2 rounded-lg border border-border/60 p-2.5"
              data-testid={`lighting-context-lens-${entry.surface}`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{entry.surface === "case" ? "Case" : "Keys"}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{entry.detail}</p>
              </div>
              <Badge variant="secondary" className="shrink-0 text-xs">
                {entry.label}
              </Badge>
            </div>
          ))}
          {resolved.contextLens.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No resolver data available.</p>
          ) : null}
        </AppSheetBody>
      </AppSheetContent>
    </AppSheet>
  );
}

export function LightingStudioDialog() {
  const { profile } = useDisplayProfile();
  const { value: lightingStudioEnabled } = useFeatureFlag("lighting_studio_enabled");
  const {
    studioOpen,
    closeStudio,
    studioState,
    resolved,
    rawDeviceState,
    previewState,
    setPreviewState,
    clearPreviewState,
    applyPreviewAsProfileBase,
    setActiveProfileId,
    saveProfile,
    duplicateProfile,
    renameProfile,
    deleteProfile,
    togglePinProfile,
    updateAutomation,
    updateCircadianLocationPreference,
    requestDeviceLocation,
    deviceLocationError,
    deviceLocationStatus,
    circadianState,
    manualLockEnabled,
    lockCurrentLook,
    unlockCurrentLook,
    markManualLightingChange,
    isActiveProfileModified,
    capabilities,
    openContextLens,
  } = useLightingStudio();

  const compact = profile === "compact";
  const narrow = profile !== "expanded";
  const [selectedProfileId, setSelectedProfileId] = React.useState<string | null>(studioState.activeProfileId);
  const [selectedSurface, setSelectedSurface] = React.useState<LightingSurface>("case");
  const [saveName, setSaveName] = React.useState("");
  const [renameValue, setRenameValue] = React.useState("");
  const [cityQuery, setCityQuery] = React.useState(studioState.automation.circadian.locationPreference.city ?? "");
  const [selectedCity, setSelectedCity] = React.useState(
    studioState.automation.circadian.locationPreference.city ?? "",
  );
  const [manualLatitude, setManualLatitude] = React.useState(
    studioState.automation.circadian.locationPreference.manualCoordinates?.lat?.toString() ?? "",
  );
  const [manualLongitude, setManualLongitude] = React.useState(
    studioState.automation.circadian.locationPreference.manualCoordinates?.lon?.toString() ?? "",
  );
  const [draft, setDraft] = React.useState<Partial<Record<LightingSurface, LightingSurfaceState>>>(() =>
    buildStudioDraftBase(rawDeviceState, capabilities),
  );
  const [linkMode, setLinkMode] = React.useState<LightingLinkMode>("independent");

  const draftBaseState = React.useMemo(
    () => buildStudioDraftBase(previewState ?? rawDeviceState, capabilities),
    [capabilities, previewState, rawDeviceState],
  );

  const currentSheetTop = React.useMemo(() => {
    const result = resolveAppSheetTopClearancePx();
    assertOverlayRespectsBadgeSafeZone(result, "LightingStudioDialog[expanded]");
    return result;
  }, []);

  React.useEffect(() => {
    if (!studioOpen) return;
    setSelectedProfileId(studioState.activeProfileId);
    setSelectedSurface("case");
    setRenameValue("");
    setSaveName("");
    setCityQuery(studioState.automation.circadian.locationPreference.city ?? "");
    setSelectedCity(studioState.automation.circadian.locationPreference.city ?? "");
    setManualLatitude(studioState.automation.circadian.locationPreference.manualCoordinates?.lat?.toString() ?? "");
    setManualLongitude(studioState.automation.circadian.locationPreference.manualCoordinates?.lon?.toString() ?? "");
    setDraft(buildDraftFromCurrent(draftBaseState));
  }, [
    draftBaseState,
    studioOpen,
    studioState.activeProfileId,
    studioState.automation.circadian.locationPreference.city,
    studioState.automation.circadian.locationPreference.manualCoordinates?.lat,
    studioState.automation.circadian.locationPreference.manualCoordinates?.lon,
  ]);

  const sortedProfiles = React.useMemo(
    () =>
      [...studioState.profiles].sort((left, right) => {
        if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
        if (Boolean(left.bundled) !== Boolean(right.bundled)) return left.bundled ? -1 : 1;
        return left.name.localeCompare(right.name);
      }),
    [studioState.profiles],
  );

  const selectedProfile = sortedProfiles.find((profileEntry) => profileEntry.id === selectedProfileId) ?? null;
  const cityResults = React.useMemo(() => searchLightingCities(cityQuery), [cityQuery]);
  const latitudeError = React.useMemo(() => validateLatitude(manualLatitude), [manualLatitude]);
  const longitudeError = React.useMemo(() => validateLongitude(manualLongitude), [manualLongitude]);
  const manualCoordinatesValid = !latitudeError && !longitudeError;

  const setSurfaceDraft = React.useCallback(
    (surface: LightingSurface, next: LightingSurfaceState) => {
      setDraft((current) => {
        const updated = { ...current, [surface]: next };
        if (linkMode === "linked") {
          const other = surface === "case" ? "keyboard" : "case";
          updated[other] = buildDraftFromCurrent({ [surface]: next })[surface];
        }
        if (linkMode === "mirrored" && next.color?.kind === "named") {
          const other = surface === "case" ? "keyboard" : "case";
          updated[other] = {
            ...next,
            color: { kind: "named", value: mirrorNamedColor(next.color.value) },
          };
        }
        return updated;
      });
    },
    [linkMode],
  );

  const handlePreview = () => {
    setPreviewState(draft);
    markManualLightingChange();
  };

  const handleSaveDraft = () => {
    const trimmed = saveName.trim();
    if (!trimmed) return;
    saveProfile(trimmed, draft);
    setSaveName("");
  };

  if (!lightingStudioEnabled) {
    return null;
  }

  const activeProfileChip = resolved.activeProfile ? (
    <Badge variant="secondary" className="text-xs" data-testid="lighting-active-profile-chip">
      {resolved.activeProfile.name}
      {isActiveProfileModified ? " *" : ""}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-xs" data-testid="lighting-active-profile-chip">
      Device look
    </Badge>
  );

  return (
    <>
      <AppSheet open={studioOpen} onOpenChange={(open) => (open ? undefined : closeStudio())}>
        <AppSheetContent
          className="flex min-w-0 flex-col overflow-hidden p-0 sm:w-[min(100vw-2rem,64rem)]"
          style={{
            top: `${currentSheetTop}px`,
          }}
          data-testid="lighting-studio-sheet"
        >
          <AppSheetHeader closeTestId="lighting-studio-close">
            <AppSheetTitle className={cn("min-w-0", compact && "text-base")}>Lighting Studio</AppSheetTitle>
            <AppSheetDescription className={cn(compact && "sr-only")}>
              {compact ? "Shape looks and automate them." : "Shape looks, save them, and tune the resolver."}
            </AppSheetDescription>
          </AppSheetHeader>

          <AppSheetBody className="min-h-0 px-0 py-0">
            <ScrollArea className="flex-1 min-h-0">
              <div className={cn("space-y-6", compact ? "p-4" : "p-6")}>
                <section data-testid="lighting-header-actions">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {activeProfileChip}
                      {resolved.activeAutomationChip ? (
                        <Badge className="text-xs">{resolved.activeAutomationChip}</Badge>
                      ) : null}
                      {circadianState?.fallbackActive ? (
                        <Badge variant="outline" className="text-xs">
                          Fallback
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 shrink-0 px-2 text-xs"
                        onClick={openContextLens}
                        data-testid="lighting-open-context-lens"
                      >
                        Why
                      </Button>
                      {manualLockEnabled ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-8 shrink-0 px-2 text-xs"
                          onClick={unlockCurrentLook}
                          data-testid="lighting-unlock"
                        >
                          Unlock look
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </section>

                <section className="space-y-3" data-testid="lighting-profiles-section">
                  <div className={cn("flex gap-3", narrow ? "flex-col" : "items-center")}>
                    <div className="min-w-0 flex-1">
                      <h3 className={cn("min-w-0 font-semibold", compact ? "text-sm" : "text-base")}>Profiles</h3>
                      {!compact ? <p className="text-sm text-muted-foreground">Save and reuse looks.</p> : null}
                    </div>
                    <div className={cn("flex shrink-0 gap-1.5", narrow ? "w-full" : "items-center")}>
                      <Input
                        value={saveName}
                        onChange={(event) => setSaveName(event.target.value)}
                        placeholder="Save current"
                        data-testid="lighting-profile-save-name"
                        className={cn("min-w-0", narrow ? "flex-1" : null, compact ? "h-8 text-xs" : "w-40")}
                      />
                      <Button
                        size="sm"
                        onClick={handleSaveDraft}
                        data-testid="lighting-profile-save"
                        className={compact ? "h-8 px-2.5" : undefined}
                      >
                        <Save className="h-3.5 w-3.5" />
                        <span className={cn("ml-1.5", compact && "sr-only")}>Save</span>
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
                    <div className="grid gap-2">
                      {sortedProfiles.map((profileEntry) => {
                        const compatibility =
                          (["case", "keyboard"] as const).filter(
                            (surface) => profileEntry.surfaces[surface] && capabilities[surface].supported,
                          ).length || 0;

                        return (
                          <button
                            key={profileEntry.id}
                            type="button"
                            className={cn(
                              "rounded-xl border p-3 text-left transition-colors",
                              selectedProfileId === profileEntry.id
                                ? "border-primary bg-primary/5"
                                : "border-border/60 bg-card/60",
                            )}
                            onClick={() => {
                              setSelectedProfileId(profileEntry.id);
                              setRenameValue(profileEntry.name);
                            }}
                            data-testid={`lighting-profile-${profileEntry.id}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate font-medium">{profileEntry.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {profileEntry.bundled ? "Bundled" : "Saved"} ·{" "}
                                  {compatibility === 0
                                    ? "Unsupported here"
                                    : compatibility === 2
                                      ? "Full compatibility"
                                      : "Partial compatibility"}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {compatibility === 1 ? <Badge variant="outline">Partial</Badge> : null}
                                {compatibility === 0 ? <Badge variant="destructive">Unsupported</Badge> : null}
                                {profileEntry.pinned ? <Pin className="h-4 w-4 text-primary" /> : null}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div
                      className="min-w-0 rounded-xl border border-border/60 bg-card/60 p-3"
                      data-testid="lighting-profile-detail-card"
                    >
                      <h4 className="font-medium">{selectedProfile?.name ?? "Select a profile"}</h4>
                      {selectedProfile ? (
                        <div className="mt-3 space-y-3">
                          <Input
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            placeholder="Rename profile"
                            disabled={Boolean(selectedProfile.bundled)}
                            data-testid="lighting-profile-rename-input"
                          />
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <Button
                              size="sm"
                              onClick={() => {
                                setActiveProfileId(selectedProfile.id);
                                clearPreviewState();
                              }}
                              data-testid="lighting-profile-apply"
                            >
                              Apply
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => duplicateProfile(selectedProfile.id)}
                              data-testid="lighting-profile-duplicate"
                            >
                              <Copy className="mr-2 h-4 w-4" />
                              Duplicate
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => togglePinProfile(selectedProfile.id)}
                              data-testid="lighting-profile-pin"
                            >
                              {selectedProfile.pinned ? (
                                <PinOff className="mr-2 h-4 w-4" />
                              ) : (
                                <Pin className="mr-2 h-4 w-4" />
                              )}
                              {selectedProfile.pinned ? "Unpin" : "Pin"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => renameProfile(selectedProfile.id, renameValue)}
                              disabled={Boolean(selectedProfile.bundled) || !renameValue.trim()}
                              data-testid="lighting-profile-rename"
                            >
                              Rename
                            </Button>
                          </div>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => deleteProfile(selectedProfile.id)}
                            disabled={Boolean(selectedProfile.bundled)}
                            data-testid="lighting-profile-delete"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">Pick a look to manage it.</p>
                      )}
                    </div>
                  </div>
                </section>

                <Separator />

                <section className="space-y-3" data-testid="lighting-compose-section">
                  <div className={cn("flex gap-3", narrow ? "flex-col" : "items-center justify-between")}>
                    <h3 className={cn("font-semibold", compact ? "text-sm" : "text-base")}>Compose</h3>
                    <div className="flex shrink-0 items-center gap-2">
                      <Label htmlFor="lighting-link-mode" className="text-xs text-muted-foreground">
                        Link
                      </Label>
                      <Select value={linkMode} onValueChange={(value: LightingLinkMode) => setLinkMode(value)}>
                        <SelectTrigger
                          id="lighting-link-mode"
                          className={cn(compact ? "h-8 w-28 text-xs" : "w-40")}
                          data-testid="lighting-link-mode"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="linked">Linked</SelectItem>
                          <SelectItem value="mirrored">Mirrored</SelectItem>
                          <SelectItem value="independent">Independent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(LIGHTING_COMPOSE_PRESET_LABELS) as LightingComposePreset[]).map((preset) => (
                      <Button
                        key={preset}
                        size="sm"
                        variant="outline"
                        onClick={() => setDraft((current) => applyPreset(preset, current))}
                        data-testid={`lighting-preset-${preset}`}
                      >
                        {LIGHTING_COMPOSE_PRESET_LABELS[preset]}
                      </Button>
                    ))}
                  </div>

                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.95fr)]">
                    <LightingDeviceMockup
                      draft={draft}
                      selectedSurface={selectedSurface}
                      keyboardSupported={capabilities.keyboard.supported}
                      onSelectSurface={setSelectedSurface}
                    />

                    <div className="space-y-3">
                      <SurfaceEditor
                        surface="case"
                        draft={draft.case}
                        onChange={(next) => setSurfaceDraft("case", next)}
                        compact={compact}
                      />
                      {capabilities.keyboard.supported ? (
                        <SurfaceEditor
                          surface="keyboard"
                          draft={draft.keyboard}
                          onChange={(next) => setSurfaceDraft("keyboard", next)}
                          compact={compact}
                        />
                      ) : (
                        <div
                          className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground"
                          data-testid="lighting-keyboard-unsupported"
                        >
                          Keyboard lighting is unavailable on this device.
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <Separator />

                <section className="space-y-4" data-testid="lighting-automation-section">
                  <div>
                    <h3 className={cn("font-semibold", compact ? "text-sm" : "text-base")}>Automation</h3>
                    {!compact ? (
                      <p className="text-sm text-muted-foreground">Status, startup, source, and daylight rules.</p>
                    ) : null}
                  </div>

                  <div className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-3">
                    <div className={cn("flex gap-3", narrow ? "flex-wrap" : "items-center justify-between")}>
                      <div>
                        <p className="font-medium">Connection Sentinel</p>
                        <p className="text-sm text-muted-foreground">Map link state to looks.</p>
                      </div>
                      <Switch
                        checked={studioState.automation.connectionSentinel.enabled}
                        onCheckedChange={(checked) =>
                          updateAutomation((state) => ({
                            ...state,
                            connectionSentinel: { ...state.connectionSentinel, enabled: checked === true },
                          }))
                        }
                        data-testid="lighting-connection-sentinel-toggle"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {(Object.keys(CONNECTION_STATE_LABELS) as LightingConnectionSentinelState[]).map((stateKey) => (
                        <div key={stateKey} className="space-y-1.5">
                          <Label>{CONNECTION_STATE_LABELS[stateKey]}</Label>
                          <Select
                            value={studioState.automation.connectionSentinel.mappings[stateKey] ?? "__none__"}
                            onValueChange={(value) =>
                              updateAutomation((state) => ({
                                ...state,
                                connectionSentinel: {
                                  ...state.connectionSentinel,
                                  mappings: {
                                    ...state.connectionSentinel.mappings,
                                    [stateKey]: value === "__none__" ? null : value,
                                  },
                                },
                              }))
                            }
                          >
                            <SelectTrigger data-testid={`lighting-connection-${stateKey}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Base profile</SelectItem>
                              {sortedProfiles.map((profileEntry) => (
                                <SelectItem key={profileEntry.id} value={profileEntry.id}>
                                  {profileEntry.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-3">
                    <div className={cn("flex gap-3", narrow ? "flex-wrap" : "items-center justify-between")}>
                      <div>
                        <p className="font-medium">Quiet Launch</p>
                        <p className="text-sm text-muted-foreground">Use a calm look at startup, then hand off.</p>
                      </div>
                      <Switch
                        checked={studioState.automation.quietLaunch.enabled}
                        onCheckedChange={(checked) =>
                          updateAutomation((state) => ({
                            ...state,
                            quietLaunch: { ...state.quietLaunch, enabled: checked === true },
                          }))
                        }
                        data-testid="lighting-quiet-launch-toggle"
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Launch profile</Label>
                        <Select
                          value={studioState.automation.quietLaunch.profileId ?? "__none__"}
                          onValueChange={(value) =>
                            updateAutomation((state) => ({
                              ...state,
                              quietLaunch: { ...state.quietLaunch, profileId: value === "__none__" ? null : value },
                            }))
                          }
                        >
                          <SelectTrigger data-testid="lighting-quiet-launch-profile">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {sortedProfiles.map((profileEntry) => (
                              <SelectItem key={profileEntry.id} value={profileEntry.id}>
                                {profileEntry.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-background/70 p-3 text-sm text-muted-foreground">
                        Runs for {(studioState.automation.quietLaunch.windowMs / 1000).toFixed(0)}s, then exits on its
                        own or after a manual change.
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-3">
                    <div className={cn("flex gap-3", narrow ? "flex-wrap" : "items-center justify-between")}>
                      <div>
                        <p className="font-medium">Source Identity Map</p>
                        <p className="text-sm text-muted-foreground">Reflect the active source on Play and Disks.</p>
                      </div>
                      <Switch
                        checked={studioState.automation.sourceIdentityMap.enabled}
                        onCheckedChange={(checked) =>
                          updateAutomation((state) => ({
                            ...state,
                            sourceIdentityMap: { ...state.sourceIdentityMap, enabled: checked === true },
                          }))
                        }
                        data-testid="lighting-source-identity-toggle"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {(
                        Object.keys(LIGHTING_SOURCE_BUCKET_LABELS) as Array<keyof typeof LIGHTING_SOURCE_BUCKET_LABELS>
                      ).map((bucket) => (
                        <div key={bucket} className="space-y-1.5">
                          <Label>
                            {bucket === "idle" ? "Idle" : LIGHTING_SOURCE_BUCKET_LABELS[bucket].replace(" look", "")}
                          </Label>
                          <Select
                            value={studioState.automation.sourceIdentityMap.mappings[bucket] ?? "__none__"}
                            onValueChange={(value) =>
                              updateAutomation((state) => ({
                                ...state,
                                sourceIdentityMap: {
                                  ...state.sourceIdentityMap,
                                  mappings: {
                                    ...state.sourceIdentityMap.mappings,
                                    [bucket]: value === "__none__" ? null : value,
                                  },
                                },
                              }))
                            }
                          >
                            <SelectTrigger data-testid={`lighting-source-${bucket}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Base profile</SelectItem>
                              {sortedProfiles.map((profileEntry) => (
                                <SelectItem key={profileEntry.id} value={profileEntry.id}>
                                  {profileEntry.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-3">
                    <div className={cn("flex gap-3", narrow ? "flex-wrap" : "items-center justify-between")}>
                      <div>
                        <p className="font-medium">Circadian Palette</p>
                        <p className="text-sm text-muted-foreground">
                          Offline sun phases from device, manual, or city location.
                        </p>
                      </div>
                      <Switch
                        checked={studioState.automation.circadian.enabled}
                        onCheckedChange={(checked) =>
                          updateAutomation((state) => ({
                            ...state,
                            circadian: { ...state.circadian, enabled: checked === true },
                          }))
                        }
                        data-testid="lighting-circadian-toggle"
                      />
                    </div>
                    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                      <div className="space-y-3">
                        <div
                          className={cn(
                            "rounded-lg border border-border/60 bg-background/70 p-3",
                            narrow ? "space-y-3" : "flex items-center justify-between gap-3",
                          )}
                        >
                          <div>
                            <p className="font-medium">Use device location</p>
                            <p className="text-xs text-muted-foreground">Best when permission is granted.</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={studioState.automation.circadian.locationPreference.useDeviceLocation}
                              onCheckedChange={(checked) =>
                                updateCircadianLocationPreference({ useDeviceLocation: checked === true })
                              }
                              data-testid="lighting-use-device-location"
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={requestDeviceLocation}
                              data-testid="lighting-request-device-location"
                            >
                              <MapPinned className="mr-2 h-4 w-4" />
                              Refresh
                            </Button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Latitude</Label>
                            <Input
                              type="number"
                              step="0.0001"
                              value={manualLatitude}
                              onChange={(event) => setManualLatitude(event.target.value)}
                              data-testid="lighting-manual-latitude"
                            />
                            {latitudeError ? (
                              <p className="text-xs text-destructive" data-testid="lighting-manual-latitude-error">
                                {latitudeError}
                              </p>
                            ) : null}
                          </div>
                          <div className="space-y-1.5">
                            <Label>Longitude</Label>
                            <Input
                              type="number"
                              step="0.0001"
                              value={manualLongitude}
                              onChange={(event) => setManualLongitude(event.target.value)}
                              data-testid="lighting-manual-longitude"
                            />
                            {longitudeError ? (
                              <p className="text-xs text-destructive" data-testid="lighting-manual-longitude-error">
                                {longitudeError}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            updateCircadianLocationPreference({
                              manualCoordinates: {
                                lat: Number(manualLatitude),
                                lon: Number(manualLongitude),
                              },
                            })
                          }
                          disabled={!manualCoordinatesValid}
                          data-testid="lighting-apply-manual-coordinates"
                        >
                          Use manual coordinates
                        </Button>

                        <div className="space-y-1.5">
                          <Label>City</Label>
                          <Input
                            value={cityQuery}
                            onChange={(event) => setCityQuery(event.target.value)}
                            placeholder="Search cities"
                            data-testid="lighting-city-search"
                          />
                          <div className="flex flex-wrap gap-2" data-testid="lighting-city-results">
                            {cityResults.map((city) => (
                              <Button
                                key={city.name}
                                type="button"
                                size="sm"
                                variant={selectedCity === city.name ? "default" : "outline"}
                                onClick={() => {
                                  setCityQuery(city.name);
                                  setSelectedCity(city.name);
                                }}
                                data-testid={`lighting-city-option-${city.name.replace(/\s+/g, "-").toLowerCase()}`}
                              >
                                {city.name}
                              </Button>
                            ))}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => updateCircadianLocationPreference({ city: selectedCity || null })}
                            disabled={!selectedCity}
                            data-testid="lighting-apply-city"
                          >
                            Use city
                          </Button>
                        </div>
                      </div>

                      <div className="rounded-lg border border-border/60 bg-background/70 p-3 text-sm">
                        <div className="flex items-center gap-2">
                          <Info className="h-4 w-4 text-primary" />
                          <p className="font-medium">Current schedule</p>
                        </div>
                        <div className="mt-3 space-y-2 text-muted-foreground">
                          <p data-testid="lighting-circadian-period">
                            Period: {circadianState ? circadianState.period : "Unavailable"}
                          </p>
                          <p data-testid="lighting-circadian-location">
                            Location: {circadianState ? circadianState.resolvedLocation.label : "Not resolved"}
                          </p>
                          <p data-testid="lighting-circadian-next-boundary">
                            Next: {circadianState ? circadianState.nextBoundaryLabel : "Unavailable"}
                          </p>
                          <p data-testid="lighting-circadian-fallback">
                            {circadianState?.fallbackActive ? "Fallback schedule" : "Solar schedule"}
                          </p>
                          <p data-testid="lighting-device-location-status">
                            Device: {deviceLocationStatus}
                            {deviceLocationError ? ` (${deviceLocationError})` : ""}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </ScrollArea>
          </AppSheetBody>

          <AppSheetFooter
            className={cn("shrink-0 border-t border-border/60", compact ? "flex-row gap-1.5 p-3" : "p-5 pt-4")}
          >
            <Button
              variant="outline"
              size={compact ? "sm" : "default"}
              className={compact ? "flex-1" : undefined}
              onClick={clearPreviewState}
              data-testid="lighting-clear-preview"
            >
              {compact ? "Clear" : "Clear preview"}
            </Button>
            <Button
              variant="outline"
              size={compact ? "sm" : "default"}
              className={compact ? "flex-1" : undefined}
              onClick={handlePreview}
              data-testid="lighting-preview"
            >
              Preview
            </Button>
            <Button
              size={compact ? "sm" : "default"}
              className={compact ? "flex-1" : undefined}
              onClick={() => applyPreviewAsProfileBase(studioState.activeProfileId)}
              data-testid="lighting-apply-draft"
            >
              Apply
            </Button>
          </AppSheetFooter>
        </AppSheetContent>
      </AppSheet>
      <LightingContextLensDialog />
    </>
  );
}
