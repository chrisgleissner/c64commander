/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

import { isNativePlatform } from "./platform";

export interface DeviceRotationEvent {
  /** Chassis rotation clockwise from upright, quantised to 0/90/180/270. */
  rotation: number;
}

export interface DeviceRotationPlugin {
  current: () => Promise<DeviceRotationEvent>;
  addListener: (
    eventName: "deviceRotation",
    listener: (event: DeviceRotationEvent) => void,
  ) => Promise<PluginListenerHandle>;
}

const DeviceRotation = registerPlugin<DeviceRotationPlugin>("DeviceRotation");

/**
 * Whether this build can read the chassis angle at all. Checked per-call rather
 * than assumed from {@link isNativePlatform}: `StreamUdp` has no iOS
 * implementation and its unconditional calls rejected "not implemented" on every
 * iOS launch, which is the same shape of mistake this plugin could make.
 */
export const isDeviceRotationAvailable = (): boolean =>
  isNativePlatform() && Capacitor.isPluginAvailable("DeviceRotation");

/**
 * Subscribes to chassis rotation. Returns a no-op unsubscribe where the plugin is
 * unavailable, so the caller needs no platform branch of its own.
 */
export const subscribeDeviceRotation = (listener: (rotation: number) => void): (() => void) => {
  if (!isDeviceRotationAvailable()) return () => {};
  let handle: PluginListenerHandle | null = null;
  let cancelled = false;
  void DeviceRotation.addListener("deviceRotation", (event) => listener(event.rotation))
    .then((registered) => {
      if (cancelled) {
        void registered.remove();
        return;
      }
      handle = registered;
    })
    .catch((error: unknown) => {
      console.warn("Failed to subscribe to device rotation; Game Mode falls back to the manual override", error);
    });
  return () => {
    cancelled = true;
    void handle?.remove();
    handle = null;
  };
};

export const readDeviceRotation = async (): Promise<number> => {
  if (!isDeviceRotationAvailable()) return 0;
  try {
    const { rotation } = await DeviceRotation.current();
    return rotation;
  } catch (error) {
    console.warn("Failed to read the current device rotation", error);
    return 0;
  }
};
