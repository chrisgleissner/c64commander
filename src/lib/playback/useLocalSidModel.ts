/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";

import {
  loadLearnedDeviceSidModel,
  loadLocalSidModelFromDevice,
  resolveLocalSidModel,
  type LocalSidModel,
} from "@/lib/config/appSettings";

/**
 * The chip on-device playback currently falls back to, re-read on the app-settings broadcast.
 *
 * Reactive because two different things move it: the Settings controls, and the background read of
 * the connected Ultimate. Without the subscription the Settings screen would keep showing whatever
 * was true when it mounted, so learning the chip from the device would look as though it had done
 * nothing.
 */
export const useLocalSidModel = (): LocalSidModel => {
  const [model, setModel] = useState(resolveLocalSidModel);
  useEffect(() => {
    const handler = () => setModel(resolveLocalSidModel());
    window.addEventListener("c64u-app-settings-updated", handler);
    return () => window.removeEventListener("c64u-app-settings-updated", handler);
  }, []);
  return model;
};

/**
 * Whether the chip should be taken from the connected Ultimate.
 *
 * Reactive so that switching it on in Settings reads the machine there and then, rather than at
 * the next connection: the user has just asked the question, and the answer belongs on the screen
 * they asked it from.
 */
export const useLocalSidModelFromDevice = (): boolean => {
  const [enabled, setEnabled] = useState(loadLocalSidModelFromDevice);
  useEffect(() => {
    const handler = () => setEnabled(loadLocalSidModelFromDevice());
    window.addEventListener("c64u-app-settings-updated", handler);
    return () => window.removeEventListener("c64u-app-settings-updated", handler);
  }, []);
  return enabled;
};

/** The chip last read from a connected Ultimate, or null if none ever has been. */
export const useLearnedDeviceSidModel = (): LocalSidModel | null => {
  const [model, setModel] = useState(loadLearnedDeviceSidModel);
  useEffect(() => {
    const handler = () => setModel(loadLearnedDeviceSidModel());
    window.addEventListener("c64u-app-settings-updated", handler);
    return () => window.removeEventListener("c64u-app-settings-updated", handler);
  }, []);
  return model;
};
