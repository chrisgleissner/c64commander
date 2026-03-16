/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ActionSummary, ErrorEffect, FtpEffect, RestEffect } from "@/lib/diagnostics/actionSummaries";
import type { PayloadPreview, TraceHeaders } from "@/lib/tracing/types";
import {
  formatActionEffectTarget,
  formatActionSummaryOrigin,
  formatTriggerDisplay,
} from "@/lib/diagnostics/actionSummaryDisplay";

type Props = {
  summary: ActionSummary;
};

const PayloadPreviewBlock = ({ label, preview }: { label: string; preview?: PayloadPreview | null }) => {
  if (!preview) return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-foreground">{label}</p>
      <p className="text-muted-foreground">
        bytes: {preview.byteCount}
        {preview.truncated ? ` · showing ${preview.previewByteCount}` : ""}
      </p>
      <pre className="overflow-x-auto whitespace-pre text-[11px] text-muted-foreground">HEX {preview.hex}</pre>
      <pre className="overflow-x-auto whitespace-pre text-[11px] text-muted-foreground">ASCII {preview.ascii}</pre>
    </div>
  );
};

const JsonBlock = ({ label, value }: { label: string; value: unknown }) => {
  if (value === undefined) return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-foreground">{label}</p>
      <pre className="overflow-x-auto whitespace-pre text-[11px] text-muted-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
};

const HeaderBlock = ({ label, headers }: { label: string; headers?: TraceHeaders }) => {
  if (!headers || Object.keys(headers).length === 0) return null;
  return <JsonBlock label={label} value={headers} />;
};

export const ActionExpandedContent = ({ summary }: Props) => {
  const effects = summary.effects ?? [];
  const restEffects = effects.filter((e): e is RestEffect => e.type === "REST");
  const ftpEffects = effects.filter((e): e is FtpEffect => e.type === "FTP");
  const errorEffects = effects.filter((e): e is ErrorEffect => e.type === "ERROR");
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
              <p className="font-medium">
                {effect.method} {effect.path}
              </p>
              <p className="text-muted-foreground">
                target: {formatActionEffectTarget(effect.target, effect.product ?? inferredProduct)} · status:{" "}
                {effect.status !== null && effect.status !== undefined ? effect.status : "unknown"}
                {effect.durationMs !== null ? ` · ${effect.durationMs}ms` : ""}
              </p>
              {effect.error ? <p className="text-diagnostics-error">error: {effect.error}</p> : null}
              <div className="mt-2 space-y-2">
                <HeaderBlock label="Request headers" headers={effect.requestHeaders} />
                <JsonBlock label="Request payload" value={effect.requestBody} />
                <PayloadPreviewBlock label="Request preview" preview={effect.requestPayloadPreview} />
                <HeaderBlock label="Response headers" headers={effect.responseHeaders} />
                <JsonBlock label="Response payload" value={effect.responseBody} />
                <PayloadPreviewBlock label="Response preview" preview={effect.responsePayloadPreview} />
              </div>
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
              <p className="font-medium">
                {effect.operation} {effect.path}
              </p>
              <p className="text-muted-foreground">
                target: {formatActionEffectTarget(effect.target, inferredProduct)} · result:{" "}
                {effect.result ?? "unknown"}
              </p>
              {effect.error ? <p className="text-diagnostics-error">error: {effect.error}</p> : null}
              <div className="mt-2 space-y-2">
                <JsonBlock label="Request payload" value={effect.requestPayload} />
                <PayloadPreviewBlock label="Request preview" preview={effect.requestPayloadPreview} />
                <JsonBlock label="Response payload" value={effect.responsePayload} />
                <PayloadPreviewBlock label="Response preview" preview={effect.responsePayloadPreview} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {errorEffects.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold">Errors</p>
          {errorEffects.map((effect, index) => (
            <div
              key={`${summary.correlationId}-error-${index}`}
              data-testid={`action-error-effect-${summary.correlationId}-${index}`}
              className="rounded-md border border-border/70 p-2"
            >
              <p className="text-diagnostics-error">{effect.message}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
