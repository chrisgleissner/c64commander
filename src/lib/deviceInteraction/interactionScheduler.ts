/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type InteractionIntent = "user" | "system" | "background";

export type QueueTask<T> = {
  run: () => Promise<T>;
  resolve?: (value: T) => void;
  reject?: (error: Error) => void;
  intent: InteractionIntent;
  getReadyAtMs?: () => number;
};

// PH10: thrown when queued interaction tasks are cancelled by a device-state
// reset (e.g. saved-device switch). Classified as cancellation, not failure,
// so callers and diagnostics can distinguish "stale, ignored" from "broken".
export class InteractionCancelledError extends Error {
  readonly isCancellation = true as const;
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "InteractionCancelledError";
  }
}

export class InteractionScheduler {
  private running = 0;
  private deferredDrainTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly queues: Record<InteractionIntent, Array<QueueTask<unknown>>> = {
    user: [],
    system: [],
    background: [],
  };

  constructor(
    private readonly maxConcurrency: () => number,
    private readonly label: string = "scheduler",
  ) {}

  schedule<T>(task: QueueTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: QueueTask<unknown> = {
        ...task,
        resolve,
        reject,
      } as QueueTask<unknown>;
      this.queues[task.intent].push(entry);
      this.drain();
    });
  }

  // PH10: reject every queued (not-yet-running) task with a cancellation
  // error so a saved-device switch doesn't leak old-host work into the new
  // device's context. Running tasks cannot be revoked here — they complete
  // or fail naturally; their late results are handled by the caller (or
  // simply ignored when state has moved on).
  cancelAll(reason: string, intents: readonly InteractionIntent[] = ["user", "system", "background"]): number {
    this.clearDeferredDrainTimer();
    let cancelled = 0;
    for (const intent of intents) {
      const queue = this.queues[intent];
      while (queue.length > 0) {
        const task = queue.shift();
        if (!task) continue;
        cancelled += 1;
        const error = new InteractionCancelledError(`${this.label} queued task cancelled: ${reason}`, reason);
        // Promise reject cannot throw synchronously, so no try/catch is needed.
        task.reject?.(error);
      }
    }
    return cancelled;
  }

  private clearDeferredDrainTimer() {
    if (this.deferredDrainTimer) {
      clearTimeout(this.deferredDrainTimer);
      this.deferredDrainTimer = null;
    }
  }

  private scheduleDeferredDrain(nextReadyAtMs: number | null) {
    this.clearDeferredDrainTimer();
    if (nextReadyAtMs === null) return;
    this.deferredDrainTimer = setTimeout(
      () => {
        this.deferredDrainTimer = null;
        this.drain();
      },
      Math.max(0, nextReadyAtMs - Date.now()),
    );
  }

  private takeNext(): { task: QueueTask<unknown> | null; nextReadyAtMs: number | null } {
    const now = Date.now();
    let nextReadyAtMs: number | null = null;
    for (const intent of ["user", "system", "background"] as const) {
      const queue = this.queues[intent];
      for (let index = 0; index < queue.length; index += 1) {
        const candidate = queue[index];
        const readyAtMs = candidate.getReadyAtMs?.() ?? now;
        if (readyAtMs <= now) {
          queue.splice(index, 1);
          return { task: candidate, nextReadyAtMs: null };
        }
        nextReadyAtMs = nextReadyAtMs === null ? readyAtMs : Math.min(nextReadyAtMs, readyAtMs);
      }
    }
    return { task: null, nextReadyAtMs };
  }

  private drain() {
    this.clearDeferredDrainTimer();
    const limit = Math.max(1, this.maxConcurrency());
    while (this.running < limit) {
      const { task, nextReadyAtMs } = this.takeNext();
      if (!task) {
        this.scheduleDeferredDrain(nextReadyAtMs);
        return;
      }
      this.running += 1;
      void task
        .run()
        .then((value) => task.resolve?.(value))
        .catch((error) => task.reject?.(error))
        .finally(() => {
          this.running = Math.max(0, this.running - 1);
          this.drain();
        });
    }
  }
}

export class PerDeviceInteractionScheduler {
  private readonly schedulers = new Map<string, InteractionScheduler>();

  constructor(
    private readonly maxConcurrency: () => number,
    private readonly label: string,
  ) {}

  forDevice(deviceScope: string): InteractionScheduler {
    const scheduler = this.schedulers.get(deviceScope) ?? new InteractionScheduler(this.maxConcurrency, this.label);
    this.schedulers.set(deviceScope, scheduler);
    return scheduler;
  }

  cancelAll(reason: string, intents?: readonly InteractionIntent[]): number {
    let cancelled = 0;
    this.schedulers.forEach((scheduler) => {
      cancelled += scheduler.cancelAll(reason, intents);
    });
    return cancelled;
  }
}
