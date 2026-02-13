/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ActionSummaryOutcome } from '@/lib/diagnostics/actionSummaries';
import type { LogLevel } from '@/lib/logging';
import type { TraceEvent } from '@/lib/tracing/types';

export type DiagnosticsSeverity = 'error' | 'warn' | 'info' | 'debug';
export type DiagnosticsDisplaySeverity = 'ERROR' | 'WARN' | 'INFO';

type DiagnosticsSeverityMeta = {
  glyph: 'E' | 'W' | 'I' | 'D';
  label: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  colorClass: string;
};

export const DIAGNOSTICS_SEVERITY_META: Record<DiagnosticsSeverity, DiagnosticsSeverityMeta> = {
  error: { glyph: 'E', label: 'ERROR', colorClass: 'text-destructive' },
  warn: { glyph: 'W', label: 'WARN', colorClass: 'text-amber-600' },
  info: { glyph: 'I', label: 'INFO', colorClass: 'text-muted-foreground' },
  debug: { glyph: 'D', label: 'DEBUG', colorClass: 'text-c64-blue' },
};

export const getDiagnosticsSeverityMeta = (severity: DiagnosticsSeverity): DiagnosticsSeverityMeta =>
  DIAGNOSTICS_SEVERITY_META[severity];

const DISPLAY_TO_DIAGNOSTICS_SEVERITY: Record<DiagnosticsDisplaySeverity, DiagnosticsSeverity> = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
};

export const getDiagnosticsColorClassForDisplaySeverity = (severity: DiagnosticsDisplaySeverity): string =>
  getDiagnosticsSeverityMeta(DISPLAY_TO_DIAGNOSTICS_SEVERITY[severity]).colorClass;

export const resolveLogSeverity = (level: LogLevel): DiagnosticsSeverity => level;

export const resolveTraceSeverity = (event: Pick<TraceEvent, 'type'>): DiagnosticsSeverity =>
  event.type === 'error' ? 'error' : 'info';

export const resolveActionSeverity = (outcome: ActionSummaryOutcome): DiagnosticsSeverity => {
  switch (outcome) {
    case 'error':
      return 'error';
    case 'blocked':
    case 'timeout':
    case 'incomplete':
      return 'warn';
    case 'success':
      return 'info';
    default:
      return 'info';
  }
};
