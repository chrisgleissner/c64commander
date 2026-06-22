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
 * Firmware grounding (1541ultimate; see docs/research/device-discovery/firmware-capabilities.md):
 * The features that differ by device are exactly the firmware-documented "U64-only"
 * set — `/v1/machine:poweroff`, `/v1/machine:debugreg`, and `/v1/streams` — and every
 * one of them has a RUNTIME signal, so NO product-family literal is used as a feature
 * gate:
 * - `/v1/info.core_version` is returned "only for Ultimate 64 devices" (integrated
 *   computers: Ultimate 64 / Elite / Elite-II and the "C64 Ultimate" board). Its
 *   presence is therefore the runtime discriminator for the U64-only feature set, and
 *   its absence marks an Ultimate-II cartridge (U2). Verified live: U64 `core 1.4B`,
 *   C64U `core 1.49`; U2 cartridges return no `core_version`.
 * - Streaming prefers the REST config signal (Data Streams `Stream VIC/Audio to`) and
 *   falls back to `core_version` presence — never a family list. A U2 whose config
 *   advertises streaming flips on; a U64 whose config disables it flips off.
 * - `/v1/machine:menu_button` is compiled on every family → menu input is granted to
 *   any recognised, reachable Ultimate (family classification only distinguishes a
 *   recognised Ultimate from an unknown non-Ultimate host — there is no runtime field
 *   for that, so it stays a heuristic).
 */

import { resolveCanonicalProductFamilyCode } from "@/lib/savedDevices/store";
import type { ProductFamilyCode } from "@/lib/savedDevices/store";

/**
 * How a derived capability value was decided:
 * - `rest-config`: a read-only `/v1/configs` signal decided it (most precise).
 * - `core-version`: decided by `/v1/info.core_version` presence (the U64-family marker).
 * - `unknown`: no runtime signal and/or the device was not reachable.
 */
export type CapabilitySource = "rest-config" | "core-version" | "unknown";

export type DeviceFamily = ProductFamilyCode | "unknown";

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

const trimOrNull = (value?: string | null): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed.length ? trimmed : null;
};

export const deriveDeviceCapabilities = (input: DeviceCapabilityInput = {}): DeviceCapabilities => {
  const productString = trimOrNull(input.product);
  // `family` is for display/labels only — it is NEVER used as a feature gate.
  const family: DeviceFamily = resolveCanonicalProductFamilyCode(productString) ?? "unknown";
  const coreVersion = trimOrNull(input.coreVersion);
  // The firmware returns `core_version` only for integrated Ultimate 64-family
  // computers (incl. the C64 Ultimate board), which are exactly the devices that
  // expose the U64-only feature set (poweroff / debugreg / streams). Cartridges (U2)
  // omit it. This is the runtime discriminator that replaces every family literal.
  const isIntegratedComputer = coreVersion !== null;
  // A REST-discovered streaming signal (boolean) implies the device answered a
  // read-only config probe, i.e. it is reachable — even if no product string was
  // supplied alongside it.
  const hasStreamSignal = typeof input.streamEndpointsAdvertised === "boolean";
  const restReachable = input.restReachable ?? (Boolean(productString) || hasStreamSignal);

  let supportsStreaming: boolean;
  let streamingSource: CapabilitySource;
  if (hasStreamSignal) {
    // Most precise: the device's own config says whether stream targets exist. This
    // is what makes the gate capability-driven rather than family-driven.
    supportsStreaming = input.streamEndpointsAdvertised as boolean;
    streamingSource = "rest-config";
  } else if (restReachable && isIntegratedComputer) {
    // No config probed yet: streams are a U64-family feature, marked at runtime by
    // `/v1/info.core_version` presence — not by a product-family literal.
    supportsStreaming = true;
    streamingSource = "core-version";
  } else {
    // No config signal and no `core_version` (cartridge / unknown / unreachable).
    supportsStreaming = false;
    streamingSource = "unknown";
  }

  return {
    family,
    productString,
    restReachable,
    firmwareVersion: trimOrNull(input.firmwareVersion),
    coreVersion,
    supportsStreaming,
    // menu_button is compiled on every family; only require a recognised, reachable
    // Ultimate (there is no runtime field distinguishing an unrecognised Ultimate from
    // a non-Ultimate host, so this stays a heuristic).
    supportsMenuInput: restReachable && family !== "unknown",
    // poweroff / power-cycle are integrated-computer-only → gate on the runtime
    // `core_version` signal, never a family list. Cartridges (no core_version) are
    // correctly excluded; all U64-family computers (incl. plain U64/Elite) included.
    supportsPowerCycle: restReachable && isIntegratedComputer,
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
