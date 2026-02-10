/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { getMockConfigPayload, setMockConfigLoader } from '@/lib/mock/mockConfig';
import { loadConfigYaml } from '@/lib/mock/mockConfigLoader.node';

describe('mockConfig YAML payload', () => {
  it('builds categories and items from the full YAML', async () => {
    setMockConfigLoader(loadConfigYaml);
    const payload = await getMockConfigPayload();

    expect(payload.categories['Audio Mixer']).toBeTruthy();
    expect(payload.categories['Network Settings']).toBeTruthy();
    expect(payload.categories['U64 Specific Settings']).toBeTruthy();
    expect(payload.categories['U64 Specific Settings']['System Mode'].options?.length).toBeGreaterThan(1);
  });
});
