/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  redactErrorMessage,
  redactHeaders,
  redactPayload,
  REDACTION,
} from '@/lib/tracing/redaction';
import { redactTreeUri } from '@/lib/native/safUtils';

vi.mock('@/lib/native/safUtils', () => ({
  redactTreeUri: vi.fn(() => 'REDACTED_URI'),
}));

describe('redaction', () => {
  it('redacts sensitive headers and URI values', () => {
    const input = {
      Authorization: 'Bearer secret-token',
      'X-Password': 'hunter2',
      'X-Token': ['token-a', 'token-b'],
      'Content-Type': 'application/json',
      'X-Path': 'content://com.example/document/123',
    };

    const redacted = redactHeaders(input);

    expect(redacted.Authorization).toBe(REDACTION.REDACTED);
    expect(redacted['X-Password']).toBe(REDACTION.REDACTED);
    expect(redacted['X-Token']).toBe(REDACTION.REDACTED);
    expect(redacted['Content-Type']).toBe('application/json');
    expect(redacted['X-Path']).toBe('REDACTED_URI');
  });

  it('redacts nested payloads and arrays', () => {
    const payload = {
      token: 'abc123',
      nested: {
        auth: 'secret',
        uri: 'file:///storage/emulated/0/Download/test.sid',
        list: [{ password: 'pw' }, 'content://com.example/tree/456'],
      },
    };

    const redacted = redactPayload(payload);

    expect(redacted).toEqual({
      token: REDACTION.REDACTED,
      nested: {
        auth: REDACTION.REDACTED,
        uri: 'REDACTED_URI',
        list: [{ password: REDACTION.REDACTED }, 'REDACTED_URI'],
      },
    });
  });

  it('redacts URI-only error messages', () => {
    const message = 'content://com.example/tree/789';
    expect(redactErrorMessage(message)).toBe('REDACTED_URI');
  });

  it('returns whitespace-only string unchanged from redactUri (line 24 TRUE)', () => {
    expect(redactErrorMessage('   ')).toBe('   ');
  });

  it('falls back to REDACTED when redactTreeUri returns null (line 26)', () => {
    vi.mocked(redactTreeUri).mockReturnValueOnce(null);
    expect(redactErrorMessage('content://com.example/doc')).toBe(
      REDACTION.REDACTED,
    );
  });

  it('skips undefined header values (line 48)', () => {
    const result = redactHeaders({ 'X-Meta': undefined });
    expect(result['X-Meta']).toBeUndefined();
  });

  it('redacts array values for non-sensitive header keys (line 53)', () => {
    vi.mocked(redactTreeUri).mockImplementation((v: string) => `REDACTED:${v}`);
    const result = redactHeaders({ 'X-Paths': ['file:///a', 'file:///b'] });
    expect(result['X-Paths']).toEqual([
      'REDACTED:file:///a',
      'REDACTED:file:///b',
    ]);
    vi.mocked(redactTreeUri).mockImplementation(() => 'REDACTED_URI');
  });
});
