/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { clearMockConfigLoader, getMockConfigPayload, setMockConfigLoader } from '@/lib/mock/mockConfig';
import { loadConfigYaml } from '@/lib/mock/mockConfigLoader.node';

describe('mockConfig YAML payload', () => {
  afterEach(() => {
    clearMockConfigLoader();
  });

  it('builds categories and items from the full YAML', async () => {
    setMockConfigLoader(loadConfigYaml);
    const payload = await getMockConfigPayload();

    expect(payload.categories['Audio Mixer']).toBeTruthy();
    expect(payload.categories['Network Settings']).toBeTruthy();
    expect(payload.categories['U64 Specific Settings']).toBeTruthy();
    expect(payload.categories['U64 Specific Settings']['System Mode'].options?.length).toBeGreaterThan(1);
  });

  it('builds payload with numeric selected value', async () => {
    setMockConfigLoader(() => ({
      config: {
        general: { base_url: 'http://test', rest_api_version: '1.0', device_type: 'U64', firmware_version: '4.0' },
        categories: {
          TestCat: {
            items: {
              Volume: { selected: 42, options: ['10', '42', '100'] },
            },
          },
        },
      },
    }));
    const payload = await getMockConfigPayload();
    expect(payload.categories.TestCat.Volume.value).toBe(42);
  });

  it('handles string loader returning YAML text', async () => {
    const yamlText = `
config:
  general:
    base_url: http://custom
    rest_api_version: "2.0"
    device_type: Custom
    firmware_version: "5.0"
  categories:
    MyCat:
      items:
        MyItem:
          selected: hello
          options:
            - hello
            - world
`;
    setMockConfigLoader(() => yamlText);
    const payload = await getMockConfigPayload();
    expect(payload.general.baseUrl).toBe('http://custom');
    expect(payload.categories.MyCat.MyItem.value).toBe('hello');
  });

  it('normalizes details with min/max/format/presets', async () => {
    setMockConfigLoader(() => ({
      config: {
        general: {},
        categories: {
          Cat: {
            items: {
              Slider: {
                selected: '5',
                options: ['1', '10'],
                details: { min: 1, max: '10', format: '%d dB', presets: [3, 'five'] },
              },
            },
          },
        },
      },
    }));
    const payload = await getMockConfigPayload();
    const details = payload.categories.Cat.Slider.details!;
    expect(details.min).toBe(1);
    expect(details.max).toBe(10);
    expect(details.format).toBe('%d dB');
    expect(details.presets).toEqual(['3', 'five']);
  });

  it('returns undefined details when all fields empty', async () => {
    setMockConfigLoader(() => ({
      config: {
        general: {},
        categories: {
          Cat: {
            items: {
              Empty: {
                selected: 'x',
                details: { min: undefined, max: undefined },
              },
            },
          },
        },
      },
    }));
    const payload = await getMockConfigPayload();
    expect(payload.categories.Cat.Empty.details).toBeUndefined();
  });

  it('filters empty string options', async () => {
    setMockConfigLoader(() => ({
      config: {
        general: {},
        categories: {
          Cat: {
            items: {
              Opt: { selected: 'a', options: ['a', '', 'b'] },
            },
          },
        },
      },
    }));
    const payload = await getMockConfigPayload();
    expect(payload.categories.Cat.Opt.options).toEqual(['a', 'b']);
  });

  it('uses default general values when fields missing', async () => {
    setMockConfigLoader(() => ({
      config: { general: {}, categories: {} },
    }));
    const payload = await getMockConfigPayload();
    expect(payload.general.baseUrl).toBe('http://c64u');
    expect(payload.general.restApiVersion).toBe('0.1');
    expect(payload.general.deviceType).toBe('Ultimate 64');
    expect(payload.general.firmwareVersion).toBe('3.12a');
  });

  it('handles asNumber with NaN string', async () => {
    setMockConfigLoader(() => ({
      config: {
        general: {},
        categories: {
          Cat: {
            items: {
              X: { selected: 'ok', details: { min: 'not-a-number' } },
            },
          },
        },
      },
    }));
    const payload = await getMockConfigPayload();
    expect(payload.categories.Cat.X.details).toBeUndefined();
  });

  it('handles asString with non-string non-number', async () => {
    setMockConfigLoader(() => ({
      config: {
        general: { base_url: true as unknown },
        categories: {},
      },
    }));
    const payload = await getMockConfigPayload();
    // boolean falls back to default
    expect(payload.general.baseUrl).toBe('http://c64u');
  });
});
