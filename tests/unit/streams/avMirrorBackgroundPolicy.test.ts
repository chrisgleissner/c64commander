/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { AvMirrorBackgroundPolicy, installAvMirrorBackgroundPolicy } from "@/lib/streams/avMirrorBackgroundPolicy";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

/** A session stub whose live flags follow the start/stop calls, like the real one. */
const createSession = (initial: { audioLive: boolean; videoLive: boolean }) => {
  const state = { ...initial };
  const calls: string[] = [];
  return {
    calls,
    get audioLive() {
      return state.audioLive;
    },
    get videoLive() {
      return state.videoLive;
    },
    setLive(next: Partial<typeof state>) {
      Object.assign(state, next);
    },
    stopAll: vi.fn(async () => {
      calls.push("stopAll");
      state.audioLive = false;
      state.videoLive = false;
    }),
    startAudio: vi.fn(async () => {
      calls.push("startAudio");
      state.audioLive = true;
    }),
    startVideo: vi.fn(async () => {
      calls.push("startVideo");
      state.videoLive = true;
    }),
  };
};

describe("AvMirrorBackgroundPolicy (HARD27-021)", () => {
  it("stops both streams when the app is hidden while the mirror is live", async () => {
    const session = createSession({ audioLive: true, videoLive: true });
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleHidden();

    expect(session.stopAll).toHaveBeenCalledTimes(1);
    expect(policy.suspendedState).toEqual({ audioWasLive: true, videoWasLive: true });
  });

  it("does nothing when the app is hidden and the mirror is off", async () => {
    const session = createSession({ audioLive: false, videoLive: false });
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleHidden();

    expect(session.stopAll).not.toHaveBeenCalled();
    expect(policy.suspendedState).toBeNull();
  });

  it("restarts only the streams that were live when the app becomes visible again", async () => {
    const session = createSession({ audioLive: true, videoLive: false });
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleHidden();
    await policy.handleVisible();

    expect(session.startAudio).toHaveBeenCalledTimes(1);
    expect(session.startVideo).not.toHaveBeenCalled();
    expect(policy.suspendedState).toBeNull();
  });

  it("stops before it restarts, so the device is never asked to start a stream it is still sending", async () => {
    const session = createSession({ audioLive: true, videoLive: true });
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleHidden();
    await policy.handleVisible();

    expect(session.calls).toEqual(["stopAll", "startVideo", "startAudio"]);
  });

  it("does not restart a stream that something else already restarted", async () => {
    const session = createSession({ audioLive: true, videoLive: true });
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleHidden();
    // A device retarget followed the mirror to the new device while the app was hidden.
    session.setLive({ audioLive: true, videoLive: true });
    await policy.handleVisible();

    expect(session.startAudio).not.toHaveBeenCalled();
    expect(session.startVideo).not.toHaveBeenCalled();
  });

  it("keeps the first recorded state when hidden fires twice without an intervening visible", async () => {
    const session = createSession({ audioLive: true, videoLive: true });
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleHidden();
    await policy.handleHidden();

    expect(session.stopAll).toHaveBeenCalledTimes(1);
    expect(policy.suspendedState).toEqual({ audioWasLive: true, videoWasLive: true });
  });

  it("does not restart anything when visible fires without a preceding hidden", async () => {
    const session = createSession({ audioLive: false, videoLive: false });
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleVisible();

    expect(session.startAudio).not.toHaveBeenCalled();
    expect(session.startVideo).not.toHaveBeenCalled();
  });

  it("still clears the held state when a restart fails, so the next hide records afresh", async () => {
    const session = createSession({ audioLive: true, videoLive: false });
    session.startAudio.mockRejectedValueOnce(new Error("streams:start refused"));
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleHidden();
    await policy.handleVisible();

    expect(policy.suspendedState).toBeNull();
  });
});

describe("installAvMirrorBackgroundPolicy (HARD27-021)", () => {
  beforeEach(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  const setHidden = (hidden: boolean) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  };

  it("drives the policy from visibilitychange and stops driving it after disposal", async () => {
    const session = createSession({ audioLive: true, videoLive: true });
    const policy = new AvMirrorBackgroundPolicy(session);
    const dispose = installAvMirrorBackgroundPolicy(policy);

    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(session.stopAll).toHaveBeenCalledTimes(1));

    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(session.startVideo).toHaveBeenCalledTimes(1));

    dispose();
    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(session.stopAll).toHaveBeenCalledTimes(1);
  });
});
