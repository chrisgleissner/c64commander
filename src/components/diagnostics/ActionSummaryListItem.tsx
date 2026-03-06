/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type {
  ActionSummary,
  ErrorEffect,
  FtpEffect,
  RestEffect,
} from '@/lib/diagnostics/actionSummaries';
import { formatActionDuration } from '@/lib/diagnostics/actionSummaryDisplay';
import { resolveActionSeverity } from '@/lib/diagnostics/diagnosticsSeverity';
import { DiagnosticsListItem } from '@/components/diagnostics/DiagnosticsListItem';
import { ActionExpandedContent } from '@/components/diagnostics/ActionExpandedContent';
import type { ReactNode } from 'react';

type Props = {
  summary: ActionSummary;
};

export const ActionSummaryListItem = ({ summary }: Props) => {
  const effects = summary.effects ?? [];
  const restCount = effects.filter(
    (e): e is RestEffect => e.type === 'REST',
  ).length;
  const ftpCount = effects.filter(
    (e): e is FtpEffect => e.type === 'FTP',
  ).length;
  const errorCount = effects.filter(
    (e): e is ErrorEffect => e.type === 'ERROR',
  ).length;
  const hasEffects = Boolean(restCount || ftpCount || errorCount);

  let badges: ReactNode = null;
  if (hasEffects) {
    badges = (
      <>
        {restCount ? (
          <span
            data-testid={`action-rest-count-${summary.correlationId}`}
            className="text-diagnostics-rest text-xs font-medium"
          >
            REST×{restCount}
          </span>
        ) : null}
        {ftpCount ? (
          <span
            data-testid={`action-ftp-count-${summary.correlationId}`}
            className="text-diagnostics-ftp text-xs font-medium"
          >
            FTP×{ftpCount}
          </span>
        ) : null}
        {errorCount ? (
          <span
            data-testid={`action-error-count-${summary.correlationId}`}
            className="text-diagnostics-error text-xs font-medium"
          >
            ERR×{errorCount}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <DiagnosticsListItem
      key={summary.correlationId}
      testId={`action-summary-${summary.correlationId}`}
      mode="action"
      severity={resolveActionSeverity(summary.outcome)}
      title={summary.actionName}
      timestamp={summary.startTimestamp}
      origin={summary.origin}
      secondaryLeft={badges}
      secondaryRight={formatActionDuration(summary.durationMs)}
    >
      <ActionExpandedContent summary={summary} />
    </DiagnosticsListItem>
  );
};
