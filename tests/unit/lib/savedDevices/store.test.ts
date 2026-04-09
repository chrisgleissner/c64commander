/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadStore = async () => import("@/lib/savedDevices/store");

const seedLegacyStorage = () => {
  localStorage.setItem("c64u_device_host", "backup-c64:8080");
  localStorage.setItem("c64u_ftp_port", "2021");
  localStorage.setItem("c64u_telnet_port", "2323");
  localStorage.setItem("c64u_has_password", "1");
};

describe("savedDevices store", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T12:00:00.000Z"));
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("migrates legacy single-device storage into one selected saved device and keeps reloads idempotent", async () => {
    seedLegacyStorage();

    const store = await loadStore();
    const firstSnapshot = store.getSavedDevicesSnapshot();

    expect(firstSnapshot.devices).toHaveLength(1);
    expect(firstSnapshot.selectedDeviceId).toBe(firstSnapshot.devices[0]?.id);
    expect(firstSnapshot.devices[0]).toMatchObject({
      host: "backup-c64",
      httpPort: 8080,
      ftpPort: 2021,
      telnetPort: 2323,
      hasPassword: true,
    });

    const persistedAfterFirstLoad = localStorage.getItem(store.getSavedDevicesStorageKey());
    expect(persistedAfterFirstLoad).not.toBeNull();

    vi.resetModules();

    const reloadedStore = await loadStore();
    const secondSnapshot = reloadedStore.getSavedDevicesSnapshot();

    expect(secondSnapshot).toMatchObject({
      selectedDeviceId: firstSnapshot.selectedDeviceId,
      devices: [
        {
          host: "backup-c64",
          httpPort: 8080,
          ftpPort: 2021,
          telnetPort: 2323,
          hasPassword: true,
        },
      ],
    });
    expect(localStorage.getItem(reloadedStore.getSavedDevicesStorageKey())).toBe(persistedAfterFirstLoad);
  });

  it("derives unique short labels and rejects missing, duplicate, or oversized labels", async () => {
    const store = await loadStore();
    const officeDevice = {
      id: "device-office",
      nickname: "Living Room",
      shortLabel: null,
      host: "office-u64.local",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "U64" as const,
      lastKnownHostname: null,
      lastKnownUniqueId: null,
      lastSuccessfulConnectionAt: null,
      lastUsedAt: null,
      hasPassword: false,
    };
    const backupDevice = {
      id: "device-backup",
      nickname: "Living Rack",
      shortLabel: null,
      host: "backup-lab.local",
      httpPort: 8080,
      ftpPort: 2021,
      telnetPort: 2323,
      lastKnownProduct: "U64E" as const,
      lastKnownHostname: null,
      lastKnownUniqueId: null,
      lastSuccessfulConnectionAt: null,
      lastUsedAt: null,
      hasPassword: false,
    };

    const devicesWithExistingLabel = [
      { ...officeDevice, shortLabel: "Living" },
      { ...backupDevice, shortLabel: null },
    ];

    expect(store.deriveSavedDeviceShortLabel(officeDevice, [officeDevice, backupDevice])).toBe("Living");
    expect(store.deriveSavedDeviceShortLabel(backupDevice, devicesWithExistingLabel)).toBe("backupla");

    const devicesWithDuplicateLabel = [
      { ...officeDevice, shortLabel: "Office" },
      { ...backupDevice, shortLabel: null },
    ];

    expect(store.validateSavedDeviceShortLabel(devicesWithDuplicateLabel, backupDevice.id, "")).toBe(
      "Short label is required.",
    );
    expect(store.validateSavedDeviceShortLabel(devicesWithDuplicateLabel, backupDevice.id, "ABCDEFGHI")).toBe(
      "Short label must be 8 characters or fewer.",
    );
    expect(store.validateSavedDeviceShortLabel(devicesWithDuplicateLabel, backupDevice.id, "office")).toBe(
      "Short label must be unique.",
    );
    expect(store.validateSavedDeviceShortLabel(devicesWithDuplicateLabel, backupDevice.id, "Backup")).toBeNull();
  });

  it("persists the selected device across reloads and projects its connection settings", async () => {
    const store = await loadStore();
    const initialSnapshot = store.getSavedDevicesSnapshot();
    const initialDeviceId = initialSnapshot.selectedDeviceId;

    store.updateSavedDevice(initialDeviceId, {
      nickname: "Office U64",
      shortLabel: "Office",
      host: "c64u",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
    });
    store.addSavedDevice({
      id: "device-backup",
      nickname: "Backup Lab",
      shortLabel: "Backup",
      host: "backup-c64",
      httpPort: 8080,
      ftpPort: 2021,
      telnetPort: 2323,
      lastKnownProduct: "U64E",
      lastKnownHostname: "backup-lab",
      lastKnownUniqueId: "UID-BACKUP",
      hasPassword: true,
    });
    store.selectSavedDevice("device-backup");

    expect(store.getSelectedSavedDeviceConnection()).toMatchObject({
      deviceHost: "backup-c64:8080",
      host: "backup-c64",
      httpPort: 8080,
      ftpPort: 2021,
      telnetPort: 2323,
      hasPassword: true,
    });

    vi.resetModules();

    const reloadedStore = await loadStore();
    const reloadedSnapshot = reloadedStore.getSavedDevicesSnapshot();

    expect(reloadedSnapshot.selectedDeviceId).toBe("device-backup");
    expect(reloadedStore.getSelectedSavedDeviceConnection()).toMatchObject({
      deviceHost: "backup-c64:8080",
      host: "backup-c64",
      httpPort: 8080,
      ftpPort: 2021,
      telnetPort: 2323,
      hasPassword: true,
    });
  });
});
