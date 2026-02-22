import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addLog } from '@/lib/logging';
import { runWithImplicitAction } from '@/lib/tracing/actionTrace';

vi.mock('@/lib/logging', () => ({
  addLog: vi.fn(),
}));

vi.mock('@/lib/tracing/actionTrace', () => ({
  runWithImplicitAction: vi.fn(async (_name: string, fn: () => Promise<void>) => fn()),
}));

describe('startupMilestones', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(addLog).mockReset();
    vi.mocked(runWithImplicitAction).mockReset();
    vi.mocked(runWithImplicitAction).mockImplementation(async (_name: string, fn: () => Promise<void>) => fn());
  });

  it('marks startup bootstrap once', async () => {
    const { markStartupBootstrapComplete } = await import('@/lib/startup/startupMilestones');
    markStartupBootstrapComplete();
    markStartupBootstrapComplete();

    expect(addLog).toHaveBeenCalledTimes(1);
    expect(addLog).toHaveBeenCalledWith(
      'info',
      'Startup bootstrap complete',
      expect.objectContaining({ elapsedMs: expect.any(Number) }),
    );
    expect(runWithImplicitAction).toHaveBeenCalledTimes(1);
    expect(runWithImplicitAction).toHaveBeenCalledWith(
      'startup.bootstrap_complete',
      expect.any(Function),
    );
  });

  it('marks first meaningful interaction once and emits startup milestone event', async () => {
    const { markFirstMeaningfulInteraction } = await import('@/lib/startup/startupMilestones');
    const captured: CustomEvent[] = [];
    const listener = (event: Event) => {
      captured.push(event as CustomEvent);
    };
    window.addEventListener('c64u-startup-milestone', listener);

    markFirstMeaningfulInteraction('click', 'Play');
    markFirstMeaningfulInteraction('click', 'Play');

    window.removeEventListener('c64u-startup-milestone', listener);

    expect(addLog).toHaveBeenCalledTimes(1);
    expect(addLog).toHaveBeenCalledWith(
      'info',
      'First meaningful interaction',
      expect.objectContaining({
        action: 'click',
        label: 'Play',
        elapsedMs: expect.any(Number),
      }),
    );
    expect(runWithImplicitAction).toHaveBeenCalledTimes(1);
    expect(runWithImplicitAction).toHaveBeenCalledWith(
      'startup.first_meaningful_interaction',
      expect.any(Function),
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].detail).toEqual(expect.objectContaining({
      name: 'first-meaningful-interaction',
      action: 'click',
      label: 'Play',
      elapsedMs: expect.any(Number),
    }));
  });

  it('ignores diagnostics open actions as first meaningful interaction', async () => {
    const { markFirstMeaningfulInteraction } = await import('@/lib/startup/startupMilestones');

    markFirstMeaningfulInteraction('click', 'Diagnostics');

    expect(addLog).not.toHaveBeenCalledWith(
      'info',
      'First meaningful interaction',
      expect.anything(),
    );
    expect(runWithImplicitAction).not.toHaveBeenCalledWith(
      'startup.first_meaningful_interaction',
      expect.any(Function),
    );

    markFirstMeaningfulInteraction('click', 'Play');
    expect(addLog).toHaveBeenCalledWith(
      'info',
      'First meaningful interaction',
      expect.objectContaining({ action: 'click', label: 'Play' }),
    );
  });
});
