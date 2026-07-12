/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { QueryClient } from "@tanstack/react-query";

/**
 * Registry for the app's single React Query client so non-React library code can
 * invalidate device-scoped caches.
 *
 * Motivation (HARD19-012): `tryReachableSavedDeviceFallback` in connectionManager
 * is a second device-switch path that runs outside React and therefore had no
 * access to the `useQueryClient()` instance the canonical `executeSavedDeviceSwitch`
 * uses. The shared `prepareForDeviceRetarget` hygiene helper needs to invalidate
 * device-scoped queries from that lib context, so App.tsx registers its client
 * here at module load.
 */
let registeredQueryClient: QueryClient | null = null;

export const registerQueryClient = (client: QueryClient | null): void => {
  registeredQueryClient = client;
};

export const getRegisteredQueryClient = (): QueryClient | null => registeredQueryClient;
