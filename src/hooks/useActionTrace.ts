/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useMemo } from 'react';
import type { TraceOrigin } from '@/lib/tracing/types';
import { createActionContext, runActionScope, runWithActionTrace } from '@/lib/tracing/actionTrace';

const inferActionName = (componentName: string | undefined, fn: (...args: unknown[]) => unknown) => {
  if (componentName) {
    const fnName = fn.name || 'anonymousAction';
    return `${componentName}.${fnName}`;
  }
  if (fn.name) return fn.name;
  return 'anonymousAction';
};

const inferComponentNameFromStack = () => {
  try {
    const stack = new Error().stack;
    if (!stack) return undefined;
    const lines = stack.split('\n').map((line) => line.trim());
    const candidates = lines
      .map((line) => line.replace(/^at\s+/, '').split(' ')[0])
      .filter((name) =>
        name &&
        !['useActionTrace', 'renderWithHooks', 'mountIndeterminateComponent', 'beginWork'].includes(name)
      );
    return candidates[0];
  } catch {
    return undefined;
  }
};

type ActionTraceWrapper = (<T extends (...args: any[]) => any>(fn: T) => T) & {
  scope: <T>(name: string, fn: () => Promise<T> | T) => Promise<T>;
};

export const useActionTrace = (componentName?: string): ActionTraceWrapper => {
  const origin: TraceOrigin = 'user';
  const resolvedComponent = componentName ?? inferComponentNameFromStack();

  const wrap = useCallback(<T extends (...args: any[]) => any>(fn: T) => {
    const actionName = inferActionName(resolvedComponent, fn);
    const traced = ((...args: Parameters<T>) => {
      const context = createActionContext(actionName, origin, resolvedComponent ?? null);
      return runWithActionTrace(context, () => fn(...args));
    }) as T;
    return traced;
  }, [origin, resolvedComponent]);

  return useMemo(() => Object.assign(wrap, { scope: runActionScope }), [wrap]);
};
