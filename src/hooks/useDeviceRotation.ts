/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { loadScreenOrientationMode } from "@/lib/config/appSettings";
import { frameRotation as computeFrameRotation, ROTATION_DWELL_MS } from "@/lib/remoteInput/deviceRotation";
import type { DeviceRotation } from "@/lib/remoteInput/joystickKeyBindings";
import { readDeviceRotation, subscribeDeviceRotation } from "@/lib/native/deviceRotation";

export type RotationSource = "auto" | "pinned";

export interface DeviceRotationState {
  /** How far the chassis is turned; what the physical keys are permuted by. */
  deviceRotation: DeviceRotation;
  /** How far the app's rendered frame appears turned; what the mirror is counter-rotated by. */
  frameRotation: DeviceRotation;
  source: RotationSource;
  pin: (rotation: DeviceRotation) => void;
  clearPin: () => void;
}

const isDeviceRotation = (value: number): value is DeviceRotation =>
  value === 0 || value === 90 || value === 180 || value === 270;

/**
 * The angle the app's own layout has been turned by.
 *
 * Under the shipping portrait lock this is a hard 0 rather than a read of
 * `screen.orientation.angle`: the property's sign convention differs between
 * implementations, and the one configuration that matters most is exactly the one
 * where the answer is known without asking.
 */
const readWindowRotation = (): DeviceRotation => {
  if (loadScreenOrientationMode() === "portrait") return 0;
  if (typeof window === "undefined") return 0;
  const angle = window.screen?.orientation?.angle;
  return typeof angle === "number" && isDeviceRotation(angle) ? angle : 0;
};

/**
 * Chassis orientation for Game Mode, with the dwell filter applied and a manual
 * override for the three cases a sensor cannot answer: a handset lying flat, a
 * platform whose runtime delivers no sensor callbacks, and a player lying down.
 *
 * The pin is per session rather than persisted — an orientation chosen for one
 * game should not still apply weeks later.
 */
export const useDeviceRotation = (active = true): DeviceRotationState => {
  const [sensorRotation, setSensorRotation] = useState<DeviceRotation>(0);
  const [pinnedRotation, setPinnedRotation] = useState<DeviceRotation | null>(null);
  const [windowRotation, setWindowRotation] = useState<DeviceRotation>(0);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) return;
    setWindowRotation(readWindowRotation());
    const sync = () => setWindowRotation(readWindowRotation());
    window.addEventListener("orientationchange", sync);
    return () => window.removeEventListener("orientationchange", sync);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let disposed = false;

    void readDeviceRotation().then((rotation) => {
      if (!disposed && isDeviceRotation(rotation)) setSensorRotation(rotation);
    });

    // A new value must hold for the dwell before it is published, so a handset
    // turned slowly changes the mapping once rather than at every sector it
    // passes through.
    const unsubscribe = subscribeDeviceRotation((rotation) => {
      if (!isDeviceRotation(rotation)) return;
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = setTimeout(() => {
        dwellTimerRef.current = null;
        setSensorRotation((current) => (current === rotation ? current : rotation));
      }, ROTATION_DWELL_MS);
    });

    return () => {
      disposed = true;
      if (dwellTimerRef.current) {
        clearTimeout(dwellTimerRef.current);
        dwellTimerRef.current = null;
      }
      unsubscribe();
    };
  }, [active]);

  const pin = useCallback((rotation: DeviceRotation) => setPinnedRotation(rotation), []);
  const clearPin = useCallback(() => setPinnedRotation(null), []);

  const deviceRotation = pinnedRotation ?? sensorRotation;
  return {
    deviceRotation,
    frameRotation: computeFrameRotation(deviceRotation, pinnedRotation === null ? windowRotation : 0),
    source: pinnedRotation === null ? "auto" : "pinned",
    pin,
    clearPin,
  };
};
