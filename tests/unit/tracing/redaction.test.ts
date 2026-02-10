/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from 'vitest';
import { redactErrorMessage, redactHeaders, redactPayload, REDACTION } from '@/lib/tracing/redaction';

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
});
