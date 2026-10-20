/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { toLocalSidError } from "../localSidWorkerCore";
import type {
  EngineSidModel,
  LocalSidMainToWorker,
  LocalSidOpenedMessage,
  LocalSidWorkerToMain,
} from "../localSidWorkerProtocol";
import type { PcmPayload } from "./pcmPayload";
import type { SidRendererId } from "./sidRendererAvailability";

/**
 * The one interface every SID renderer implements.
 *
 * `LocalSidEngine` orchestrates playback — chunked rendering, seeking, the whole-tune pre-render,
 * lead-in warming, crossfades, stall recovery — and it talks to a renderer only through the
 * `LocalSidMainToWorker` / `LocalSidWorkerToMain` messages. {@link createRendererDispatcher} turns a
 * {@link SidRendererCore} into a handler for those messages, so the ordering, superseding and error
 * rules exist once for every renderer:
 *
 *  - `WasmSidRendererCore` (reSIDfp and SIDLite) runs inside the Web Worker.
 *  - `SidplayEzRendererCore` (libSidplayEZ) runs on the main thread but only issues calls to the
 *    native renderer, which does the work on its own thread; `NativeRendererChannel` presents it to
 *    the engine as if it were a worker.
 *
 * A core is a single stateful player: it is never re-entered. The dispatcher guarantees that.
 */
export interface SidRendererOpenRequest {
  sidBytes: ArrayBuffer;
  /** 0-based song index; the core clamps it to the tune's song count. */
  songIndex: number;
  sampleRate: number;
  roms?: { kernal: ArrayBuffer; basic: ArrayBuffer };
  /** The chip for a tune that does not name one. A fallback, never forced over a declared model. */
  sidModel?: EngineSidModel;
  engine: SidRendererId;
}

export type SidRendererOpened = Omit<LocalSidOpenedMessage, "type" | "id" | "romRequired"> & {
  romRequired?: boolean;
};

export interface SidRendererChunk {
  /** Interleaved stereo S16; a JS buffer or a native reference. */
  pcm: PcmPayload;
  /** Interleaved sample count (`frames × channels`). */
  samples: number;
  renderMs: number;
}

export interface SidRendererPrerenderSlice {
  pcm: PcmPayload;
  sampleRate: number;
  channels: number;
  /** Seconds rendered so far, this slice included. */
  seconds: number;
}

export interface SidRendererPrerendered {
  sampleRate: number;
  channels: number;
  seconds: number;
}

export interface SidRendererCore {
  /** Make the renderer ready to open tunes (instantiate WASM, create the native renderer). */
  load(options: { pcmHeadroomSamples?: number }): Promise<void>;
  /** Replace whatever tune is open with this one, positioned at its start. */
  open(request: SidRendererOpenRequest): Promise<SidRendererOpened>;
  /** The next `seconds` of the open tune, or null when it has ended or nothing is open. */
  render(seconds: number): Promise<SidRendererChunk | null>;
  /** Reposition the open tune to an absolute time; resolves with where it landed. */
  seek(positionSeconds: number): Promise<number>;
  /**
   * Render a whole tune ahead of time on a separate player, so the playing one is not disturbed,
   * handing over each slice as it is produced. Stops early, without error, when superseded.
   */
  prerender(
    request: SidRendererOpenRequest & { seconds: number },
    onSlice: (slice: SidRendererPrerenderSlice) => void,
    isSuperseded: () => boolean,
  ): Promise<SidRendererPrerendered>;
  /** Close the open tune, keeping the renderer ready for the next. */
  close(): Promise<void>;
  /** Release everything; the core is not used again. */
  dispose(): void;
}

export type RendererPost = (message: LocalSidWorkerToMain, transfer?: Transferable[]) => void;

const transferOf = (pcm: PcmPayload): Transferable[] | undefined =>
  pcm instanceof Int16Array ? [pcm.buffer as ArrayBuffer] : undefined;

/**
 * Handle the engine's messages for one core, strictly in order.
 *
 * Serialised because a core is one stateful player and a render is not re-entrant: with several
 * renders in flight a plain async handler interleaved them over one player, which replayed spans of
 * the tune — heard as a short passage looping with crackle at the seams.
 *
 * Superseding rather than queueing: once a new `open` has been *received*, renders and seeks queued
 * for the tune it replaces are skipped (a skipped seek is still answered, so nobody waits out a
 * timeout). Doing that work first would hold the new tune's open behind all of it — on a Pixel 4 a
 * scrub-then-skip put enough in front of an open to blow its 15 s timeout.
 */
export const createRendererDispatcher = (
  core: SidRendererCore,
  post: RendererPost,
): ((message: LocalSidMainToWorker) => Promise<void>) => {
  let queue: Promise<void> = Promise.resolve();
  let openGeneration = 0;
  let prerenderGeneration = 0;

  const handle = async (message: LocalSidMainToWorker, myPrerenderGeneration: number): Promise<void> => {
    try {
      switch (message.type) {
        case "load": {
          const startedAt = performance.now();
          await core.load({ pcmHeadroomSamples: message.pcmHeadroomSamples });
          post({ type: "ready", moduleLoadMs: performance.now() - startedAt });
          return;
        }
        case "open": {
          const opened = await core.open({
            sidBytes: message.sidBytes,
            songIndex: message.songIndex,
            sampleRate: message.sampleRate,
            roms: message.roms,
            sidModel: message.sidModel,
            engine: message.engine,
          });
          post({ type: "opened", id: message.id, romRequired: false, ...opened });
          return;
        }
        case "render": {
          const chunk = await core.render(message.seconds);
          if (!chunk || chunk.samples === 0) {
            post({ type: "end", id: message.id });
            return;
          }
          post(
            { type: "chunk", id: message.id, pcm: chunk.pcm, samples: chunk.samples, renderMs: chunk.renderMs },
            transferOf(chunk.pcm),
          );
          return;
        }
        case "seek": {
          // Reported as requested, not as landed: the engine owns the playback clock, and a tune
          // shorter than the target simply ends on its next render.
          const target = Math.max(0, message.positionSeconds);
          await core.seek(target);
          post({ type: "seeked", id: message.id, positionSeconds: target });
          return;
        }
        case "prerender": {
          try {
            const done = await core.prerender(
              {
                sidBytes: message.sidBytes,
                songIndex: message.songIndex,
                sampleRate: message.sampleRate,
                roms: message.roms,
                sidModel: message.sidModel,
                engine: message.engine,
                seconds: message.seconds,
              },
              (slice) => {
                post(
                  {
                    type: "prerender-chunk",
                    id: message.id,
                    pcm: slice.pcm,
                    sampleRate: slice.sampleRate,
                    channels: slice.channels,
                    seconds: slice.seconds,
                  },
                  transferOf(slice.pcm),
                );
                post({
                  type: "prerender-progress",
                  id: message.id,
                  fraction: message.seconds > 0 ? Math.min(1, slice.seconds / message.seconds) : 1,
                });
              },
              () => myPrerenderGeneration !== prerenderGeneration,
            );
            post({ type: "prerendered", id: message.id, ...done });
          } catch (error) {
            post(toLocalSidError(error, "prerender", message.id));
          }
          return;
        }
        case "close": {
          await core.close();
          return;
        }
      }
    } catch (error) {
      const code = message?.type === "load" ? "load" : message?.type === "render" ? "render" : "open";
      const id = message && "id" in message ? (message as { id?: number }).id : undefined;
      post(toLocalSidError(error, code, id));
    }
  };

  return (message: LocalSidMainToWorker) => {
    if (message?.type === "open") openGeneration += 1;
    // Counted on receipt, so a pre-render already running can see that a newer one is waiting.
    if (message?.type === "prerender") prerenderGeneration += 1;
    const generation = openGeneration;
    const myPrerenderGeneration = prerenderGeneration;
    queue = queue
      .then(() => {
        if (generation < openGeneration && (message.type === "render" || message.type === "seek")) {
          if (message.type === "seek") {
            post({ type: "seeked", id: message.id, positionSeconds: Math.max(0, message.positionSeconds) });
          }
          return undefined;
        }
        return handle(message, myPrerenderGeneration);
      })
      .catch((error: unknown) => {
        // `handle` posts every failure it can see; anything here escaped it, and the chain must survive.
        console.warn("SID renderer: a queued message rejected outside its own handler", error);
      });
    return queue;
  };
};
