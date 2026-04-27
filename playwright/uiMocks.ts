/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Page } from "@playwright/test";
import { ensureValidSidBase64 } from "./sidFixture";

type UiMockSeedOptions = {
  seedFeatureFlagsByDefault?: boolean;
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

export async function seedUiMocks(page: Page, baseUrl: string, options: UiMockSeedOptions = {}) {
  const { seedFeatureFlagsByDefault = true } = options;
  await page.addInitScript(
    ({
      baseUrl: baseUrlArg,
      songData,
      snapshot,
      seedFeatureFlagsByDefault: seedFeatureFlags,
    }: {
      baseUrl: string;
      songData: string;
      snapshot: unknown;
      seedFeatureFlagsByDefault: boolean;
    }) => {
      const parseStoredPort = (value: string | null, fallback: number) => {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : fallback;
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
        } catch {
          return null;
        }
      };

      try {
        delete (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker;
      } catch (error) {
        console.warn("Unable to clear showDirectoryPicker", error);
      }
      const routingWindow = window as Window & {
        __c64uExpectedBaseUrl?: string;
        __c64uAllowedBaseUrls?: string[];
        __c64uTestProbeEnabled?: boolean;
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
      } catch {
        // ignore storage access failures
      }
      routingWindow.__c64uAllowedBaseUrls = Array.from(allowedBaseUrls);
      const host = baseUrlArg?.replace(/^https?:\/\//, "");
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
          } catch {
            // ignore
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
        if (baseUrlArg) {
          localStorage.setItem("c64u_base_url", baseUrlArg);
        }
        localStorage.setItem("c64u_notification_visibility", "all");
        localStorage.setItem(`c64u_initial_snapshot:${baseUrlArg}`, JSON.stringify(snapshot));
        sessionStorage.setItem(`c64u_initial_snapshot_session:${baseUrlArg}`, "1");
        if (seedFeatureFlags) {
          localStorage.setItem("c64u_dev_mode_enabled", "1");
          localStorage.setItem("c64u_feature_flag:demo_mode_enabled", "1");
          localStorage.setItem("c64u_feature_flag:hvsc_enabled", "1");
          localStorage.setItem("c64u_feature_flag:commoserve_enabled", "1");
          localStorage.setItem("c64u_feature_flag:lighting_studio_enabled", "1");
        }
      } catch {
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
          return { remove: async () => { } };
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
        cancelHvscInstall: async () => { },
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
      };
    },
    {
      baseUrl: baseUrl,
      songData: fixtureBase64,
      snapshot: initialSnapshot,
      seedFeatureFlagsByDefault,
    },
  );
}
