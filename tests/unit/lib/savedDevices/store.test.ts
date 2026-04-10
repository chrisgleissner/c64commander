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
      name: "",
      host: "backup-c64",
      httpPort: 8080,
      ftpPort: 2021,
      telnetPort: 2323,
      hasPassword: true,
    });
    expect(store.buildSavedDevicePrimaryLabel(firstSnapshot.devices[0]!)).toBe("C64U");

    const persistedAfterFirstLoad = localStorage.getItem(store.getSavedDevicesStorageKey());
    expect(persistedAfterFirstLoad).not.toBeNull();

    vi.resetModules();

    const reloadedStore = await loadStore();
    const secondSnapshot = reloadedStore.getSavedDevicesSnapshot();

    expect(secondSnapshot).toMatchObject({
      selectedDeviceId: firstSnapshot.selectedDeviceId,
      devices: [
        {
          name: "",
          host: "backup-c64",
          httpPort: 8080,
          ftpPort: 2021,
          telnetPort: 2323,
          hasPassword: true,
        },
      ],
    });
    expect(JSON.parse(localStorage.getItem(reloadedStore.getSavedDevicesStorageKey()) ?? "{}")).toEqual(
      JSON.parse(persistedAfterFirstLoad ?? "{}"),
    );
  });

  it("derives product-based auto names and enforces unique final labels", async () => {
    const store = await loadStore();
    const officeDevice = {
      id: "device-office",
      name: "Living Room",
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
      name: "Backup Lab",
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

    expect(store.buildSavedDevicePrimaryLabel(officeDevice)).toBe("Living Room");
    expect(
      store.validateSavedDeviceName([officeDevice, backupDevice], backupDevice.id, "  ", backupDevice.host),
    ).toBeNull();
    expect(
      store.validateSavedDeviceName([officeDevice, backupDevice], backupDevice.id, "living room", backupDevice.host),
    ).toBe("Device name must be unique.");

    store.addSavedDevice({
      id: "device-auto-1",
      name: "   ",
      host: "blank-host",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 64,
      lastKnownProduct: "U64",
      lastKnownHostname: null,
      lastKnownUniqueId: null,
      hasPassword: false,
    });
    store.addSavedDevice({
      id: "device-auto-2",
      name: "",
      host: "blank-host-2",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 64,
      lastKnownProduct: "U64",
      lastKnownHostname: null,
      lastKnownUniqueId: null,
      hasPassword: false,
    });

    expect(store.getSavedDeviceById("device-auto-1")).toMatchObject({
      name: "",
      host: "blank-host",
    });
    expect(store.buildSavedDevicePrimaryLabel(store.getSavedDeviceById("device-auto-1")!)).toBe("U64");
    expect(store.buildSavedDevicePrimaryLabel(store.getSavedDeviceById("device-auto-2")!)).toBe("U64-2");
    expect(
      store.validateSavedDeviceName(
        [officeDevice, backupDevice, store.getSavedDeviceById("device-auto-1")!],
        backupDevice.id,
        "U64",
        backupDevice.host,
      ),
    ).toBeNull();
  });

  it("persists the selected device across reloads and projects its connection settings", async () => {
    const store = await loadStore();
    const initialSnapshot = store.getSavedDevicesSnapshot();
    const initialDeviceId = initialSnapshot.selectedDeviceId;

    store.updateSavedDevice(initialDeviceId, {
      name: "Office U64",
      host: "c64u",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
    });
    store.addSavedDevice({
      id: "device-backup",
      name: "Backup Lab",
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
