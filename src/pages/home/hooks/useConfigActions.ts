/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useActionTrace } from "@/hooks/useActionTrace";
import { getC64API } from "@/lib/c64api";
import { buildConfigKey, readItemValue } from "../utils/HomeConfigUtils";
import { reportUserError } from "@/lib/uiErrors";
import { toast } from "@/hooks/use-toast";
import { useAuthoritativeConfigValueState } from "@/hooks/useAuthoritativeConfigValueState";
import { getActiveBaseUrl, updateHasChanges } from "@/lib/config/appConfigStore";
import { useConnectionRoutingEpoch } from "@/hooks/useC64Connection";

export function useConfigActions() {
  const api = getC64API();
  const queryClient = useQueryClient();
  const trace = useActionTrace();
  const authoritativeValues = useAuthoritativeConfigValueState();
  const configOverrides = useMemo(
    () => authoritativeValues.values as Record<string, string | number>,
    [authoritativeValues.values],
  );
  const configWritePending = useMemo(() => authoritativeValues.pending, [authoritativeValues.pending]);

  // A device switch or reconnect bumps routingEpoch and re-keys every config
  // query against the new device; a pin from the previous device would
  // otherwise stay latched forever, since its pinned value can never echo
  // back from a different device. Same rationale as ConfigBrowserPage's
  // existing clearAll-on-routingEpoch effect (BUG-033); Home's store had no
  // equivalent. See HARD9-052.
  const routingEpoch = useConnectionRoutingEpoch();
  const clearAllAuthoritative = authoritativeValues.clearAll;
  useEffect(() => {
    clearAllAuthoritative();
  }, [routingEpoch, clearAllAuthoritative]);

  const updateConfigValue = trace(async function updateConfigValue(
    category: string,
    itemName: string,
    value: string | number,
    operation: string,
    successTitle: string,
    options: { refreshDrives?: boolean; suppressToast?: boolean; clearPendingOnSuccess?: boolean } = {},
  ) {
    const key = buildConfigKey(category, itemName);
    const previousEntry = authoritativeValues.entriesRef.current[key];
    authoritativeValues.replaceEntry(key, value);
    try {
      await api.setConfigValue(category, itemName, value);
      // useC64SetConfig/useC64UpdateConfigBatch (Config-page and slider
      // writes) already set this; this direct api.setConfigValue call
      // bypassed both, so Home's Video Mode/Turbo/SID address/UltiSID
      // filter/lighting selects never enabled "Revert Changes". See
      // HARD9-051.
      updateHasChanges(getActiveBaseUrl(), true);
      if (!options.suppressToast) {
        toast({ title: successTitle });
      }
      await queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey[0] === "c64-config-items" && query.queryKey[1] === category,
      });
      if (options.refreshDrives) {
        await queryClient.fetchQuery({
          queryKey: ["c64-drives"],
          queryFn: () => api.getDrives(),
          staleTime: 0,
        });
      }
      if (options.clearPendingOnSuccess) {
        authoritativeValues.clearEntry(key);
      }
      return true;
    } catch (error) {
      authoritativeValues.restoreEntry(key, previousEntry, value);
      reportUserError({
        operation,
        title: "Update failed",
        description: (error as Error).message,
        error,
        context: { category, item: itemName, value },
        retry: options.suppressToast
          ? undefined
          : () => void updateConfigValue(category, itemName, value, operation, successTitle, options),
      });
      return false;
    }
  });

  const resolveConfigValue = (payload: unknown, category: string, itemName: string, fallback: string | number) => {
    const key = buildConfigKey(category, itemName);
    const value = readItemValue(payload, category, itemName);
    return authoritativeValues.resolveValue(key, value as string | number | undefined, fallback);
  };

  const setConfigOverride = (category: string, itemName: string, value: string | number) => {
    const key = buildConfigKey(category, itemName);
    authoritativeValues.replaceEntry(key, value);
  };

  return {
    configOverrides,
    configWritePending,
    updateConfigValue,
    resolveConfigValue,
    setConfigOverride,
  };
}
