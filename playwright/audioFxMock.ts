/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { Page } from "@playwright/test";

export type AudioFxCall =
  | { method: "setAudioProcessing"; params: Record<string, unknown> }
  | { method: "setSpectrumEnabled"; enabled: boolean };

type AudioFxWindow = Window & {
  __c64uAudioFxOverride?: unknown;
  __c64uAudioFxCalls?: AudioFxCall[];
  __c64uAudioFxActive?: boolean;
  __c64uAudioFxClipped?: boolean;
};

/**
 * Stands in for the native analyser: a music-like spectrum that moves, with a falling tilt, three
 * drifting formants, a kick on the lowest bands and a little noise, delivered as the plugin would.
 */
export const installAudioFxMock = async (page: Page, options: { active?: boolean } = {}) => {
  await page.addInitScript((active) => {
    const w = window as AudioFxWindow;
    w.__c64uAudioFxCalls = [];
    w.__c64uAudioFxActive = active;
    w.__c64uAudioFxClipped = false;
    let enabled = false;
    w.__c64uAudioFxOverride = {
      async setAudioProcessing(params: Record<string, unknown>) {
        w.__c64uAudioFxCalls!.push({ method: "setAudioProcessing", params });
        return {};
      },
      async setSpectrumEnabled({ enabled: next }: { enabled: boolean }) {
        enabled = next;
        w.__c64uAudioFxCalls!.push({ method: "setSpectrumEnabled", enabled: next });
        return {};
      },
      async readSpectrum() {
        const t = performance.now() / 1000;
        const bands: number[] = [];
        const kick = Math.max(0, Math.sin(t * Math.PI * 4)) ** 4;
        for (let i = 0; i < 48; i += 1) {
          let level = -22 - i * 0.7;
          for (let f = 0; f < 3; f += 1) {
            const centre = 10 + f * 14 + 8 * Math.sin(t * (0.7 + f * 0.43));
            level += 18 * Math.exp(-(((i - centre) / 3.2) ** 2));
          }
          if (i < 8) level += 12 * kick;
          level -= 6 * Math.abs(Math.sin(i * 12.9898 + Math.floor(t * 30) * 78.233));
          bands.push(Math.max(-100, Math.min(0, Math.round(level))));
        }
        return {
          enabled,
          active: w.__c64uAudioFxActive === true,
          sequence: Math.floor(t * 30),
          sampleRate: 48000,
          bands,
          peakDb: -7 - Math.round(kick * 2),
          rmsDb: -21 + Math.round(kick * 3),
          clipped: w.__c64uAudioFxClipped === true,
        };
      },
    };
  }, options.active ?? true);
};

export const audioFxCalls = (page: Page): Promise<AudioFxCall[]> =>
  page.evaluate(() => (window as AudioFxWindow).__c64uAudioFxCalls ?? []);

export const setAudioFxActive = (page: Page, active: boolean) =>
  page.evaluate((value) => {
    (window as AudioFxWindow).__c64uAudioFxActive = value;
  }, active);

export const setAudioFxClipped = (page: Page, clipped: boolean) =>
  page.evaluate((value) => {
    (window as AudioFxWindow).__c64uAudioFxClipped = value;
  }, clipped);
