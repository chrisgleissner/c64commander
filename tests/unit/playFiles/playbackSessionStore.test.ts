/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLAYBACK_SESSION_KEY,
  clearStoredPlaybackSession,
  readStoredPlaybackSession,
  writeStoredPlaybackSession,
} from "@/lib/playback/playbackSessionStore";
import type { StoredPlaybackSession } from "@/pages/playFiles/types";

const session = (overrides: Partial<StoredPlaybackSession> = {}): StoredPlaybackSession => ({
  playlistKey: "c64u_playlist:v1:device-1",
  currentItemId: "local::/Music/demo.sid",
  currentItemLabel: "demo.sid",
  currentIndex: 0,
  isPlaying: true,
  isPaused: false,
  elapsedMs: 5000,
  playedMs: 5000,
  durationMs: 60000,
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe("playbackSessionStore", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // HARD27-032: sessionStorage dies with the process the OS ends in the
  // background, and the session behind the Home "Last" tile has to outlive it.
  it("keeps a written session readable once sessionStorage is gone", () => {
    writeStoredPlaybackSession(session());
    sessionStorage.clear();

    expect(readStoredPlaybackSession()?.currentItemLabel).toBe("demo.sid");
    expect(localStorage.getItem(PLAYBACK_SESSION_KEY)).not.toBeNull();
  });

  it("migrates a session left by a build from before the move, and empties the old slot", () => {
    sessionStorage.setItem(PLAYBACK_SESSION_KEY, JSON.stringify(session({ currentItemLabel: "legacy.sid" })));

    expect(readStoredPlaybackSession()?.currentItemLabel).toBe("legacy.sid");
    expect(sessionStorage.getItem(PLAYBACK_SESSION_KEY)).toBeNull();
    expect(readStoredPlaybackSession()?.currentItemLabel).toBe("legacy.sid");
  });

  it("prefers the current session over a stale one still in the old slot", () => {
    sessionStorage.setItem(PLAYBACK_SESSION_KEY, JSON.stringify(session({ currentItemLabel: "legacy.sid" })));
    writeStoredPlaybackSession(session({ currentItemLabel: "current.sid" }));

    expect(readStoredPlaybackSession()?.currentItemLabel).toBe("current.sid");
  });

  // Without this, stopping playback would leave the pre-move entry behind, and
  // the migration read would resurrect the session the user had just ended.
  it("clears both slots, so a stop is not undone by the old one", () => {
    sessionStorage.setItem(PLAYBACK_SESSION_KEY, JSON.stringify(session({ currentItemLabel: "legacy.sid" })));
    writeStoredPlaybackSession(session());
    clearStoredPlaybackSession();

    expect(readStoredPlaybackSession()).toBeNull();
  });

  it("returns null for a payload that is not an object", () => {
    localStorage.setItem(PLAYBACK_SESSION_KEY, '"just-a-string"');
    expect(readStoredPlaybackSession()).toBeNull();
  });

  it("returns null for an unparseable payload instead of throwing", () => {
    localStorage.setItem(PLAYBACK_SESSION_KEY, "{invalid");
    expect(readStoredPlaybackSession()).toBeNull();
  });

  // Storage can refuse a write in a private-browsing context or when the quota is full. The
  // session is a convenience for the next launch, so losing it must not fail the playback that
  // was reporting its position.
  it("does not throw when the session cannot be written", () => {
    const realSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === PLAYBACK_SESSION_KEY) throw new DOMException("quota", "QuotaExceededError");
      realSetItem.call(this, key, value);
    });
    try {
      expect(() => writeStoredPlaybackSession(session())).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });

  it("does not throw when the session cannot be cleared", () => {
    const realRemoveItem = Storage.prototype.removeItem;
    const removeItem = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (key === PLAYBACK_SESSION_KEY) throw new DOMException("denied", "SecurityError");
      realRemoveItem.call(this, key);
    });
    try {
      expect(() => clearStoredPlaybackSession()).not.toThrow();
    } finally {
      removeItem.mockRestore();
    }
  });
});
