/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_PLAY_OUT_GRACE_MS,
  beginLocalPlayOut,
  endLocalPlayOut,
  readLocalPlayOut,
  subscribeLocalPlayOut,
} from "@/lib/playback/localPlayOut";

describe("the phone's play-out of a tune the playlist has moved past", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    endLocalPlayOut();
    vi.useRealTimers();
  });

  it("is announced when it begins and when the next tune's first sample is heard", () => {
    const changes: unknown[] = [];
    const unsubscribe = subscribeLocalPlayOut(() => changes.push(readLocalPlayOut()));

    beginLocalPlayOut(2.4, 1_000);
    endLocalPlayOut();
    endLocalPlayOut();
    unsubscribe();

    expect(changes).toEqual([{ endsAtMs: 3_400 }, null]);
  });

  it("ends by itself at its expected end plus the grace when no report of the next tune's audio comes", () => {
    beginLocalPlayOut(2.4);

    vi.advanceTimersByTime(2_400 + LOCAL_PLAY_OUT_GRACE_MS - 1);
    expect(readLocalPlayOut()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(readLocalPlayOut()).toBeNull();
  });

  it("measures the bound from the newest play-out, not from one it replaced", () => {
    beginLocalPlayOut(1);
    vi.advanceTimersByTime(900);
    beginLocalPlayOut(2);

    vi.advanceTimersByTime(1_000 + LOCAL_PLAY_OUT_GRACE_MS);
    expect(readLocalPlayOut()).not.toBeNull();
    vi.advanceTimersByTime(1_000);
    expect(readLocalPlayOut()).toBeNull();
  });
});
