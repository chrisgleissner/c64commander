import type { TraceActionContext, TraceOrigin } from '@/lib/tracing/types';
import {
  recordActionEnd,
  recordActionScopeEnd,
  recordActionScopeStart,
  recordActionStart,
  recordTraceError,
} from '@/lib/tracing/traceSession';
import { nextCorrelationId } from '@/lib/tracing/traceIds';
import {
  getCurrentActionContext,
  runWithActionContext,
  exitCurrentActionContext,
  resetActionContextStore,
} from '@/lib/tracing/traceActionContextStore';

/**
 * Get the currently active action context from the async context store.
 * This returns the context even for fire-and-forget async continuations.
 */
export const getActiveAction = (): TraceActionContext | null => {
  return getCurrentActionContext();
};

/**
 * Reset the action trace state (for testing).
 */
export const resetActionTrace = () => {
  resetActionContextStore();
};

/**
 * Run a function within an action trace context.
 * The context will propagate through all async boundaries, including fire-and-forget patterns.
 *
 * @param context - The TraceActionContext for this action
 * @param fn - The function to execute within the action trace
 * @returns The result of fn
 */
export const runWithActionTrace = async <T>(context: TraceActionContext, fn: () => Promise<T> | T): Promise<T> => {
  return runWithActionContext(context, async () => {
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
      // Exit the context when the action completes
      // Note: already-scheduled async continuations will still have access
      // to the captured context through the Promise wrapper
      exitCurrentActionContext();
    }
  });
};

/**
 * Run a function within a detached action trace.
 * Used for implicit system actions where we don't want to affect the global state.
 *
 * @param context - The TraceActionContext for this action
 * @param fn - The function to execute
 * @returns The result of fn
 */
const runWithDetachedActionTrace = async <T>(context: TraceActionContext, fn: () => Promise<T> | T): Promise<T> => {
  return runWithActionContext(context, async () => {
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
      exitCurrentActionContext();
    }
  });
};

/**
 * Run an implicit system action.
 * Used when a REST or FTP operation occurs outside any user action context.
 *
 * @param name - The action name
 * @param fn - The function to execute, receives the action context
 * @returns The result of fn
 */
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

/**
 * Create a new action context with a fresh correlation ID.
 *
 * @param name - The action name
 * @param origin - The action origin (user, automatic, system)
 * @param componentName - Optional component name for tracing
 * @returns A new TraceActionContext
 */
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

/**
 * Run a scoped sub-trace within the current action.
 * Scopes are optional and used for large multi-phase flows.
 *
 * @param name - The scope name
 * @param fn - The function to execute within the scope
 * @returns The result of fn
 */
export const runActionScope = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
  const activeAction = getActiveAction();
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
