import type { TraceActionContext, TraceOrigin } from '@/lib/tracing/types';
import {
  recordActionEnd,
  recordActionScopeEnd,
  recordActionScopeStart,
  recordActionStart,
  recordTraceError,
} from '@/lib/tracing/traceSession';
import { nextCorrelationId } from '@/lib/tracing/traceIds';

let activeAction: TraceActionContext | null = null;

export const getActiveAction = () => activeAction;

export const resetActionTrace = () => {
  activeAction = null;
};

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

const runWithDetachedActionTrace = async <T>(context: TraceActionContext, fn: () => Promise<T> | T): Promise<T> => {
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
  }
};

export const runWithImplicitAction = async <T>(
  name: string,
  fn: (context: TraceActionContext) => Promise<T> | T,
): Promise<T> => {
  const context: TraceActionContext = {
    correlationId: nextCorrelationId(),
    origin: 'system',
    name,
    componentName: null,
  };
  return runWithDetachedActionTrace(context, () => fn(context));
};

export const createActionContext = (
  name: string,
  origin: TraceOrigin,
  componentName?: string | null,
): TraceActionContext => ({
  correlationId: nextCorrelationId(),
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
