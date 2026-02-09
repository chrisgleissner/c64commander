/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { buildSidStatusEntries } from '@/lib/config/sidStatus';
import type { SidEnablement } from '@/lib/config/sidVolumeControl';

describe('sid status mapping', () => {
  it('maps SID enablement in stable order', () => {
    const enablement: SidEnablement = {
      socket1: true,
      socket2: false,
      ultiSid1: undefined,
      ultiSid2: true,
    };
    const entries = buildSidStatusEntries(enablement);
    expect(entries.map((entry) => entry.label)).toEqual([
      'SID Socket 1',
      'SID Socket 2',
      'UltiSID 1',
      'UltiSID 2',
    ]);
    expect(entries.map((entry) => entry.enabled)).toEqual([true, false, undefined, true]);
  });
});
