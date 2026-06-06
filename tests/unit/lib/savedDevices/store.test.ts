/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadStore = async () => import("@/lib/savedDevices/store");

const { addLog, buildErrorLogDetails } = vi.hoisted(() => ({
  addLog: vi.fn(),
  buildErrorLogDetails: vi.fn((error: Error, details: Record<string, unknown> = {}) => ({
    ...details,
    error: { name: error.name, message: error.message, stack: error.stack },
    errorName: error.name,
    errorStack: error.stack ?? null,
  })),
}));

vi.mock("@/lib/logging", () => ({
  addLog,
  buildErrorLogDetails,
}));

const seedLegacyStorage = () => {
  localStorage.setItem("c64u_device_host", "backup-c64:8080");
  localStorage.setItem("c64u_ftp_port", "2021");
  localStorage.setItem("c64u_telnet_port", "2323");
  localStorage.setItem("c64u_has_password", "1");
};

describe("savedDevices store", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T12:00:00.000Z"));
    localStorage.clear();
    addLog.mockClear();
    buildErrorLogDetails.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it("logs corrupted saved-device envelopes before falling back to legacy initialization", async () => {
    localStorage.setItem("c64u_saved_devices:v1", "{");
    seedLegacyStorage();

    const store = await loadStore();
    const snapshot = store.getSavedDevicesSnapshot();

    expect(snapshot.devices[0]).toMatchObject({ host: "backup-c64" });
    expect(buildErrorLogDetails).toHaveBeenCalledWith(
      expect.any(SyntaxError),
      expect.objectContaining({ storageKey: "c64u_saved_devices:v1" }),
    );
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Failed to parse persisted saved-devices envelope; falling back to legacy initialization.",
      expect.objectContaining({
        storageKey: "c64u_saved_devices:v1",
        error: expect.objectContaining({ name: "SyntaxError" }),
      }),
    );
  });

  it("uses the debug bootstrap devices for a fresh install when configured", async () => {
    vi.stubEnv(
      "VITE_DEBUG_SAVED_DEVICES_JSON",
      JSON.stringify([
        {
          id: "debug-u64",
          name: "u64",
          nameSource: "USER",
          host: "192.168.1.13",
          httpPort: 80,
          ftpPort: 21,
          telnetPort: 23,
          hasPassword: false,
        },
        {
          id: "debug-c64u",
          name: "c64u",
          nameSource: "USER",
          host: "192.168.1.167",
          httpPort: 80,
          ftpPort: 21,
          telnetPort: 23,
          hasPassword: false,
        },
      ]),
    );

    const store = await loadStore();
    const initialSnapshot = store.getSavedDevicesSnapshot();

    expect(initialSnapshot.selectedDeviceId).toBe("debug-u64");
    expect(initialSnapshot.hasEverHadMultipleDevices).toBe(true);
    expect(initialSnapshot.devices).toMatchObject([
      {
        id: "debug-u64",
        name: "u64",
        nameSource: "USER",
        host: "192.168.1.13",
        httpPort: 80,
        ftpPort: 21,
        telnetPort: 23,
        hasPassword: false,
      },
      {
        id: "debug-c64u",
        name: "c64u",
        nameSource: "USER",
        host: "192.168.1.167",
        httpPort: 80,
        ftpPort: 21,
        telnetPort: 23,
        hasPassword: false,
      },
    ]);
  });

  it("falls back to the legacy device when the debug bootstrap env is missing or empty (no import.meta.env crash)", async () => {
    // Regression: createDebugBootstrapDevices() previously accessed
    // import.meta.env.VITE_DEBUG_SAVED_DEVICES_JSON directly. When the store
    // was loaded from a Node context where import.meta.env is undefined (e.g.
    // playwright --list pulling in deviceInteractionManager which calls
    // loadDeviceSafetyConfig at module init), the access threw and broke all
    // E2E Android shards. The helper must tolerate both an unset and an
    // explicitly empty value.
    vi.stubEnv("VITE_DEBUG_SAVED_DEVICES_JSON", "");

    const store = await loadStore();
    const snapshot = store.getSavedDevicesSnapshot();

    expect(snapshot.devices).toHaveLength(1);
    expect(snapshot.devices[0]).toMatchObject({ host: "c64u" });
  });

  it("logs malformed debug bootstrap JSON and falls back to the default device", async () => {
    vi.stubEnv("VITE_DEBUG_SAVED_DEVICES_JSON", "{");

    const store = await loadStore();
    const snapshot = store.getSavedDevicesSnapshot();

    expect(snapshot.devices).toHaveLength(1);
    expect(snapshot.devices[0]).toMatchObject({ host: "c64u" });
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Failed to parse debug saved devices bootstrap",
      expect.objectContaining({
        error: expect.objectContaining({ name: "SyntaxError" }),
      }),
    );
  });

  it("guards the debug bootstrap env read with a typeof check so module init survives non-Vite runners", async () => {
    // Contract: the readDebugSavedDevicesEnv helper must defensively probe
    // import.meta before reading .env, matching the safe pattern used by
    // src/lib/fuzz/fuzzMode.ts. This protects the eager module-init chain
    // deviceInteractionManager -> loadDeviceSafetyConfig -> store from
    // crashing under playwright --list / ts-node / other non-Vite runners.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/lib/savedDevices/store.ts", "utf8");
    expect(source).toContain('if (typeof import.meta === "undefined" || !import.meta.env) return undefined;');
    expect(source).toMatch(/const raw = readDebugSavedDevicesEnv\(\);/);
  });

  it("hydrates persisted device summaries and keeps resolved addresses on reload", async () => {
    vi.resetModules();
    localStorage.setItem(
      "c64u_saved_devices:v1",
      JSON.stringify({
        version: 1,
        selectedDeviceId: "device-u64",
        devices: [
          {
            id: "device-u64",
            name: "u64",
            nameSource: "INFERRED",
            host: "u64",
            type: "U64E",
            typeSource: "INFERRED",
            httpPort: 80,
            ftpPort: 21,
            telnetPort: 23,
            lastKnownProduct: "U64E",
            lastKnownHostname: "u64",
            lastKnownUniqueId: "UID-U64",
            lastSuccessfulConnectionAt: null,
            lastUsedAt: null,
            hasPassword: false,
          },
        ],
        summaries: {
          "device-u64": {
            verifiedAt: "2026-04-09T12:00:00.000Z",
            lastHealthState: "Healthy",
            lastConnectivityState: "Online",
            lastProbeSucceededAt: "2026-04-09T12:00:01.000Z",
            lastProbeFailedAt: null,
            lastVerifiedProduct: "U64E",
            lastVerifiedHostname: "u64",
            lastVerifiedUniqueId: "UID-U64",
            lastResolvedAddress: "192.168.1.13",
          },
        },
        summaryLru: ["device-u64"],
        hasEverHadMultipleDevices: false,
      }),
    );

    const reloadedStore = await loadStore();
    const reloadedSnapshot = reloadedStore.getSavedDevicesSnapshot();

    expect(reloadedSnapshot.summaries["device-u64"]).toEqual({
      deviceId: "device-u64",
      verifiedAt: "2026-04-09T12:00:00.000Z",
      lastHealthState: "Healthy",
      lastConnectivityState: "Online",
      lastProbeSucceededAt: "2026-04-09T12:00:01.000Z",
      lastProbeFailedAt: null,
      lastVerifiedProduct: "U64E",
      lastVerifiedHostname: "u64",
      lastVerifiedUniqueId: "UID-U64",
      lastResolvedAddress: "192.168.1.13",
    });
    expect(reloadedSnapshot.summaryLru).toEqual(["device-u64"]);
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

  it("accepts a unique label when validating a brand-new device draft", async () => {
    const store = await loadStore();

    expect(
      store.validateSavedDeviceName(
        store.getSavedDevicesSnapshot().devices,
        "device-lab",
        "Lab U64",
        "lab-u64.local:8080",
      ),
    ).toBeNull();
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

  it("preserves user-authored type metadata when editing a device host", async () => {
    const store = await loadStore();
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;

    store.updateSavedDevice(initialDeviceId, {
      host: "u64",
      name: "Workbench",
      nameSource: "USER",
      type: "Lab Ultimate",
      typeSource: "USER",
      lastKnownProduct: "U64E",
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
      host: "u64-elite",
      type: "Lab Ultimate",
      typeSource: "USER",
      lastKnownProduct: "U64E",
      lastKnownHostname: "u64",
      lastKnownUniqueId: "UID-U64",
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

  it("does not mark a first verification as mismatch when the configured host is an IP alias", async () => {
    const store = await loadStore();
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;

    store.updateSavedDevice(initialDeviceId, {
      host: "192.168.1.167",
      name: "c64u",
      nameSource: "USER",
      type: "",
      typeSource: "INFERRED",
      lastKnownProduct: null,
      lastKnownHostname: null,
      lastKnownUniqueId: null,
    });

    store.completeSavedDeviceVerification(initialDeviceId, {
      product: "C64 Ultimate",
      hostname: "c64u",
      unique_id: "UID-C64U",
    });

    expect(store.getSavedDeviceSwitchStatus(initialDeviceId)).toBe("connected");
    expect(store.getSavedDeviceSwitchSummary(initialDeviceId)).toMatchObject({
      lastHealthState: "Healthy",
      lastConnectivityState: "Online",
      lastVerifiedProduct: "C64U",
      lastVerifiedHostname: "c64u",
      lastVerifiedUniqueId: "UID-C64U",
    });
  });

  it("clears verification summary state when editing a device host", async () => {
    const store = await loadStore();
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;

    store.updateSavedDevice(initialDeviceId, {
      host: "u64",
      name: "u64",
      nameSource: "INFERRED",
      type: "U64E",
      typeSource: "INFERRED",
    });
    store.completeSavedDeviceVerification(
      initialDeviceId,
      {
        product: "Ultimate 64 Elite",
        hostname: "u64",
        unique_id: "UID-U64",
      },
      "192.168.1.13",
    );

    store.updateSavedDevice(initialDeviceId, {
      host: "c64u",
    });

    expect(store.getSavedDeviceSwitchSummary(initialDeviceId)).toMatchObject({
      verifiedAt: null,
      lastHealthState: null,
      lastConnectivityState: null,
      lastVerifiedHostname: null,
      lastVerifiedUniqueId: null,
      lastResolvedAddress: null,
    });
  });

  it("clears verification summary state when the selected connection host changes", async () => {
    const store = await loadStore();
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;

    store.updateSavedDevice(initialDeviceId, {
      host: "u64",
      name: "u64",
      nameSource: "INFERRED",
      type: "U64E",
      typeSource: "INFERRED",
    });
    store.completeSavedDeviceVerification(
      initialDeviceId,
      {
        product: "Ultimate 64 Elite",
        hostname: "u64",
        unique_id: "UID-U64",
      },
      "192.168.1.13",
    );

    store.updateSelectedSavedDeviceConnection({
      deviceHost: "c64u",
      passwordPresent: false,
    });

    expect(store.getSavedDeviceSwitchSummary(initialDeviceId)).toMatchObject({
      verifiedAt: null,
      lastHealthState: null,
      lastConnectivityState: null,
      lastVerifiedHostname: null,
      lastVerifiedUniqueId: null,
      lastResolvedAddress: null,
    });
  });

  it("preserves user-authored type metadata when updating the selected connection host", async () => {
    const store = await loadStore();
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;

    store.updateSavedDevice(initialDeviceId, {
      host: "u64",
      name: "Workbench",
      nameSource: "USER",
      type: "Lab Ultimate",
      typeSource: "USER",
      lastKnownProduct: "U64E",
      lastKnownHostname: "u64",
      lastKnownUniqueId: "UID-U64",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
    });
    store.completeSavedDeviceVerification(
      initialDeviceId,
      {
        product: "Ultimate 64 Elite",
        hostname: "u64",
        unique_id: "UID-U64",
      },
      "192.168.1.13",
    );

    store.updateSelectedSavedDeviceConnection({
      deviceHost: "c64u:8080",
      httpPort: 8080,
      passwordPresent: true,
    });

    expect(store.getSelectedSavedDevice()).toMatchObject({
      host: "c64u",
      httpPort: 8080,
      hasPassword: true,
      type: "Lab Ultimate",
      typeSource: "USER",
      lastKnownProduct: "U64E",
      lastKnownHostname: "u64",
      lastKnownUniqueId: "UID-U64",
    });
    expect(store.getSavedDeviceSwitchSummary(initialDeviceId)).toMatchObject({
      verifiedAt: null,
      lastHealthState: null,
      lastConnectivityState: null,
      lastVerifiedHostname: null,
      lastVerifiedUniqueId: null,
      lastResolvedAddress: null,
    });
  });

  it("updates only the selected device service ports", async () => {
    const store = await loadStore();
    const initialSnapshot = store.getSavedDevicesSnapshot();
    const initialDeviceId = initialSnapshot.selectedDeviceId;

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

    store.updateSelectedSavedDevicePorts({
      ftpPort: 2121,
      telnetPort: 2424,
    });

    expect(store.getSavedDeviceById(initialDeviceId)).toMatchObject({
      ftpPort: 2121,
      telnetPort: 2424,
    });
    expect(store.getSavedDeviceById("device-backup")).toMatchObject({
      ftpPort: 2021,
      telnetPort: 2323,
    });
  });

  it("reclassifies legacy inferred types from the verified product instead of stale pre-update fields", async () => {
    const store = await loadStore();
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;

    store.updateSavedDevice(initialDeviceId, {
      host: "u64",
      type: "U64E",
      typeSource: undefined,
      lastKnownProduct: null,
    });

    store.completeSavedDeviceVerification(initialDeviceId, {
      product: "Ultimate 64 Elite",
      hostname: "u64",
      unique_id: "UID-U64-LEGACY",
    });

    expect(store.getSelectedSavedDevice()).toMatchObject({
      type: "U64E",
      typeSource: "INFERRED",
      lastKnownProduct: "U64E",
      lastKnownHostname: "u64",
      lastKnownUniqueId: "UID-U64-LEGACY",
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
