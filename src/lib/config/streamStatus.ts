import { normalizeConfigItem } from '@/lib/config/normalizeConfigItem';

export type StreamStatusEntry = {
  key: 'vic' | 'audio' | 'debug';
  label: 'VIC' | 'Audio' | 'Debug';
  state: 'ON' | 'OFF';
  ip: string;
  port: string;
};

const STREAM_ORDER: Array<{
  key: StreamStatusEntry['key'];
  label: StreamStatusEntry['label'];
  itemName: string;
  defaultPort: string;
}> = [
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

const parseStreamTarget = (value: unknown, defaultPort: string) => {
  const raw = String(value ?? '').trim();
  if (OFF_TOKENS.has(raw.toLowerCase())) {
    return {
      state: 'OFF' as const,
      ip: '—',
      port: '—',
    };
  }

  let ip = raw;
  let port = defaultPort;
  const colonIndex = raw.lastIndexOf(':');
  if (colonIndex > 0 && colonIndex < raw.length - 1) {
    const candidatePort = raw.slice(colonIndex + 1);
    if (/^\d+$/.test(candidatePort)) {
      ip = raw.slice(0, colonIndex).trim();
      port = candidatePort;
    }
  }

  if (!ip) {
    return {
      state: 'OFF' as const,
      ip: '—',
      port: '—',
    };
  }

  return {
    state: 'ON' as const,
    ip,
    port,
  };
};

const getStreamItemValue = (payload: Record<string, unknown> | undefined, itemName: string) => {
  if (!payload) return undefined;
  const category = (payload['Data Streams'] ?? payload) as Record<string, unknown> | undefined;
  const items = (category?.items ?? category) as Record<string, unknown> | undefined;
  if (!items || !Object.prototype.hasOwnProperty.call(items, itemName)) return undefined;
  return normalizeConfigItem(items[itemName]).value;
};

export const buildStreamStatusEntries = (
  dataStreamsCategory?: Record<string, unknown>,
): StreamStatusEntry[] =>
  STREAM_ORDER.map((entry) => {
    const selected = getStreamItemValue(dataStreamsCategory, entry.itemName);
    const parsed = parseStreamTarget(selected, entry.defaultPort);
    return {
      key: entry.key,
      label: entry.label,
      state: parsed.state,
      ip: parsed.ip,
      port: parsed.port,
    };
  });
