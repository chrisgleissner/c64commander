import { normalizeConfigItem } from '@/lib/config/normalizeConfigItem';

export type StreamKey = 'vic' | 'audio' | 'debug';

export type StreamControlEntry = {
  key: StreamKey;
  label: string;
  itemName: string;
  enabled: boolean;
  ip: string;
  port: string;
  rawValue: string;
};

const STREAM_LAYOUT: Array<{ key: StreamKey; label: string; itemName: string; defaultPort: string }> = [
  { key: 'vic', label: 'VIC', itemName: 'Stream VIC to', defaultPort: '11000' },
  { key: 'audio', label: 'Audio', itemName: 'Stream Audio to', defaultPort: '11001' },
  { key: 'debug', label: 'Debug', itemName: 'Stream Debug to', defaultPort: '11002' },
];

const OFF_TOKENS = new Set([
  '',
  'off',
  'disabled',
  'none',
  '0.0.0.0',
  '0.0.0.0:0',
  'false',
]);

const HOST_PATTERN = /^(?:[a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$/;

const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

const getItemValue = (payload: unknown, itemName: string) => {
  const record = payload as Record<string, unknown> | undefined;
  const categoryBlock = (record?.['Data Streams'] ?? record) as Record<string, unknown> | undefined;
  const items = (categoryBlock?.items ?? categoryBlock) as Record<string, unknown> | undefined;
  if (!items || !Object.prototype.hasOwnProperty.call(items, itemName)) return undefined;
  return normalizeConfigItem(items[itemName]).value;
};

const parseStreamTarget = (value: unknown, defaultPort: string) => {
  const raw = String(value ?? '').trim();
  const lower = raw.toLowerCase();
  if (OFF_TOKENS.has(lower)) {
    return {
      enabled: false,
      ip: '',
      port: defaultPort,
      rawValue: raw,
    };
  }

  const colonIndex = raw.lastIndexOf(':');
  if (colonIndex > 0 && colonIndex < raw.length - 1) {
    const host = raw.slice(0, colonIndex).trim();
    const port = raw.slice(colonIndex + 1).trim();
    return {
      enabled: true,
      ip: host,
      port: port || defaultPort,
      rawValue: raw,
    };
  }

  return {
    enabled: true,
    ip: raw,
    port: defaultPort,
    rawValue: raw,
  };
};

export const buildStreamControlEntries = (dataStreamsCategory?: Record<string, unknown>): StreamControlEntry[] =>
  STREAM_LAYOUT.map((entry) => {
    const value = getItemValue(dataStreamsCategory, entry.itemName);
    const parsed = parseStreamTarget(value, entry.defaultPort);
    return {
      key: entry.key,
      label: entry.label,
      itemName: entry.itemName,
      enabled: parsed.enabled,
      ip: parsed.ip,
      port: parsed.port,
      rawValue: parsed.rawValue,
    };
  });

export const validateStreamHost = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return 'IP/host is required.';
  if (!HOST_PATTERN.test(trimmed) && !IPV4_PATTERN.test(trimmed)) {
    return 'Enter a valid IPv4 address or host name.';
  }
  return null;
};

export const validateStreamPort = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return 'Port is required.';
  if (!/^\d+$/.test(trimmed)) return 'Port must be numeric.';
  const numeric = Number(trimmed);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    return 'Port must be between 1 and 65535.';
  }
  return null;
};

export const buildStreamConfigValue = (enabled: boolean, ip: string, port: string) => {
  if (!enabled) return 'off';
  return `${ip.trim()}:${port.trim()}`;
};

