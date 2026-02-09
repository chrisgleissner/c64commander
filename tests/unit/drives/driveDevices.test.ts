/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import {
  buildBusIdOptions,
  buildTypeOptions,
  normalizeDriveDevices,
} from '@/lib/drives/driveDevices';

describe('drive device normalization', () => {
  it('classifies and orders known device classes', () => {
    const result = normalizeDriveDevices({
      drives: [
        { 'Printer Emulation': { enabled: false, bus_id: 4 } },
        { b: { enabled: false, bus_id: 9, type: '1541' } },
        { 'IEC Drive': { enabled: true, bus_id: 11, type: 'DOS emulation' } },
        { a: { enabled: true, bus_id: 8, type: '1571' } },
      ],
    });

    expect(result.devices.map((entry) => entry.class)).toEqual([
      'PHYSICAL_DRIVE_A',
      'PHYSICAL_DRIVE_B',
      'SOFT_IEC_DRIVE',
      'PRINTER',
    ]);
    expect(result.devices.map((entry) => entry.label)).toEqual([
      'Drive A',
      'Drive B',
      'Soft IEC Drive',
      'Printer',
    ]);
  });

  it('tolerates unknown devices and missing optional fields', () => {
    const result = normalizeDriveDevices({
      drives: [
        { a: { enabled: true, bus_id: 8 } },
        { UnknownDevice: { enabled: false, bus_id: 15, type: 'mystery' } },
      ],
    });

    expect(result.devices).toHaveLength(1);
    expect(result.unknownDevices).toHaveLength(1);
    expect(result.devices[0]?.type).toBeNull();
  });

  it('reflects refreshed soft IEC transient error state without optimistic clearing', () => {
    const beforeReset = normalizeDriveDevices({
      drives: [
        {
          'IEC Drive': {
            enabled: false,
            bus_id: 11,
            type: 'DOS emulation',
            last_error: '73,U64IEC ULTIMATE DOS V1.1,00,00',
          },
        },
      ],
    });
    const afterReset = normalizeDriveDevices({
      drives: [
        {
          'IEC Drive': {
            enabled: false,
            bus_id: 11,
            type: 'DOS emulation',
          },
        },
      ],
    });

    expect(beforeReset.devices[0]?.lastError).toContain('73,U64IEC');
    expect(afterReset.devices[0]?.lastError).toBeNull();
  });

  it('keeps current values in dropdown option builders', () => {
    expect(buildBusIdOptions([8, 9, 10, 11], 15)).toContain('15');
    expect(buildTypeOptions(['1541', '1571', '1581'], 'custom')).toContain('custom');
  });
});
