/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectionRef = vi.hoisted(() => ({ current: { isConnected: false } }));
vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({ status: connectionRef.current }),
}));

import { useOfflineArrangement } from "@/hooks/useOfflineArrangement";
import { OFFLINE_SETTLE_MS } from "@/lib/home/offlineArrangement";
import { resetSavedDevicesCacheForTests } from "@/lib/savedDevices/store";

const SAVED_DEVICES_KEY = "c64u_saved_devices:v1";

const seedDevice = (overrides: Record<string, unknown>) => {
  localStorage.setItem(
    SAVED_DEVICES_KEY,
    JSON.stringify({
      version: 1,
      selectedDeviceId: "seeded",
      devices: [
        {
          id: "seeded",
          name: "c64u",
          nameSource: "INFERRED",
          host: "c64u",
          type: "",
          typeSource: "INFERRED",
          httpPort: 80,
          ftpPort: 21,
          telnetPort: 23,
          lastKnownProduct: null,
          lastKnownHostname: null,
          lastKnownUniqueId: null,
          lastSuccessfulConnectionAt: null,
          lastUsedAt: null,
          hasPassword: false,
          ...overrides,
        },
      ],
      summaries: {},
      summaryLru: [],
      hasEverHadMultipleDevices: false,
    }),
  );
  resetSavedDevicesCacheForTests();
};

const Probe = ({ pinned = false }: { pinned?: boolean }) => {
  const offline = useOfflineArrangement(pinned);
  return <span data-testid="arrangement">{offline ? "offline" : "connected"}</span>;
};

const arrangement = () => screen.getByTestId("arrangement").textContent;

describe("useOfflineArrangement", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    connectionRef.current = { isConnected: false };
  });

  afterEach(() => {
    vi.useRealTimers();
    resetSavedDevicesCacheForTests();
  });

  it("is offline at once when the selected device is the untouched bootstrap default", () => {
    seedDevice({});
    render(<Probe />);
    expect(arrangement()).toBe("offline");
  });

  it("is connected while the device is connected", () => {
    seedDevice({ lastSuccessfulConnectionAt: "2026-01-01T00:00:00.000Z" });
    connectionRef.current = { isConnected: true };
    render(<Probe />);
    expect(arrangement()).toBe("connected");
  });

  describe("the flap test", () => {
    beforeEach(() => {
      // A device that has connected before, so only the settle window decides.
      seedDevice({ lastSuccessfulConnectionAt: "2026-01-01T00:00:00.000Z", nameSource: "USER" });
    });

    it("does not reorder Home after 8 seconds unreachable", async () => {
      render(<Probe />);
      expect(arrangement()).toBe("connected");
      await act(async () => {
        vi.advanceTimersByTime(OFFLINE_SETTLE_MS - 1);
      });
      expect(arrangement()).toBe("connected");
    });

    it("reorders Home after 9 seconds unreachable", async () => {
      render(<Probe />);
      await act(async () => {
        vi.advanceTimersByTime(9_000);
      });
      expect(arrangement()).toBe("offline");
    });

    it("restores the connected arrangement immediately on a reconnection", async () => {
      const { rerender } = render(<Probe />);
      await act(async () => {
        vi.advanceTimersByTime(9_000);
      });
      expect(arrangement()).toBe("offline");

      connectionRef.current = { isConnected: true };
      rerender(<Probe />);
      expect(arrangement()).toBe("connected");
    });

    it("restarts the clock after a reconnection, so a second brief drop does not reorder", async () => {
      const { rerender } = render(<Probe />);
      await act(async () => {
        vi.advanceTimersByTime(9_000);
      });
      expect(arrangement()).toBe("offline");

      connectionRef.current = { isConnected: true };
      rerender(<Probe />);
      expect(arrangement()).toBe("connected");

      connectionRef.current = { isConnected: false };
      rerender(<Probe />);
      await act(async () => {
        vi.advanceTimersByTime(3_000);
      });
      expect(arrangement()).toBe("connected");
    });

    it("does not reorder while something is on top of the page, however long the device is away", async () => {
      render(<Probe pinned />);
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(arrangement()).toBe("connected");
    });

    it("applies the deferred change as soon as the pin lifts", async () => {
      const { rerender } = render(<Probe pinned />);
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(arrangement()).toBe("connected");

      rerender(<Probe pinned={false} />);
      expect(arrangement()).toBe("offline");
    });
  });
});
