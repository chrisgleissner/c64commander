/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import {
  DIAGNOSTICS_SEVERITY_META,
  getDiagnosticsSeverityMeta,
  resolveActionSeverity,
  resolveLogSeverity,
  resolveTraceSeverity,
} from '@/lib/diagnostics/diagnosticsSeverity';

describe('diagnosticsSeverity', () => {
  it('maps severity to glyph, label, and color token', () => {
    expect(getDiagnosticsSeverityMeta('error')).toEqual({
      glyph: 'E',
      label: 'ERROR',
      colorClass: 'text-destructive',
    });
    expect(getDiagnosticsSeverityMeta('warn')).toEqual({
      glyph: 'W',
      label: 'WARN',
      colorClass: 'text-amber-600',
    });
    expect(getDiagnosticsSeverityMeta('info')).toEqual({
      glyph: 'I',
      label: 'INFO',
      colorClass: 'text-muted-foreground',
    });
    expect(getDiagnosticsSeverityMeta('debug')).toEqual({
      glyph: 'D',
      label: 'DEBUG',
      colorClass: 'text-c64-blue',
    });
    expect(Object.keys(DIAGNOSTICS_SEVERITY_META)).toEqual(['error', 'warn', 'info', 'debug']);
  });

  it('maps log levels to severity', () => {
    expect(resolveLogSeverity('debug')).toBe('debug');
    expect(resolveLogSeverity('info')).toBe('info');
    expect(resolveLogSeverity('warn')).toBe('warn');
    expect(resolveLogSeverity('error')).toBe('error');
  });

  it('maps action outcomes to severity', () => {
    expect(resolveActionSeverity('success')).toBe('info');
    expect(resolveActionSeverity('error')).toBe('error');
    expect(resolveActionSeverity('blocked')).toBe('warn');
    expect(resolveActionSeverity('timeout')).toBe('warn');
    expect(resolveActionSeverity('incomplete')).toBe('warn');
  });

  it('maps trace errors to error severity and others to info', () => {
    expect(resolveTraceSeverity({ type: 'error' })).toBe('error');
    expect(resolveTraceSeverity({ type: 'rest-request' })).toBe('info');
  });
});
