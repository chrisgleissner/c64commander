/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  FeatureFlagSnapshot,
  FeatureFlagKey,
  FeatureFlags,
  featureFlagManager,
} from '@/lib/config/featureFlags';

type FeatureFlagsContextValue = FeatureFlagSnapshot & {
  setFlag: (key: FeatureFlagKey, value: boolean) => Promise<void>;
};

const FeatureFlagsContext = createContext<FeatureFlagsContextValue | null>(null);

export const FeatureFlagsProvider = ({ children }: { children: React.ReactNode }) => {
  const [snapshot, setSnapshot] = useState<FeatureFlagSnapshot>(featureFlagManager.getSnapshot());

  useEffect(() => featureFlagManager.subscribe(setSnapshot), []);
  useEffect(() => {
    void featureFlagManager.load();
  }, []);

  const value = useMemo<FeatureFlagsContextValue>(
    () => ({
      ...snapshot,
      setFlag: featureFlagManager.setFlag.bind(featureFlagManager),
    }),
    [snapshot],
  );

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
};

export const useFeatureFlags = () => {
  const context = useContext(FeatureFlagsContext);
  if (!context) {
    throw new Error('useFeatureFlags must be used within FeatureFlagsProvider');
  }
  return context;
};

export const useFeatureFlag = (key: FeatureFlagKey) => {
  const { flags, isLoaded, setFlag } = useFeatureFlags();
  const value = flags[key];
  const update = async (next: boolean) => setFlag(key, next);
  return { value, isLoaded, setValue: update } as const;
};

export const getFeatureFlagValue = (flags: FeatureFlags, key: FeatureFlagKey) => flags[key];
