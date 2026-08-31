/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface DroidctlLogger {
  debug(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

function format(message: string, details?: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) {
    return message;
  }

  try {
    return `${message} ${JSON.stringify(details)}`;
  } catch {
    return message;
  }
}

export function createLogger(scope: string): DroidctlLogger {
  return {
    debug(message, details) {
      if (process.env.DROIDCTL_DEBUG === "1") {
        console.error(`[${scope}] ${format(message, details)}`);
      }
    },
    info(message, details) {
      console.error(`[${scope}] ${format(message, details)}`);
    },
    warn(message, details) {
      console.error(`[${scope}] ${format(message, details)}`);
    },
    error(message, details) {
      console.error(`[${scope}] ${format(message, details)}`);
    },
  };
}
