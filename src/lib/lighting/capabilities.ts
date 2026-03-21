/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getLedColorRgb, rgbToCss } from "@/lib/config/ledColors";
import { extractConfigValue } from "@/lib/config/configValueExtractor";
import { LIGHTING_SURFACE_TO_CATEGORY } from "@/lib/lighting/constants";
import type {
  LightingColorSpec,
  LightingDeviceCapability,
  LightingSurface,
  LightingSurfaceState,
} from "@/lib/lighting/types";

const asRecord = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : null);

const readItemsBlock = (config: Record<string, unknown> | undefined) => {
  const direct = asRecord(config);
  if (!direct) return null;
  const items = asRecord(direct.items);
  return items ?? direct;
};

const readOptions = (itemsBlock: Record<string, unknown> | null, key: string) => {
  const item = asRecord(itemsBlock?.[key]);
  const options = item?.options ?? item?.values;
  return Array.isArray(options) ? options.map((value) => String(value)) : [];
};

const readNumericDetail = (
  itemsBlock: Record<string, unknown> | null,
  key: string,
  field: "min" | "max",
  fallback: number,
) => {
  const item = asRecord(itemsBlock?.[key]);
  const raw = item?.[field];
  return typeof raw === "number" ? raw : fallback;
};

const readValue = (itemsBlock: Record<string, unknown> | null, key: string) => extractConfigValue(itemsBlock?.[key]);

const clampIntensity = (value: number, capability: LightingDeviceCapability) =>
  Math.max(capability.intensityRange.min, Math.min(capability.intensityRange.max, Math.round(value)));

export const normalizeLightingCapability = (
  surface: LightingSurface,
  config: Record<string, unknown> | undefined,
): LightingDeviceCapability => {
  const itemsBlock = readItemsBlock(config);
  const namedColorOptions = readOptions(itemsBlock, "Fixed Color");
  const hasRgb =
    itemsBlock !== null &&
    ["Fixed Color Red", "Fixed Color Green", "Fixed Color Blue"].every((key) =>
      Object.prototype.hasOwnProperty.call(itemsBlock, key),
    );
  const supported = itemsBlock !== null && Object.keys(itemsBlock).length > 0;

  return {
    surface,
    category: LIGHTING_SURFACE_TO_CATEGORY[surface],
    supported,
    supportedModes: readOptions(itemsBlock, "LedStrip Mode"),
    supportedPatterns: readOptions(itemsBlock, "LedStrip Pattern"),
    supportedNamedColors: namedColorOptions,
    supportsTint:
      readOptions(itemsBlock, "Color tint").length > 0 ||
      Object.prototype.hasOwnProperty.call(itemsBlock ?? {}, "Color tint"),
    supportedTints: readOptions(itemsBlock, "Color tint"),
    supportsSidSelect:
      readOptions(itemsBlock, "LedStrip SID Select").length > 0 ||
      Object.prototype.hasOwnProperty.call(itemsBlock ?? {}, "LedStrip SID Select"),
    supportedSidSelects: readOptions(itemsBlock, "LedStrip SID Select"),
    intensityRange: {
      min: readNumericDetail(itemsBlock, "Strip Intensity", "min", 0),
      max: readNumericDetail(itemsBlock, "Strip Intensity", "max", 31),
    },
    colorEncoding: namedColorOptions.length > 0 ? "named" : hasRgb ? "rgb" : null,
  };
};

export const normalizeLightingState = (
  capability: LightingDeviceCapability,
  config: Record<string, unknown> | undefined,
): LightingSurfaceState | null => {
  if (!capability.supported) return null;
  const itemsBlock = readItemsBlock(config);
  const intensityValue = readValue(itemsBlock, "Strip Intensity");
  let color: LightingColorSpec | undefined;
  if (capability.colorEncoding === "named") {
    const named = String(readValue(itemsBlock, "Fixed Color") || "");
    if (named) {
      color = { kind: "named", value: named };
    }
  } else if (capability.colorEncoding === "rgb") {
    color = {
      kind: "rgb",
      r: Number(readValue(itemsBlock, "Fixed Color Red") || 0),
      g: Number(readValue(itemsBlock, "Fixed Color Green") || 0),
      b: Number(readValue(itemsBlock, "Fixed Color Blue") || 0),
    };
  }

  return {
    mode: String(readValue(itemsBlock, "LedStrip Mode") || ""),
    pattern: String(readValue(itemsBlock, "LedStrip Pattern") || ""),
    color,
    tint: capability.supportsTint ? String(readValue(itemsBlock, "Color tint") || "") : undefined,
    intensity:
      typeof intensityValue === "number" || typeof intensityValue === "string"
        ? clampIntensity(Number(intensityValue || 0), capability)
        : undefined,
    sidSelect: capability.supportsSidSelect ? String(readValue(itemsBlock, "LedStrip SID Select") || "") : undefined,
  };
};

export const normalizeSurfaceStateForCapability = (
  capability: LightingDeviceCapability,
  state: LightingSurfaceState | undefined,
): LightingSurfaceState | null => {
  if (!capability.supported || !state) return null;
  const normalized: LightingSurfaceState = {};
  if (state.mode && (capability.supportedModes.length === 0 || capability.supportedModes.includes(state.mode))) {
    normalized.mode = state.mode;
  }
  if (
    state.pattern &&
    (capability.supportedPatterns.length === 0 || capability.supportedPatterns.includes(state.pattern))
  ) {
    normalized.pattern = state.pattern;
  }
  if (typeof state.intensity === "number") {
    normalized.intensity = clampIntensity(state.intensity, capability);
  }
  if (capability.supportsTint && state.tint) {
    normalized.tint =
      capability.supportedTints.length === 0 || capability.supportedTints.includes(state.tint) ? state.tint : undefined;
  }
  if (capability.supportsSidSelect && state.sidSelect) {
    normalized.sidSelect =
      capability.supportedSidSelects.length === 0 || capability.supportedSidSelects.includes(state.sidSelect)
        ? state.sidSelect
        : undefined;
  }
  if (state.color && capability.colorEncoding) {
    if (capability.colorEncoding === "named") {
      if (state.color.kind === "named") {
        normalized.color =
          capability.supportedNamedColors.length === 0 || capability.supportedNamedColors.includes(state.color.value)
            ? state.color
            : undefined;
      } else {
        const closest = rgbToNamedColor(state.color.r, state.color.g, state.color.b, capability.supportedNamedColors);
        normalized.color = closest ? { kind: "named", value: closest } : undefined;
      }
    } else if (capability.colorEncoding === "rgb") {
      if (state.color.kind === "rgb") {
        normalized.color = state.color;
      } else {
        const rgb = getLedColorRgb(state.color.value);
        normalized.color = rgb ? { kind: "rgb", r: rgb.r, g: rgb.g, b: rgb.b } : undefined;
      }
    }
  }
  return normalized;
};

const rgbDistance = (left: { r: number; g: number; b: number }, right: { r: number; g: number; b: number }) =>
  Math.pow(left.r - right.r, 2) + Math.pow(left.g - right.g, 2) + Math.pow(left.b - right.b, 2);

const rgbToNamedColor = (r: number, g: number, b: number, allowed: string[]) => {
  let best: { name: string; distance: number } | null = null;
  for (const option of allowed) {
    const rgb = getLedColorRgb(option);
    if (!rgb) continue;
    const distance = rgbDistance({ r, g, b }, rgb);
    if (!best || distance < best.distance) {
      best = { name: option, distance };
    }
  }
  return best?.name ?? null;
};

export const buildLightingUpdatePayload = (
  capability: LightingDeviceCapability,
  state: LightingSurfaceState,
): Record<string, string | number> => {
  const normalized = normalizeSurfaceStateForCapability(capability, state);
  if (!normalized) return {};
  const payload: Record<string, string | number> = {};
  if (normalized.mode) payload["LedStrip Mode"] = normalized.mode;
  if (normalized.pattern) payload["LedStrip Pattern"] = normalized.pattern;
  if (typeof normalized.intensity === "number") payload["Strip Intensity"] = normalized.intensity;
  if (capability.supportsTint && normalized.tint) payload["Color tint"] = normalized.tint;
  if (capability.supportsSidSelect && normalized.sidSelect) payload["LedStrip SID Select"] = normalized.sidSelect;
  if (normalized.color) {
    if (capability.colorEncoding === "named" && normalized.color.kind === "named") {
      payload["Fixed Color"] = normalized.color.value;
    }
    if (capability.colorEncoding === "rgb" && normalized.color.kind === "rgb") {
      payload["Fixed Color Red"] = normalized.color.r;
      payload["Fixed Color Green"] = normalized.color.g;
      payload["Fixed Color Blue"] = normalized.color.b;
    }
  }
  return payload;
};

export const lightingStateEquals = (
  left: LightingSurfaceState | null | undefined,
  right: LightingSurfaceState | null | undefined,
) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

export const formatLightingColor = (color: LightingColorSpec | undefined) => {
  if (!color) return "Unset";
  if (color.kind === "named") return color.value;
  return rgbToCss({ r: color.r, g: color.g, b: color.b });
};
