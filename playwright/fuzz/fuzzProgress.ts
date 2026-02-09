/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { Page } from '@playwright/test';

export type ProgressSnapshot = {
  screenKey: string;
  navKey: string;
  traceKey: string;
  stateKey: string;
};

export type ProgressDelta = {
  screenChanged: boolean;
  navigationChanged: boolean;
  traceChanged: boolean;
  stateChanged: boolean;
};

const traceProgressTypes = new Set([
  'rest-request',
  'rest-response',
  'ftp-operation',
  'device-guard',
  'backend-decision',
  'error',
]);

export const readProgressSnapshot = async (page: Page): Promise<ProgressSnapshot> => {
  const progressTypes = Array.from(traceProgressTypes);
  return page.evaluate((types) => {
    const traceProgressTypes = new Set(types);
    const route = location.pathname || '';
    const title = document.title || '';
    const heading = Array.from(document.querySelectorAll('h1,[data-testid="page-title"]'))
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 3)
      .join('|')
      .slice(0, 120);

    const historyState = window.history.state as { idx?: number; key?: string } | null;
    const navKey = `${window.history.length}:${historyState?.idx ?? ''}:${historyState?.key ?? ''}`;

    const traces = (window as Window & { __c64uTracing?: { getTraces?: () => any[] } }).__c64uTracing?.getTraces?.() ?? [];
    let traceKey = '';
    const start = Math.max(0, traces.length - 40);
    for (let i = traces.length - 1; i >= start; i -= 1) {
      const event = traces[i];
      if (!event || typeof event !== 'object') continue;
      if (!traceProgressTypes.has(event.type)) continue;
      traceKey = `${event.id}:${event.type}`;
      break;
    }

    let stateKey = '';
    for (let i = traces.length - 1; i >= start; i -= 1) {
      const event = traces[i];
      const context = event?.data?.context as {
        device?: { connectionState?: string | null };
        playback?: { isPlaying?: boolean; currentItemId?: string | null; queueLength?: number };
      } | undefined;
      if (!context) continue;
      const deviceState = context.device?.connectionState ?? '';
      const playing = context.playback?.isPlaying ? 'playing' : 'stopped';
      const currentItem = context.playback?.currentItemId ?? '';
      const queueLength = typeof context.playback?.queueLength === 'number' ? String(context.playback?.queueLength) : '';
      stateKey = `${deviceState}:${playing}:${currentItem}:${queueLength}`;
      break;
    }

    return {
      screenKey: `${route}|${title}|${heading}`,
      navKey,
      traceKey,
      stateKey,
    };
  }, progressTypes);
};

export const diffProgress = (prev: ProgressSnapshot, next: ProgressSnapshot): ProgressDelta => ({
  screenChanged: prev.screenKey !== next.screenKey,
  navigationChanged: prev.navKey !== next.navKey,
  traceChanged: prev.traceKey !== next.traceKey,
  stateChanged: prev.stateKey !== next.stateKey,
});

export const hasMeaningfulProgress = (delta: ProgressDelta) =>
  delta.screenChanged || delta.navigationChanged || delta.traceChanged || delta.stateChanged;
