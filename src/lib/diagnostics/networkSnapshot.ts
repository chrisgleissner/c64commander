/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getTraceEvents } from '@/lib/tracing/traceSession';
import type { TraceEvent } from '@/lib/tracing/types';

export type NetworkRequest = {
  hostname: string | null;
  resolvedIp: string | null;
  port: number | null;
  protocol: string | null;
  durationMs: number | null;
  httpStatus: number | null;
  errorDomain: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  url: string;
  method: string;
  timestamp: string;
};

export type NetworkSnapshot = {
  requests: NetworkRequest[];
  successCount: number;
  failureCount: number;
};

const parseUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return {
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80),
      protocol: parsed.protocol.replace(':', ''),
    };
  } catch {
    return { hostname: null, port: null, protocol: null };
  }
};

export const buildNetworkSnapshot = (): NetworkSnapshot => {
  const events = getTraceEvents();
  const requestMap = new Map<string, { request?: TraceEvent; response?: TraceEvent }>();

  for (const event of events) {
    if (event.type !== 'rest-request' && event.type !== 'rest-response') continue;

    const correlationId = event.correlationId;
    const entry = requestMap.get(correlationId) ?? {};

    if (event.type === 'rest-request') {
      entry.request = event;
    } else {
      entry.response = event;
    }

    requestMap.set(correlationId, entry);
  }

  const requests: NetworkRequest[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (const [, { request, response }] of requestMap) {
    const reqData = request?.data as Record<string, unknown> | undefined;
    const resData = response?.data as Record<string, unknown> | undefined;

    const url = (reqData?.url as string) ?? '';
    const method = (reqData?.method as string) ?? 'GET';
    const { hostname, port, protocol } = parseUrl(url);

    const httpStatus = (resData?.status as number) ?? null;
    const error = resData?.error as Record<string, unknown> | undefined;
    const durationMs = (resData?.durationMs as number) ?? null;

    const isSuccess = httpStatus !== null && httpStatus >= 200 && httpStatus < 400;
    if (isSuccess) {
      successCount++;
    } else if (response) {
      failureCount++;
    }

    requests.push({
      hostname,
      resolvedIp: hostname === '127.0.0.1' || hostname === 'localhost' ? '127.0.0.1' : hostname,
      port,
      protocol,
      durationMs,
      httpStatus,
      errorDomain: error ? ((error.name as string) ?? null) : null,
      errorCode: error ? ((error.code as string) ?? null) : null,
      errorMessage: error ? ((error.message as string) ?? null) : null,
      retryCount: 0,
      url,
      method,
      timestamp: request?.timestamp ?? response?.timestamp ?? '',
    });
  }

  return { requests, successCount, failureCount };
};
