import { useEffect, useState } from 'react';
import { getDeveloperModeEnabled, setDeveloperModeEnabled, subscribeDeveloperMode } from '@/lib/config/developerModeStore';

export const useDeveloperMode = () => {
  const [isDeveloperModeEnabled, setIsDeveloperModeEnabled] = useState(() =>
    getDeveloperModeEnabled(),
  );

  useEffect(() => subscribeDeveloperMode(({ enabled }) => setIsDeveloperModeEnabled(enabled)), []);

  const enableDeveloperMode = () => setDeveloperModeEnabled(true);

  return {
    isDeveloperModeEnabled,
    enableDeveloperMode,
  };
};
