
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getMockConfigPayload, setMockConfigLoader, clearMockConfigLoader } from '@/lib/mock/mockConfig';

describe('mockConfig', () => {
    beforeEach(() => {
        clearMockConfigLoader();
        vi.resetModules();
    });

    it('parses custom loader data', async () => {
        const rawConfig = {
            config: {
                general: {
                    base_url: 'http://test',
                    firmware_version: '9.9.9'
                },
                categories: {
                    Audio: {
                        items: {
                            Volume: {
                                selected: '0 dB',
                                options: ['0 dB', '6 dB'],
                                details: { min: 0, max: 10, presets: ['A', 'B'] }
                            },
                            Mute: {
                                selected: 1, // Number value
                                details: { min: '0', max: '1' } // String details
                            }
                        }
                    }
                }
            }
        };

        setMockConfigLoader(() => rawConfig);
        const payload = await getMockConfigPayload();

        expect(payload.general.baseUrl).toBe('http://test');
        expect(payload.general.firmwareVersion).toBe('9.9.9');

        const audio = payload.categories.Audio;
        expect(audio.Volume.value).toBe('0 dB');
        expect(audio.Volume.options).toEqual(['0 dB', '6 dB']);
        expect(audio.Volume.details?.min).toBe(0);
        expect(audio.Volume.details?.presets).toEqual(['A', 'B']);

        expect(audio.Mute.value).toBe(1);
        expect(audio.Mute.details?.min).toBe(0);
    });

    it('handles empty or malformed data', async () => {
        setMockConfigLoader(() => ({}));
        const payload = await getMockConfigPayload();
        expect(payload.categories).toEqual({});
    });

    it('handles weird types in normalization', async () => {
        setMockConfigLoader(() => ({
            config: {
                categories: {
                    Test: {
                        items: {
                            BadVal: {
                                // @ts-ignore
                                selected: null,
                                details: { min: 'invalid' }
                            }
                        }
                    }
                }
            }
        }));
        const payload = await getMockConfigPayload();
        expect(payload.categories.Test.BadVal.value).toBe('');
        expect(payload.categories.Test.BadVal.details?.min).toBeUndefined();
    });

    it('handles string input from loader (yaml string)', async () => {
        const yamlStr =
            `config:
  general:
    device_type: TestDevice
`;
        setMockConfigLoader(() => yamlStr);
        const payload = await getMockConfigPayload();
        expect(payload.general.deviceType).toBe('TestDevice');
    });
});
