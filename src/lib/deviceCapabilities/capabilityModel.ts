/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Dynamic device-capability model.
 *
 * Feature availability is driven by REST-discovered capabilities where a safe
 * read-only signal exists, and falls back to a documented product-family default
 * only where the REST API does not expose a capability. UI feature gates MUST
 * consume the predicates here (`supportsStreaming`, `supportsMenuInput`,
 * `supportsPowerCycle`) rather than raw `device.type === "C64U"`-style checks.
 *
 * Firmware grounding (1541ultimate source):
 * - Streaming (`/v1/streams`, route_streams.cc) is compiled into the U64 family
 *   only (Ultimate 64 / Elite / 64-II — the "C64 Ultimate" board is internally a
 *   U64-family device). The Ultimate II family (U2) exposes NO REST streams
 *   endpoint at all, so streaming is never assumed for U2.
 * - `/v1/machine:menu_button` is compiled on every family → menu input is a
 *   shared capability of any recognised, reachable Ultimate device.
 * - The Home power-cycle action matches the families that exposed it before this
 *   model existed ({C64U, U64E2}); U2 is excluded.
 */

import { resolveCanonicalProductFamilyCode } from "@/lib/savedDevices/store";
import type { ProductFamilyCode } from "@/lib/savedDevices/store";

export type DeviceFamily = ProductFamilyCode | "unknown";

/** How a derived capability value was decided. */
export type CapabilitySource = "rest-config" | "family-default" | "unknown";

export type DeviceCapabilities = {
  /** Resolved product family, or "unknown" for an unrecognised product. */
  family: DeviceFamily;
  /** Raw `/v1/info` product string (trimmed), or null. Preserved for display. */
  productString: string | null;
  /** Whether the device answered the read-only REST identity probe. */
  restReachable: boolean;
  firmwareVersion: string | null;
  /** U64-family only in firmware (`#ifdef U64`); null elsewhere. */
  coreVersion: string | null;
  /** Live video/audio streaming (`/v1/streams`). Never assumed for U2/unknown. */
  supportsStreaming: boolean;
  /** Machine menu navigation (`/v1/machine:menu_button`). */
  supportsMenuInput: boolean;
  /** Home power-cycle action. */
  supportsPowerCycle: boolean;
  /** Provenance of `supportsStreaming` (rest-config override vs family default). */
  streamingSource: CapabilitySource;
};

export type DeviceCapabilityInput = {
  product?: string | null;
  firmwareVersion?: string | null;
  coreVersion?: string | null;
  /** Defaults to "a product string was returned" when omitted. */
  restReachable?: boolean;
  /**
   * REST-discovered streaming signal: whether the device's config advertises the
   * video/audio stream endpoints (Data Streams "Stream VIC to" / "Stream Audio to"
   * items). `undefined`/`null` = not discovered → fall back to the family default.
   * Providing this is what makes the streaming gate capability-driven rather than
   * family-driven: a U2 that advertises streaming flips to `true`; a U64 whose
   * config explicitly lacks it flips to `false`.
   */
  streamEndpointsAdvertised?: boolean | null;
};

// Families with C64 video/audio hardware → /v1/streams compiled in firmware.
const VIDEO_STREAM_FAMILIES: ReadonlySet<DeviceFamily> = new Set<DeviceFamily>(["C64U", "U64", "U64E", "U64E2"]);

// Families exposing the Home power-cycle action (matches the pre-capability gate).
const POWER_CYCLE_FAMILIES: ReadonlySet<DeviceFamily> = new Set<DeviceFamily>(["C64U", "U64E2"]);

const trimOrNull = (value?: string | null): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed.length ? trimmed : null;
};

export const deriveDeviceCapabilities = (input: DeviceCapabilityInput = {}): DeviceCapabilities => {
  const productString = trimOrNull(input.product);
  const family: DeviceFamily = resolveCanonicalProductFamilyCode(productString) ?? "unknown";
  // A REST-discovered streaming signal (boolean) implies the device answered a
  // read-only config probe, i.e. it is reachable — even if no product string was
  // supplied alongside it.
  const hasStreamSignal = typeof input.streamEndpointsAdvertised === "boolean";
  const restReachable = input.restReachable ?? (Boolean(productString) || hasStreamSignal);

  let supportsStreaming: boolean;
  let streamingSource: CapabilitySource;
  if (hasStreamSignal) {
    // Prefer the REST-discovered capability signal over the family default. This is
    // what makes the gate capability-driven rather than family-driven.
    supportsStreaming = input.streamEndpointsAdvertised as boolean;
    streamingSource = "rest-config";
  } else if (family === "unknown") {
    // Unknown devices are not granted advanced capabilities by default.
    supportsStreaming = false;
    streamingSource = "unknown";
  } else {
    supportsStreaming = restReachable && VIDEO_STREAM_FAMILIES.has(family);
    streamingSource = "family-default";
  }

  return {
    family,
    productString,
    restReachable,
    firmwareVersion: trimOrNull(input.firmwareVersion),
    coreVersion: trimOrNull(input.coreVersion),
    supportsStreaming,
    supportsMenuInput: restReachable && family !== "unknown",
    supportsPowerCycle: restReachable && POWER_CYCLE_FAMILIES.has(family),
    streamingSource,
  };
};

// Predicate accessors. UI feature gates consume these, never raw family literals.
export const supportsStreaming = (capabilities: DeviceCapabilities): boolean => capabilities.supportsStreaming;
export const supportsMenuInput = (capabilities: DeviceCapabilities): boolean => capabilities.supportsMenuInput;
export const supportsPowerCycle = (capabilities: DeviceCapabilities): boolean => capabilities.supportsPowerCycle;

/**
 * Read-only signal: does this config payload advertise video/audio stream targets?
 * Used to feed `streamEndpointsAdvertised` so the streaming gate is REST-driven.
 * Returns `null` when the Data Streams category is absent (not discovered) so the
 * caller can fall back to the family default rather than wrongly inferring "off".
 */
export const detectStreamingFromConfig = (configRoot?: Record<string, unknown> | null): boolean | null => {
  if (!configRoot || typeof configRoot !== "object") return null;
  const category = (configRoot["Data Streams"] ?? configRoot) as Record<string, unknown> | undefined;
  const items = (category?.items ?? category) as Record<string, unknown> | undefined;
  if (!items || typeof items !== "object") return null;
  const hasDataStreams = Object.prototype.hasOwnProperty.call(configRoot, "Data Streams");
  const hasVic = Object.prototype.hasOwnProperty.call(items, "Stream VIC to");
  const hasAudio = Object.prototype.hasOwnProperty.call(items, "Stream Audio to");
  if (!hasDataStreams && !hasVic && !hasAudio) return null;
  return hasVic || hasAudio;
};
