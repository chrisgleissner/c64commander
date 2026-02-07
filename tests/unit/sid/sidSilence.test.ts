import { describe, expect, it, vi } from 'vitest';
import {
  buildSidSilenceTargets,
  buildSidSilenceWrites,
  silenceSidTargets,
} from '@/lib/sid/sidSilence';

describe('sidSilence', () => {
  it('builds deterministic register writes for a SID base address', () => {
    const writes = buildSidSilenceWrites(0xd400);
    expect(writes).toEqual([
      { address: 'D404', value: 0x00 },
      { address: 'D40B', value: 0x00 },
      { address: 'D412', value: 0x00 },
      { address: 'D418', value: 0x00 },
      { address: 'D405', value: 0x00 },
      { address: 'D406', value: 0x00 },
      { address: 'D40C', value: 0x00 },
      { address: 'D40D', value: 0x00 },
      { address: 'D413', value: 0x00 },
      { address: 'D414', value: 0x00 },
    ]);
  });

  it('builds targets only for mapped SID addresses', () => {
    const targets = buildSidSilenceTargets([
      {
        key: 'socket1',
        label: 'SID Socket 1',
        volume: '0 dB',
        pan: 'Center',
        address: '$D400',
        addressRaw: '$D400',
      },
      {
        key: 'ultiSid2',
        label: 'UltiSID 2',
        volume: '0 dB',
        pan: 'Center',
        address: 'Unmapped',
        addressRaw: 'Unmapped',
      },
    ]);

    expect(targets).toEqual([
      {
        key: 'socket1',
        label: 'SID Socket 1',
        baseAddress: 0xd400,
      },
    ]);
  });

  it('writes all silence registers for each target', async () => {
    const writeMemory = vi.fn().mockResolvedValue(undefined);
    const targets = [
      { key: 'socket1', label: 'SID Socket 1', baseAddress: 0xd400 },
      { key: 'socket2', label: 'SID Socket 2', baseAddress: 0xd420 },
    ] as const;

    await expect(silenceSidTargets({ writeMemory }, [...targets])).resolves.toEqual({
      silenced: ['SID Socket 1', 'SID Socket 2'],
    });

    expect(writeMemory).toHaveBeenCalledTimes(20);
    expect(writeMemory).toHaveBeenNthCalledWith(1, 'D404', new Uint8Array([0x00]));
    expect(writeMemory).toHaveBeenNthCalledWith(11, 'D424', new Uint8Array([0x00]));
  });

  it('continues with remaining SID targets when one fails', async () => {
    const writeMemory = vi.fn()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValue(undefined);

    const targets = [
      { key: 'socket1', label: 'SID Socket 1', baseAddress: 0xd400 },
      { key: 'socket2', label: 'SID Socket 2', baseAddress: 0xd420 },
    ];

    await expect(silenceSidTargets({ writeMemory }, targets)).rejects.toThrow('SID Socket 1: first failure');
    expect(writeMemory).toHaveBeenCalledTimes(20);
  });
});

