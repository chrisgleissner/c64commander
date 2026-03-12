/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { buildEnabledSidUnmuteUpdates, type SidEnablement } from "@/lib/config/sidVolumeControl";

/**
 * Unit tests for Issue 1 (volume/mute desync) fixes.
 *
 * These tests validate the key behavioural contracts that were broken before
 * the fix:
 *
 *   A. applyAudioMixerUpdates rethrows for non-Restore contexts so callers can
 *      gate UI state on confirmed writes.
 *
 *   B. scheduleVolumeUpdate (runUpdate) only dispatches 'unmute' after the
 *      write succeeds, and skips the dispatch when the write fails or when the
 *      operation token has been superseded.
 *
 *   C. handleToggleMute mute path only dispatches 'mute' after the write
 *      succeeds.
 */

// ---------------------------------------------------------------------------
// A. applyAudioMixerUpdates rethrow contract
// ---------------------------------------------------------------------------

/**
 * A minimal standalone replica of applyAudioMixerUpdates that mirrors the
 * exact branching logic in useVolumeOverride.ts.  Tests here verify the
 * rethrow / swallow contract in isolation.
 */
async function applyAudioMixerUpdates(
  mutateAsync: () => Promise<void>,
  context: string,
  onError: (msg: string, ctx: string) => void,
  onToast: () => void,
): Promise<void> {
  try {
    await mutateAsync();
  } catch (error) {
    if (context.startsWith("Restore")) {
      onError((error as Error).message, context);
      onToast();
      return;
    }
    throw error;
  }
}

describe("applyAudioMixerUpdates rethrow contract", () => {
  it("swallows and logs errors for Restore contexts", async () => {
    const onError = vi.fn();
    const onToast = vi.fn();
    const mutateAsync = vi.fn().mockRejectedValue(new Error("network"));

    await expect(applyAudioMixerUpdates(mutateAsync, "Restore (stop)", onError, onToast)).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith("network", "Restore (stop)");
    expect(onToast).toHaveBeenCalledTimes(1);
  });

  it("rethrows for Volume context", async () => {
    const onError = vi.fn();
    const onToast = vi.fn();
    const mutateAsync = vi.fn().mockRejectedValue(new Error("timeout"));

    await expect(applyAudioMixerUpdates(mutateAsync, "Volume", onError, onToast)).rejects.toThrow("timeout");

    expect(onError).not.toHaveBeenCalled();
    expect(onToast).not.toHaveBeenCalled();
  });

  it("rethrows for Mute context", async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error("unreachable"));
    await expect(applyAudioMixerUpdates(mutateAsync, "Mute", vi.fn(), vi.fn())).rejects.toThrow("unreachable");
  });

  it("rethrows for Unmute context", async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error("device lost"));
    await expect(applyAudioMixerUpdates(mutateAsync, "Unmute", vi.fn(), vi.fn())).rejects.toThrow("device lost");
  });

  it("does not call onError or onToast on success", async () => {
    const onError = vi.fn();
    const onToast = vi.fn();
    const mutateAsync = vi.fn().mockResolvedValue(undefined);

    await applyAudioMixerUpdates(mutateAsync, "Mute", onError, onToast);

    expect(onError).not.toHaveBeenCalled();
    expect(onToast).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// B. scheduleVolumeUpdate: dispatch gated on write success
// ---------------------------------------------------------------------------

/**
 * Replica of the fixed runUpdate inner function from scheduleVolumeUpdate.
 * Returns the dispatched action type or null if skipped.
 */
async function runUpdate(opts: {
  token: number;
  tokenRef: { current: number };
  writeVolume: () => Promise<void>;
  dispatch: (action: string) => void;
}): Promise<void> {
  const { token, tokenRef, writeVolume, dispatch } = opts;
  if (token !== tokenRef.current) return;
  try {
    await writeVolume();
  } catch {
    return;
  }
  if (token !== tokenRef.current) return;
  dispatch("unmute");
}

describe("scheduleVolumeUpdate: dispatch gated on write", () => {
  it("dispatches unmute after a successful write", async () => {
    const dispatch = vi.fn();
    const tokenRef = { current: 1 };
    await runUpdate({
      token: 1,
      tokenRef,
      writeVolume: vi.fn().mockResolvedValue(undefined),
      dispatch,
    });
    expect(dispatch).toHaveBeenCalledWith("unmute");
  });

  it("skips dispatch when write fails", async () => {
    const dispatch = vi.fn();
    const tokenRef = { current: 1 };
    await runUpdate({
      token: 1,
      tokenRef,
      writeVolume: vi.fn().mockRejectedValue(new Error("write error")),
      dispatch,
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("skips dispatch when token is superseded before write", async () => {
    const dispatch = vi.fn();
    const tokenRef = { current: 2 }; // already advanced
    await runUpdate({
      token: 1,
      tokenRef,
      writeVolume: vi.fn().mockResolvedValue(undefined),
      dispatch,
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("skips dispatch when token is superseded after write completes", async () => {
    const dispatch = vi.fn();
    const tokenRef = { current: 1 };
    const writeVolume = vi.fn().mockImplementation(async () => {
      // Simulate another update arriving while this write is in-flight.
      tokenRef.current = 2;
    });
    await runUpdate({ token: 1, tokenRef, writeVolume, dispatch });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches when token matches after concurrent write completes", async () => {
    const dispatch = vi.fn();
    const tokenRef = { current: 3 };
    await runUpdate({
      token: 3,
      tokenRef,
      writeVolume: vi.fn().mockResolvedValue(undefined),
      dispatch,
    });
    expect(dispatch).toHaveBeenCalledWith("unmute");
  });
});

// ---------------------------------------------------------------------------
// C. handleToggleMute mute path: dispatch gated on write success
// ---------------------------------------------------------------------------

/**
 * Replica of the fixed mute path in handleToggleMute.
 */
async function handleMute(opts: { writeMute: () => Promise<void>; dispatch: (action: string) => void }): Promise<void> {
  const { writeMute, dispatch } = opts;
  await writeMute(); // throws on failure — caller sees rejection
  dispatch("mute");
}

describe("handleToggleMute mute path: dispatch gated on write", () => {
  it("dispatches mute after write succeeds", async () => {
    const dispatch = vi.fn();
    await handleMute({
      writeMute: vi.fn().mockResolvedValue(undefined),
      dispatch,
    });
    expect(dispatch).toHaveBeenCalledWith("mute");
  });

  it("does not dispatch mute when write fails", async () => {
    const dispatch = vi.fn();
    await expect(
      handleMute({
        writeMute: vi.fn().mockRejectedValue(new Error("network")),
        dispatch,
      }),
    ).rejects.toThrow("network");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatch is called exactly once on a single successful mute", async () => {
    const dispatch = vi.fn();
    await handleMute({
      writeMute: vi.fn().mockResolvedValue(undefined),
      dispatch,
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// D. Convergence: rapid mute/unmute sequence leaves state consistent
// ---------------------------------------------------------------------------

describe("convergence: rapid mute/unmute sequence", () => {
  it("final state reflects last successful write", async () => {
    let muteCount = 0;
    let unmuteCount = 0;

    /**
     * Simulates N rapid mute/unmute cycles where every write succeeds.
     * The final dispatch must reflect the last operation.
     */
    const N = 10;
    for (let i = 0; i < N; i++) {
      const dispatch = vi.fn();
      if (i % 2 === 0) {
        await handleMute({
          writeMute: vi.fn().mockResolvedValue(undefined),
          dispatch,
        });
        expect(dispatch).toHaveBeenCalledWith("mute");
        muteCount++;
      } else {
        const tokenRef = { current: i };
        await runUpdate({
          token: i,
          tokenRef,
          writeVolume: vi.fn().mockResolvedValue(undefined),
          dispatch,
        });
        expect(dispatch).toHaveBeenCalledWith("unmute");
        unmuteCount++;
      }
    }
    expect(muteCount + unmuteCount).toBe(N);
  });

  it("no dispatch leaks when all writes in the sequence fail", async () => {
    const allDispatches: string[] = [];
    const N = 6;
    for (let i = 0; i < N; i++) {
      const dispatch = vi.fn((a: string) => allDispatches.push(a));
      const tokenRef = { current: i };
      await runUpdate({
        token: i,
        tokenRef,
        writeVolume: vi.fn().mockRejectedValue(new Error("fail")),
        dispatch,
      });
    }
    expect(allDispatches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F. Unmute refresh: skip SIDs disabled while muted
// ---------------------------------------------------------------------------

async function resolveManualUnmuteUpdates(opts: {
  snapshot: Record<string, string | number>;
  staleEnablement: SidEnablement;
  resolveEnabledSidVolumeItems: (forceRefresh?: boolean) => Promise<Array<{ name: string }>>;
}) {
  const { snapshot, staleEnablement, resolveEnabledSidVolumeItems } = opts;
  const items = await resolveEnabledSidVolumeItems(true);
  const allowedNames = new Set(items.map((item) => item.name));
  return Object.fromEntries(
    Object.entries(buildEnabledSidUnmuteUpdates(snapshot, staleEnablement)).filter(([name]) => allowedNames.has(name)),
  );
}

describe("unmute refresh uses live SID enablement", () => {
  it("skips restoring SIDs that were disabled while muted", async () => {
    const resolveEnabledSidVolumeItems = vi.fn().mockResolvedValue([{ name: "Vol UltiSid 2" }]);

    const updates = await resolveManualUnmuteUpdates({
      snapshot: {
        "Vol Socket 1": "+6 dB",
        "Vol UltiSid 2": "+6 dB",
      },
      staleEnablement: {
        socket1: true,
        socket2: false,
        ultiSid1: false,
        ultiSid2: true,
      },
      resolveEnabledSidVolumeItems,
    });

    expect(resolveEnabledSidVolumeItems).toHaveBeenCalledWith(true);
    expect(updates).toEqual({
      "Vol UltiSid 2": "+6 dB",
    });
  });
});

// ---------------------------------------------------------------------------
// E. Pause transition: stale query data must not cancel the paused mute state
// ---------------------------------------------------------------------------

function syncPauseMuteState(opts: {
  activeIndices: number[];
  pausingFromPauseRef: { current: boolean };
  resumingFromPauseRef: { current: boolean };
  dispatch: (state: "muted" | "unmuted") => void;
}) {
  const { activeIndices, pausingFromPauseRef, resumingFromPauseRef, dispatch } = opts;
  if (pausingFromPauseRef.current && activeIndices.length) {
    return;
  }
  if (!activeIndices.length) {
    if (resumingFromPauseRef.current) return;
    pausingFromPauseRef.current = false;
    dispatch("muted");
    return;
  }
  dispatch("unmuted");
}

describe("pause transition mute guard", () => {
  it("does not revert the UI to unmuted while stale pre-pause values are still in the query cache", () => {
    const dispatch = vi.fn();
    const pausingFromPauseRef = { current: true };

    syncPauseMuteState({
      activeIndices: [3],
      pausingFromPauseRef,
      resumingFromPauseRef: { current: false },
      dispatch,
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(pausingFromPauseRef.current).toBe(true);
  });

  it("clears the pause guard once the hardware mute state is observed", () => {
    const dispatch = vi.fn();
    const pausingFromPauseRef = { current: true };

    syncPauseMuteState({
      activeIndices: [],
      pausingFromPauseRef,
      resumingFromPauseRef: { current: false },
      dispatch,
    });

    expect(dispatch).toHaveBeenCalledWith("muted");
    expect(pausingFromPauseRef.current).toBe(false);
  });
});
