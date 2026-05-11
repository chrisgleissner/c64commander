/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { TraceEvent } from "./types";

export const getTraceTitle = (event: TraceEvent): string => {
  const data = event.data as Record<string, unknown>;

  if (event.type === "action-start") {
    return `Action: ${data.name}`;
  }

  if (event.type === "rest-request") {
    return `REST ${data.method} ${data.url}`;
  }

  if (event.type === "rest-response") {
    return `Response ${data.status} (${data.durationMs}ms)`;
  }

  if (event.type === "ftp-operation") {
    return `FTP ${data.command ?? data.operation ?? "operation"} ${data.path ?? ""}`.trim();
  }

  if (event.type === "telnet-operation") {
    return `TELNET ${data.actionLabel ?? data.actionId ?? "operation"}`.trim();
  }

  return `${event.type} · ${event.origin}`;
};
