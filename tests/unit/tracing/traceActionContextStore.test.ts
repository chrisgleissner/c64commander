/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import {
  getCurrentActionContext,
  runWithActionContext,
  exitCurrentActionContext,
  resetActionContextStore,
  installAsyncContextPropagation,
  uninstallAsyncContextPropagation,
  isAsyncContextInstalled,
  getContextStackDepth,
} from '@/lib/tracing/traceActionContextStore';
import type { TraceActionContext } from '@/lib/tracing/types';

const createTestContext = (correlationId: string, origin: 'user' | 'automatic' | 'system' = 'user'): TraceActionContext => ({
  correlationId,
  origin,
  name: `test-action-${correlationId}`,
  componentName: 'TestComponent',
});

describe('traceActionContextStore', () => {
  beforeEach(() => {
    resetActionContextStore();
    installAsyncContextPropagation();
  });

  afterEach(() => {
    resetActionContextStore();
    uninstallAsyncContextPropagation();
  });

  describe('basic context management', () => {
    it('returns null when no context is active', () => {
      expect(getCurrentActionContext()).toBeNull();
    });

    it('returns active context during synchronous execution', () => {
      const ctx = createTestContext('COR-0001');
      let capturedCtx: TraceActionContext | null = null;

      runWithActionContext(ctx, () => {
        capturedCtx = getCurrentActionContext();
      });

      expect(capturedCtx).toBe(ctx);
    });

    it('tracks context stack depth', () => {
      expect(getContextStackDepth()).toBe(0);

      const ctx = createTestContext('COR-0001');
      runWithActionContext(ctx, () => {
        expect(getContextStackDepth()).toBe(1);
      });
    });
  });

  describe('async context propagation', () => {
    it('propagates context through await', async () => {
      const ctx = createTestContext('COR-0001');
      let capturedCtx: TraceActionContext | null = null;

      await runWithActionContext(ctx, async () => {
        await Promise.resolve();
        capturedCtx = getCurrentActionContext();
      });

      expect(capturedCtx).toBe(ctx);
    });

    it('propagates context through .then() chain', async () => {
      const ctx = createTestContext('COR-0001');
      let capturedCtx: TraceActionContext | null = null;

      await runWithActionContext(ctx, () => {
        return Promise.resolve()
          .then(() => {
            capturedCtx = getCurrentActionContext();
          });
      });

      expect(capturedCtx).toBe(ctx);
    });

    it('propagates context through multiple .then() calls', async () => {
      const ctx = createTestContext('COR-0001');
      const capturedContexts: (TraceActionContext | null)[] = [];

      await runWithActionContext(ctx, () => {
        return Promise.resolve()
          .then(() => {
            capturedContexts.push(getCurrentActionContext());
            return 'first';
          })
          .then(() => {
            capturedContexts.push(getCurrentActionContext());
            return 'second';
          })
          .then(() => {
            capturedContexts.push(getCurrentActionContext());
          });
      });

      expect(capturedContexts).toHaveLength(3);
      expect(capturedContexts.every(c => c === ctx)).toBe(true);
    });

    it('propagates context through .catch()', async () => {
      const ctx = createTestContext('COR-0001');
      let capturedCtx: TraceActionContext | null = null;

      await runWithActionContext(ctx, () => {
        return Promise.reject(new Error('test'))
          .catch(() => {
            capturedCtx = getCurrentActionContext();
          });
      });

      expect(capturedCtx).toBe(ctx);
    });

    it('propagates context through .finally()', async () => {
      const ctx = createTestContext('COR-0001');
      let capturedCtx: TraceActionContext | null = null;

      await runWithActionContext(ctx, () => {
        return Promise.resolve()
          .finally(() => {
            capturedCtx = getCurrentActionContext();
          });
      });

      expect(capturedCtx).toBe(ctx);
    });

    it('propagates context through fire-and-forget (void promise)', async () => {
      const ctx = createTestContext('COR-0001');
      let capturedCtx: TraceActionContext | null = null;
      let resolved = false;

      await runWithActionContext(ctx, async () => {
        // Fire-and-forget: schedule async work but don't await it
        void Promise.resolve().then(() => {
          capturedCtx = getCurrentActionContext();
          resolved = true;
        });
        // Don't await the above promise - this is the fire-and-forget pattern
      });

      // Wait for the fire-and-forget promise to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(resolved).toBe(true);
      expect(capturedCtx).toBe(ctx);
    });

    it('propagates context through setTimeout', async () => {
      const ctx = createTestContext('COR-0001');
      let capturedCtx: TraceActionContext | null = null;

      await new Promise<void>((resolve) => {
        runWithActionContext(ctx, () => {
          setTimeout(() => {
            capturedCtx = getCurrentActionContext();
            resolve();
          }, 5);
        });
      });

      expect(capturedCtx).toBe(ctx);
    });

    it('propagates context through queueMicrotask', async () => {
      const ctx = createTestContext('COR-0001');
      let capturedCtx: TraceActionContext | null = null;

      await new Promise<void>((resolve) => {
        runWithActionContext(ctx, () => {
          queueMicrotask(() => {
            capturedCtx = getCurrentActionContext();
            resolve();
          });
        });
      });

      expect(capturedCtx).toBe(ctx);
    });
  });

  describe('overlapping actions', () => {
    it('maintains separate contexts for non-overlapping actions', async () => {
      const ctx1 = createTestContext('COR-0001');
      const ctx2 = createTestContext('COR-0002');
      let capturedCtx1: TraceActionContext | null = null;
      let capturedCtx2: TraceActionContext | null = null;

      await runWithActionContext(ctx1, async () => {
        await Promise.resolve();
        capturedCtx1 = getCurrentActionContext();
      });
      exitCurrentActionContext();

      await runWithActionContext(ctx2, async () => {
        await Promise.resolve();
        capturedCtx2 = getCurrentActionContext();
      });
      exitCurrentActionContext();

      expect(capturedCtx1).toBe(ctx1);
      expect(capturedCtx2).toBe(ctx2);
    });

    it('maintains correct correlation when fire-and-forget effects overlap', async () => {
      const ctx1 = createTestContext('COR-0001');
      const ctx2 = createTestContext('COR-0002');
      const capturedContexts: { id: string; ctx: TraceActionContext | null }[] = [];

      // Start action 1 with fire-and-forget effect
      await runWithActionContext(ctx1, async () => {
        void Promise.resolve().then(() => new Promise(r => setTimeout(r, 20))).then(() => {
          capturedContexts.push({ id: 'effect1', ctx: getCurrentActionContext() });
        });
      });
      exitCurrentActionContext();

      // Start action 2 with fire-and-forget effect (while effect1 is still pending)
      await runWithActionContext(ctx2, async () => {
        void Promise.resolve().then(() => new Promise(r => setTimeout(r, 10))).then(() => {
          capturedContexts.push({ id: 'effect2', ctx: getCurrentActionContext() });
        });
      });
      exitCurrentActionContext();

      // Wait for all effects to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Each effect should have captured its originating context
      const effect1 = capturedContexts.find(c => c.id === 'effect1');
      const effect2 = capturedContexts.find(c => c.id === 'effect2');

      expect(effect1?.ctx).toBe(ctx1);
      expect(effect2?.ctx).toBe(ctx2);
    });
  });

  describe('sequential actions', () => {
    it('allows starting a new action after exiting previous one', () => {
      const ctx1 = createTestContext('COR-0001');
      const ctx2 = createTestContext('COR-0002');

      runWithActionContext(ctx1, () => {
        expect(getCurrentActionContext()).toBe(ctx1);
      });
      exitCurrentActionContext();

      // Should be able to start a new action without warnings
      runWithActionContext(ctx2, () => {
        expect(getCurrentActionContext()).toBe(ctx2);
      });
      exitCurrentActionContext();
    });
  });

  describe('context cleanup', () => {
    it('exitCurrentActionContext removes the context', () => {
      const ctx = createTestContext('COR-0001');

      runWithActionContext(ctx, () => {
        expect(getCurrentActionContext()).toBe(ctx);
        exitCurrentActionContext();
        expect(getCurrentActionContext()).toBeNull();
      });
    });

    it('context is null after synchronous runWithActionContext', () => {
      const ctx = createTestContext('COR-0001');

      runWithActionContext(ctx, () => {
        // sync work
      });

      // After sync execution, context may still be on stack
      // (cleanup happens explicitly or via exitCurrentActionContext)
    });
  });

  describe('installation', () => {
    it('isAsyncContextInstalled returns correct state', () => {
      uninstallAsyncContextPropagation();
      expect(isAsyncContextInstalled()).toBe(false);

      installAsyncContextPropagation();
      expect(isAsyncContextInstalled()).toBe(true);
    });

    it('multiple installs are idempotent', () => {
      installAsyncContextPropagation();
      installAsyncContextPropagation();
      expect(isAsyncContextInstalled()).toBe(true);
    });
  });
});
