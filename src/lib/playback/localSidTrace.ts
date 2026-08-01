/**
 * A timestamped trace of a track change, readable from a hardware test.
 *
 * A crossfade either happens or it does not, and the counters in `debugState` cannot tell you which:
 * they are sampled, and a track change is over in a couple of seconds. This records the handful of
 * moments that decide whether two tunes overlap — when the outgoing tune was told to stop, how much
 * audio it had left to hand over, when the incoming tune's bytes arrived, whether its opening was
 * already rendered, and when its first sample reached the speaker.
 *
 * It is a fixed-size ring of plain objects written a few times per track change, so it costs nothing
 * to leave on. Read it with `__localSidTrace()` over CDP.
 */

/** One moment worth knowing about, with the time it happened. */
export interface LocalSidTraceEntry {
  /** Milliseconds on the same clock as `performance.now()`. */
  at: number;
  event: string;
  detail?: Record<string, unknown>;
}

/** Large enough for several track changes, small enough to never matter. */
const CAPACITY = 200;

const entries: LocalSidTraceEntry[] = [];

export const traceLocalSid = (event: string, detail?: Record<string, unknown>): void => {
  entries.push({ at: Math.round(performance.now()), event, detail });
  if (entries.length > CAPACITY) entries.splice(0, entries.length - CAPACITY);
};

/** The trace so far, oldest first. Copied, so a reader cannot disturb it. */
export const readLocalSidTrace = (): LocalSidTraceEntry[] => entries.map((entry) => ({ ...entry }));

export const clearLocalSidTrace = (): void => {
  entries.length = 0;
};

// The HIL seam. Mirrors `__localEngineDebug` on the Play page.
(globalThis as Record<string, unknown>).__localSidTrace = readLocalSidTrace;
(globalThis as Record<string, unknown>).__localSidTraceClear = clearLocalSidTrace;
