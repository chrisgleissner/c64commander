/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { parseSidBaseAddress, type SidDetailEntry } from '@/lib/config/sidDetails';

export type SidSilenceWrite = {
  address: string;
  value: number;
};

export type SidSilenceTarget = {
  key: SidDetailEntry['key'];
  label: string;
  baseAddress: number;
};

const CTRL_OFFSETS = [0x04, 0x0b, 0x12];
const MODE_VOLUME_OFFSET = 0x18;
const ADSR_OFFSETS = [0x05, 0x06, 0x0c, 0x0d, 0x13, 0x14];
const SILENCE_VALUE = 0x00;

const toAddressHex = (value: number) => value.toString(16).toUpperCase().padStart(4, '0');

export const buildSidSilenceWrites = (baseAddress: number): SidSilenceWrite[] => {
  const offsets = [
    ...CTRL_OFFSETS,
    MODE_VOLUME_OFFSET,
    ...ADSR_OFFSETS,
  ];
  return offsets.map((offset) => ({
    address: toAddressHex(baseAddress + offset),
    value: SILENCE_VALUE,
  }));
};

export const buildSidSilenceTargets = (entries: SidDetailEntry[]): SidSilenceTarget[] =>
  entries
    .map((entry) => {
      const baseAddress = parseSidBaseAddress(entry.addressRaw ?? entry.address);
      if (baseAddress === null) return null;
      return {
        key: entry.key,
        label: entry.label,
        baseAddress,
      };
    })
    .filter((entry): entry is SidSilenceTarget => entry !== null);

export const silenceSidTargets = async (
  api: { writeMemory: (address: string, data: Uint8Array) => Promise<unknown> },
  targets: SidSilenceTarget[],
) => {
  if (!targets.length) {
    throw new Error('No configured SID chips found.');
  }

  const failures: Array<{ label: string; message: string }> = [];

  for (const target of targets) {
    const writes = buildSidSilenceWrites(target.baseAddress);
    let firstFailureMessage: string | null = null;
    for (const write of writes) {
      try {
        await api.writeMemory(write.address, new Uint8Array([write.value]));
      } catch (error) {
        if (!firstFailureMessage) {
          firstFailureMessage = (error as Error).message;
        }
      }
    }
    if (firstFailureMessage) {
      failures.push({
        label: target.label,
        message: firstFailureMessage,
      });
    }
  }

  if (failures.length) {
    const details = failures.map((failure) => `${failure.label}: ${failure.message}`).join('; ');
    throw new Error(`SID silence incomplete. ${details}`);
  }

  return {
    silenced: targets.map((target) => target.label),
  };
};

