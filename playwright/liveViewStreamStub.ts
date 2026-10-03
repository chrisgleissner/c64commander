/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { Page } from "@playwright/test";

/**
 * Turns on the A/V mirror flags and feeds the app a live video stream.
 *
 * Colour-bar frames in the app's own packet format go through the real receiver, controller and
 * decoder, so the Live View stats panel renders with genuine values. The stream start/stop REST
 * calls are answered with success.
 */
export const installLiveViewStreamStub = async (page: Page) => {
  await page.addInitScript(() => {
    for (const flag of ["audio_mirror_enabled", "video_mirror_enabled"]) {
      localStorage.setItem(`c64u_feature_flag:${flag}`, "1");
      sessionStorage.setItem(`c64u_feature_flag:${flag}`, "1");
    }
    const RealWebSocket = window.WebSocket;
    const HDR = 12;
    const BYTES_PER_LINE = 192;
    const LINES_PER_PKT = 4;
    const WIDTH = 384;
    const HEIGHT = 272;
    const packets: ArrayBuffer[] = [];
    const total = HEIGHT / LINES_PER_PKT;
    for (let i = 0; i < total; i++) {
      const line = i * LINES_PER_PKT;
      const buf = new ArrayBuffer(HDR + LINES_PER_PKT * BYTES_PER_LINE);
      const dv = new DataView(buf);
      const u8 = new Uint8Array(buf);
      dv.setUint16(0, i, true);
      dv.setUint16(4, (line & 0x7fff) | (i === total - 1 ? 0x8000 : 0), true);
      dv.setUint16(6, WIDTH, true);
      u8[8] = LINES_PER_PKT;
      u8[9] = 4;
      for (let k = 0; k < LINES_PER_PKT; k++) {
        const color = Math.floor((line + k) / (HEIGHT / 16)) & 0x0f;
        u8.fill(color | (color << 4), HDR + k * BYTES_PER_LINE, HDR + (k + 1) * BYTES_PER_LINE);
      }
      packets.push(buf);
    }
    class StubStreamWebSocket {
      url: string;
      binaryType = "blob";
      readyState = 0;
      onopen: ((e?: unknown) => void) | null = null;
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onclose: ((e?: unknown) => void) | null = null;
      onerror: ((e?: unknown) => void) | null = null;
      private closed = false;
      constructor(url: string) {
        this.url = String(url);
        if (!this.url.includes("/streams/")) return new RealWebSocket(url) as unknown as StubStreamWebSocket;
        const isVideo = this.url.endsWith("/streams/video");
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.({});
          if (!isVideo) return;
          let n = 0;
          const tick = () => {
            if (this.closed || n > 900) return;
            for (const p of packets) this.onmessage?.({ data: p.slice(0) });
            n += 1;
            setTimeout(tick, 33);
          };
          tick();
        }, 15);
      }
      send() {}
      close() {
        this.closed = true;
        this.readyState = 3;
        this.onclose?.({});
      }
    }
    window.WebSocket = StubStreamWebSocket as unknown as typeof WebSocket;
  });
  await page.route("**/v1/streams/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ errors: [] }) }),
  );
};
