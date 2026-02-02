const REDACTED = '***';

const SENSITIVE_KEY_REGEX = /(password|token|authorization|auth|secret|credential|api[-_]?key)/i;
const HOST_KEY_REGEX = /(host|hostname|ip|address)/i;
const LOCATION_KEY_REGEX = /(url|path|uri)/i;

const IP_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const URL_REGEX = /(https?:\/\/)([^\s/]+)([^\s]*)/gi;
const FILE_URI_REGEX = /\b(?:content|file|filesystem|saf):\/\/[^\s"']+/gi;
const FILE_PATH_REGEX = /(?:[A-Za-z]:\\|\/)(?:[^\s"'<>]+)+/g;
const HOSTNAME_REGEX = /\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/g;
const AUTH_SCHEME_REGEX = /\b(Bearer|Token)\s+[A-Za-z0-9._-]+\b/gi;
const KEY_VALUE_REGEX = /(password|token|authorization|auth|secret|credential|api[-_]?key)\s*[:=]\s*([^\s",]+)/gi;

const redactText = (input: string) => {
  let output = input;
  output = output.replace(KEY_VALUE_REGEX, (_match, key) => `${key}=` + REDACTED);
  output = output.replace(AUTH_SCHEME_REGEX, (_match, scheme) => `${scheme} ${REDACTED}`);
  output = output.replace(URL_REGEX, (_match, scheme, _host, rest) => `${scheme}${REDACTED}${rest}`);
  output = output.replace(FILE_URI_REGEX, REDACTED);
  output = output.replace(FILE_PATH_REGEX, REDACTED);
  output = output.replace(IP_REGEX, REDACTED);
  output = output.replace(HOSTNAME_REGEX, REDACTED);
  return output;
};

export const redactExportText = (input: string) => redactText(input);

export const redactExportValue = (value: unknown, keyHint?: string): unknown => {
  if (typeof keyHint === 'string') {
    if (SENSITIVE_KEY_REGEX.test(keyHint)) return REDACTED;
    if (HOST_KEY_REGEX.test(keyHint)) return REDACTED;
    if (LOCATION_KEY_REGEX.test(keyHint) && typeof value === 'string') {
      return redactText(value);
    }
  }
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactExportValue(entry));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      result[key] = redactExportValue(entry, key);
    });
    return result;
  }
  return value;
};

export const EXPORT_REDACTION = { REDACTED } as const;
