/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Async Action Context Store
 *
 * This module provides async context propagation for TraceActionContext.
 * It ensures that correlation IDs flow correctly through all async boundaries,
 * including fire-and-forget patterns (void promise), timers, and microtasks.
 *
 * Key Design Principles:
 * 1. Context MUST propagate across promise chains, async/await, timers, and microtasks
 * 2. Fire-and-forget usage (void promise) MUST retain the originating context
 * 3. Business logic remains tracing-agnostic
 *
 * Implementation:
 * Uses Promise wrapping to capture and restore context across async boundaries.
 * When a promise is created within a context, its continuations (then/catch/finally)
 * will execute with that same context, regardless of when they run.
 * 
 * The implementation uses two mechanisms:
 * 1. A variable for the "current" action context during synchronous execution
 * 2. Promise/timer patching to restore captured contexts in async callbacks
 */

import type { TraceActionContext } from '@/lib/tracing/types';

// The active action context during synchronous execution
// This is what getActiveAction() returns for synchronous callers
let currentActionContext: TraceActionContext | null = null;

// Track original Promise methods
let originalPromiseThen: typeof Promise.prototype.then | null = null;
let originalPromiseCatch: typeof Promise.prototype.catch | null = null;
let originalPromiseFinally: typeof Promise.prototype.finally | null = null;
let originalSetTimeout: typeof globalThis.setTimeout | null = null;
let originalSetInterval: typeof globalThis.setInterval | null = null;
let originalQueueMicrotask: typeof globalThis.queueMicrotask | null = null;
let isInstalled = false;

/**
 * Get the current action context from the async context store.
 * Returns null if no context is active.
 */
export const getCurrentActionContext = (): TraceActionContext | null => {
  return currentActionContext;
};

/**
 * Run a function within the given action context.
 * All async continuations scheduled during this function will inherit the context.
 *
 * @param ctx - The TraceActionContext to propagate
 * @param fn - The function to execute within the context
 * @returns The result of fn (preserves sync/async behavior)
 */
export function runWithActionContext<T>(ctx: TraceActionContext, fn: () => T): T;
export function runWithActionContext<T>(ctx: TraceActionContext, fn: () => Promise<T>): Promise<T>;
export function runWithActionContext<T>(ctx: TraceActionContext, fn: () => T | Promise<T>): T | Promise<T> {
  // Save the previous context (for restoring on sync error or cleanup)
  const previousContext = currentActionContext;
  
  // Set the new context as active
  currentActionContext = ctx;

  try {
    const result = fn();
    // For async functions, the caller is responsible for cleanup via exitCurrentActionContext
    return result;
  } catch (error) {
    // Restore previous context on sync error
    currentActionContext = previousContext;
    throw error;
  }
}

/**
 * Create a context-preserving wrapper for any callback.
 * The callback will execute with the context that was active when this wrapper was created.
 */
const wrapCallback = <T extends (...args: any[]) => any>(callback: T, capturedCtx: TraceActionContext | null): T => {
  if (capturedCtx === null) {
    return callback;
  }

  return ((...args: Parameters<T>) => {
    // Save current context
    const previousCtx = currentActionContext;
    // Restore the captured context for this callback execution
    currentActionContext = capturedCtx;
    try {
      return callback(...args);
    } finally {
      // Restore the context that was active before this callback
      currentActionContext = previousCtx;
    }
  }) as T;
};

/**
 * Install async context propagation by patching Promise and timer APIs.
 * This should be called once at application startup.
 */
export const installAsyncContextPropagation = (): void => {
  if (isInstalled) return;
  if (typeof Promise === 'undefined') return;

  isInstalled = true;

  // Save original methods
  originalPromiseThen = Promise.prototype.then;
  originalPromiseCatch = Promise.prototype.catch;
  originalPromiseFinally = Promise.prototype.finally;

  const promiseThen = originalPromiseThen;
  const promiseCatch = originalPromiseCatch;
  const promiseFinally = originalPromiseFinally;

  // Patch Promise.prototype.then
  Promise.prototype.then = function <TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null | undefined,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined
  ): Promise<TResult1 | TResult2> {
    const capturedCtx = getCurrentActionContext();
    return promiseThen.call(
      this,
      onfulfilled ? wrapCallback(onfulfilled, capturedCtx) : undefined,
      onrejected ? wrapCallback(onrejected, capturedCtx) : undefined
    );
  };

  // Patch Promise.prototype.catch
  Promise.prototype.catch = function <TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null | undefined
  ): Promise<unknown | TResult> {
    const capturedCtx = getCurrentActionContext();
    return promiseCatch.call(
      this,
      onrejected ? wrapCallback(onrejected, capturedCtx) : undefined
    );
  };

  // Patch Promise.prototype.finally
  if (promiseFinally) {
    Promise.prototype.finally = function (onfinally?: (() => void) | null | undefined): Promise<unknown> {
      const capturedCtx = getCurrentActionContext();
      return promiseFinally.call(
        this,
        onfinally ? wrapCallback(onfinally, capturedCtx) : undefined
      );
    };
  }

  // Patch setTimeout
  if (typeof globalThis !== 'undefined' && typeof globalThis.setTimeout === 'function') {
    originalSetTimeout = globalThis.setTimeout;
    (globalThis as any).setTimeout = ((
      callback: (...args: any[]) => void,
      ms?: number,
      ...args: any[]
    ): ReturnType<typeof setTimeout> => {
      const capturedCtx = getCurrentActionContext();
      return originalSetTimeout!(
        wrapCallback(callback, capturedCtx),
        ms,
        ...args
      );
    }) as typeof setTimeout;
  }

  // Patch setInterval
  if (typeof globalThis !== 'undefined' && typeof globalThis.setInterval === 'function') {
    originalSetInterval = globalThis.setInterval;
    (globalThis as any).setInterval = ((
      callback: (...args: any[]) => void,
      ms?: number,
      ...args: any[]
    ): ReturnType<typeof setInterval> => {
      const capturedCtx = getCurrentActionContext();
      return originalSetInterval!(
        wrapCallback(callback, capturedCtx),
        ms,
        ...args
      );
    }) as typeof setInterval;
  }

  // Patch queueMicrotask
  if (typeof globalThis !== 'undefined' && typeof globalThis.queueMicrotask === 'function') {
    originalQueueMicrotask = globalThis.queueMicrotask;
    globalThis.queueMicrotask = (callback: VoidFunction): void => {
      const capturedCtx = getCurrentActionContext();
      originalQueueMicrotask!(wrapCallback(callback, capturedCtx));
    };
  }
};

/**
 * Uninstall async context propagation (for testing).
 */
export const uninstallAsyncContextPropagation = (): void => {
  if (!isInstalled) return;

  if (originalPromiseThen) {
    Promise.prototype.then = originalPromiseThen;
    originalPromiseThen = null;
  }
  if (originalPromiseCatch) {
    Promise.prototype.catch = originalPromiseCatch;
    originalPromiseCatch = null;
  }
  if (originalPromiseFinally) {
    Promise.prototype.finally = originalPromiseFinally;
    originalPromiseFinally = null;
  }
  if (originalSetTimeout && typeof globalThis !== 'undefined') {
    globalThis.setTimeout = originalSetTimeout;
    originalSetTimeout = null;
  }
  if (originalSetInterval && typeof globalThis !== 'undefined') {
    globalThis.setInterval = originalSetInterval;
    originalSetInterval = null;
  }
  if (originalQueueMicrotask && typeof globalThis !== 'undefined') {
    globalThis.queueMicrotask = originalQueueMicrotask;
    originalQueueMicrotask = null;
  }

  isInstalled = false;
};

/**
 * Reset the context store (for testing).
 */
export const resetActionContextStore = (): void => {
  currentActionContext = null;
};

/**
 * Check if async context propagation is installed.
 */
export const isAsyncContextInstalled = (): boolean => isInstalled;

/**
 * Exit the current action context.
 * This should be called when an action completes to properly clean up the context.
 * 
 * IMPORTANT: This clears the current context, but any already-scheduled
 * async continuations will still have access to the captured context through
 * the Promise wrapper.
 */
export const exitCurrentActionContext = (): void => {
  currentActionContext = null;
};

/**
 * Get the current context stack depth (for debugging/testing).
 * Note: With the new implementation, this returns 1 if there's a context, 0 otherwise.
 */
export const getContextStackDepth = (): number => currentActionContext !== null ? 1 : 0;
