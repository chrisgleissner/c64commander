import yaml from 'js-yaml';

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

let customYamlLoader: (() => unknown | Promise<unknown>) | null = null;

/**
 * Set a custom YAML loader (for tests with full config)
 */
export const setMockConfigLoader = (loader: () => unknown | Promise<unknown>) => {
  customYamlLoader = loader;
  cachedPayload = null; // Clear cache
  cachedPromise = null;
};
const resolveYamlUrl = () => {
  const base = typeof import.meta !== 'undefined' ? import.meta.env.BASE_URL || '/' : '/';
  if (typeof window === 'undefined') return `${base}doc/c64/c64u-config.yaml`;
  return new URL(`doc/c64/c64u-config.yaml`, `${window.location.origin}${base}`).toString();
};

const loadYamlFromAssets = async () => {
  const response = await fetch(resolveYamlUrl());
  if (!response.ok) {
    throw new Error(`Demo config fetch failed: ${response.status}`);
  }
  return response.text();
};

const loadRawConfig = async (): Promise<RawConfig> => {
  if (customYamlLoader) {
    const loaded = await customYamlLoader();
    if (typeof loaded === 'string') {
      return (yaml.load(loaded) as RawConfig) ?? {};
    }
    return (loaded as RawConfig) ?? {};
  }
  const yamlText = await loadYamlFromAssets();
  return (yaml.load(yamlText) as RawConfig) ?? {};
};

const buildPayload = (parsed: RawConfig): MockConfigPayload => {
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
let cachedPromise: Promise<MockConfigPayload> | null = null;

export const getMockConfigPayload = async () => {
  if (cachedPayload) return cachedPayload;
  if (!cachedPromise) {
    cachedPromise = (async () => {
      const parsed = await loadRawConfig();
      const payload = buildPayload(parsed);
      cachedPayload = payload;
      return payload;
    })();
  }
  return cachedPromise;
};
