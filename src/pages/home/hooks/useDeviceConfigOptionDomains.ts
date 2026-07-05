/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { getC64API } from "@/lib/c64api";
import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import { useConnectionRoutingEpoch } from "@/hooks/useC64Connection";
import { addLog } from "@/lib/logging";
import { readItemDetails, readItemOptions } from "../utils/HomeConfigUtils";

/**
 * A single device config item, identified by its live REST `{category, item}` coordinate.
 */
export type DeviceConfigItemRef = { category: string; item: string };

/**
 * The device-reported constraints for one config item: the enum `values` (`options`) and/or the
 * numeric bounds (`min`/`max`/`format`). Either half may be absent depending on the item type.
 */
export type DeviceConfigDomain = {
  options?: string[];
  min?: number;
  max?: number;
  format?: string;
};

/**
 * Map of `"Category::Item"` -> that item's device-reported {@link DeviceConfigDomain}.
 */
export type DeviceConfigOptionDomains = Record<string, DeviceConfigDomain>;

export const buildOptionDomainKey = (category: string, item: string) => `${category}::${item}`;

const toDomain = (
  options: string[] | undefined,
  details: { min?: number; max?: number; format?: string } | undefined,
): DeviceConfigDomain | undefined => {
  const domain: DeviceConfigDomain = {};
  if (options && options.length) domain.options = options.map(String);
  if (details?.min !== undefined) domain.min = details.min;
  if (details?.max !== undefined) domain.max = details.max;
  if (details?.format !== undefined) domain.format = details.format;
  return Object.keys(domain).length ? domain : undefined;
};

const extractCachedDomain = (category: string, item: string): DeviceConfigDomain | undefined => {
  const cached = getC64API()?.getCachedConfigItem?.(category, item);
  if (!cached) return undefined;
  const normalized = normalizeConfigItem(cached);
  return toDomain(normalized.options, normalized.details);
};

const seedFromCache = (refs: readonly DeviceConfigItemRef[]): DeviceConfigOptionDomains => {
  const domains: DeviceConfigOptionDomains = {};
  refs.forEach(({ category, item }) => {
    const domain = extractCachedDomain(category, item);
    if (domain) domains[buildOptionDomainKey(category, item)] = domain;
  });
  return domains;
};

/**
 * Resolve the *permitted values* (and numeric bounds) for a fixed set of device config items
 * straight from the device — never from a hard-coded, model-specific option list. The Home summary
 * reads config VALUES with per-item enrichment skipped (for first-paint responsiveness), so the
 * bulk category payload carries only the current value and no `values`/`min`/`max` metadata. This
 * hook fills that gap for the dropdown / range controls:
 *
 *   1. The firmware-namespaced enrichment cache (populated by earlier per-item reads / the Config
 *      page / a prior session) is seeded synchronously, so a device whose constraints were already
 *      learned renders correct choices on the very first frame.
 *   2. Any still-unknown item is fetched from `GET /v1/configs/{cat}/{item}` *sequentially* — this
 *      avoids a request burst after idle (the C64U firmware TCP stack is fragile there) while still
 *      interrogating the concrete device for its truth. The per-item read repopulates the cache, so
 *      the fetch happens at most once per firmware.
 *
 * The effect re-runs on the connection routing epoch, so swapping devices (e.g. C64U <-> U64)
 * re-resolves every constraint against the newly connected hardware instead of reusing stale
 * choices. `refs` must be a stable (module-level or memoised) array to avoid refetch churn.
 *
 * Implemented with plain state (no react-query) so the option-bearing controls can be unit-tested
 * in isolation without a QueryClientProvider.
 */
export function useDeviceConfigOptionDomains(
  scopeKey: string,
  refs: readonly DeviceConfigItemRef[],
  enabled: boolean,
): DeviceConfigOptionDomains {
  const routingEpoch = useConnectionRoutingEpoch();
  const [domains, setDomains] = useState<DeviceConfigOptionDomains>(() => seedFromCache(refs));

  useEffect(() => {
    let cancelled = false;

    // Re-seed from the (device-namespaced) cache first — instant for already-learned firmwares
    // and a clean reset when the connected device changes.
    const seeded = seedFromCache(refs);
    setDomains(seeded);

    if (!enabled) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const api = getC64API();
      for (const { category, item } of refs) {
        if (cancelled) return;
        const key = buildOptionDomainKey(category, item);
        if (seeded[key]) continue;
        try {
          const payload = await api.getConfigItem(category, item, { __c64uIntent: "background" });
          if (cancelled) return;
          const domain = toDomain(
            readItemOptions(payload, category, item).map(String),
            readItemDetails(payload, category, item),
          );
          if (domain) setDomains((previous) => ({ ...previous, [key]: domain }));
        } catch (error) {
          // A missing/unsupported item on this model simply yields nothing; the control then
          // presents the device's current value only, never a fabricated choice. Logged at debug
          // level because an absent item is an expected, benign per-model outcome.
          addLog("debug", "Device config option-domain fetch skipped", {
            category,
            item,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // `scopeKey` distinguishes independent consumers; `refs` is expected stable. routingEpoch
    // re-resolves against the newly connected device.
  }, [enabled, routingEpoch, scopeKey, refs]);

  return domains;
}
