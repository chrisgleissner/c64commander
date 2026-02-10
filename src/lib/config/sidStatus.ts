/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { SidEnablement } from '@/lib/config/sidVolumeControl';

export type SidStatusEntry = {
  key: keyof SidEnablement;
  label: string;
  enabled?: boolean;
};

const SID_STATUS_ORDER: Array<Omit<SidStatusEntry, 'enabled'>> = [
  { key: 'socket1', label: 'SID Socket 1' },
  { key: 'socket2', label: 'SID Socket 2' },
  { key: 'ultiSid1', label: 'UltiSID 1' },
  { key: 'ultiSid2', label: 'UltiSID 2' },
];

export const buildSidStatusEntries = (enablement: SidEnablement): SidStatusEntry[] =>
  SID_STATUS_ORDER.map((entry) => ({
    ...entry,
    enabled: enablement[entry.key],
  }));
