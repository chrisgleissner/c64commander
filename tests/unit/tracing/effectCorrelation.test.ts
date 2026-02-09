/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock the tracing modules
const recordActionStart = vi.fn();
const recordActionEnd = vi.fn();
const recordRestRequest = vi.fn();
const recordRestResponse = vi.fn();
const recordFtpOperation = vi.fn();
const recordTraceError = vi.fn();

let correlationCounter = 0;

vi.mock('@/lib/tracing/traceSession', () => ({
  recordActionStart: (...args: unknown[]) => recordActionStart(...args),
  recordActionEnd: (...args: unknown[]) => recordActionEnd(...args),
  recordRestRequest: (...args: unknown[]) => recordRestRequest(...args),
  recordRestResponse: (...args: unknown[]) => recordRestResponse(...args),
  recordFtpOperation: (...args: unknown[]) => recordFtpOperation(...args),
  recordTraceError: (...args: unknown[]) => recordTraceError(...args),
}));

vi.mock('@/lib/tracing/traceIds', () => ({
  nextCorrelationId: () => `COR-${String(correlationCounter++).padStart(4, '0')}`,
}));

vi.mock('@/lib/tracing/traceContext', () => ({
  getTraceContextSnapshot: () => ({ ui: { route: '/test' } }),
}));

vi.mock('@/lib/tracing/traceTargets', () => ({
  resolveBackendTarget: () => ({ target: 'real-device', reason: 'reachable' }),
}));

import {
  createActionContext,
  getActiveAction,
  resetActionTrace,
  runWithActionTrace,
} from '@/lib/tracing/actionTrace';
import {
  installAsyncContextPropagation,
  uninstallAsyncContextPropagation,
  resetActionContextStore,
} from '@/lib/tracing/traceActionContextStore';

describe('Effect Correlation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    correlationCounter = 0;
    resetActionTrace();
    resetActionContextStore();
    installAsyncContextPropagation();
  });

  afterEach(() => {
    resetActionTrace();
    resetActionContextStore();
    uninstallAsyncContextPropagation();
  });

  describe('REST effects', () => {
    it('inherits correlation from active user action', async () => {
      const userContext = createActionContext('click Open Folder', 'user', 'GlobalInteraction');
      
      await runWithActionTrace(userContext, async () => {
        // Verify the active action is set
        const activeAction = getActiveAction();
        expect(activeAction).toBe(userContext);
        expect(activeAction?.correlationId).toBe('COR-0000');
        expect(activeAction?.origin).toBe('user');
      });
      
      expect(recordActionStart).toHaveBeenCalledWith(userContext);
      expect(recordActionEnd).toHaveBeenCalledWith(userContext, null);
    });

    it('creates implicit system action when no active action', async () => {
      // Verify no active action
      expect(getActiveAction()).toBeNull();
      
      // This simulates what happens when a REST call is made outside any action context
      const implicitContext = createActionContext('rest.get', 'system', null);
      await runWithActionTrace(implicitContext, async () => {
        expect(getActiveAction()).toBe(implicitContext);
        expect(implicitContext.origin).toBe('system');
      });
    });
  });

  describe('Action uniqueness', () => {
    it('single user interaction produces one action trace', async () => {
      // Simulate a single click that would previously create duplicates
      const globalContext = createActionContext('click Open Folder', 'user', 'GlobalInteraction');
      
      await runWithActionTrace(globalContext, async () => {
        // No second trace should be created for the same click
      });
      
      expect(recordActionStart).toHaveBeenCalledTimes(1);
      expect(recordActionEnd).toHaveBeenCalledTimes(1);
    });

    it('sequential user interactions produce sequential correlations', async () => {
      const firstClick = createActionContext('click Button A', 'user', 'GlobalInteraction');
      const secondClick = createActionContext('click Button B', 'user', 'GlobalInteraction');
      
      await runWithActionTrace(firstClick, async () => {});
      await runWithActionTrace(secondClick, async () => {});
      
      expect(firstClick.correlationId).toBe('COR-0000');
      expect(secondClick.correlationId).toBe('COR-0001');
      expect(recordActionStart).toHaveBeenCalledTimes(2);
    });
  });

  describe('Nested action prevention', () => {
    it('restores previous active action after nested trace', async () => {
      const outerContext = createActionContext('outer', 'user', 'Component');
      
      await runWithActionTrace(outerContext, async () => {
        expect(getActiveAction()).toBe(outerContext);
        
        // Nested action should not create a new trace if we're checking getActiveAction
        // This tests that the mechanism for checking active actions works
        const inner = getActiveAction();
        expect(inner?.correlationId).toBe(outerContext.correlationId);
      });
      
      expect(getActiveAction()).toBeNull();
    });
  });

  describe('Origin inheritance', () => {
    it('user actions retain user origin', async () => {
      const userContext = createActionContext('click Item', 'user', 'GlobalInteraction');
      
      await runWithActionTrace(userContext, async () => {
        const active = getActiveAction();
        expect(active?.origin).toBe('user');
      });
    });

    it('system actions have system origin', async () => {
      const systemContext = createActionContext('rest.get', 'system', null);
      
      await runWithActionTrace(systemContext, async () => {
        const active = getActiveAction();
        expect(active?.origin).toBe('system');
      });
    });
  });

  describe('Fire-and-forget async correlation (critical)', () => {
    it('maintains correlation through fire-and-forget REST calls', async () => {
      const userContext = createActionContext('click Submit', 'user', 'GlobalInteraction');
      let capturedCorrelation: string | null = null;
      let fireAndForgetResolved = false;

      await runWithActionTrace(userContext, async () => {
        // Fire-and-forget: schedule async work but don't await it
        void Promise.resolve().then(() => {
          // Simulate what happens when REST fetch executes
          const activeAction = getActiveAction();
          capturedCorrelation = activeAction?.correlationId ?? null;
          fireAndForgetResolved = true;
        });
        // Action completes without awaiting the above
      });

      // Wait for fire-and-forget to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(fireAndForgetResolved).toBe(true);
      expect(capturedCorrelation).toBe('COR-0000');
    });

    it('maintains user origin through fire-and-forget', async () => {
      const userContext = createActionContext('click Load', 'user', 'GlobalInteraction');
      let capturedOrigin: string | null = null;

      await runWithActionTrace(userContext, async () => {
        void Promise.resolve().then(() => {
          const activeAction = getActiveAction();
          capturedOrigin = activeAction?.origin ?? null;
        });
      });

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(capturedOrigin).toBe('user');
    });

    it('maintains correlation through setTimeout', async () => {
      const userContext = createActionContext('click Delayed', 'user', 'GlobalInteraction');
      let capturedCorrelation: string | null = null;

      await new Promise<void>((resolve) => {
        void runWithActionTrace(userContext, async () => {
          setTimeout(() => {
            const activeAction = getActiveAction();
            capturedCorrelation = activeAction?.correlationId ?? null;
            resolve();
          }, 5);
        });
      });

      expect(capturedCorrelation).toBe('COR-0000');
    });

    it('does NOT bleed correlation between overlapping actions', async () => {
      const action1 = createActionContext('click Action1', 'user', 'GlobalInteraction');
      const action2 = createActionContext('click Action2', 'user', 'GlobalInteraction');
      
      const correlations: { action: string; correlationId: string | null }[] = [];

      // Start action 1 with fire-and-forget effect (longer delay)
      await runWithActionTrace(action1, async () => {
        void Promise.resolve()
          .then(() => new Promise(r => setTimeout(r, 20)))
          .then(() => {
            correlations.push({
              action: 'effect1',
              correlationId: getActiveAction()?.correlationId ?? null,
            });
          });
      });

      // Start action 2 with fire-and-forget effect (shorter delay)
      await runWithActionTrace(action2, async () => {
        void Promise.resolve()
          .then(() => new Promise(r => setTimeout(r, 10)))
          .then(() => {
            correlations.push({
              action: 'effect2',
              correlationId: getActiveAction()?.correlationId ?? null,
            });
          });
      });

      // Wait for all effects
      await new Promise(resolve => setTimeout(resolve, 50));

      const effect1 = correlations.find(c => c.action === 'effect1');
      const effect2 = correlations.find(c => c.action === 'effect2');

      // Effect 1 should correlate to action 1 (COR-0000)
      expect(effect1?.correlationId).toBe('COR-0000');
      // Effect 2 should correlate to action 2 (COR-0001)
      expect(effect2?.correlationId).toBe('COR-0001');
    });

    it('maintains correlation through deeply nested async chains', async () => {
      const userContext = createActionContext('click Deep', 'user', 'GlobalInteraction');
      let finalCorrelation: string | null = null;

      await runWithActionTrace(userContext, async () => {
        void Promise.resolve()
          .then(() => Promise.resolve())
          .then(() => new Promise(r => setTimeout(r, 5)))
          .then(() => Promise.resolve())
          .then(() => {
            finalCorrelation = getActiveAction()?.correlationId ?? null;
          });
      });

      await new Promise(resolve => setTimeout(resolve, 20));
      expect(finalCorrelation).toBe('COR-0000');
    });
  });
});
