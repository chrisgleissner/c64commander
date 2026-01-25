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
