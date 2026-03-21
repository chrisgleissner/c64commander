/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentPlaybackSnapshotLabel } from "./currentPlaybackSnapshotLabel";
import { PLAYBACK_SESSION_KEY } from "@/pages/playFiles/playFilesUtils";

const addErrorLogMock = vi.fn();

vi.mock("@/lib/logging", () => ({
  addErrorLog: (...args: unknown[]) => addErrorLogMock(...args),
}));

describe("getCurrentPlaybackSnapshotLabel", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("returns the trimmed current item label from the playback session", () => {
    sessionStorage.setItem(
      PLAYBACK_SESSION_KEY,
      JSON.stringify({
        currentItemLabel: "  Wizball.sid  ",
      }),
    );

    expect(getCurrentPlaybackSnapshotLabel()).toBe("Wizball.sid");
  });

  it("returns undefined when no session is stored", () => {
    expect(getCurrentPlaybackSnapshotLabel()).toBeUndefined();
  });

  it("returns undefined when the stored label is blank", () => {
    sessionStorage.setItem(
      PLAYBACK_SESSION_KEY,
      JSON.stringify({
        currentItemLabel: "   ",
      }),
    );

    expect(getCurrentPlaybackSnapshotLabel()).toBeUndefined();
  });

  it("logs and returns undefined when the session payload is invalid JSON", () => {
    sessionStorage.setItem(PLAYBACK_SESSION_KEY, "{invalid");

    expect(getCurrentPlaybackSnapshotLabel()).toBeUndefined();
    expect(addErrorLogMock).toHaveBeenCalledWith(
      "Failed to read current playback snapshot label",
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("returns undefined when the session payload is a JSON primitive (not an object)", () => {
    sessionStorage.setItem(PLAYBACK_SESSION_KEY, '"just-a-string"');
    expect(getCurrentPlaybackSnapshotLabel()).toBeUndefined();
  });

  it("returns undefined when currentItemLabel is not a string", () => {
    sessionStorage.setItem(PLAYBACK_SESSION_KEY, JSON.stringify({ currentItemLabel: 42 }));
    expect(getCurrentPlaybackSnapshotLabel()).toBeUndefined();
  });
});
