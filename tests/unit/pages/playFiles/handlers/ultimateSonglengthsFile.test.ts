/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { readFtpFile, api } = vi.hoisted(() => ({
  readFtpFile: vi.fn(),
  api: { host: "u64", password: "", port: 21, selected: "device-1" },
}));

vi.mock("@/lib/ftp/ftpClient", () => ({ readFtpFile }));
vi.mock("@/lib/ftp/ftpConfig", () => ({ getStoredFtpPort: () => api.port }));
vi.mock("@/lib/c64api", () => ({ getC64APIConfigSnapshot: () => ({ deviceHost: api.host, password: api.password }) }));
vi.mock("@/lib/savedDevices/store", () => ({ getSavedDevicesSnapshot: () => ({ selectedDeviceId: api.selected }) }));
vi.mock("@/lib/sourceNavigation/ftpSourceAdapter", () => ({ normalizeFtpHost: (host: string) => host }));

import {
  buildUltimateSonglengthsFile,
  SONGLENGTHS_IDLE_TIMEOUT_MS,
} from "@/pages/playFiles/handlers/ultimateSonglengthsFile";

const entry = { path: "/DOCUMENTS/Songlengths.md5", name: "Songlengths.md5", sizeBytes: 1024 };

describe("buildUltimateSonglengthsFile", () => {
  beforeEach(() => {
    readFtpFile.mockReset();
    api.host = "u64";
    api.password = "";
    api.port = 21;
    api.selected = "device-1";
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

  it("reads from the Ultimate it was found on, not the one selected when the read happens", async () => {
    readFtpFile.mockResolvedValue({ data: "QUJDRA==", sizeBytes: 4 });
    const file = buildUltimateSonglengthsFile(entry, () => undefined, vi.fn());
    api.host = "c64u";

    await file.arrayBuffer();

    expect(readFtpFile).toHaveBeenCalledWith(expect.objectContaining({ host: "u64" }));
  });

  it("gives up a stalled read after the idle timeout even while an add is running to cancel it", async () => {
    readFtpFile.mockResolvedValue({ data: "QUJDRA==", sizeBytes: 4 });
    const add = new AbortController();
    const file = buildUltimateSonglengthsFile(entry, () => add.signal, vi.fn());

    await file.arrayBuffer();

    expect(readFtpFile).toHaveBeenCalledWith(
      expect.objectContaining({ signal: add.signal, timeoutMs: SONGLENGTHS_IDLE_TIMEOUT_MS }),
    );
  });

  it("reads on the FTP port of the Ultimate it was found on, not the port of the device selected when the read happens", async () => {
    readFtpFile.mockResolvedValue({ data: "QUJDRA==", sizeBytes: 4 });
    api.port = 2121;
    const file = buildUltimateSonglengthsFile(entry, () => undefined, vi.fn());
    api.port = 21;
    api.selected = "device-2";

    await file.arrayBuffer();

    expect(readFtpFile).toHaveBeenCalledWith(expect.objectContaining({ port: 2121 }));
  });

  it("uses the password the device has now when the same device is still selected", async () => {
    readFtpFile.mockResolvedValue({ data: "QUJDRA==", sizeBytes: 4 });
    api.password = "old";
    const file = buildUltimateSonglengthsFile(entry, () => undefined, vi.fn());
    api.password = "new";

    await file.arrayBuffer();

    expect(readFtpFile).toHaveBeenCalledWith(expect.objectContaining({ password: "new" }));
  });

  it("keeps the password it was found with when another device is selected at the read", async () => {
    readFtpFile.mockResolvedValue({ data: "QUJDRA==", sizeBytes: 4 });
    api.password = "old";
    const file = buildUltimateSonglengthsFile(entry, () => undefined, vi.fn());
    api.password = "other-device";
    api.selected = "device-2";

    await file.arrayBuffer();

    expect(readFtpFile).toHaveBeenCalledWith(expect.objectContaining({ password: "old" }));
  });
});
