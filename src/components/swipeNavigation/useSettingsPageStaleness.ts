/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { APP_SETTINGS_KEYS } from "@/lib/config/appSettings";
import { TAB_ROUTES, tabIndexForPath } from "@/lib/navigation/tabRoutes";

export const SETTINGS_PAGE_INDEX = TAB_ROUTES.findIndex((route) => route.path === "/settings");

const STORED_SETTING_EVENTS = [
  "c64u-app-settings-updated",
  "c64u-ui-preferences-changed",
  "c64u-device-safety-updated",
  "c64u-ram-dump-folder-updated",
];

/**
 * App settings that other pages write and that a kept Settings page either does not show or follows as they change.
 * Playback writes the learned SID model on every tune, which rebuilt Settings on each return to it.
 */
const SETTINGS_PAGE_IGNORES_KEYS: ReadonlySet<unknown> = new Set([
  APP_SETTINGS_KEYS.LEARNED_DEVICE_SID_MODEL_KEY,
  APP_SETTINGS_KEYS.PLAYBACK_ENGINE_KEY,
  APP_SETTINGS_KEYS.VIC_PALETTE_KEY,
  APP_SETTINGS_KEYS.PALETTE_TARGET_KEY,
  APP_SETTINGS_KEYS.STREAM_VIDEO_FRAME_RATE_MODE_KEY,
  APP_SETTINGS_KEYS.DEFAULT_SONG_DURATION_MS_KEY,
]);

const leavesSettingsCurrent = (event: Event) =>
  event.type === "c64u-app-settings-updated" &&
  SETTINGS_PAGE_IGNORES_KEYS.has((event as CustomEvent<{ key?: string }>).detail?.key);

/**
 * Settings reads its values from storage when it is built. Kept built while another page changes one of them (the
 * quick menu, the Demo Mode offer, the device switcher), it would show the old value, so it is rebuilt on return.
 * Decided while rendering the route change, so a stale Settings page is never shown for a frame first.
 */
export const useSettingsPageStaleness = (
  cachePages: boolean,
  routeIndex: number,
  setPageGenerations: Dispatch<SetStateAction<Readonly<Record<number, number>>>>,
): void => {
  const staleRef = useRef(false);
  useEffect(() => {
    if (!cachePages) return;
    const markStale = (event: Event) => {
      if (leavesSettingsCurrent(event)) return;
      if (tabIndexForPath(window.location.pathname) !== SETTINGS_PAGE_INDEX) staleRef.current = true;
    };
    STORED_SETTING_EVENTS.forEach((type) => window.addEventListener(type, markStale));
    return () => STORED_SETTING_EVENTS.forEach((type) => window.removeEventListener(type, markStale));
  }, [cachePages]);

  const [renderedRouteIndex, setRenderedRouteIndex] = useState(routeIndex);
  if (renderedRouteIndex !== routeIndex) {
    setRenderedRouteIndex(routeIndex);
    if (routeIndex === SETTINGS_PAGE_INDEX && staleRef.current) {
      staleRef.current = false;
      setPageGenerations((generations) => ({
        ...generations,
        [SETTINGS_PAGE_INDEX]: (generations[SETTINGS_PAGE_INDEX] ?? 0) + 1,
      }));
    }
  }
};
