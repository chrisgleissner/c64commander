import yaml from 'js-yaml';

// Minimal embedded config for browser - tests will override this with full YAML
const defaultConfigYaml = `
config:
  general:
    base_url: http://c64u
    rest_api_version: '0.1'
    device_type: 'Ultimate 64 Elite'
    firmware_version: '3.12a'
    fetched_at: '2026-01-18T11:47:52.430762+00:00'
  categories:
    Audio Mixer:
      items:
        Vol UltiSid 1:
          selected: 'OFF'
          options: ['OFF', '+6 dB', '+5 dB', '+4 dB', '+3 dB', '+2 dB', '+1 dB', '0 dB', '-1 dB', '-2 dB', '-3 dB', '-4 dB', '-5 dB', '-6 dB', '-9 dB', '-12 dB', '-18 dB', '-24 dB', '-30 dB', '-42 dB']
`;

type RawConfigItem = {
  selected?: string | number;
  options?: Array<string | number>;
  details?: {
    min?: number | string;
    max?: number | string;
    format?: string;
    presets?: Array<string | number>;
  };
};

type RawConfigCategory = {
  items?: Record<string, RawConfigItem>;
};

type RawConfig = {
  config?: {
    general?: Record<string, unknown>;
    categories?: Record<string, RawConfigCategory>;
  };
};

export type MockConfigDetails = {
  min?: number;
  max?: number;
  format?: string;
  presets?: string[];
};

export type MockConfigItem = {
  value: string | number;
  options?: string[];
  details?: MockConfigDetails;
};

export type MockConfigPayload = {
  general: {
    baseUrl: string;
    restApiVersion: string;
    deviceType: string;
    firmwareVersion: string;
    fetchedAt?: string;
  };
  categories: Record<string, Record<string, MockConfigItem>>;
};

const asString = (value: unknown, fallback = '') => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return fallback;
};

const asNumber = (value: unknown) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
};

const normalizeDetails = (details?: RawConfigItem['details']): MockConfigDetails | undefined => {
  if (!details) return undefined;
  const min = asNumber(details.min);
  const max = asNumber(details.max);
  const format = asString(details.format);
  const presets = details.presets?.map((entry) => asString(entry)) ?? undefined;

  const payload: MockConfigDetails = {};
  if (min !== undefined) payload.min = min;
  if (max !== undefined) payload.max = max;
  if (format) payload.format = format;
  if (presets && presets.length > 0) payload.presets = presets;
  return Object.keys(payload).length ? payload : undefined;
};

const normalizeOptions = (options?: Array<string | number>) =>
  options?.map((entry) => asString(entry)).filter((entry) => entry.length > 0);

let customYamlLoader: (() => any) | null = null;

/**
 * Set a custom YAML loader (for tests with full config)
 */
export const setMockConfigLoader = (loader: () => any) => {
  customYamlLoader = loader;
  cachedPayload = null; // Clear cache
};

const buildPayload = (): MockConfigPayload => {
  const parsed = (customYamlLoader ? customYamlLoader() : yaml.load(defaultConfigYaml)) as RawConfig;
  const config = parsed?.config ?? {};
  const general = config.general ?? {};
  const categories = config.categories ?? {};

  const categoryPayload: Record<string, Record<string, MockConfigItem>> = {};
  Object.entries(categories).forEach(([categoryName, category]) => {
    const items = category.items ?? {};
    const itemPayload: Record<string, MockConfigItem> = {};
    Object.entries(items).forEach(([itemName, item]) => {
      const value = item?.selected ?? '';
      const options = normalizeOptions(item?.options);
      const details = normalizeDetails(item?.details);
      itemPayload[itemName] = {
        value: typeof value === 'number' ? value : asString(value),
        ...(options && options.length > 0 ? { options } : {}),
        ...(details ? { details } : {}),
      };
    });
    categoryPayload[categoryName] = itemPayload;
  });

  return {
    general: {
      baseUrl: asString(general.base_url, 'http://c64u'),
      restApiVersion: asString(general.rest_api_version, '0.1'),
      deviceType: asString(general.device_type, 'Ultimate 64'),
      firmwareVersion: asString(general.firmware_version, '3.12a'),
      fetchedAt: asString(general.fetched_at || '', ''),
    },
    categories: categoryPayload,
  };
};

let cachedPayload: MockConfigPayload | null = null;

export const getMockConfigPayload = () => {
  if (!cachedPayload) {
    cachedPayload = buildPayload();
  }
  return cachedPayload;
};
