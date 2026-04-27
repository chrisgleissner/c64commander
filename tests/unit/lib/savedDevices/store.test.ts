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
      name: "backup-c64",
      host: "backup-c64",
      httpPort: 8080,
      ftpPort: 2021,
      telnetPort: 2323,
      hasPassword: true,
    });
    expect(store.buildSavedDevicePrimaryLabel(firstSnapshot.devices[0]!)).toBe("backup-c64");

    const persistedAfterFirstLoad = localStorage.getItem(store.getSavedDevicesStorageKey());
    expect(persistedAfterFirstLoad).not.toBeNull();

    vi.resetModules();

    const reloadedStore = await loadStore();
    const secondSnapshot = reloadedStore.getSavedDevicesSnapshot();

    expect(secondSnapshot).toMatchObject({
      selectedDeviceId: firstSnapshot.selectedDeviceId,
      devices: [
        {
          name: "backup-c64",
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

  it("uses the Telnet default port for a fresh saved device", async () => {
    const store = await loadStore();

    const initialSnapshot = store.getSavedDevicesSnapshot();

    expect(initialSnapshot.devices).toHaveLength(1);
    expect(initialSnapshot.devices[0]).toMatchObject({
      host: "c64u",
      telnetPort: 23,
    });
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

    expect(store.buildSavedDevicePrimaryLabel(officeDevice)).toBe("Living Roo");
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
      name: "blank-host",
      host: "blank-host",
    });
    expect(store.buildSavedDevicePrimaryLabel(store.getSavedDeviceById("device-auto-1")!)).toBe("blank-host");
    expect(store.buildSavedDevicePrimaryLabel(store.getSavedDeviceById("device-auto-2")!)).toBe("blank-host-2");
    expect(
      store.validateSavedDeviceName(
        [officeDevice, backupDevice, store.getSavedDeviceById("device-auto-1")!],
        backupDevice.id,
        "blank-host",
        backupDevice.host,
      ),
    ).toBe("Device name must be unique.");
    expect(
      store.validateSavedDeviceName(
        [
          officeDevice,
          backupDevice,
          store.getSavedDeviceById("device-auto-1")!,
          store.getSavedDeviceById("device-auto-2")!,
        ],
        backupDevice.id,
        "blank-host-2",
        backupDevice.host,
      ),
    ).toBe("Device name must be unique.");
  });

  it("keeps inferred names pinned to the host when the user clears the field", async () => {
    const store = await loadStore();
    const initialSnapshot = store.getSavedDevicesSnapshot();
    const initialDeviceId = initialSnapshot.selectedDeviceId;

    store.updateSavedDevice(initialDeviceId, {
      name: "",
      nameSource: "INFERRED",
      host: "c64u",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
    });

    expect(store.getSelectedSavedDevice()).toMatchObject({
      name: "c64u",
      nameSource: "INFERRED",
    });
    expect(store.buildSavedDevicePrimaryLabel(store.getSelectedSavedDevice()!)).toBe("c64u");
  });

  it("preserves a user-authored name across host changes but recomputes inferred names and clears inferred type", async () => {
    const store = await loadStore();
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;

    store.updateSavedDevice(initialDeviceId, {
      name: "Studio",
      nameSource: "USER",
      host: "u64",
      type: "U64",
      typeSource: "INFERRED",
      lastKnownProduct: "U64",
      lastKnownHostname: "u64",
      lastKnownUniqueId: "UID-U64",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
    });

    store.updateSavedDevice(initialDeviceId, {
      host: "u64-elite",
    });

    expect(store.getSelectedSavedDevice()).toMatchObject({
      name: "Studio",
      nameSource: "USER",
      host: "u64-elite",
      type: "",
      typeSource: "INFERRED",
      lastKnownProduct: null,
      lastKnownHostname: null,
      lastKnownUniqueId: null,
    });

    store.updateSavedDevice(initialDeviceId, {
      name: "",
      nameSource: "INFERRED",
    });

    expect(store.getSelectedSavedDevice()).toMatchObject({
      name: "u64-elite",
      nameSource: "INFERRED",
    });
  });

  it("preserves a same-as-host user name across host changes when nameSource is USER", async () => {
    const store = await loadStore();
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;

    store.updateSavedDevice(initialDeviceId, {
      host: "u64",
      name: "u64",
      nameSource: "USER",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
    });

    store.updateSavedDevice(initialDeviceId, {
      host: "u64-elite",
    });

    expect(store.getSelectedSavedDevice()).toMatchObject({
      host: "u64-elite",
      name: "u64",
      nameSource: "USER",
    });
  });

  it("updates inferred type from successful verification after a host change", async () => {
    const store = await loadStore();
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;

    store.updateSavedDevice(initialDeviceId, {
      host: "u64",
      name: "",
      nameSource: "INFERRED",
      type: "",
      typeSource: "INFERRED",
    });

    store.completeSavedDeviceVerification(initialDeviceId, {
      product: "Ultimate 64 Elite",
      hostname: "u64",
      unique_id: "UID-U64",
    });

    expect(store.getSelectedSavedDevice()).toMatchObject({
      name: "u64",
      type: "U64E",
      typeSource: "INFERRED",
      lastKnownProduct: "U64E",
      lastKnownHostname: "u64",
      lastKnownUniqueId: "UID-U64",
    });
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

  it("keeps the prior-multi-device visibility flag after devices are removed back to one", async () => {
    const store = await loadStore();

    expect(store.getSavedDevicesSnapshot().hasEverHadMultipleDevices).toBe(false);

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
      hasPassword: false,
    });

    expect(store.getSavedDevicesSnapshot().hasEverHadMultipleDevices).toBe(true);

    store.removeSavedDevice("device-backup");
    expect(store.getSavedDevicesSnapshot().devices).toHaveLength(1);
    expect(store.getSavedDevicesSnapshot().hasEverHadMultipleDevices).toBe(true);

    vi.resetModules();
    const reloadedStore = await loadStore();
    expect(reloadedStore.getSavedDevicesSnapshot().hasEverHadMultipleDevices).toBe(true);
  });
});
