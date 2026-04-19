/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  FeatureFlagSnapshot,
  FeatureFlagId,
  FeatureFlags,
  FeatureFlagResolution,
  featureFlagManager,
} from "@/lib/config/featureFlags";

type FeatureFlagsContextValue = FeatureFlagSnapshot & {
  setFlag: (id: FeatureFlagId, value: boolean) => Promise<void>;
  clearOverride: (id: FeatureFlagId) => Promise<void>;
};

const FeatureFlagsContext = createContext<FeatureFlagsContextValue | null>(null);

export const FeatureFlagsProvider = ({ children }: { children: React.ReactNode }) => {
  const [snapshot, setSnapshot] = useState<FeatureFlagSnapshot>(featureFlagManager.getSnapshot());

  useEffect(() => featureFlagManager.subscribe(setSnapshot), []);
  useEffect(() => {
    void featureFlagManager.load();
    return featureFlagManager.subscribeToDeveloperMode();
  }, []);

  const value = useMemo<FeatureFlagsContextValue>(
    () => ({
      ...snapshot,
      setFlag: featureFlagManager.setFlag.bind(featureFlagManager),
      clearOverride: featureFlagManager.clearOverride.bind(featureFlagManager),
    }),
    [snapshot],
  );

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
};

export const useFeatureFlags = () => {
  const context = useContext(FeatureFlagsContext);
  if (!context) {
    throw new Error("useFeatureFlags must be used within FeatureFlagsProvider");
  }
  return context;
};

export const useFeatureFlag = (id: FeatureFlagId) => {
  const { flags, resolved, isLoaded, setFlag } = useFeatureFlags();
  const resolution: FeatureFlagResolution = resolved[id];
  const value = flags[id];
  const update = async (next: boolean) => setFlag(id, next);
  return {
    value,
    isLoaded,
    setValue: update,
    resolution,
    visible: resolution.visible,
    editable: resolution.editable,
  } as const;
};

export const getFeatureFlagValue = (flags: FeatureFlags, id: FeatureFlagId) => flags[id];
