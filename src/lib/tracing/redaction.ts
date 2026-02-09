/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { redactTreeUri } from '@/lib/native/safUtils';

const REDACTED = '***';

const isSensitiveKey = (key: string) =>
  /password|token|authorization|auth|secret|credential|cookie/i.test(key);

// Audit confirmed: Covers Authorization, Cookie, and common sensitive JSON keys (password, token, secret)

const isUriValue = (value: string) =>
  /^(content:\/\/|file:\/\/|filesystem:|saf:)/i.test(value.trim());

const redactUri = (value: string) => {
  if (!value) return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (isUriValue(trimmed)) {
    return redactTreeUri(trimmed) ?? REDACTED;
  }
  return value;
};

const redactValue = (value: unknown, keyHint?: string): unknown => {
  if (typeof keyHint === 'string' && isSensitiveKey(keyHint)) return REDACTED;
  if (typeof value === 'string') return redactUri(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      result[key] = redactValue(entry, key);
    });
    return result;
  }
  return value;
};

export const redactHeaders = (headers: Record<string, string | string[] | undefined>) => {
  const redacted: Record<string, string | string[] | undefined> = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (value === undefined) return;
    if (isSensitiveKey(key)) {
      redacted[key] = REDACTED;
      return;
    }
    if (Array.isArray(value)) {
      redacted[key] = value.map((entry) => (typeof entry === 'string' ? redactValue(entry, key) : entry)) as string[];
      return;
    }
    redacted[key] = typeof value === 'string' ? (redactValue(value, key) as string) : value;
  });
  return redacted;
};

export const redactPayload = <T>(payload: T): T => redactValue(payload) as T;

export const redactErrorMessage = (message: string) => redactValue(message) as string;

export const REDACTION = { REDACTED } as const;
