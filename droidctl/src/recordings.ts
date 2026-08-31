/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { DetachedHandle } from "./transport/types.js";

export interface RecordingHandle {
  readonly recordingId: string;
  readonly targetId: string;
  readonly name: string;
  readonly devicePath: string;
  readonly timeLimitSec: number;
  readonly startedAt: string;
  readonly runRoot?: string;
  readonly process: DetachedHandle;
}

export class RecordingStore {
  private readonly handles = new Map<string, RecordingHandle>();
  private counter = 0;

  nextId(): string {
    this.counter += 1;
    return `rec-${this.counter.toString().padStart(4, "0")}`;
  }

  put(handle: RecordingHandle): void {
    this.handles.set(handle.recordingId, handle);
  }

  get(recordingId: string): RecordingHandle | undefined {
    return this.handles.get(recordingId);
  }

  delete(recordingId: string): void {
    this.handles.delete(recordingId);
  }

  ids(): string[] {
    return [...this.handles.keys()];
  }
}
