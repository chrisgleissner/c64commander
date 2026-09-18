/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { C64API, DrivesResponse } from "@/lib/c64api";
import { buildPlayPlan, executePlayPlan } from "@/lib/playback/playbackRouter";
import { loadFirstDiskPrgViaDma } from "@/lib/playback/diskFirstPrg";
import { mountDiskToDrive } from "@/lib/disks/diskMount";
import { enqueueKeyboardBufferInjection } from "@/lib/remoteInput/kernalFallbackInjector";
import { readFtpFile } from "@/lib/ftp/ftpClient";

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/c64api", () => ({
  getC64APIConfigSnapshot: vi.fn(() => ({ deviceHost: "c64u", password: "" })),
}));

vi.mock("@/lib/ftp/ftpClient", () => ({
  readFtpFile: vi.fn(),
}));

vi.mock("@/lib/ftp/ftpConfig", () => ({
  getStoredFtpPort: vi.fn(() => 21),
}));

vi.mock("@/lib/sourceNavigation/ftpSourceAdapter", () => ({
  normalizeFtpHost: vi.fn((host: string) => host),
}));

vi.mock("@/lib/tracing/actionTrace", () => ({
  getActiveAction: vi.fn(() => null),
}));

vi.mock("@/lib/tracing/traceSession", () => ({
  recordDeviceGuard: vi.fn(),
  recordTraceError: vi.fn(),
}));

vi.mock("@/lib/tracing/failureTaxonomy", () => ({
  classifyError: vi.fn(() => ({ category: "unknown", isExpected: false })),
}));

vi.mock("@/lib/disks/diskMount", () => ({
  mountDiskToDrive: vi.fn(async () => undefined),
  resolveLocalDiskBlob: vi.fn(),
}));

vi.mock("@/lib/playback/autostart", () => ({
  AUTOSTART_SEQUENCE: new Uint8Array([42]),
  buildAutostartSequence: vi.fn((busId = 8) => new Uint8Array([busId])),
  injectAutostart: vi.fn(async () => undefined),
}));

// HARD19-018: disk autostart now routes through the shared keyboard-buffer queue.
vi.mock("@/lib/remoteInput/kernalFallbackInjector", () => ({
  enqueueKeyboardBufferInjection: vi.fn(async () => undefined),
}));

vi.mock("@/lib/playback/diskFirstPrg", () => ({
  loadFirstDiskPrgViaDma: vi.fn(async () => undefined),
}));

describe("executePlayPlan disk autoplay drive configuration", () => {
  const originalBlobArrayBuffer = Blob.prototype.arrayBuffer;

  const createApi = (driveInfo: DrivesResponse["drives"][number]["a"], refreshedDriveInfo = driveInfo) => {
    return {
      getDrives: vi
        .fn()
        .mockResolvedValueOnce({ drives: [{ a: driveInfo }], errors: [] } satisfies DrivesResponse)
        .mockResolvedValue({ drives: [{ a: refreshedDriveInfo }], errors: [] } satisfies DrivesResponse),
      driveOn: vi.fn(async () => ({ errors: [] })),
      setDriveMode: vi.fn(async () => ({ errors: [] })),
      mountDriveUpload: vi.fn(async () => ({ errors: [] })),
      machineReset: vi.fn(async () => ({ errors: [] })),
      machineReboot: vi.fn(async () => ({ errors: [] })),
    } as unknown as C64API;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(() => {
    if (!Blob.prototype.arrayBuffer) {
      Object.defineProperty(Blob.prototype, "arrayBuffer", {
        configurable: true,
        value() {
          return new Response(this).arrayBuffer();
        },
      });
    }
  });

  afterAll(() => {
    if (originalBlobArrayBuffer) {
      Object.defineProperty(Blob.prototype, "arrayBuffer", {
        configurable: true,
        value: originalBlobArrayBuffer,
      });
      return;
    }

    delete (Blob.prototype as Blob & { arrayBuffer?: unknown }).arrayBuffer;
  });

  it("powers on Drive A and switches to 1541 before autoplaying a d64", async () => {
    // HARD19-022: seed an INCOMPATIBLE starting mode (a 1581 cannot read a d64),
    // so a switch is genuinely required. A 1571 would now be preserved (it reads
    // d64 natively) — that compatible-mode case is covered in the sibling
    // tests/unit/playbackRouter.test.ts.
    const api = createApi({ enabled: false, type: "1581" });

    await executePlayPlan(
      api,
      buildPlayPlan({
        source: "local",
        path: "/games/demo.d64",
        file: new Blob([Uint8Array.from([1, 2, 3])]),
      }),
      { resetBeforeMount: false, diskAutostartMode: "dma" },
    );

    expect(api.driveOn).toHaveBeenCalledWith("a");
    expect(api.setDriveMode).toHaveBeenCalledWith("a", "1541");
    expect(vi.mocked(mountDiskToDrive)).toHaveBeenCalledWith(
      api,
      "a",
      expect.objectContaining({ path: "/games/demo.d64", location: "local" }),
      expect.anything(),
      expect.objectContaining({ writeBack: expect.anything() }),
    );
    expect(loadFirstDiskPrgViaDma).toHaveBeenCalled();
    expect(api.driveOn.mock.invocationCallOrder[0]).toBeLessThan(api.setDriveMode.mock.invocationCallOrder[0]);
    expect(api.setDriveMode.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(mountDiskToDrive).mock.invocationCallOrder[0],
    );
  });

  it("switches Drive A to 1571 before autoplaying a d71", async () => {
    const api = createApi({ enabled: true, type: "1541" });

    await executePlayPlan(
      api,
      buildPlayPlan({
        source: "local",
        path: "/games/demo.d71",
        file: new Blob([Uint8Array.from([1, 2, 3])]),
      }),
      { resetBeforeMount: false, diskAutostartMode: "dma" },
    );

    expect(api.driveOn).not.toHaveBeenCalled();
    expect(api.setDriveMode).toHaveBeenCalledWith("a", "1571");
    expect(vi.mocked(mountDiskToDrive)).toHaveBeenCalledWith(
      api,
      "a",
      expect.objectContaining({ path: "/games/demo.d71", location: "local" }),
      expect.anything(),
      expect.objectContaining({ writeBack: expect.anything() }),
    );
  });

  it("switches Drive A to 1581 before autoplaying a d81", async () => {
    const api = createApi({ enabled: true, type: "1541" });

    await executePlayPlan(
      api,
      buildPlayPlan({
        source: "local",
        path: "/games/demo.d81",
        file: new Blob([Uint8Array.from([1, 2, 3])]),
      }),
      { resetBeforeMount: false, diskAutostartMode: "dma" },
    );

    expect(api.setDriveMode).toHaveBeenCalledWith("a", "1581");
    expect(vi.mocked(mountDiskToDrive)).toHaveBeenCalledWith(
      api,
      "a",
      expect.objectContaining({ path: "/games/demo.d81", location: "local" }),
      expect.anything(),
      expect.objectContaining({ writeBack: expect.anything() }),
    );
  });

  it("skips drive power and mode changes when Drive A is already ready", async () => {
    const api = createApi({ enabled: true, type: "1541" });

    await executePlayPlan(
      api,
      buildPlayPlan({
        source: "local",
        path: "/games/demo.d64",
        file: new Blob([Uint8Array.from([1, 2, 3])]),
      }),
      { resetBeforeMount: false, diskAutostartMode: "dma" },
    );

    expect(api.driveOn).not.toHaveBeenCalled();
    expect(api.setDriveMode).not.toHaveBeenCalled();
    expect(vi.mocked(mountDiskToDrive)).toHaveBeenCalledWith(
      api,
      "a",
      expect.objectContaining({ path: "/games/demo.d64", location: "local" }),
      expect.anything(),
      expect.objectContaining({ writeBack: expect.anything() }),
    );
  });

  it("uses refreshed drive bus metadata after changing the drive mode", async () => {
    const api = createApi({ enabled: true, type: "1541", bus_id: 8 }, { enabled: true, type: "1571", bus_id: 9 });

    await executePlayPlan(
      api,
      buildPlayPlan({
        source: "local",
        path: "/games/demo.d71",
        file: new Blob([Uint8Array.from([1, 2, 3])]),
      }),
      { resetBeforeMount: false, diskAutostartMode: "inject" },
    );

    expect(api.setDriveMode).toHaveBeenCalledWith("a", "1571");
    expect(api.getDrives).toHaveBeenCalledTimes(2);
    expect(enqueueKeyboardBufferInjection).toHaveBeenCalledWith(api, new Uint8Array([9]), {
      pollIntervalMs: 140,
      maxAttempts: 20,
    });
  });

  it("runs beforeLaunch after disk reboot and mount but before autostart", async () => {
    vi.useFakeTimers();
    const api = createApi({ enabled: true, type: "1541", bus_id: 8 });
    const beforeLaunch = vi.fn(async () => undefined);

    const task = executePlayPlan(
      api,
      buildPlayPlan({
        source: "local",
        path: "/games/demo.d64",
        file: new Blob([Uint8Array.from([1, 2, 3])]),
      }),
      {
        rebootBeforeMount: true,
        diskAutostartMode: "inject",
        beforeLaunch,
      },
    );

    await vi.runAllTimersAsync();
    await task;

    expect(api.machineReboot).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mountDiskToDrive)).toHaveBeenCalledTimes(1);
    expect(beforeLaunch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(enqueueKeyboardBufferInjection)).toHaveBeenCalledTimes(1);
    expect(api.machineReboot.mock.invocationCallOrder[0]).toBeLessThan(beforeLaunch.mock.invocationCallOrder[0]);
    expect(vi.mocked(mountDiskToDrive).mock.invocationCallOrder[0]).toBeLessThan(
      beforeLaunch.mock.invocationCallOrder[0],
    );
    expect(beforeLaunch.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(enqueueKeyboardBufferInjection).mock.invocationCallOrder[0],
    );

    vi.useRealTimers();
  });
});

/*
 * `runners:run_prg` makes the firmware load the program's own `.cfg` (or `.usr`) AFTER the app has
 * applied its settings, so on that endpoint the firmware has the last word — measured on a C64
 * Ultimate running firmware 1.2RC. Uploading the bytes runs the program from a temporary file with
 * no settings file beside it, which is how an edited or declined choice survives the launch.
 */
describe("launching a program whose settings the firmware would reload", () => {
  const createPrgApi = () =>
    ({
      runPrg: vi.fn(async () => ({ errors: [] })),
      loadPrg: vi.fn(async () => ({ errors: [] })),
      runPrgUpload: vi.fn(async () => ({ errors: [] })),
      loadPrgUpload: vi.fn(async () => ({ errors: [] })),
    }) as unknown as C64API;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFtpFile).mockResolvedValue({ data: btoa("\x01\x08"), sizeBytes: 2 } as never);
  });

  it("names the path when the app is applying what the firmware would apply anyway", async () => {
    const api = createPrgApi();
    const plan = buildPlayPlan({ source: "ultimate", path: "/Usb0/Games/Game.prg" }, false);
    await executePlayPlan(api, plan);

    expect(vi.mocked(api.runPrg)).toHaveBeenCalledWith("/Usb0/Games/Game.prg");
    expect(vi.mocked(api.runPrgUpload)).not.toHaveBeenCalled();
    expect(vi.mocked(readFtpFile)).not.toHaveBeenCalled();
  });

  it("uploads the bytes when the firmware would otherwise reload the settings file", async () => {
    const api = createPrgApi();
    const plan = buildPlayPlan({ source: "ultimate", path: "/Usb0/Games/Game.prg" }, true);
    await executePlayPlan(api, plan);

    expect(vi.mocked(api.runPrg)).not.toHaveBeenCalled();
    expect(vi.mocked(api.runPrgUpload)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.runPrgUpload).mock.calls[0][1]).toEqual({ filename: "/Usb0/Games/Game.prg" });
  });

  it("uses the same upload for a load that does not run", async () => {
    const api = createPrgApi();
    const plan = buildPlayPlan({ source: "ultimate", path: "/Usb0/Games/Game.prg" }, true);
    await executePlayPlan(api, plan, { loadMode: "load" });

    expect(vi.mocked(api.loadPrgUpload)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.loadPrg)).not.toHaveBeenCalled();
  });

  /* A device that will not hand the bytes back still has to start the program. */
  it("falls back to the path launch when the file cannot be read back", async () => {
    const api = createPrgApi();
    vi.mocked(readFtpFile).mockRejectedValue(new Error("530 Not logged in"));
    const plan = buildPlayPlan({ source: "ultimate", path: "/Usb0/Games/Game.prg" }, true);
    await executePlayPlan(api, plan);

    expect(vi.mocked(api.runPrg)).toHaveBeenCalledWith("/Usb0/Games/Game.prg");
    expect(vi.mocked(api.runPrgUpload)).not.toHaveBeenCalled();
  });
});
