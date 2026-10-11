/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { LocalSidWorkerLike } from "../localSidEngine";
import type { LocalSidMainToWorker, LocalSidWorkerToMain } from "../localSidWorkerProtocol";
import { createRendererDispatcher, type SidRendererCore } from "./sidRendererContract";
import { releaseNativePcm } from "./nativePcmRelease";
import { isNativePcm } from "./pcmPayload";

type MessageHandler = (event: MessageEvent<LocalSidWorkerToMain>) => void;
type ErrorHandler = (event: { message?: string }) => void;

/**
 * A renderer core presented to `LocalSidEngine` exactly as a Web Worker is: `postMessage` in,
 * `message` events out, `terminate` to end it.
 *
 * This is what lets libSidplayEZ use the engine's orchestration unchanged. Replies are delivered
 * asynchronously, as a worker's are, so no engine code runs re-entrantly inside its own
 * `postMessage`. After `terminate` nothing more is delivered, as with a terminated worker; a native
 * buffer the engine never saw is given back, since nobody else knows it exists.
 */
export class NativeRendererChannel implements LocalSidWorkerLike {
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly errorHandlers = new Set<ErrorHandler>();
  private terminated = false;
  /** Pre-render buffers the engine has seen. It owns those, and may still hold one in its cache. */
  private readonly deliveredBuffers = new Set<number>();
  private readonly dispatch: (message: LocalSidMainToWorker) => Promise<void>;

  constructor(private readonly core: SidRendererCore) {
    this.dispatch = createRendererDispatcher(core, (message) => {
      if (this.terminated) return this.discard(message);
      queueMicrotask(() => {
        if (this.terminated) return this.discard(message);
        if (message.type === "prerender-chunk" && isNativePcm(message.pcm)) {
          this.deliveredBuffers.add(message.pcm.bufferId);
        }
        const event = { data: message } as MessageEvent<LocalSidWorkerToMain>;
        for (const handler of this.messageHandlers) handler(event);
      });
    });
  }

  private discard(message: LocalSidWorkerToMain): void {
    if (message.type !== "chunk" && message.type !== "prerender-chunk") return;
    if (isNativePcm(message.pcm) && !this.deliveredBuffers.has(message.pcm.bufferId)) releaseNativePcm(message.pcm);
  }

  postMessage(message: LocalSidMainToWorker): void {
    if (this.terminated) return;
    void this.dispatch(message);
  }

  addEventListener(type: "message", handler: MessageHandler): void;
  addEventListener(type: "error", handler: ErrorHandler): void;
  addEventListener(type: "messageerror", handler: () => void): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    handler: MessageHandler | ErrorHandler | (() => void),
  ): void {
    if (type === "message") this.messageHandlers.add(handler as MessageHandler);
    else if (type === "error") this.errorHandlers.add(handler as ErrorHandler);
    // A native channel has no structured-clone step, so `messageerror` can never fire.
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.messageHandlers.clear();
    this.errorHandlers.clear();
    this.core.dispose();
  }
}
