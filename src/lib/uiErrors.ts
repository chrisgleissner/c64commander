/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { toast } from "@/hooks/use-toast";
import { addErrorLog, addLog } from "@/lib/logging";

export type UiErrorReport = {
  operation: string;
  title: string;
  description: string;
  error?: unknown;
  context?: Record<string, unknown>;
};

const buildErrorDetails = (error?: unknown) => {
  if (!error) return undefined;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (typeof error === "object") {
    return { ...(error as Record<string, unknown>) };
  }
  return { message: String(error) };
};

// Exported so c64api.ts and other modules can reuse the same detection logic
// instead of duplicating transient-failure pattern strings.
export const isTransientConnectivityFailure = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return /host unreachable|service unavailable|http 503|failed to fetch|net::err|request timed out|networkerror|dns/.test(
    normalized,
  );
};

const isRecoverableConnectivityError = (
  description: string,
  error?: unknown,
) => {
  const details = buildErrorDetails(error) as { message?: string } | undefined;
  const message = `${description} ${details?.message ?? ""}`;
  return isTransientConnectivityFailure(message);
};

export const reportUserError = ({
  operation,
  title,
  description,
  error,
  context,
}: UiErrorReport) => {
  const logPayload = {
    operation,
    description,
    ...context,
    error: buildErrorDetails(error),
  };

  // Always log as error so the entry is captured even when the diagnostics
  // overlay is open (addLog at warn level is suppressed by the overlay).
  // The recoverableConnectivityIssue flag distinguishes transient failures
  // from persistent defects so callers can filter or present them differently.
  addErrorLog(`${operation}: ${title}`, {
    ...logPayload,
    ...(isRecoverableConnectivityError(description, error)
      ? { recoverableConnectivityIssue: true }
      : {}),
  });

  toast({
    title,
    description,
    variant: "destructive",
  });
};
