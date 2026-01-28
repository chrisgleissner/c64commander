import type { SidEnablement } from '@/lib/config/sidVolumeControl';

export type SidStatusEntry = {
  key: keyof SidEnablement;
  label: string;
  shortLabel: string;
  enabled?: boolean;
};

const SID_STATUS_ORDER: Array<Omit<SidStatusEntry, 'enabled'>> = [
  { key: 'socket1', label: 'Socket 1', shortLabel: 'S1' },
  { key: 'socket2', label: 'Socket 2', shortLabel: 'S2' },
  { key: 'ultiSid1', label: 'UltiSID 1', shortLabel: 'U1' },
  { key: 'ultiSid2', label: 'UltiSID 2', shortLabel: 'U2' },
];

export const buildSidStatusEntries = (enablement: SidEnablement): SidStatusEntry[] =>
  SID_STATUS_ORDER.map((entry) => ({
    ...entry,
    enabled: enablement[entry.key],
  }));
