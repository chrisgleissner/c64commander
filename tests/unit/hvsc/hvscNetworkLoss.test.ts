/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordNetworkStatus, resetNetworkStatusWatchForTests } from "@/lib/connection/networkStatusWatch";

const platform = vi.hoisted(() => ({ online: true }));
vi.mock("@/lib/connection/offlineStartup", async () => {
  const watch = await import("@/lib/connection/networkStatusWatch");
  return {
    readNativeNetworkStatus: vi.fn(async () => {
      const status = { online: platform.online, supported: true };
      watch.recordNetworkStatus(status);
      return status;
    }),
  };
});

import { explainHvscDownloadFailure, isHvscNoNetworkError } from "@/lib/hvsc/hvscNetworkLoss";

describe("explaining an HVSC download failure", () => {
  beforeEach(() => {
    resetNetworkStatusWatchForTests();
    recordNetworkStatus({ online: true, supported: true });
    platform.online = true;
  });

  // The socket's own words ("Software caused connection abort") arrived before the network event did.
  it("restates a transfer failure as the no-network failure when the platform then reports no network", async () => {
    platform.online = false;

    const explained = await explainHvscDownloadFailure(new Error("Software caused connection abort"));

    expect(isHvscNoNetworkError(explained)).toBe(true);
  });

  it("keeps a transfer failure as it was while the network is up", async () => {
    const error = new Error("HTTP 503");

    expect(await explainHvscDownloadFailure(error)).toBe(error);
  });
});
