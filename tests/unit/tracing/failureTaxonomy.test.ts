/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { classifyError } from '@/lib/tracing/failureTaxonomy';
import { LocalSourceListingError } from '@/lib/sourceNavigation/localSourceErrors';

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

  it('classifyError with null input wraps in Error (lines 42, 93)', () => {
    const result = classifyError(null);
    expect(result.failureClass).toBe('unknown');
  });

  it('classifyError with string input wraps in Error (lines 43, 93)', () => {
    const result = classifyError('aborted');
    // 'aborted' matches /aborted|canceled|cancelled/i → user-cancellation
    expect(result.failureClass).toBe('user-cancellation');
  });

  it('normalizeMessage returns empty string for non-string message property (line 46)', () => {
    const result = classifyError({ message: 42 });
    expect(result.failureClass).toBe('unknown');
  });

  it('classifies numeric error input (normalizeMessage skips object-branch for non-object, BRDA:47)', () => {
    // normalizeMessage(42): !42=false, typeof 42!=='string', typeof 42!=='object' → straight to return ''
    const result = classifyError(42);
    expect(result.failureClass).toBe('unknown');
  });

  it('classifies LocalSourceListingError with saf- code as permission-denied (lines 85, 135)', () => {
    const err = new LocalSourceListingError('Cannot list', 'saf-listing-unavailable');
    const result = classifyError(err);
    expect(result.failureClass).toBe('permission-denied');
    expect(result.errorType).toContain('LocalSourceListingError');
  });

  it('classifies LocalSourceListingError with non-saf code as io-read-failure (line 136 FALSE)', () => {
    const err = new LocalSourceListingError('Cannot list', 'local-entries-missing');
    const result = classifyError(err);
    expect(result.failureClass).toBe('io-read-failure');
  });
});
