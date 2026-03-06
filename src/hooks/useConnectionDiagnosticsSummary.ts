/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useState } from 'react';
import { buildConnectionDiagnosticsSummary } from '@/lib/diagnostics/connectionStatusDiagnostics';
import type { ConnectionDiagnosticsSummary } from '@/lib/diagnostics/connectionStatusDiagnostics';
import { getErrorLogs, getLogs } from '@/lib/logging';
import { getTraceEvents } from '@/lib/tracing/traceSession';

export const useConnectionDiagnosticsSummary =
  (): ConnectionDiagnosticsSummary => {
    const [traceEvents, setTraceEvents] = useState(getTraceEvents);
    const [logs, setLogs] = useState(getLogs);
    const [errorLogs, setErrorLogs] = useState(getErrorLogs);

    useEffect(() => {
      const handleTracesUpdated = () => setTraceEvents(getTraceEvents());
      const handleLogsUpdated = () => {
        setLogs(getLogs());
        setErrorLogs(getErrorLogs());
      };
      window.addEventListener('c64u-traces-updated', handleTracesUpdated);
      window.addEventListener('c64u-logs-updated', handleLogsUpdated);
      return () => {
        window.removeEventListener('c64u-traces-updated', handleTracesUpdated);
        window.removeEventListener('c64u-logs-updated', handleLogsUpdated);
      };
    }, []);

    return useMemo(
      () => buildConnectionDiagnosticsSummary(traceEvents, logs, errorLogs),
      [errorLogs, logs, traceEvents],
    );
  };
