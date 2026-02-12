/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { classifyError } from '@/lib/tracing/failureTaxonomy';

describe('failureTaxonomy', () => {
  it('classifies user cancellation', () => {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    expect(classifyError(err).failureClass).toBe('user-cancellation');
  });

  it('classifies network timeouts as network-transient', () => {
    expect(classifyError(new Error('Request timed out')).failureClass).toBe('network-transient');
  });

  it('classifies unreachable network as network-unreachable', () => {
    expect(classifyError(new Error('getaddrinfo ENOTFOUND c64u')).failureClass).toBe('network-unreachable');
  });

  it('classifies permission errors', () => {
    expect(classifyError(new Error('Permission denied: content://demo')).failureClass).toBe('permission-denied');
  });

  it('classifies parse errors', () => {
    expect(classifyError(new SyntaxError('Unexpected token')).failureClass).toBe('parse-failure');
  });

  it('classifies plugin failures', () => {
    expect(classifyError(new Error('Capacitor plugin call failed')).failureClass).toBe('plugin-failure');
  });

  it('classifies storage read/write failures', () => {
    expect(classifyError(new Error('No such file or directory')).failureClass).toBe('io-read-failure');
    expect(classifyError(new Error('Failed to write file')).failureClass).toBe('io-write-failure');
  });

  it('classifies resource exhaustion', () => {
    const err = new Error('QuotaExceededError');
    err.name = 'QuotaExceededError';
    expect(classifyError(err).failureClass).toBe('resource-exhausted');
  });

  it('classifies metadata absent', () => {
    expect(classifyError(new Error('No songlength entry found')).failureClass).toBe('metadata-absent');
  });
});
