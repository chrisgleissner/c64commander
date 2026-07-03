/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { ensureValidSidBase64 } from "./sidFixture";
import { variant } from "../src/generated/variant";

type UiMockSeedOptions = {
  seedFeatureFlagsByDefault?: boolean;
  clearStorageBeforeSeeding?: boolean;
};

type InitialSnapshotConfigUpdates = Record<string, Record<string, string | number>>;

type InitialSnapshotConfigSeedWindow = Window & {
  __c64uInitialSnapshotConfigUpdates?: Record<string, InitialSnapshotConfigUpdates>;
};

type HvscFixture = {
  version: number;
  songs: Array<{
    virtualPath: string;
    fileName: string;
    dataBase64: string;
    durationSeconds?: number;
    durations?: number[];
  }>;
};

export async function dismissStartupDiscoveryDialog(page: Page) {
  const clickIfVisible = async (locator: Locator, label: string) => {
    const button = locator.first();
    let visible = false;
    try {
      visible = (await locator.count()) > 0 && (await button.isVisible());
    } catch (error) {
      console.warn(`Unable to inspect startup discovery ${label}.`, error);
      return false;
    }
    if (!visible) {
      return false;
    }

    try {
      const handle = await button.elementHandle();
      if (!handle) {
        return false;
      }
      await page.evaluate((node) => (node as HTMLElement).click(), handle);
      return true;
    } catch (error) {
      console.warn(`Startup discovery ${label} changed while being dismissed.`, error);
      try {
        if ((await locator.count()) === 0 || !(await button.isVisible())) {
          return true;
        }
      } catch (visibilityError) {
        console.warn(`Unable to recheck startup discovery ${label}.`, visibilityError);
        return true;
      }
      await button.click({ timeout: 5000, force: true, noWaitAfter: true });
      return true;
    }
  };

  const dismissButton = page.getByTestId("startup-device-discovery-dismiss");
  if (await clickIfVisible(dismissButton, "dismiss button")) {
    return true;
  }
  const closeButton = page.getByTestId("startup-device-discovery-close");
  return clickIfVisible(closeButton, "close button");
}

const configState = JSON.parse(
  fs.readFileSync(path.resolve("playwright/fixtures/c64u/configState.json"), "utf8"),
) as Record<string, Record<string, any>>;

const baselineFixture = JSON.parse(
  fs.readFileSync(path.resolve("playwright/fixtures/hvsc/baseline.json"), "utf8"),
) as HvscFixture;

const primarySong = baselineFixture.songs[0];
const fixtureBase64 = primarySong
  ? ensureValidSidBase64(primarySong.dataBase64, primarySong.durations?.length ?? 1)
  : "";

const buildSnapshotData = () => {
  const data: Record<string, any> = {};
  Object.entries(configState).forEach(([category, items]) => {
    const payloadItems: Record<string, any> = {};
    Object.entries(items).forEach(([name, entry]) => {
      payloadItems[name] = {
        selected: entry.value,
        options: entry.options ?? [],
        details: entry.details ?? undefined,
      };
    });
    data[category] = { [category]: { items: payloadItems }, errors: [] };
  });
  return data;
};

const initialSnapshot = {
  savedAt: new Date().toISOString(),
  data: buildSnapshotData(),
};

export const uiFixtures = {
  configState,
  initialSnapshot,
  fixtureBase64,
};

export async function seedInitialSnapshotConfig(page: Page, baseUrl: string, updates: InitialSnapshotConfigUpdates) {
  await page.addInitScript(
    ({ baseUrl: baseUrlArg, updates: updatesArg }: { baseUrl: string; updates: InitialSnapshotConfigUpdates }) => {
      type Snapshot = {
        data?: Record<string, Record<string, { items?: Record<string, { selected?: string | number }> }>>;
      };
      type ConfigUpdates = InitialSnapshotConfigUpdates;
      const snapshotKeys = Array.from(
        new Set([
          `c64u_initial_snapshot:${baseUrlArg}`,
          `c64u_initial_snapshot:${baseUrlArg.replace(/\/$/, "")}`,
          `c64u_initial_snapshot:${new URL(baseUrlArg).toString()}`,
        ]),
      );
      const updatesKeys = Array.from(
        new Set([
          `c64u_initial_snapshot_updates:${baseUrlArg}`,
          `c64u_initial_snapshot_updates:${baseUrlArg.replace(/\/$/, "")}`,
          `c64u_initial_snapshot_updates:${new URL(baseUrlArg).toString()}`,
        ]),
      );
      const mergeUpdates = (left: ConfigUpdates, right: ConfigUpdates) => {
        const merged: ConfigUpdates = { ...left };
        Object.entries(right).forEach(([category, items]) => {
          merged[category] = { ...(merged[category] ?? {}), ...items };
        });
        return merged;
      };

      const seededWindow = window as InitialSnapshotConfigSeedWindow;
      const seededUpdates = seededWindow.__c64uInitialSnapshotConfigUpdates?.[baseUrlArg] ?? {};
      let pendingUpdates = mergeUpdates(seededUpdates, updatesArg);
      seededWindow.__c64uInitialSnapshotConfigUpdates = {
        ...(seededWindow.__c64uInitialSnapshotConfigUpdates ?? {}),
        [baseUrlArg]: pendingUpdates,
      };

      const rawPendingUpdates = updatesKeys.map((updatesKey) => localStorage.getItem(updatesKey)).find(Boolean);
      if (rawPendingUpdates) {
        try {
          pendingUpdates = mergeUpdates(JSON.parse(rawPendingUpdates) as ConfigUpdates, updatesArg);
        } catch (error) {
          console.warn("Unable to parse seeded initial snapshot updates", error);
        }
      }
      updatesKeys.forEach((updatesKey) => localStorage.setItem(updatesKey, JSON.stringify(pendingUpdates)));

      const raw = snapshotKeys.map((snapshotKey) => localStorage.getItem(snapshotKey)).find(Boolean);
      if (!raw) return;
      try {
        const snapshot = JSON.parse(raw) as Snapshot;
        Object.entries(pendingUpdates).forEach(([category, items]) => {
          Object.entries(items).forEach(([itemName, value]) => {
            const item = snapshot.data?.[category]?.[category]?.items?.[itemName];
            if (item) {
              item.selected = value;
            }
          });
        });
        snapshotKeys.forEach((snapshotKey) => localStorage.setItem(snapshotKey, JSON.stringify(snapshot)));
      } catch (error) {
        console.warn("Unable to apply seeded initial snapshot updates", error);
      }
    },
    { baseUrl, updates },
  );
}

export async function seedUiMocks(page: Page, baseUrl: string, options: UiMockSeedOptions = {}) {
  const { seedFeatureFlagsByDefault = true, clearStorageBeforeSeeding = false } = options;
  const currentDeviceHostKey = `${variant.id}:device_host`;
  await page.addInitScript(
    ({
      baseUrl: baseUrlArg,
      songData,
      snapshot,
      seedFeatureFlagsByDefault: seedFeatureFlags,
      clearStorageBeforeSeeding: clearStorage,
      currentDeviceHostKey: currentDeviceHostKeyArg,
    }: {
      baseUrl: string;
      songData: string;
      snapshot: unknown;
      seedFeatureFlagsByDefault: boolean;
      clearStorageBeforeSeeding: boolean;
      currentDeviceHostKey: string;
    }) => {
      if (clearStorage) {
        localStorage.clear();
        sessionStorage.clear();
      }

      const parseStoredPort = (value: string | null, fallback: number) => {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : fallback;
      };

      const applyInitialSnapshotConfigUpdates = (snapshotArg: unknown) => {
        type Snapshot = {
          data?: Record<string, Record<string, { items?: Record<string, { selected?: string | number }> }>>;
        };
        const mergeUpdates = (left: InitialSnapshotConfigUpdates, right: InitialSnapshotConfigUpdates) => {
          const merged: InitialSnapshotConfigUpdates = { ...left };
          Object.entries(right).forEach(([category, items]) => {
            merged[category] = { ...(merged[category] ?? {}), ...items };
          });
          return merged;
        };
        const updatesKeys = Array.from(
          new Set([
            `c64u_initial_snapshot_updates:${baseUrlArg}`,
            `c64u_initial_snapshot_updates:${baseUrlArg.replace(/\/$/, "")}`,
            `c64u_initial_snapshot_updates:${new URL(baseUrlArg).toString()}`,
          ]),
        );
        const seededUpdates =
          (window as InitialSnapshotConfigSeedWindow).__c64uInitialSnapshotConfigUpdates?.[baseUrlArg] ?? {};
        const rawUpdates = updatesKeys.map((updatesKey) => localStorage.getItem(updatesKey)).find(Boolean);
        if (!rawUpdates && Object.keys(seededUpdates).length === 0) return snapshotArg;
        try {
          const storedUpdates = rawUpdates ? (JSON.parse(rawUpdates) as InitialSnapshotConfigUpdates) : {};
          const configUpdates = mergeUpdates(seededUpdates, storedUpdates);
          const mutableSnapshot = snapshotArg as Snapshot;
          Object.entries(configUpdates).forEach(([category, items]) => {
            Object.entries(items).forEach(([itemName, value]) => {
              const item = mutableSnapshot.data?.[category]?.[category]?.items?.[itemName];
              if (item) {
                item.selected = value;
              }
            });
          });
          return mutableSnapshot;
        } catch (error) {
          console.warn("Unable to apply pending initial snapshot updates", error);
          return snapshotArg;
        }
      };

      const readSeededSavedDevice = () => {
        const savedDevicesRaw = localStorage.getItem("c64u_saved_devices:v1");
        if (!savedDevicesRaw) return null;
        try {
          const parsed = JSON.parse(savedDevicesRaw) as {
            selectedDeviceId?: string;
            devices?: Array<{
              id?: string;
              ftpPort?: number;
              telnetPort?: number;
              hasPassword?: boolean;
            }>;
          };
          const devices = Array.isArray(parsed.devices) ? parsed.devices : [];
          return devices.find((device) => device.id === parsed.selectedDeviceId) ?? devices[0] ?? null;
        } catch (error) {
          console.warn("Unable to read seeded saved device", error);
          return null;
        }
      };

      try {
        Object.defineProperty(window, "showDirectoryPicker", {
          configurable: true,
          writable: true,
          value: undefined,
        });
      } catch (error) {
        console.warn("Unable to clear showDirectoryPicker", error);
      }
      const routingWindow = window as Window & {
        __c64uExpectedBaseUrl?: string;
        __c64uAllowedBaseUrls?: string[];
        __c64uTestProbeEnabled?: boolean;
        __c64uSeedVerifiedIdentity?: () => Promise<void>;
        __c64uConnectionTestProbe?: {
          noteReachable: (
            host: string,
            source: "rest",
            deviceInfo: {
              product: string;
              firmware_version: string;
              fpga_version: string;
              core_version: string;
              hostname: string;
              unique_id: string;
              errors: string[];
            },
          ) => void;
        };
      };
      routingWindow.__c64uExpectedBaseUrl = baseUrlArg;
      routingWindow.__c64uTestProbeEnabled = true;
      const allowedBaseUrls = new Set<string>();
      if (Array.isArray(routingWindow.__c64uAllowedBaseUrls)) {
        routingWindow.__c64uAllowedBaseUrls.forEach((url) => {
          if (url) allowedBaseUrls.add(url);
        });
      }
      if (baseUrlArg) {
        allowedBaseUrls.add(baseUrlArg);
      }
      try {
        const ftpBridgeUrl = localStorage.getItem("c64u_ftp_bridge_url");
        if (ftpBridgeUrl) {
          allowedBaseUrls.add(ftpBridgeUrl);
        }
      } catch (error) {
        console.warn("Unable to read seeded FTP bridge URL", error);
      }
      routingWindow.__c64uAllowedBaseUrls = Array.from(allowedBaseUrls);
      const host = baseUrlArg?.replace(/^https?:\/\//, "");
      routingWindow.__c64uSeedVerifiedIdentity = async () => {
        const probe = routingWindow.__c64uConnectionTestProbe;
        if (!probe) {
          throw new Error("C64U connection test probe is not installed");
        }
        probe.noteReachable(baseUrlArg || host || "c64u", "rest", {
          product: "C64 Ultimate",
          firmware_version: "3.12.0",
          fpga_version: "1.0.0",
          core_version: "1.0.0",
          hostname: "c64u",
          unique_id: "TEST-123",
          errors: [],
        });
      };
      try {
        const seededSavedDevice = readSeededSavedDevice();
        const seededFtpPort = parseStoredPort(
          localStorage.getItem("c64u_ftp_port"),
          typeof seededSavedDevice?.ftpPort === "number" ? seededSavedDevice.ftpPort : 21,
        );
        const seededTelnetPort = parseStoredPort(
          localStorage.getItem("c64u_telnet_port"),
          typeof seededSavedDevice?.telnetPort === "number" ? seededSavedDevice.telnetPort : 64,
        );
        const preservedPassword = (
          window as Window & {
            __c64uSecureStorageOverride?: { password?: string | null };
          }
        ).__c64uSecureStorageOverride?.password;
        const hasPassword = localStorage.getItem("c64u_has_password") === "1" || preservedPassword != null;
        localStorage.removeItem("c64u_password");
        if (hasPassword && preservedPassword != null) {
          localStorage.setItem("c64u_has_password", "1");
          (
            window as Window & {
              __c64uSecureStorageOverride?: { password?: string | null };
            }
          ).__c64uSecureStorageOverride = {
            password: preservedPassword,
          };
        } else {
          localStorage.removeItem("c64u_has_password");
          delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
        }
        let deviceHost = "c64u";
        let deviceHttpPort = 80;
        if (baseUrlArg) {
          try {
            const parsedUrl = new URL(baseUrlArg);
            deviceHost = parsedUrl.hostname || "c64u";
            deviceHttpPort = Number(parsedUrl.port) || 80;
          } catch (error) {
            console.warn("Unable to parse seeded mock base URL", error);
          }
        }
        const testDeviceId = "test-device-mock";
        localStorage.setItem(
          "c64u_saved_devices:v1",
          JSON.stringify({
            version: 1,
            selectedDeviceId: testDeviceId,
            devices: [
              {
                id: testDeviceId,
                name: "C64U",
                nameSource: "custom",
                host: deviceHost,
                httpPort: deviceHttpPort,
                ftpPort: seededFtpPort,
                telnetPort: seededTelnetPort,
                lastKnownProduct: "C64U",
                lastKnownHostname: deviceHost,
                lastKnownUniqueId: null,
                lastSuccessfulConnectionAt: null,
                lastUsedAt: null,
                hasPassword,
              },
            ],
            summaries: {},
            summaryLru: [],
            hasEverHadMultipleDevices: false,
          }),
        );
        localStorage.setItem("c64u_device_host", host || "c64u");
        localStorage.setItem("c64commander:device_host", host || "c64u");
        localStorage.setItem(currentDeviceHostKeyArg, host || "c64u");
        if (baseUrlArg) {
          localStorage.setItem("c64u_base_url", baseUrlArg);
        }
        localStorage.setItem("c64u_notification_visibility", "all");
        const snapshotText = JSON.stringify(applyInitialSnapshotConfigUpdates(snapshot));
        Array.from(
          new Set([
            `c64u_initial_snapshot:${baseUrlArg}`,
            `c64u_initial_snapshot:${baseUrlArg.replace(/\/$/, "")}`,
            `c64u_initial_snapshot:${new URL(baseUrlArg).toString()}`,
          ]),
        ).forEach((snapshotKey) => localStorage.setItem(snapshotKey, snapshotText));
        Array.from(
          new Set([
            `c64u_initial_snapshot_session:${baseUrlArg}`,
            `c64u_initial_snapshot_session:${baseUrlArg.replace(/\/$/, "")}`,
            `c64u_initial_snapshot_session:${new URL(baseUrlArg).toString()}`,
          ]),
        ).forEach((snapshotSessionKey) => sessionStorage.setItem(snapshotSessionKey, "1"));
        if (seedFeatureFlags) {
          localStorage.setItem("c64u_dev_mode_enabled", "1");
          localStorage.setItem("c64u_feature_flag:demo_mode_enabled", "1");
          localStorage.setItem("c64u_feature_flag:hvsc_enabled", "1");
          localStorage.setItem("c64u_feature_flag:commoserve_enabled", "1");
          localStorage.setItem("c64u_feature_flag:lighting_studio_enabled", "1");
          localStorage.setItem("c64u_feature_flag:ram_snapshots_enabled", "1");
        }
      } catch (error) {
        console.warn("Unable to seed UI mocks", error);
        return;
      }

      const listeners: Array<(event: any) => void> = [];
      const song = {
        id: 1,
        virtualPath: "/DEMOS/0-9/10_Orbyte.sid",
        fileName: "10_Orbyte.sid",
        durationSeconds: 77,
        dataBase64: songData,
      };

      window.__hvscMock__ = {
        addListener: (_event: string, listener: (event: any) => void) => {
          listeners.push(listener);
          return { remove: async () => {} };
        },
        getHvscStatus: async () => ({
          installedBaselineVersion: 83,
          installedVersion: 84,
          ingestionState: "ready",
          lastUpdateCheckUtcMs: Date.now(),
          ingestionError: null as string | null,
        }),
        getHvscCacheStatus: async () => ({
          baselineVersion: null as number | null,
          updateVersions: [] as number[],
        }),
        checkForHvscUpdates: async () => ({
          latestVersion: 84,
          installedVersion: 84,
          baselineVersion: null as number | null,
          requiredUpdates: [] as number[],
        }),
        installOrUpdateHvsc: async () => ({
          installedBaselineVersion: 83,
          installedVersion: 84,
          ingestionState: "ready",
          lastUpdateCheckUtcMs: Date.now(),
          ingestionError: null as string | null,
        }),
        cancelHvscInstall: async () => {},
        getHvscFolderListing: async ({ path }: { path: string }) => {
          const normalized = path || "/";
          if (normalized === "/") {
            return {
              path: "/",
              folders: ["/DEMOS/0-9"],
              songs: [] as Array<any>,
            };
          }
          if (normalized === "/DEMOS/0-9") {
            return {
              path: normalized,
              folders: [],
              songs: [
                {
                  id: song.id,
                  virtualPath: song.virtualPath,
                  fileName: song.fileName,
                  durationSeconds: song.durationSeconds,
                },
              ],
            };
          }
          return { path: normalized, folders: [], songs: [] };
        },
        getHvscSong: async ({ id, virtualPath }: { id?: number; virtualPath?: string }) => {
          if (id !== song.id && virtualPath !== song.virtualPath) throw new Error("Song not found");
          return {
            id: song.id,
            virtualPath: song.virtualPath,
            fileName: song.fileName,
            durationSeconds: song.durationSeconds,
            dataBase64: song.dataBase64,
          };
        },
        getHvscDurationByMd5: async () => ({
          durationSeconds: 42,
        }),
        getHvscDurationsByMd5: async () => ({
          durationsSeconds: [42],
        }),
      };
    },
    {
      baseUrl: baseUrl,
      songData: fixtureBase64,
      snapshot: initialSnapshot,
      seedFeatureFlagsByDefault,
      clearStorageBeforeSeeding,
      currentDeviceHostKey,
    },
  );
}
