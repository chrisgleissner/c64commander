import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchUltimateOriginBlob,
  getOriginDeviceUnavailableReason,
  isOriginOnSelectedDevice,
  OriginContentUnavailableError,
  type DeviceBoundContentOrigin,
} from "@/lib/savedDevices/deviceBoundOrigin";

const { mockReadFtpFile, mockListFtpDirectory, mockGetPasswordForDevice, storeState, connectionState } = vi.hoisted(
  () => ({
    mockReadFtpFile: vi.fn(),
    mockListFtpDirectory: vi.fn(),
    mockGetPasswordForDevice: vi.fn(async () => "secret"),
    storeState: {
      selectedDevice: null as Record<string, unknown> | null,
      devicesById: {} as Record<string, Record<string, unknown>>,
    },
    connectionState: { uniqueId: null as string | null, hostname: null as string | null },
  }),
);

vi.mock("@/lib/connection/connectedDeviceIdentity", () => ({
  getConnectedDeviceIdentity: () => ({ uniqueId: connectionState.uniqueId, hostname: connectionState.hostname }),
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
        lastKnownHostname: "ultimate-desk",
        lastKnownUniqueId: "UID-1",
      },
    };
  });

  describe("isOriginOnSelectedDevice", () => {
    beforeEach(() => {
      connectionState.uniqueId = null;
      connectionState.hostname = null;
    });

    // The same Ultimate saved a second time under its other network address, not yet stamped with an id.
    const secondAddressEntry = {
      id: "device-2",
      host: "198.51.100.20",
      ftpPort: 21,
      lastKnownHostname: null,
      lastKnownUniqueId: null,
    };

    it("treats a file from the same machine as local when the selected entry has no stored id yet", () => {
      storeState.selectedDevice = secondAddressEntry;
      connectionState.uniqueId = "UID-1";
      connectionState.hostname = "Ultimate-Desk";

      expect(isOriginOnSelectedDevice(origin)).toBe(true);
    });

    it("treats a file from the same machine as local when the selected entry stores the same id and hostname", () => {
      storeState.selectedDevice = {
        ...secondAddressEntry,
        lastKnownUniqueId: "UID-1",
        lastKnownHostname: "ultimate-desk",
      };

      expect(isOriginOnSelectedDevice(origin)).toBe(true);
    });

    // The unique id is user-configurable, so a different Ultimate can report the origin's id.
    it("keeps a file remote on a different device that shares the custom unique id but not the hostname", () => {
      storeState.selectedDevice = {
        ...secondAddressEntry,
        lastKnownUniqueId: "UID-1",
        lastKnownHostname: "ultimate-attic",
      };
      expect(isOriginOnSelectedDevice(origin)).toBe(false);

      storeState.selectedDevice = secondAddressEntry;
      connectionState.uniqueId = "UID-1";
      connectionState.hostname = "ultimate-attic";
      expect(isOriginOnSelectedDevice(origin)).toBe(false);
    });

    it("keeps a file remote when the connected device reports no hostname", () => {
      storeState.selectedDevice = secondAddressEntry;
      connectionState.uniqueId = "UID-1";

      expect(isOriginOnSelectedDevice(origin)).toBe(false);
    });

    it("keeps a file from another machine remote when the connected device reports a different id", () => {
      storeState.selectedDevice = secondAddressEntry;
      connectionState.uniqueId = "UID-9";
      connectionState.hostname = "ultimate-desk";

      expect(isOriginOnSelectedDevice(origin)).toBe(false);
    });

    it("prefers the stored id over the connected device's report", () => {
      storeState.selectedDevice = {
        ...secondAddressEntry,
        lastKnownUniqueId: "UID-2",
        lastKnownHostname: "ultimate-desk",
      };
      connectionState.uniqueId = "UID-1";
      connectionState.hostname = "ultimate-desk";

      expect(isOriginOnSelectedDevice(origin)).toBe(false);
    });
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
