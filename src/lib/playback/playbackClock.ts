export class PlaybackClock {
  private baseMs = 0;
  private startedAt: number | null = null;

  start(now: number, reset = false) {
    if (reset) {
      this.baseMs = 0;
    }
    this.startedAt = now;
  }

  pause(now: number) {
    if (this.startedAt === null) return;
    const delta = Math.max(0, now - this.startedAt);
    this.baseMs += delta;
    this.startedAt = null;
  }

  resume(now: number) {
    if (this.startedAt !== null) return;
    this.startedAt = now;
  }

  stop(now: number, reset = false) {
    this.pause(now);
    if (reset) {
      this.baseMs = 0;
    }
  }

  reset() {
    this.baseMs = 0;
    this.startedAt = null;
  }

  current(now: number): number {
    if (this.startedAt === null) return this.baseMs;
    return this.baseMs + Math.max(0, now - this.startedAt);
  }
}
