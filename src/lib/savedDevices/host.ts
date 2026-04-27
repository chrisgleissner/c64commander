export const DEFAULT_SAVED_DEVICE_HOST = "c64u";
export const DEFAULT_SAVED_DEVICE_HTTP_PORT = 80;

export const normalizeSavedDeviceHostInput = (input?: string | null) => {
  const raw = input?.trim() ?? "";
  if (!raw) return DEFAULT_SAVED_DEVICE_HOST;
  if (/^[a-z]+:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return (url.host || url.hostname || DEFAULT_SAVED_DEVICE_HOST).trim() || DEFAULT_SAVED_DEVICE_HOST;
    } catch {
      return DEFAULT_SAVED_DEVICE_HOST;
    }
  }
  return raw.split("/")[0]?.trim() || DEFAULT_SAVED_DEVICE_HOST;
};

const parseSavedDeviceHttpPort = (value: string | null | undefined, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return fallback;
  return parsed;
};

export const splitSavedDeviceHostAndHttpPort = (deviceHost?: string | null) => {
  const normalized = normalizeSavedDeviceHostInput(deviceHost);

  if (normalized.startsWith("[")) {
    const closeBracketIndex = normalized.indexOf("]");
    if (closeBracketIndex !== -1) {
      const host = normalized.slice(0, closeBracketIndex + 1);
      const rest = normalized.slice(closeBracketIndex + 1);
      if (rest.startsWith(":")) {
        const httpPort = parseSavedDeviceHttpPort(rest.slice(1), DEFAULT_SAVED_DEVICE_HTTP_PORT);
        return { host, httpPort };
      }
      return { host, httpPort: DEFAULT_SAVED_DEVICE_HTTP_PORT };
    }
  }

  const colonCount = (normalized.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    const separatorIndex = normalized.lastIndexOf(":");
    const maybePort = normalized.slice(separatorIndex + 1);
    if (/^\d+$/.test(maybePort)) {
      return {
        host: normalized.slice(0, separatorIndex) || DEFAULT_SAVED_DEVICE_HOST,
        httpPort: parseSavedDeviceHttpPort(maybePort, DEFAULT_SAVED_DEVICE_HTTP_PORT),
      };
    }
  }

  return { host: normalized, httpPort: DEFAULT_SAVED_DEVICE_HTTP_PORT };
};

export const stripSavedDeviceHttpPort = (deviceHost?: string | null) =>
  splitSavedDeviceHostAndHttpPort(deviceHost).host;

export const buildInferredSavedDeviceName = (host: string) => stripSavedDeviceHttpPort(host);
