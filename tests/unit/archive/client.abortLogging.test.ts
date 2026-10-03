/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDefaultArchiveClientConfig } from "@/lib/archive/config";
import { createArchiveClient } from "@/lib/archive/client";
import { addErrorLog, addLog } from "@/lib/logging";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
  CapacitorHttp: { request: vi.fn() },
}));

vi.mock("@/lib/logging", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging")>()),
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
}));

const neverAnswers = () => new Promise<Response>(() => undefined);

describe("archive client failure logging", () => {
  beforeEach(() => {
    vi.mocked(addLog).mockClear();
    vi.mocked(addErrorLog).mockClear();
  });

  it("logs a download the caller aborted at info, not as an error", async () => {
    const controller = new AbortController();
    const client = createArchiveClient(buildDefaultArchiveClientConfig(), neverAnswers);

    const download = client.downloadBinary("2725466672", 39, 1, "nosetrimmer.sid", { signal: controller.signal });
    controller.abort();

    await expect(download).rejects.toThrow();
    expect(addErrorLog).not.toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith(
      "info",
      "Archive binary download failed: canceled by the caller",
      expect.objectContaining({ requestUrl: expect.stringContaining("/leet/search/bin/2725466672/39/1") }),
    );
  });

  it("logs a search replaced by a newer one at info, not as an error", async () => {
    const controller = new AbortController();
    const client = createArchiveClient(buildDefaultArchiveClientConfig(), neverAnswers);

    const search = client.search({ name: "elite" }, { signal: controller.signal });
    controller.abort();

    await expect(search).rejects.toThrow();
    expect(addErrorLog).not.toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith(
      "info",
      "Archive request failed: canceled by the caller",
      expect.objectContaining({ operation: "search" }),
    );
  });

  it("still logs a download that failed on its own as an error", async () => {
    const client = createArchiveClient(buildDefaultArchiveClientConfig(), async () => {
      throw new Error("Failed to connect");
    });

    await expect(client.downloadBinary("2725466672", 39, 1, "nosetrimmer.sid")).rejects.toThrow("Failed to connect");
    expect(addErrorLog).toHaveBeenCalledWith(
      "Archive binary download failed",
      expect.objectContaining({ requestUrl: expect.stringContaining("/leet/search/bin/") }),
    );
  });
});
