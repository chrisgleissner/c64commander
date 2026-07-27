/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const SOURCE_LABELS = {
  local: "Local",
  c64u: "C64U",
  hvsc: "HVSC",
  commoserve: "CommoServe",
} as const;

export const SOURCE_EXPLANATIONS = {
  local: "Local Device",
  c64u: "Commodore 64 Ultimate",
  hvsc: "High Voltage SID Collection",
  commoserve: "Online File Archive",
} as const;

/**
 * What to call the connected machine, in one place.
 *
 * Its own name when we know it, `C64U` when we do not. Two reasons for that
 * order. First, "C64U" is only literally right for a Commodore 64 Ultimate, and
 * the broad C64 Commander variant also drives a U64 / Elite / Ultimate-II+ —
 * calling a U64 Elite "C64U" is simply wrong. Second, a user with two machines
 * saved is choosing between *those two*, and their own names are what tells them
 * apart.
 *
 * The "Choose source" dialog already worked this way. Everywhere else invented
 * its own wording — the Play page said "C64", playlist rows said "C64 Ultimate",
 * disks said "C64U" — so the same machine had three names in one app.
 */
export const connectedDeviceLabel = (deviceName?: string | null): string => deviceName?.trim() || SOURCE_LABELS.c64u;

/**
 * What to call this phone/tablet. `Local`, matching the source picker and the
 * disks list; the Play page used to say "This device".
 */
export const LOCAL_DEVICE_LABEL = SOURCE_LABELS.local;
