/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { readFtpFile } = vi.hoisted(() => ({ readFtpFile: vi.fn() }));

vi.mock("@/lib/ftp/ftpClient", () => ({ readFtpFile }));
vi.mock("@/lib/ftp/ftpConfig", () => ({ getStoredFtpPort: () => 21 }));
vi.mock("@/lib/c64api", () => ({ getC64APIConfigSnapshot: () => ({ deviceHost: "u64", password: "" }) }));
vi.mock("@/lib/sourceNavigation/ftpSourceAdapter", () => ({ normalizeFtpHost: (host: string) => host }));

import {
  buildUltimateSonglengthsFile,
  SONGLENGTHS_IDLE_TIMEOUT_MS,
} from "@/pages/playFiles/handlers/ultimateSonglengthsFile";

const entry = { path: "/DOCUMENTS/Songlengths.md5", name: "Songlengths.md5", sizeBytes: 1024 };

describe("buildUltimateSonglengthsFile", () => {
  beforeEach(() => {
    readFtpFile.mockReset();
  });

  it("reports a read that the running add canceled as a cancel, whatever the native plugin calls it", async () => {
    const add = new AbortController();
    readFtpFile.mockImplementation(async () => {
      add.abort();
      throw new Error("FTP read aborted");
    });
    const file = buildUltimateSonglengthsFile(entry, () => add.signal, vi.fn());

    await expect(file.arrayBuffer()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("passes on any other failure of the read unchanged", async () => {
    const failure = new Error("FTP list failed: Timeout (control socket)");
    readFtpFile.mockRejectedValue(failure);
    const file = buildUltimateSonglengthsFile(entry, () => undefined, vi.fn());

    await expect(file.arrayBuffer()).rejects.toBe(failure);
    expect(readFtpFile).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: SONGLENGTHS_IDLE_TIMEOUT_MS }));
  });
});
