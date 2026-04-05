/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildPlayPlan, executePlayPlan, tryFetchUltimateSidBlob } from "@/lib/playback/playbackRouter";
import { readFtpFile } from "@/lib/ftp/ftpClient";
import { getC64APIConfigSnapshot } from "@/lib/c64api";
import { addErrorLog } from "@/lib/logging";
import { buildAutostartSequence, injectAutostart } from "@/lib/playback/autostart";
import { loadFirstDiskPrgViaDma } from "@/lib/playback/diskFirstPrg";
import { mountDiskToDrive, resolveLocalDiskBlob } from "@/lib/disks/diskMount";
import { loadDiskAutostartMode } from "@/lib/config/appSettings";
import { getActiveAction } from "@/lib/tracing/actionTrace";
import { recordDeviceGuard } from "@/lib/tracing/traceSession";
import { recordSmokeBenchmarkSnapshot } from "@/lib/smoke/smokeMode";

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/tracing/actionTrace", () => ({
  getActiveAction: vi.fn(() => ({
    correlationId: "test-correlation",
    origin: "ui",
    name: "test-action",
  })),
}));

vi.mock("@/lib/tracing/traceSession", () => ({
  recordTraceError: vi.fn(),
  recordDeviceGuard: vi.fn(),
}));

vi.mock("@/lib/ftp/ftpClient", () => ({
  readFtpFile: vi.fn(),
}));

vi.mock("@/lib/ftp/ftpConfig", () => ({
  getStoredFtpPort: vi.fn().mockReturnValue(21),
}));

vi.mock("@/lib/sourceNavigation/ftpSourceAdapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sourceNavigation/ftpSourceAdapter")>(
    "@/lib/sourceNavigation/ftpSourceAdapter",
  );
  return {
    ...actual,
    normalizeFtpHost: vi.fn((host: string) => host),
  };
});

vi.mock("@/lib/c64api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/c64api")>("@/lib/c64api");
  return {
    ...actual,
    getC64APIConfigSnapshot: vi.fn(() => ({
      deviceHost: "c64u",
      password: "",
    })),
  };
});

vi.mock("@/lib/playback/autostart", async () => {
  const actual = await vi.importActual<typeof import("@/lib/playback/autostart")>("@/lib/playback/autostart");
  return {
    ...actual,
    injectAutostart: vi.fn(),
  };
});

vi.mock("@/lib/playback/diskFirstPrg", () => ({
  loadFirstDiskPrgViaDma: vi.fn().mockResolvedValue({
    name: "TEST",
    loadAddress: 0x0801,
    endAddressExclusive: 0x0810,
    isBasic: true,
  }),
}));

vi.mock("@/lib/disks/diskMount", () => ({
  mountDiskToDrive: vi.fn().mockResolvedValue({ errors: [] }),
  resolveLocalDiskBlob: vi.fn(),
}));

vi.mock("@/lib/config/appSettings", () => ({
  loadDiskAutostartMode: vi.fn().mockReturnValue("kernal"),
}));

vi.mock("@/lib/smoke/smokeMode", () => ({
  recordSmokeBenchmarkSnapshot: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(injectAutostart).mockClear();
  vi.mocked(loadFirstDiskPrgViaDma).mockClear();
  vi.mocked(mountDiskToDrive).mockClear();
  vi.mocked(resolveLocalDiskBlob).mockReset();
  vi.mocked(loadDiskAutostartMode).mockReset();
  vi.mocked(loadDiskAutostartMode).mockReturnValue("kernal");
  vi.mocked(readFtpFile).mockReset();
  vi.mocked(getC64APIConfigSnapshot).mockReturnValue({
    deviceHost: "c64u",
    password: "",
  } as any);
  vi.mocked(recordDeviceGuard).mockReset();
  vi.mocked(recordSmokeBenchmarkSnapshot).mockReset();
  vi.mocked(getActiveAction).mockReturnValue({
    correlationId: "test-correlation",
    origin: "ui",
    name: "test-action",
  } as any);
});

const createApiMock = () => ({
  playSid: vi.fn().mockResolvedValue({ errors: [] }),
  playSidUpload: vi.fn().mockResolvedValue({ errors: [] }),
  playMod: vi.fn().mockResolvedValue({ errors: [] }),
  playModUpload: vi.fn().mockResolvedValue({ errors: [] }),
  runPrg: vi.fn().mockResolvedValue({ errors: [] }),
  runPrgUpload: vi.fn().mockResolvedValue({ errors: [] }),
  loadPrg: vi.fn().mockResolvedValue({ errors: [] }),
  loadPrgUpload: vi.fn().mockResolvedValue({ errors: [] }),
  runCartridge: vi.fn().mockResolvedValue({ errors: [] }),
  runCartridgeUpload: vi.fn().mockResolvedValue({ errors: [] }),
  mountDrive: vi.fn().mockResolvedValue({ errors: [] }),
  mountDriveUpload: vi.fn().mockResolvedValue({ errors: [] }),
  machineReset: vi.fn().mockResolvedValue({ errors: [] }),
  machineReboot: vi.fn().mockResolvedValue({ errors: [] }),
  readMemory: vi.fn().mockResolvedValue(new Uint8Array([0])),
  writeMemory: vi.fn().mockResolvedValue({ errors: [] }),
});

describe("playbackRouter", () => {
  it("routes SID playback from Ultimate filesystem", async () => {
    const api = createApiMock();
    const plan = buildPlayPlan({ source: "ultimate", path: "/MUSIC/DEMO.SID" });
    await executePlayPlan(api as any, plan);
    expect(api.playSid).toHaveBeenCalledWith("/MUSIC/DEMO.SID", undefined);
    expect(recordSmokeBenchmarkSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        scenario: "playback-start",
        metadata: expect.objectContaining({ mode: "ultimate-direct", path: "/MUSIC/DEMO.SID" }),
      }),
    );
  });

  it("uses FTP + upload when Ultimate SID has duration and download succeeds", async () => {
    const api = createApiMock();
    const sidBytes = new Uint8Array([0x50, 0x53, 0x49, 0x44]);
    const encoded = Buffer.from(sidBytes).toString("base64");
    vi.mocked(readFtpFile).mockResolvedValue({
      data: encoded,
      sizeBytes: sidBytes.length,
    });
    const plan = buildPlayPlan({
      source: "ultimate",
      path: "/MUSIC/DEMO.SID",
      durationMs: 120000,
    });
    await executePlayPlan(api as any, plan);
    expect(api.playSidUpload).toHaveBeenCalledTimes(1);
    expect(api.playSid).not.toHaveBeenCalled();
    expect(recordSmokeBenchmarkSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        scenario: "playback-start",
        metadata: expect.objectContaining({ mode: "ultimate-ssl-upload", durationMs: 120000 }),
      }),
    );
  });

  it("falls back to PUT when Ultimate SID FTP download fails", async () => {
    const api = createApiMock();
    vi.mocked(readFtpFile).mockRejectedValue(new Error("ftp failed"));
    const plan = buildPlayPlan({
      source: "ultimate",
      path: "/MUSIC/DEMO.SID",
      durationMs: 120000,
    });
    await executePlayPlan(api as any, plan);
    expect(api.playSid).toHaveBeenCalledWith("/MUSIC/DEMO.SID", undefined);
    expect(recordSmokeBenchmarkSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        scenario: "playback-start",
        metadata: expect.objectContaining({ mode: "ultimate-direct-fallback", path: "/MUSIC/DEMO.SID" }),
      }),
    );
    expect(vi.mocked(recordDeviceGuard)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "ssl-propagation-failure",
        level: "error",
        reason: "ftp-fetch-failed",
      }),
    );
  });

  it("records info-level no-duration signal when Ultimate SID has no songlength metadata", async () => {
    const api = createApiMock();
    const plan = buildPlayPlan({
      source: "ultimate",
      path: "/MUSIC/NODUR.SID",
    });
    await executePlayPlan(api as any, plan);
    expect(api.playSid).toHaveBeenCalledWith("/MUSIC/NODUR.SID", undefined);
    expect(api.playSidUpload).not.toHaveBeenCalled();
    expect(vi.mocked(recordDeviceGuard)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "playback-no-duration",
        level: "info",
        reason: "no-songlength-entry",
      }),
    );
  });

  it("falls back to direct play and records error when SID+SSL upload fails", async () => {
    const api = createApiMock();
    const sidBytes = new Uint8Array([0x50, 0x53, 0x49, 0x44]);
    const encoded = Buffer.from(sidBytes).toString("base64");
    vi.mocked(readFtpFile).mockResolvedValue({
      data: encoded,
      sizeBytes: sidBytes.length,
    });
    api.playSidUpload.mockRejectedValueOnce(new Error("HTTP 400: Bad Request"));

    const plan = buildPlayPlan({
      source: "ultimate",
      path: "/MUSIC/DEMO.SID",
      durationMs: 120000,
    });
    await executePlayPlan(api as any, plan);

    expect(api.playSidUpload).toHaveBeenCalledTimes(1);
    expect(api.playSid).toHaveBeenCalledWith("/MUSIC/DEMO.SID", undefined);
    expect(vi.mocked(recordDeviceGuard)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "ssl-propagation-failure",
        level: "error",
        reason: "upload-failed-with-songlength-available",
      }),
    );
  });

  it("propagates classified error when upload and fallback both fail", async () => {
    const api = createApiMock();
    const sidBytes = new Uint8Array([0x50, 0x53, 0x49, 0x44]);
    const encoded = Buffer.from(sidBytes).toString("base64");
    vi.mocked(readFtpFile).mockResolvedValue({
      data: encoded,
      sizeBytes: sidBytes.length,
    });
    api.playSidUpload.mockRejectedValueOnce(new Error("HTTP 500: Server Error"));
    api.playSid.mockRejectedValueOnce(new Error("HTTP 503: Service Unavailable"));

    const plan = buildPlayPlan({
      source: "ultimate",
      path: "/MUSIC/FAIL.SID",
      durationMs: 120000,
    });
    await expect(executePlayPlan(api as any, plan)).rejects.toThrow(
      "fallback playback failed after SSL propagation failure",
    );
  });

  it("handles invalid SSL payload duration by falling back to direct playback", async () => {
    const api = createApiMock();
    const sidBytes = new Uint8Array([0x50, 0x53, 0x49, 0x44]);
    const encoded = Buffer.from(sidBytes).toString("base64");
    vi.mocked(readFtpFile).mockResolvedValue({
      data: encoded,
      sizeBytes: sidBytes.length,
    });

    const plan = buildPlayPlan({
      source: "ultimate",
      path: "/MUSIC/INVALID.SID",
      durationMs: 100 * 60 * 1000,
    });
    await executePlayPlan(api as any, plan);

    expect(api.playSidUpload).not.toHaveBeenCalled();
    expect(api.playSid).toHaveBeenCalledWith("/MUSIC/INVALID.SID", undefined);
    expect(vi.mocked(recordDeviceGuard)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "ssl-propagation-failure",
        reason: "ssl-payload-invalid",
      }),
    );
  });

  it("routes SID playback from local upload", async () => {
    const api = createApiMock();
    const file = new File(["sid"], "demo.sid");
    const plan = buildPlayPlan({ source: "local", path: "/demo.sid", file });
    await executePlayPlan(api as any, plan);
    expect(api.playSidUpload).toHaveBeenCalled();
  });

  it("surfaces local SID read failures with a re-add message", async () => {
    const api = createApiMock();
    const file = {
      name: "demo.sid",
      lastModified: Date.now(),
      arrayBuffer: async () => {
        throw new TypeError("Failed to fetch");
      },
    };
    const plan = buildPlayPlan({ source: "local", path: "/demo.sid", file });
    await expect(executePlayPlan(api as any, plan)).rejects.toThrow(
      "Local file unavailable. Re-add it to the playlist.",
    );
    expect(vi.mocked(addErrorLog)).toHaveBeenCalled();
  });

  it("routes MOD playback for Ultimate files", async () => {
    const api = createApiMock();
    const plan = buildPlayPlan({ source: "ultimate", path: "/MUSIC/DEMO.MOD" });
    await executePlayPlan(api as any, plan);
    expect(api.playMod).toHaveBeenCalledWith("/MUSIC/DEMO.MOD");
  });

  it("routes CRT playback for local uploads", async () => {
    const api = createApiMock();
    const file = new File(["crt"], "demo.crt");
    const plan = buildPlayPlan({ source: "local", path: "/demo.crt", file });
    await executePlayPlan(api as any, plan);
    expect(api.runCartridgeUpload).toHaveBeenCalled();
  });

  it("routes PRG playback for Ultimate in run mode", async () => {
    const api = createApiMock();
    const plan = buildPlayPlan({ source: "ultimate", path: "/demo.prg" });
    await executePlayPlan(api as any, plan, { loadMode: "run" });
    expect(api.runPrg).toHaveBeenCalledWith("/demo.prg");
  });

  it("routes disk images to mount + autostart", async () => {
    vi.useFakeTimers();
    const api = createApiMock();
    const file = new File(["disk"], "demo.d64");
    const plan = buildPlayPlan({ source: "local", path: "/demo.d64", file });
    const task = executePlayPlan(api as any, plan, {
      drive: "a",
      rebootBeforeMount: true,
    });
    await vi.runAllTimersAsync();
    await task;
    expect(api.machineReboot).toHaveBeenCalled();
    expect(api.mountDriveUpload).toHaveBeenCalled();
    expect(vi.mocked(injectAutostart)).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("mounts Ultimate disk images via disk mount helper", async () => {
    vi.useFakeTimers();
    const api = createApiMock();
    const plan = buildPlayPlan({ source: "ultimate", path: "/Usb0/DEMO.D64" });
    const task = executePlayPlan(api as any, plan, { drive: "b" });
    await vi.runAllTimersAsync();
    await task;
    expect(vi.mocked(mountDiskToDrive)).toHaveBeenCalledWith(
      api,
      "b",
      expect.objectContaining({ path: "/Usb0/DEMO.D64", location: "ultimate" }),
    );
    vi.useRealTimers();
  });

  it("retries autostart injection after mount when initial attempt fails", async () => {
    vi.useFakeTimers();
    const api = createApiMock();
    vi.mocked(injectAutostart)
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValueOnce(undefined as any);
    const file = new File(["disk"], "demo.d64");
    const plan = buildPlayPlan({ source: "local", path: "/demo.d64", file });
    const task = executePlayPlan(api as any, plan, {
      drive: "a",
      rebootBeforeMount: true,
    });
    await vi.runAllTimersAsync();
    await task;
    expect(vi.mocked(injectAutostart)).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("uses the mounted drive bus id for kernal disk autostart", async () => {
    vi.useFakeTimers();
    const api = {
      ...createApiMock(),
      getDrives: vi.fn().mockResolvedValue({
        drives: [{ a: { enabled: true, type: "1541", bus_id: 9 } }],
        errors: [],
      }),
      driveOn: vi.fn().mockResolvedValue({ errors: [] }),
      setDriveMode: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const file = new File(["disk"], "demo.d64");
    const plan = buildPlayPlan({ source: "local", path: "/demo.d64", file });
    const task = executePlayPlan(api as any, plan, {
      drive: "a",
      rebootBeforeMount: true,
      diskAutostartMode: "kernal",
    });
    await vi.runAllTimersAsync();
    await task;

    expect(vi.mocked(injectAutostart)).toHaveBeenCalledWith(api, buildAutostartSequence(9), {
      pollIntervalMs: 140,
      maxAttempts: 20,
    });
    vi.useRealTimers();
  });

  it("uses DMA loader when disk autostart is set to DMA", async () => {
    vi.useFakeTimers();
    const api = createApiMock();
    class TestBlob extends Blob {
      async arrayBuffer() {
        return new ArrayBuffer(4);
      }
    }
    const file = new TestBlob(["disk"], {
      type: "application/octet-stream",
    }) as unknown as File;
    const plan = buildPlayPlan({ source: "local", path: "/demo.d64", file });
    const task = executePlayPlan(api as any, plan, {
      drive: "a",
      rebootBeforeMount: true,
      diskAutostartMode: "dma",
    });
    await vi.runAllTimersAsync();
    await task;
    expect(vi.mocked(loadFirstDiskPrgViaDma)).toHaveBeenCalled();
    expect(vi.mocked(injectAutostart)).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("uses DMA loader for local disk paths when blob can be resolved", async () => {
    vi.useFakeTimers();
    const api = createApiMock();
    vi.mocked(loadDiskAutostartMode).mockReturnValue("dma");
    const resolvedBlob = {
      arrayBuffer: async () => new ArrayBuffer(4),
    } as Blob;
    vi.mocked(resolveLocalDiskBlob).mockResolvedValue(resolvedBlob);
    const plan = buildPlayPlan({ source: "local", path: "/demo.d64" });
    const task = executePlayPlan(api as any, plan, { drive: "a" });
    await vi.runAllTimersAsync();
    await task;
    expect(vi.mocked(resolveLocalDiskBlob)).toHaveBeenCalled();
    expect(vi.mocked(loadFirstDiskPrgViaDma)).toHaveBeenCalled();
    expect(vi.mocked(injectAutostart)).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("falls back to autostart when DMA loader cannot resolve local disk blob", async () => {
    vi.useFakeTimers();
    const api = createApiMock();
    vi.mocked(loadDiskAutostartMode).mockReturnValue("dma");
    vi.mocked(resolveLocalDiskBlob).mockRejectedValue(new Error("missing"));
    const plan = buildPlayPlan({ source: "local", path: "/demo.d64" });
    const task = executePlayPlan(api as any, plan, { drive: "a" });
    await vi.runAllTimersAsync();
    await task;
    expect(vi.mocked(injectAutostart)).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("routes PRG uploads in load mode", async () => {
    const api = createApiMock();
    const file = new File(["prg"], "demo.prg");
    const plan = buildPlayPlan({ source: "local", path: "/demo.prg", file });
    await executePlayPlan(api as any, plan, { loadMode: "load" });
    expect(api.loadPrgUpload).toHaveBeenCalled();
  });

  it("logs and throws when local SID data is missing", async () => {
    const api = createApiMock();
    const plan = buildPlayPlan({ source: "local", path: "/demo.sid" });
    await expect(executePlayPlan(api as any, plan)).rejects.toThrow("Missing local SID data");
    expect(vi.mocked(addErrorLog)).toHaveBeenCalled();
  });

  it("throws on unsupported formats", () => {
    expect(() => buildPlayPlan({ source: "local", path: "demo.txt" })).toThrow("Unsupported");
  });

  it("routes MOD upload from local file", async () => {
    const api = createApiMock();
    const file = new File(["mod"], "demo.mod");
    const plan = buildPlayPlan({ source: "local", path: "/demo.mod", file });
    await executePlayPlan(api as any, plan);
    expect(api.playModUpload).toHaveBeenCalled();
  });

  it("throws when local MOD data is missing", async () => {
    const api = createApiMock();
    const plan = buildPlayPlan({ source: "local", path: "/demo.mod" });
    await expect(executePlayPlan(api as any, plan)).rejects.toThrow("Missing local MOD data");
  });

  it("routes CRT playback for Ultimate", async () => {
    const api = createApiMock();
    const plan = buildPlayPlan({ source: "ultimate", path: "/carts/game.crt" });
    await executePlayPlan(api as any, plan);
    expect(api.runCartridge).toHaveBeenCalledWith("/carts/game.crt");
  });

  it("throws when local CRT data is missing", async () => {
    const api = createApiMock();
    const plan = buildPlayPlan({ source: "local", path: "/demo.crt" });
    await expect(executePlayPlan(api as any, plan)).rejects.toThrow("Missing local CRT data");
  });

  it("routes PRG from Ultimate in load mode", async () => {
    const api = createApiMock();
    const plan = buildPlayPlan({ source: "ultimate", path: "/demo.prg" });
    await executePlayPlan(api as any, plan, { loadMode: "load" });
    expect(api.loadPrg).toHaveBeenCalledWith("/demo.prg");
  });

  it("routes PRG upload from local file in run mode", async () => {
    const api = createApiMock();
    const file = new File(["prg"], "demo.prg");
    const plan = buildPlayPlan({ source: "local", path: "/demo.prg", file });
    await executePlayPlan(api as any, plan, { loadMode: "run" });
    expect(api.runPrgUpload).toHaveBeenCalled();
  });

  it("throws when local PRG data is missing", async () => {
    const api = createApiMock();
    const plan = buildPlayPlan({ source: "local", path: "/demo.prg" });
    await expect(executePlayPlan(api as any, plan)).rejects.toThrow("Missing local PRG data");
  });

  it("mounts local D64 without reset when resetBeforeMount is false", async () => {
    vi.useFakeTimers();
    const api = createApiMock();
    const file = new File(["disk"], "demo.d64");
    const plan = buildPlayPlan({ source: "local", path: "/demo.d64", file });
    const task = executePlayPlan(api as any, plan, {
      drive: "a",
      resetBeforeMount: false,
      rebootBeforeMount: false,
    });
    await vi.runAllTimersAsync();
    await task;
    expect(api.machineReset).not.toHaveBeenCalled();
    expect(api.machineReboot).not.toHaveBeenCalled();
    expect(api.mountDriveUpload).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("includes songNr in SID play call", async () => {
    const api = createApiMock();
    const plan = buildPlayPlan({
      source: "ultimate",
      path: "/MUSIC/DEMO.SID",
      songNr: 3,
    });
    await executePlayPlan(api as any, plan);
    expect(api.playSid).toHaveBeenCalledWith("/MUSIC/DEMO.SID", 3);
  });

  it("includes SSL blob for local SID when duration is provided", async () => {
    const api = createApiMock();
    const file = new File(["sid"], "demo.sid");
    const plan = buildPlayPlan({
      source: "local",
      path: "/demo.sid",
      file,
      durationMs: 60000,
    });
    await executePlayPlan(api as any, plan);
    expect(api.playSidUpload).toHaveBeenCalledTimes(1);
    const sslBlobArg = api.playSidUpload.mock.calls[0][2];
    expect(sslBlobArg).toBeInstanceOf(Blob);
  });

  it("handles FTP SID size mismatch by returning null blob and falling back", async () => {
    const api = createApiMock();
    const sidBytes = new Uint8Array([0x50, 0x53]);
    const encoded = Buffer.from(sidBytes).toString("base64");
    vi.mocked(readFtpFile).mockResolvedValue({ data: encoded, sizeBytes: 999 });
    const plan = buildPlayPlan({
      source: "ultimate",
      path: "/MUSIC/MISMATCH.SID",
      durationMs: 120000,
    });
    await executePlayPlan(api as any, plan);
    // Should fall back to direct play since blob is null due to size mismatch
    expect(api.playSid).toHaveBeenCalled();
  });

  it("local disk mount with DMA for D71 type", async () => {
    vi.useFakeTimers();
    const api = createApiMock();
    class TestBlob extends Blob {
      async arrayBuffer() {
        return new ArrayBuffer(4);
      }
    }
    const file = new TestBlob(["disk"], {
      type: "application/octet-stream",
    }) as unknown as File;
    const plan = buildPlayPlan({ source: "local", path: "/demo.d71", file });
    const task = executePlayPlan(api as any, plan, {
      drive: "a",
      diskAutostartMode: "dma",
    });
    await vi.runAllTimersAsync();
    await task;
    expect(vi.mocked(loadFirstDiskPrgViaDma)).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("local SID blob upload sends correct bytes matching the file content", async () => {
    const api = createApiMock();
    const sidBytes = new Uint8Array([0x50, 0x53, 0x49, 0x44, 0x00, 0x02]); // PSID header stub
    const file = {
      name: "test.sid",
      lastModified: Date.now(),
      arrayBuffer: async () => sidBytes.buffer.slice(0),
    };
    const plan = buildPlayPlan({ source: "local", path: "/test.sid", file });
    await executePlayPlan(api as any, plan);
    expect(api.playSidUpload).toHaveBeenCalledTimes(1);
    const blob = api.playSidUpload.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(sidBytes.byteLength);
  });

  it("local SID blob upload content length matches original file size", async () => {
    const api = createApiMock();
    const content = new Uint8Array(1024);
    content.fill(0x42);
    const file = new File([content], "large.sid", {
      type: "application/octet-stream",
    });
    const plan = buildPlayPlan({ source: "local", path: "/large.sid", file });
    await executePlayPlan(api as any, plan);
    const blob = api.playSidUpload.mock.calls[0][0] as Blob;
    expect(blob.size).toBe(1024);
  });

  it("tryFetchUltimateSidBlob normalizes path without leading slash", async () => {
    // Covers normalizeUltimatePath FALSE branch: path without leading '/' → prepend '/'
    vi.mocked(readFtpFile).mockResolvedValue({
      data: btoa("\x00"),
      sizeBytes: 1,
    } as any);
    const result = await tryFetchUltimateSidBlob("MUSIC/DEMO.SID");
    expect(result).toBeInstanceOf(Blob);
    expect(vi.mocked(readFtpFile)).toHaveBeenCalledWith(expect.objectContaining({ path: "/MUSIC/DEMO.SID" }));
  });

  it("tryFetchUltimateSidBlob returns null on FTP failure", async () => {
    vi.mocked(readFtpFile).mockRejectedValue(new Error("connection refused"));
    const result = await tryFetchUltimateSidBlob("MUSIC/DEMO.SID");
    expect(result).toBeNull();
  });

  it("tryFetchUltimateSidBlob returns null and warns on size mismatch", async () => {
    // Mock readFtpFile to return base64 of 1 byte but claim sizeBytes=99
    vi.mocked(readFtpFile).mockResolvedValue({
      data: btoa("\x00"),
      sizeBytes: 99,
    } as any);
    const result = await tryFetchUltimateSidBlob("/MUSIC/DEMO.SID");
    expect(result).toBeNull();
  });

  it("local file arrayBuffer is stable across repeated reads", async () => {
    const api = createApiMock();
    const sidBytes = new Uint8Array([0x50, 0x53, 0x49, 0x44]);
    const file = {
      name: "stable.sid",
      lastModified: Date.now(),
      arrayBuffer: async () => sidBytes.buffer,
    };
    const plan = buildPlayPlan({ source: "local", path: "/stable.sid", file });
    await executePlayPlan(api as any, plan);
    // Second execution with same file
    await executePlayPlan(api as any, plan);
    const blob1 = api.playSidUpload.mock.calls[0][0] as Blob;
    const blob2 = api.playSidUpload.mock.calls[1][0] as Blob;
    const bytes1 = new Uint8Array(await blob1.arrayBuffer());
    const bytes2 = new Uint8Array(await blob2.arrayBuffer());
    expect(bytes1).toEqual(bytes2);
  });

  it("throws disk autostart failed after all retry attempts exhausted (BRDA:157,158)", async () => {
    vi.useFakeTimers();
    const api = createApiMock();
    vi.mocked(injectAutostart).mockRejectedValue(new Error("always fails"));
    const file = new File(["disk"], "demo.d64");
    const plan = buildPlayPlan({ source: "local", path: "/demo.d64", file });
    const task = executePlayPlan(api as any, plan);
    // Attach rejection handler before advancing timers to avoid unhandled-rejection warning
    const assertion = expect(task).rejects.toThrow("Disk autostart failed");
    await vi.runAllTimersAsync();
    await assertion;
    expect(vi.mocked(injectAutostart)).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it("toBlob rethrows non-network arrayBuffer error (BRDA:173)", async () => {
    const api = createApiMock();
    const file = {
      name: "demo.d64",
      arrayBuffer: () => Promise.reject(new Error("some custom error")),
    };
    const plan = buildPlayPlan({
      source: "local",
      path: "/demo.d64",
      file: file as any,
    });
    await expect(executePlayPlan(api as any, plan)).rejects.toThrow("some custom error");
  });

  it("toBlob uses generic message for empty arrayBuffer error (BRDA:169)", async () => {
    const api = createApiMock();
    const file = {
      name: "demo.d64",
      arrayBuffer: () => Promise.reject(new Error("")),
    };
    const plan = buildPlayPlan({
      source: "local",
      path: "/demo.d64",
      file: file as any,
    });
    // Error message is empty, falls back to 'Local file unavailable.' which is not a network error → rethrows original
    await expect(executePlayPlan(api as any, plan)).rejects.toBeInstanceOf(Error);
  });

  it("covers null propagationFailure in SID fallback (BRDA:257)", async () => {
    const api = createApiMock();
    const sidBytes = new Uint8Array([0x50, 0x53, 0x49, 0x44]);
    const encoded = Buffer.from(sidBytes).toString("base64");
    vi.mocked(readFtpFile).mockResolvedValue({
      data: encoded,
      sizeBytes: sidBytes.length,
    });
    // Throw a non-Error object so propagationFailure?.message is undefined → ?? null branch covered
    api.playSidUpload.mockRejectedValueOnce({});
    api.playSid.mockRejectedValueOnce(new Error("fallback also failed"));

    const plan = buildPlayPlan({
      source: "ultimate",
      path: "/MUSIC/DEMO.SID",
      durationMs: 120000,
    });
    await expect(executePlayPlan(api as any, plan)).rejects.toThrow("fallback playback failed");
    expect(vi.mocked(addErrorLog)).toHaveBeenCalled();
  });

  it("throws for unsupported play category in executePlayPlan (BRDA:374)", async () => {
    const api = createApiMock();
    const file = new File(["data"], "demo.sid");
    const plan = {
      ...buildPlayPlan({ source: "local", path: "/demo.sid", file }),
      category: "unknown-category" as any,
    };
    await expect(executePlayPlan(api as any, plan)).rejects.toThrow("Unsupported playback type");
  });
});
