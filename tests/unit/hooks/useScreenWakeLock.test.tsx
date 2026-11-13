/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { addLog } from "@/lib/logging";
import { useScreenWakeLock } from "@/hooks/useScreenWakeLock";

/**
 * HARD27-021. Watching Live View produces no touch input, so the display timeout locks the screen
 * mid-picture. The platform also revokes the sentinel every time the document is hidden, which is
 * why re-acquiring on return is part of the contract rather than a nicety.
 */

const Probe = ({ active }: { active: boolean }) => {
  useScreenWakeLock(active);
  return null;
};

describe("useScreenWakeLock (HARD27-021)", () => {
  let release: ReturnType<typeof vi.fn>;
  let request: ReturnType<typeof vi.fn>;
  let visibility: DocumentVisibilityState;

  const setVisibility = (state: DocumentVisibilityState) => {
    visibility = state;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  };

  beforeEach(() => {
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    release = vi.fn(async () => {});
    request = vi.fn(async () => ({ release }));
    Object.defineProperty(navigator, "wakeLock", { configurable: true, writable: true, value: { request } });
  });

  afterEach(() => {
    delete (navigator as Navigator & { wakeLock?: unknown }).wakeLock;
  });

  it("takes a screen wake lock while active and releases it on unmount", async () => {
    const view = render(<Probe active={true} />);
    await act(async () => {});

    expect(request).toHaveBeenCalledWith("screen");

    view.unmount();
    await act(async () => {});
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("takes no lock while inactive, and releases when it becomes inactive", async () => {
    const view = render(<Probe active={false} />);
    await act(async () => {});
    expect(request).not.toHaveBeenCalled();

    view.rerender(<Probe active={true} />);
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);

    view.rerender(<Probe active={false} />);
    await act(async () => {});
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("re-acquires after the document is hidden and shown again", async () => {
    render(<Probe active={true} />);
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does nothing on a platform with no Screen Wake Lock API", async () => {
    delete (navigator as Navigator & { wakeLock?: unknown }).wakeLock;
    const view = render(<Probe active={true} />);
    await act(async () => {});
    expect(() => view.unmount()).not.toThrow();
  });

  it("survives a refused request", async () => {
    request.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const view = render(<Probe active={true} />);
    await act(async () => {});
    expect(() => view.unmount()).not.toThrow();
    expect(release).not.toHaveBeenCalled();
  });

  // The request is asynchronous, so the component can unmount while it is in flight. The sentinel
  // that then arrives has nobody left to hold it and must be released, or the screen stays awake
  // after Live View is gone.
  it("releases a lock that arrives after the hook has gone", async () => {
    let resolveRequest: ((sentinel: { release: () => Promise<void> }) => void) | null = null;
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve as (sentinel: { release: () => Promise<void> }) => void;
        }),
    );
    const view = render(<Probe active />);

    view.unmount();
    await act(async () => {
      resolveRequest?.({ release });
      await Promise.resolve();
    });

    expect(release).toHaveBeenCalled();
  });

  it("does not start a second request, and so leaks no sentinel, when the page becomes visible while one is pending", async () => {
    const sentinels = [{ release: vi.fn(async () => {}) }, { release: vi.fn(async () => {}) }];
    const resolvers: Array<(sentinel: (typeof sentinels)[number]) => void> = [];
    request.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));

    const view = render(<Probe active={true} />);
    await act(async () => {});
    setVisibility("hidden");
    setVisibility("visible");
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => resolvers[0](sentinels[0]));
    view.unmount();
    await act(async () => {});
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("allows a new request after a failed one, because the in-progress guard is released", async () => {
    request.mockRejectedValueOnce(new Error("denied")).mockResolvedValue({ release });
    render(<Probe active={true} />);
    await act(async () => {});

    setVisibility("hidden");
    setVisibility("visible");
    await act(async () => {});

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("logs a warning with the stack when releasing the sentinel fails on unmount", async () => {
    release.mockRejectedValue(new Error("release refused"));
    const view = render(<Probe active={true} />);
    await act(async () => {});

    view.unmount();
    await act(async () => {});

    expect(addLog).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("failed to release the screen wake lock"),
      expect.objectContaining({ error: "release refused", stack: expect.any(String) }),
    );
  });

  it("logs a warning when the sentinel arrives after teardown and cannot be released", async () => {
    release.mockRejectedValue(new Error("late release refused"));
    let resolve: (sentinel: { release: typeof release }) => void = () => {};
    request.mockImplementation(() => new Promise((r) => (resolve = r)));
    const view = render(<Probe active={true} />);
    await act(async () => {});
    view.unmount();

    await act(async () => resolve({ release }));

    expect(addLog).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("after the hook was torn down"),
      expect.objectContaining({ error: "late release refused" }),
    );
  });

  it("requests again when the page became visible during a request that then rejects", async () => {
    const rejecters: Array<(error: Error) => void> = [];
    request
      .mockImplementationOnce(() => new Promise((_resolve, reject) => rejecters.push(reject)))
      .mockResolvedValue({ release });

    render(<Probe active={true} />);
    await act(async () => {});
    setVisibility("hidden");
    setVisibility("visible");
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => rejecters[0](new Error("denied")));

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("requests again when the pending request resolves with a sentinel that was already released", async () => {
    const resolvers: Array<(sentinel: { released: boolean; release: typeof release }) => void> = [];
    request
      .mockImplementationOnce(() => new Promise((resolve) => resolvers.push(resolve)))
      .mockResolvedValue({ release });

    render(<Probe active={true} />);
    await act(async () => {});
    setVisibility("hidden");
    setVisibility("visible");

    await act(async () => resolvers[0]({ released: true, release }));

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("retries at most once per visibility change when the request keeps being rejected", async () => {
    const rejecters: Array<(error: Error) => void> = [];
    request.mockImplementation(() => new Promise((_resolve, reject) => rejecters.push(reject)));

    render(<Probe active={true} />);
    await act(async () => {});
    setVisibility("hidden");
    setVisibility("visible");
    await act(async () => rejecters[0](new Error("denied")));
    expect(request).toHaveBeenCalledTimes(2);

    await act(async () => rejecters[1](new Error("denied")));
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not retry after the pending request settles while the page is hidden again", async () => {
    const rejecters: Array<(error: Error) => void> = [];
    request.mockImplementation(() => new Promise((_resolve, reject) => rejecters.push(reject)));

    render(<Probe active={true} />);
    await act(async () => {});
    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("hidden");
    await act(async () => rejecters[0](new Error("denied")));

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("logs the text of a release failure that is not an Error, without a stack", async () => {
    release.mockRejectedValue("release refused as text");
    const view = render(<Probe active={true} />);
    await act(async () => {});

    view.unmount();
    await act(async () => {});

    expect(addLog).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("failed to release the screen wake lock"),
      expect.objectContaining({ error: "release refused as text", stack: undefined }),
    );
  });

  it("keeps the held lock when the page becomes visible again without having been revoked", async () => {
    render(<Probe active={true} />);
    await act(async () => {});

    setVisibility("visible");
    await act(async () => {});

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("requests a new lock when the platform marked the held sentinel as released", async () => {
    const sentinels = [{ release, released: false }, { release }];
    request.mockResolvedValueOnce(sentinels[0]).mockResolvedValueOnce(sentinels[1]);
    render(<Probe active={true} />);
    await act(async () => {});

    sentinels[0].released = true;
    setVisibility("visible");
    await act(async () => {});

    expect(request).toHaveBeenCalledTimes(2);
  });
});
