/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ActionSummary, FtpEffect, RestEffect } from '@/lib/diagnostics/actionSummaries';
import {
  formatActionEffectTarget,
  formatActionSummaryOrigin,
  formatTriggerDisplay,
} from '@/lib/diagnostics/actionSummaryDisplay';

type Props = {
  summary: ActionSummary;
};

export const ActionExpandedContent = ({ summary }: Props) => {
  const effects = summary.effects ?? [];
  const restEffects = effects.filter((e): e is RestEffect => e.type === 'REST');
  const ftpEffects = effects.filter((e): e is FtpEffect => e.type === 'FTP');
  const inferredProduct = restEffects.find((effect) => effect.product)?.product ?? null;

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>origin: {formatActionSummaryOrigin(summary.origin, summary.originalOrigin)}</span>
        <span>outcome: {summary.outcome}</span>
        <span className="break-all">correlation: {summary.correlationId}</span>
        {summary.trigger ? (
          <span data-testid={`action-trigger-${summary.correlationId}`}>
            trigger: {formatTriggerDisplay(summary.trigger)}
          </span>
        ) : null}
        {summary.errorMessage ? (
          <span className="text-diagnostics-error break-words">error: {summary.errorMessage}</span>
        ) : null}
      </div>

      {restEffects.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold">REST</p>
          {restEffects.map((effect, index) => (
            <div
              key={`${summary.correlationId}-rest-${index}`}
              data-testid={`action-rest-effect-${summary.correlationId}-${index}`}
              className="rounded-md border border-border/70 p-2"
            >
              <p className="font-medium">{effect.method} {effect.path}</p>
              <p className="text-muted-foreground">
                target: {formatActionEffectTarget(effect.target, effect.product ?? inferredProduct)} · status: {effect.status !== null && effect.status !== undefined ? effect.status : 'unknown'}
                {effect.durationMs !== null ? ` · ${effect.durationMs}ms` : ''}
              </p>
              {effect.error ? (
                <p className="text-diagnostics-error">error: {effect.error}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {ftpEffects.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold">FTP</p>
          {ftpEffects.map((effect, index) => (
            <div
              key={`${summary.correlationId}-ftp-${index}`}
              data-testid={`action-ftp-effect-${summary.correlationId}-${index}`}
              className="rounded-md border border-border/70 p-2"
            >
              <p className="font-medium">{effect.operation} {effect.path}</p>
              <p className="text-muted-foreground">
                target: {formatActionEffectTarget(effect.target, inferredProduct)} · result: {effect.result ?? 'unknown'}
              </p>
              {effect.error ? (
                <p className="text-diagnostics-error">error: {effect.error}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
