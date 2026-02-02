import type { TraceEvent } from './types';

export const getTraceTitle = (event: TraceEvent): string => {
  const data = event.data as Record<string, unknown>;

  if (event.type === 'action-start') {
    return `Action: ${data.name}`;
  }

  if (event.type === 'rest-request') {
    return `REST ${data.method} ${data.url}`;
  }

  if (event.type === 'rest-response') {
    return `Response ${data.status} (${data.durationMs}ms)`;
  }

  return `${event.type} · ${event.origin}`;
};
