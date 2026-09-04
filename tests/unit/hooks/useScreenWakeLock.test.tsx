/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
});
