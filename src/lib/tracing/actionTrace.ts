import type { TraceActionContext, TraceOrigin } from '@/lib/tracing/types';
import {
  recordActionEnd,
  recordActionScopeEnd,
  recordActionScopeStart,
  recordActionStart,
  recordTraceError,
} from '@/lib/tracing/traceSession';

const buildId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto && crypto.randomUUID()) ||
  `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

let activeAction: TraceActionContext | null = null;

export const getActiveAction = () => activeAction;

export const runWithActionTrace = async <T>(context: TraceActionContext, fn: () => Promise<T> | T): Promise<T> => {
  if (activeAction) {
    return await fn();
  }

  activeAction = context;
  recordActionStart(context);
  try {
    const result = await fn();
    recordActionEnd(context, null);
    return result;
  } catch (error) {
    const err = error as Error;
    recordTraceError(context, err);
    recordActionEnd(context, err);
    throw error;
  } finally {
    activeAction = null;
  }
};

export const runWithImplicitAction = async <T>(
  name: string,
  fn: (context: TraceActionContext) => Promise<T> | T,
): Promise<T> => {
  if (activeAction) {
    return await fn(activeAction);
  }
  const context: TraceActionContext = {
    correlationId: buildId(),
    origin: 'system',
    name,
    componentName: null,
  };
  return runWithActionTrace(context, () => fn(context));
};

export const createActionContext = (
  name: string,
  origin: TraceOrigin,
  componentName?: string | null,
): TraceActionContext => ({
  correlationId: buildId(),
  origin,
  name,
  componentName: componentName ?? null,
});

export const runActionScope = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
  if (!activeAction) {
    return await fn();
  }
  recordActionScopeStart(activeAction, name);
  try {
    const result = await fn();
    recordActionScopeEnd(activeAction, name, null);
    return result;
  } catch (error) {
    const err = error as Error;
    recordTraceError(activeAction, err);
    recordActionScopeEnd(activeAction, name, err);
    throw error;
  }
};
