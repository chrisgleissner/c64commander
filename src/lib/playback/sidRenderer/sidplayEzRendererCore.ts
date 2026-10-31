/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { SidAudio, type SidAudioPlugin, type SidAudioPrerenderEvent } from "@/lib/native/sidAudio";
import { bytesToBase64 } from "@/lib/encoding/base64";
import type { NativePcmRef } from "./pcmPayload";
import type {
  SidRendererChunk,
  SidRendererCore,
  SidRendererOpenRequest,
  SidRendererOpened,
  SidRendererPrerendered,
  SidRendererPrerenderSlice,
} from "./sidRendererContract";

const CHANNELS = 2;

const base64Of = (buffer: ArrayBuffer): string => bytesToBase64(new Uint8Array(buffer));

/**
 * libSidplayEZ, through the `SidAudio` plugin.
 *
 * Runs on the main thread, but only as a sequence of calls: every render, seek and pre-render
 * happens on the native renderer's own thread, and the rendered PCM stays in native buffers. What
 * comes back is a reference ({@link NativePcmRef}) that the engine schedules like any other chunk
 * and the native audio feed reads in place. The tune bytes and ROM images do cross the bridge, as
 * base64, once per open: they are a few kilobytes, not audio.
 */
export class SidplayEzRendererCore implements SidRendererCore {
  private renderer: number | null = null;
  private creating: Promise<number> | null = null;
  private nextPrerenderId = 1;
  private disposed = false;

  constructor(
    private readonly options: { background: boolean; beforeCreate?: () => Promise<void> },
    private readonly plugin: SidAudioPlugin = SidAudio,
  ) {}

  private ensureRenderer(): Promise<number> {
    if (this.disposed) return Promise.reject(new Error("The libSidplayEZ renderer has been disposed"));
    if (this.renderer !== null) return Promise.resolve(this.renderer);
    this.creating ??= (this.options.beforeCreate?.() ?? Promise.resolve())
      .then(() => this.plugin.createRenderer({ background: this.options.background }))
      .then(({ renderer }) => {
        if (this.disposed) {
          void this.plugin.disposeRenderer({ renderer }).catch((error: unknown) => this.logFailure("dispose", error));
          throw new Error("The libSidplayEZ renderer was disposed while it was being created");
        }
        this.renderer = renderer;
        return renderer;
      });
    return this.creating.catch((error: unknown) => {
      this.creating = null;
      throw error;
    });
  }

  private logFailure(operation: string, error: unknown): void {
    addLog("warn", `libSidplayEZ ${operation} failed`, {
      service: "local-sid",
      error: (error as Error)?.message ?? String(error),
    });
  }

  private tuneRequest(renderer: number, request: SidRendererOpenRequest) {
    return {
      renderer,
      sid: base64Of(request.sidBytes),
      songIndex: request.songIndex,
      sampleRate: request.sampleRate,
      kernal: request.roms ? base64Of(request.roms.kernal) : undefined,
      basic: request.roms ? base64Of(request.roms.basic) : undefined,
      chargen: request.roms?.chargen ? base64Of(request.roms.chargen) : undefined,
      sidModel: request.sidModel,
    };
  }

  async load(): Promise<void> {
    await this.ensureRenderer();
  }

  async open(request: SidRendererOpenRequest): Promise<SidRendererOpened> {
    const startedAt = performance.now();
    const renderer = await this.ensureRenderer();
    const readyAt = performance.now();
    const opened = await this.plugin.openTune(this.tuneRequest(renderer, request));
    return {
      sampleRate: opened.sampleRate,
      channels: opened.channels,
      tuneInfo: opened.tuneInfo,
      openTiming: {
        moduleMs: readyAt - startedAt,
        constructMs: opened.constructMs,
        romsMs: 0,
        loadMs: opened.loadMs,
      },
    };
  }

  async render(seconds: number): Promise<SidRendererChunk | null> {
    const renderer = await this.ensureRenderer();
    const rendered = await this.plugin.render({ renderer, seconds });
    if (rendered.frames <= 0) return null;
    const pcm: NativePcmRef = {
      kind: "native-pcm",
      bufferId: rendered.bufferId,
      startFrame: 0,
      frames: rendered.frames,
    };
    return { pcm, samples: rendered.frames * CHANNELS, renderMs: rendered.renderMs };
  }

  async seek(positionSeconds: number): Promise<number> {
    const renderer = await this.ensureRenderer();
    return (await this.plugin.seek({ renderer, seconds: positionSeconds })).positionSeconds;
  }

  /**
   * One retained native buffer grows as the native renderer works through the tune; each event is
   * passed on as the frame range it added. Superseding is checked on every slice and cancels the
   * native work, so a newer pre-render queued behind this one is not kept waiting for a whole tune.
   */
  async prerender(
    request: SidRendererOpenRequest & { seconds: number },
    onSlice: (slice: SidRendererPrerenderSlice) => void,
    isSuperseded: () => boolean,
  ): Promise<SidRendererPrerendered> {
    const renderer = await this.ensureRenderer();
    const id = this.nextPrerenderId++;
    let delivered = 0;
    const sampleRate = request.sampleRate;
    return new Promise<SidRendererPrerendered>((resolve, reject) => {
      let settled = false;
      const finish = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        void handle.then((h) => h.remove()).catch((error: unknown) => this.logFailure("listener removal", error));
        outcome();
      };
      const handle = this.plugin.addListener("prerender", (event: SidAudioPrerenderEvent) => {
        if (event.renderer !== renderer || event.id !== id) return;
        if (event.kind === "error") {
          finish(() => reject(new Error(event.error ?? "libSidplayEZ pre-render failed")));
          return;
        }
        if (event.frames > delivered) {
          const pcm: NativePcmRef = {
            kind: "native-pcm",
            bufferId: event.bufferId,
            startFrame: delivered,
            frames: event.frames - delivered,
          };
          delivered = event.frames;
          onSlice({ pcm, sampleRate, channels: CHANNELS, seconds: event.seconds });
        }
        if (event.kind === "done" || event.kind === "cancelled") {
          finish(() => resolve({ sampleRate, channels: CHANNELS, seconds: event.seconds }));
          return;
        }
        if (isSuperseded()) {
          void this.plugin.cancelPrerender({ renderer }).catch((error: unknown) => this.logFailure("cancel", error));
        }
      });
      handle
        .then(() => this.plugin.prerender({ ...this.tuneRequest(renderer, request), id, seconds: request.seconds }))
        .catch((error: unknown) => finish(() => reject(error)));
    });
  }

  async close(): Promise<void> {
    if (this.renderer === null) return;
    await this.plugin.closeTune({ renderer: this.renderer });
  }

  dispose(): void {
    this.disposed = true;
    const renderer = this.renderer;
    this.renderer = null;
    if (renderer !== null) {
      void this.plugin.disposeRenderer({ renderer }).catch((error: unknown) => this.logFailure("dispose", error));
    }
  }
}
