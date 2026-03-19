import React from "react";
import { Copy, Info, MapPinned, PauseCircle, Pin, PinOff, PlayCircle, Save, Sparkles, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useLightingStudio } from "@/hooks/useLightingStudio";
import { getLedColorRgb, rgbToCss } from "@/lib/config/ledColors";
import { formatLightingColor, normalizeSurfaceStateForCapability } from "@/lib/lighting/capabilities";
import { searchLightingCities } from "@/lib/lighting/cityDataset";
import { LIGHTING_COMPOSE_PRESET_LABELS, LIGHTING_SOURCE_BUCKET_LABELS } from "@/lib/lighting/constants";
import type {
  LightingComposePreset,
  LightingConnectionSentinelState,
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
const KEYBOARD_ROW_LENGTHS = [15, 15, 14, 11, 10] as const;

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

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const mixRgb = (
  primary: { r: number; g: number; b: number },
  secondary: { r: number; g: number; b: number },
  ratio: number,
) => {
  const blend = clamp01(ratio);
  return {
    r: Math.round(primary.r * (1 - blend) + secondary.r * blend),
    g: Math.round(primary.g * (1 - blend) + secondary.g * blend),
    b: Math.round(primary.b * (1 - blend) + secondary.b * blend),
  };
};

const scaleGlowAlpha = (intensity: number | undefined, max = 0.9, min = 0.18) =>
  min + (max - min) * clamp01((intensity ?? 0) / 31);

const toRgba = (rgb: { r: number; g: number; b: number }, alpha: number) =>
  `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;

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

      {capability.colorEncoding === "rgb" && normalized.color?.kind === "rgb" ? (
        <div className="grid grid-cols-3 gap-2">
          {(["r", "g", "b"] as const).map((channel) => (
            <div key={channel} className="space-y-1">
              <Label>{channel.toUpperCase()}</Label>
              <Input
                type="number"
                min={0}
                max={255}
                value={normalized.color[channel] ?? 0}
                onChange={(event) =>
                  onChange({
                    ...normalized,
                    color: {
                      kind: "rgb",
                      ...(normalized.color?.kind === "rgb" ? normalized.color : { r: 0, g: 0, b: 0 }),
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
  const caseGlowAlpha = scaleGlowAlpha(draft.case?.intensity, 0.78, 0.2);
  const keyboardGlowAlpha = scaleGlowAlpha(draft.keyboard?.intensity ?? draft.case?.intensity, 0.86, 0.18);
  const blendedKeyRgb = mixRgb(caseRgb, keyboardRgb, 0.7);
  let keyIndex = 0;

  return (
    <div className="space-y-3 rounded-2xl border border-border/60 bg-card/70 p-4" data-testid="lighting-device-mockup">
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

      <div className="rounded-[28px] border border-border/60 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.07),_transparent_58%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.94))] p-4">
        <div className="mx-auto w-full max-w-[28rem] [perspective:1400px]">
          <div
            className="relative aspect-[16/10] origin-top rounded-[30px] border border-white/10 bg-slate-900/80 shadow-[0_32px_80px_rgba(15,23,42,0.55)] [transform:rotateX(46deg)]"
            style={{
              boxShadow: `0 32px 80px rgba(15, 23, 42, 0.55), 0 0 0 1px ${toRgba(caseRgb, caseGlowAlpha * 0.35)}`,
              background: `
                radial-gradient(circle at 50% 110%, ${toRgba(caseRgb, caseGlowAlpha * 0.72)}, transparent 52%),
                linear-gradient(180deg, rgba(226,232,240,0.06), rgba(15,23,42,0.02) 16%, rgba(15,23,42,0.82) 30%, rgba(2,6,23,0.96))
              `,
            }}
          >
            <button
              type="button"
              onClick={() => onSelectSurface("case")}
              className={cn(
                "absolute inset-0 rounded-[30px] border transition",
                selectedSurface === "case"
                  ? "border-white/70 ring-2 ring-white/60"
                  : "border-white/10 hover:border-white/30",
              )}
              data-testid="lighting-mockup-case-shell"
              aria-label="Edit case lighting"
            />

            <div
              className="absolute inset-x-[8%] top-[17%] bottom-[15%] rounded-[24px] border border-white/8"
              style={{
                background: `
                  linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0) 18%),
                  radial-gradient(circle at 50% 100%, ${toRgba(caseRgb, caseGlowAlpha * 0.82)}, transparent 62%),
                  linear-gradient(180deg, rgba(15,23,42,0.58), rgba(15,23,42,0.86))
                `,
              }}
            />

            <div
              className="absolute inset-x-[12%] top-[29%] bottom-[28%] rounded-[16px] border border-white/8 px-[3.5%] py-[4%]"
              style={{
                background: `
                  radial-gradient(circle at 50% 100%, ${toRgba(keyboardRgb, keyboardGlowAlpha * 0.88)}, transparent 58%),
                  radial-gradient(circle at 50% 110%, ${toRgba(caseRgb, caseGlowAlpha * 0.45)}, transparent 62%),
                  linear-gradient(180deg, rgba(15,23,42,0.34), rgba(15,23,42,0.82))
                `,
              }}
            >
              <div
                className="grid h-full gap-[4px]"
                style={{ gridTemplateRows: `repeat(${KEYBOARD_ROW_LENGTHS.length}, minmax(0, 1fr))` }}
              >
                {KEYBOARD_ROW_LENGTHS.map((length, rowIndex) => (
                  <div key={rowIndex} className="flex justify-center gap-[4px]">
                    {Array.from({ length }).map((_, index) => {
                      const isSpace = rowIndex === KEYBOARD_ROW_LENGTHS.length - 1 && index >= 3 && index <= 7;
                      const widthClassName = isSpace ? "w-[18%]" : rowIndex === 4 && index === 0 ? "w-[8%]" : "w-full";
                      const keyId = keyIndex++;
                      return (
                        <button
                          key={keyId}
                          type="button"
                          onClick={() => keyboardSupported && onSelectSurface("keyboard")}
                          className={cn(
                            "min-w-0 rounded-[6px] border border-white/10 transition",
                            keyboardSupported && selectedSurface === "keyboard"
                              ? "ring-1 ring-white/75 border-white/60"
                              : "hover:border-white/35",
                            widthClassName,
                            !keyboardSupported && "cursor-default opacity-80",
                          )}
                          style={{
                            background: `
                              linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.02) 34%, rgba(15,23,42,0.48) 35%, rgba(15,23,42,0.74)),
                              radial-gradient(circle at 50% 135%, ${toRgba(blendedKeyRgb, keyboardGlowAlpha * 0.92)}, transparent 68%),
                              radial-gradient(circle at 50% 120%, ${toRgba(caseRgb, caseGlowAlpha * 0.34)}, transparent 74%)
                            `,
                            boxShadow: `
                              inset 0 1px 0 rgba(255,255,255,0.18),
                              0 1px 0 rgba(15,23,42,0.46),
                              0 4px 14px ${toRgba(keyboardRgb, keyboardGlowAlpha * 0.34)}
                            `,
                          }}
                          data-testid={`lighting-mockup-key-${keyId}`}
                          aria-label={`Edit keyboard lighting from key ${keyId + 1}`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div
              className="absolute bottom-[10%] left-[18%] right-[18%] h-[11%] rounded-b-[18px] border border-white/10"
              style={{
                background: `
                  linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0) 26%),
                  radial-gradient(circle at 50% 20%, ${toRgba(caseRgb, caseGlowAlpha * 0.4)}, transparent 76%),
                  linear-gradient(180deg, rgba(30,41,59,0.54), rgba(15,23,42,0.88))
                `,
              }}
            />
          </div>
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
  const { profile } = useDisplayProfile();
  const { contextLensOpen, closeContextLens, resolved } = useLightingStudio();

  return (
    <Dialog open={contextLensOpen} onOpenChange={(open) => (open ? undefined : closeContextLens())}>
      <DialogContent surface="secondary-editor" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Context Lens</DialogTitle>
          <DialogDescription>
            {profile === "compact"
              ? "Who owns each surface right now."
              : "Which resolver layer currently owns each lighting surface."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {resolved.contextLens.map((entry) => (
            <div key={`${entry.surface}-${entry.owner}`} className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{entry.surface === "case" ? "Case" : "Keys"}</p>
                <Badge variant="secondary">{entry.label}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{entry.detail}</p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LightingStudioDialog() {
  const { profile } = useDisplayProfile();
  const {
    studioOpen,
    closeStudio,
    studioState,
    resolved,
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
    buildDraftFromCurrent(resolved.resolvedState),
  );
  const [linkMode, setLinkMode] = React.useState<LightingLinkMode>("independent");

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
    setDraft(buildDraftFromCurrent(previewState ?? resolved.resolvedState));
  }, [
    previewState,
    resolved.resolvedState,
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

  const activeProfileChip = resolved.activeProfile ? (
    <Badge variant="secondary" data-testid="lighting-active-profile-chip">
      {resolved.activeProfile.name}
      {isActiveProfileModified ? " *" : ""}
    </Badge>
  ) : (
    <Badge variant="outline" data-testid="lighting-active-profile-chip">
      Device look
    </Badge>
  );

  return (
    <>
      <Dialog open={studioOpen} onOpenChange={(open) => (open ? undefined : closeStudio())}>
        <DialogContent surface="secondary-editor" className="max-w-5xl p-0">
          <DialogHeader className={cn("border-b border-border/60", compact ? "p-4 pb-3" : "p-6 pb-4")}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <DialogTitle>Lighting Studio</DialogTitle>
                <DialogDescription>
                  {compact ? "Shape looks and automate them." : "Shape looks, save them, and tune the resolver."}
                </DialogDescription>
                <div className="flex flex-wrap gap-2">
                  {activeProfileChip}
                  {resolved.activeAutomationChip ? <Badge>{resolved.activeAutomationChip}</Badge> : null}
                  {circadianState?.fallbackActive ? <Badge variant="outline">Fallback schedule</Badge> : null}
                </div>
              </div>
              <div className={cn("flex flex-wrap items-center gap-2", compact && "w-full")}>
                <Button variant="ghost" size="sm" onClick={openContextLens} data-testid="lighting-open-context-lens">
                  Why
                </Button>
                {manualLockEnabled ? (
                  <Button variant="outline" size="sm" onClick={unlockCurrentLook} data-testid="lighting-unlock">
                    <PlayCircle className="mr-2 h-4 w-4" />
                    Resume
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={lockCurrentLook} data-testid="lighting-lock">
                    <PauseCircle className="mr-2 h-4 w-4" />
                    Hold look
                  </Button>
                )}
              </div>
            </div>

            <div className={cn("mt-4 grid gap-3", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
              {(["case", "keyboard"] as const).map((surface) => (
                <div key={surface} className="rounded-xl border border-border/60 bg-card/70 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{surface === "case" ? "Case" : "Keys"}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatLightingColor((previewState?.[surface] ?? resolved.resolvedState[surface])?.color)}
                      </p>
                    </div>
                    <div
                      className="h-11 w-11 rounded-full border border-border/60"
                      style={composeSurfaceSwatchStyle(previewState?.[surface] ?? resolved.resolvedState[surface])}
                    />
                  </div>
                </div>
              ))}
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh]">
            <div className={cn("space-y-6", compact ? "p-4" : "p-6")}>
              <section className="space-y-3" data-testid="lighting-profiles-section">
                <div className={cn("flex items-start justify-between gap-3", compact && "flex-col")}>
                  <div>
                    <h3 className="text-base font-semibold">Profiles</h3>
                    <p className="text-sm text-muted-foreground">Save and reuse looks.</p>
                  </div>
                  <div
                    className={cn(
                      "grid w-full gap-2",
                      compact ? "grid-cols-1" : "sm:w-auto sm:grid-cols-[minmax(0,13rem)_auto] sm:items-center",
                    )}
                  >
                    <Input
                      value={saveName}
                      onChange={(event) => setSaveName(event.target.value)}
                      placeholder="Save current"
                      data-testid="lighting-profile-save-name"
                      className="w-full min-w-0"
                    />
                    <Button onClick={handleSaveDraft} data-testid="lighting-profile-save">
                      <Save className="mr-2 h-4 w-4" />
                      Save
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

                  <div className="min-w-0 rounded-xl border border-border/60 bg-card/60 p-4">
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
                        <div className="grid gap-2 sm:grid-cols-2">
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
                <div className={cn("flex flex-wrap items-center justify-between gap-3", compact && "items-start")}>
                  <div>
                    <h3 className="text-base font-semibold">Compose</h3>
                    <p className="text-sm text-muted-foreground">Tune shell and keys together.</p>
                  </div>
                  <div className={cn("flex items-center gap-2", compact && "w-full flex-wrap")}>
                    <Label htmlFor="lighting-link-mode">Link mode</Label>
                    <Select value={linkMode} onValueChange={(value: LightingLinkMode) => setLinkMode(value)}>
                      <SelectTrigger id="lighting-link-mode" className="w-40" data-testid="lighting-link-mode">
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
                  <h3 className="text-base font-semibold">Automation</h3>
                  <p className="text-sm text-muted-foreground">Status, startup, source, and daylight rules.</p>
                </div>

                <div className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-4">
                  <div className="flex items-center justify-between">
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
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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

                <div className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-4">
                  <div className="flex items-center justify-between">
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
                      Runs for {(studioState.automation.quietLaunch.windowMs / 1000).toFixed(0)}s, then exits on its own
                      or after a manual change.
                    </div>
                  </div>
                </div>

                <div className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-4">
                  <div className="flex items-center justify-between">
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
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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

                <div className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-4">
                  <div className="flex items-center justify-between">
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
                      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/70 p-3">
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

                      <div className="grid grid-cols-2 gap-3">
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

          <DialogFooter className={cn("border-t border-border/60", compact ? "p-4 pt-3" : "p-6 pt-4")}>
            <Button variant="outline" onClick={clearPreviewState} data-testid="lighting-clear-preview">
              Clear preview
            </Button>
            <Button variant="outline" onClick={handlePreview} data-testid="lighting-preview">
              Preview
            </Button>
            <Button
              onClick={() => applyPreviewAsProfileBase(studioState.activeProfileId)}
              data-testid="lighting-apply-draft"
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <LightingContextLensDialog />
    </>
  );
}
