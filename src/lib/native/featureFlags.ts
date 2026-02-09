/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin } from '@capacitor/core';

export type FeatureFlagsPlugin = {
  getFlag: (options: { key: string }) => Promise<{ value?: boolean }>;
  setFlag: (options: { key: string; value: boolean }) => Promise<void>;
  getAllFlags: (options: { keys: string[] }) => Promise<{ flags?: Record<string, boolean> }>;
};

export const FeatureFlags = registerPlugin<FeatureFlagsPlugin>('FeatureFlags', {
  web: () => import('./featureFlags.web').then((module) => new module.FeatureFlagsWeb()),
});
