import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchUltimateOriginBlob,
  getOriginDeviceUnavailableReason,
  OriginContentUnavailableError,
  type DeviceBoundContentOrigin,
} from "@/lib/savedDevices/deviceBoundOrigin";

const { mockReadFtpFile, mockListFtpDirectory, mockGetPasswordForDevice, storeState } = vi.hoisted(() => ({
  mockReadFtpFile: vi.fn(),
  mockListFtpDirectory: vi.fn(),
  mockGetPasswordForDevice: vi.fn(async () => "secret"),
  storeState: {
    selectedDevice: null as Record<string, unknown> | null,
    devicesById: {} as Record<string, Record<string, unknown>>,
  },
}));

vi.mock("@/lib/ftp/ftpClient", () => ({
  readFtpFile: mockReadFtpFile,
  listFtpDirectory: mockListFtpDirectory,
}));

vi.mock("@/lib/secureStorage", () => ({
  getPasswordForDevice: mockGetPasswordForDevice,
}));

vi.mock("@/lib/sourceNavigation/ftpSourceAdapter", () => ({
  normalizeFtpHost: (host: string) => host.trim(),
}));

vi.mock("@/lib/savedDevices/store", () => ({
  getSavedDeviceById: (deviceId: string) => storeState.devicesById[deviceId] ?? null,
  getSelectedSavedDevice: () => storeState.selectedDevice,
}));

const origin: DeviceBoundContentOrigin = {
  sourceKind: "ultimate",
  originDeviceId: "device-1",
  originDeviceLastKnownUniqueId: "UID-1",
  originPath: "/Music/Test.sid",
  importedAt: "2026-04-10T10:00:00.000Z",
};

describe("deviceBoundOrigin", () => {
  beforeEach(() => {
    mockReadFtpFile.mockReset();
    mockListFtpDirectory.mockReset();
    mockGetPasswordForDevice.mockClear();
    storeState.selectedDevice = null;
    storeState.devicesById = {
      "device-1": {
        id: "device-1",
        host: "u64",
        ftpPort: 21,
        lastKnownUniqueId: "UID-1",
      },
    };
  });

  it("returns origin-device-removed when the saved origin device no longer exists", () => {
    storeState.devicesById = {};

    expect(getOriginDeviceUnavailableReason(origin)).toBe("origin-device-removed");
  });

  it("returns origin-device-mismatch when the saved device identity changed", () => {
    storeState.devicesById["device-1"] = {
      id: "device-1",
      host: "u64",
      ftpPort: 21,
      lastKnownUniqueId: "UID-2",
    };

    expect(getOriginDeviceUnavailableReason(origin)).toBe("origin-device-mismatch");
  });

  it("classifies FTP connectivity failures as origin-device-unreachable", async () => {
    mockReadFtpFile.mockRejectedValue(new Error("failed to fetch"));

    await expect(fetchUltimateOriginBlob(origin)).rejects.toMatchObject({
      name: "OriginContentUnavailableError",
      reason: "origin-device-unreachable",
    } satisfies Partial<OriginContentUnavailableError>);
  });

  it("classifies missing origin files after a parent directory probe", async () => {
    mockReadFtpFile.mockRejectedValue(new Error("FTP file read failed"));
    mockListFtpDirectory.mockResolvedValue({
      path: "/Music",
      entries: [{ type: "file", name: "Other.sid", path: "/Music/Other.sid" }],
    });

    await expect(fetchUltimateOriginBlob(origin)).rejects.toMatchObject({
      name: "OriginContentUnavailableError",
      reason: "origin-file-missing",
    } satisfies Partial<OriginContentUnavailableError>);
  });
});
