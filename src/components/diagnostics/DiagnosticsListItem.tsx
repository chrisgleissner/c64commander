/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DiagnosticsTimestamp } from '@/components/diagnostics/DiagnosticsTimestamp';
import { getDiagnosticsSeverityMeta, type DiagnosticsSeverity } from '@/lib/diagnostics/diagnosticsSeverity';

export type DiagnosticsListItemMode = 'trace' | 'action' | 'log';

type Props = {
  mode: DiagnosticsListItemMode;
  severity: DiagnosticsSeverity;
  title: string;
  timestamp: string | number | Date | null;
  origin?: 'user' | 'system' | null;
  secondaryLeft?: ReactNode;
  secondaryRight?: ReactNode;
  children?: ReactNode;
  testId?: string;
};

export const DiagnosticsListItem = ({
  mode,
  severity,
  title,
  timestamp,
  origin,
  secondaryLeft,
  secondaryRight,
  children,
  testId,
}: Props) => {
  const showOrigin = mode === 'action' && origin;
  const originClass =
    origin === 'user'
      ? 'bg-diagnostics-user'
      : origin === 'system'
        ? 'bg-diagnostics-system'
        : undefined;
  const severityMeta = getDiagnosticsSeverityMeta(severity);
  const hasSecondary = Boolean(secondaryLeft || secondaryRight);

  return (
    <details className="group rounded-lg border border-border" data-testid={testId}>
      <summary className="list-none cursor-pointer select-none px-2 py-0.5 [&::-webkit-details-marker]:hidden">
        <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2" data-testid="diagnostics-summary-grid">
          <div className="flex items-center justify-center gap-1 text-xs">
            <ChevronRight
              className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 group-[open]:rotate-90"
              aria-hidden="true"
            />
            <span
              data-testid="diagnostics-severity-glyph"
              className={cn(
                'inline-flex w-4 items-center justify-center text-[11px] font-semibold leading-none whitespace-nowrap',
                severityMeta.colorClass,
              )}
            >
              {severityMeta.glyph}
            </span>
          </div>
          <div className="flex items-center gap-2 min-w-0 text-sm font-medium">
            {showOrigin ? (
              <span
                className={cn('h-2.5 w-2.5 rounded-full shrink-0', originClass)}
                aria-label={origin ?? undefined}
              />
            ) : null}
            <span className="min-w-0 truncate" data-testid="diagnostics-entry-title">{title}</span>
          </div>
          <DiagnosticsTimestamp className="text-muted-foreground text-right shrink-0" value={timestamp} />
        </div>
      </summary>
      <div className="px-2 pb-3 pt-2 text-xs">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
          <span
            className={cn('inline-flex w-4 items-center justify-center', severityMeta.colorClass)}
            aria-hidden="true"
          >
            {severityMeta.glyph}
          </span>
          <span data-testid="diagnostics-severity-label" className={cn(severityMeta.colorClass)}>
            {severityMeta.label}
          </span>
        </div>
        {hasSecondary ? (
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-xs">
            <div className="min-w-0 flex flex-wrap items-center gap-2">
              {secondaryLeft}
            </div>
            <div className="text-muted-foreground font-semibold tabular-nums text-right shrink-0">
              {secondaryRight}
            </div>
          </div>
        ) : null}
        {children ? <div className={cn('text-xs mt-2')}>{children}</div> : null}
      </div>
    </details>
  );
};
