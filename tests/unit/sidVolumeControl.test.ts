import { describe, expect, it } from 'vitest';
import {
  buildEnabledSidMuteUpdates,
  buildEnabledSidRestoreUpdates,
  buildEnabledSidUnmuteUpdates,
  buildEnabledSidVolumeSnapshot,
  buildEnabledSidVolumeUpdates,
  buildSidEnablement,
  filterEnabledSidVolumeItems,
  type SidEnablement,
  type SidVolumeItem,
} from '@/lib/config/sidVolumeControl';
import { resolveAudioMixerMuteValue } from '@/lib/config/audioMixerSolo';

describe('sid volume control helpers', () => {
  const options = ['OFF', '+6 dB', ' 0 dB', '-6 dB'];
  const items: SidVolumeItem[] = [
    { name: 'Vol UltiSid 1', value: '+6 dB', options },
    { name: 'Vol UltiSid 2', value: 'OFF', options },
    { name: 'Vol Socket 1', value: ' 0 dB', options },
    { name: 'Vol Socket 2', value: '-6 dB', options },
  ];

  it('maps socket and ultisid enablement from config categories', () => {
    const sockets = {
      'SID Sockets Configuration': {
        items: {
          'SID Socket 1': { selected: 'Enabled' },
          'SID Socket 2': { selected: 'Disabled' },
        },
      },
    };
    const addressing = {
      'SID Addressing': {
        items: {
          'UltiSID 1 Address': { selected: 'Unmapped' },
          'UltiSID 2 Address': { selected: '$D400' },
        },
      },
    };

    expect(buildSidEnablement(sockets, addressing)).toEqual({
      socket1: true,
      socket2: false,
      ultiSid1: false,
      ultiSid2: true,
    });
  });

  it('filters volume updates to enabled SIDs only', () => {
    const enablement: SidEnablement = {
      socket1: true,
      socket2: false,
      ultiSid1: true,
      ultiSid2: false,
    };
    const enabled = filterEnabledSidVolumeItems(items, enablement);
    expect(enabled.map((item) => item.name)).toEqual(['Vol UltiSid 1', 'Vol Socket 1']);

    const updates = buildEnabledSidVolumeUpdates(items, enablement, '-6 dB');
    expect(updates).toEqual({
      'Vol UltiSid 1': '-6 dB',
      'Vol Socket 1': '-6 dB',
    });
  });

  it('mutes and restores only enabled SIDs', () => {
    const enablement: SidEnablement = {
      socket1: true,
      socket2: false,
      ultiSid1: true,
      ultiSid2: false,
    };
    const muteValue = resolveAudioMixerMuteValue(options);
    const muteUpdates = buildEnabledSidMuteUpdates(items, enablement);
    expect(muteUpdates).toEqual({
      'Vol UltiSid 1': muteValue,
      'Vol Socket 1': muteValue,
    });

    const snapshot = buildEnabledSidVolumeSnapshot(items, enablement);
    const afterDisable: SidEnablement = {
      socket1: true,
      socket2: false,
      ultiSid1: false,
      ultiSid2: false,
    };
    const unmuteUpdates = buildEnabledSidUnmuteUpdates(snapshot, afterDisable);
    expect(unmuteUpdates).toEqual({
      'Vol Socket 1': ' 0 dB',
    });
  });

  it('restores from snapshot or falls back to target volume', () => {
    const enablement: SidEnablement = {
      socket1: true,
      socket2: true,
      ultiSid1: false,
      ultiSid2: false,
    };
    const snapshot = buildEnabledSidVolumeSnapshot(items, enablement);
    const restoreFromSnapshot = buildEnabledSidRestoreUpdates(items, enablement, snapshot, null);
    expect(restoreFromSnapshot).toEqual({
      'Vol Socket 1': ' 0 dB',
      'Vol Socket 2': '-6 dB',
    });

    const restoreFromFallback = buildEnabledSidRestoreUpdates(items, enablement, null, '+6 dB');
    expect(restoreFromFallback).toEqual({
      'Vol Socket 1': '+6 dB',
      'Vol Socket 2': '+6 dB',
    });
  });
});
