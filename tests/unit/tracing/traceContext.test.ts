import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/native/platform', () => ({
  getPlatform: () => 'web',
}));

import {
  getTraceContextSnapshot,
  setTraceDeviceContext,
  setTraceFeatureFlags,
  setTracePlatformContext,
  setTracePlaybackContext,
  setTraceUiContext,
  subscribeTraceContext,
} from '@/lib/tracing/traceContext';

describe('traceContext', () => {
  it('updates snapshot fields and notifies subscribers', () => {
    const updates: Array<ReturnType<typeof getTraceContextSnapshot>> = [];
    const unsubscribe = subscribeTraceContext((next) => updates.push(next));

    setTraceUiContext('/settings', '?mode=demo');
    setTracePlatformContext('android');
    setTraceFeatureFlags({ hvsc_enabled: true });
    setTracePlaybackContext({
      queueLength: 1,
      currentIndex: 0,
      currentItemId: '1',
      isPlaying: true,
      elapsedMs: 1000,
    });
    setTraceDeviceContext({ deviceId: 'dev-1', connectionState: 'connected' });

    const snapshot = getTraceContextSnapshot();
    expect(snapshot.ui.route).toBe('/settings');
    expect(snapshot.platform).toBe('android');
    expect(snapshot.featureFlags.hvsc_enabled).toBe(true);
    expect(snapshot.playback?.currentItemId).toBe('1');
    expect(snapshot.device?.deviceId).toBe('dev-1');
    expect(updates.length).toBeGreaterThan(1);

    unsubscribe();
  });
});
