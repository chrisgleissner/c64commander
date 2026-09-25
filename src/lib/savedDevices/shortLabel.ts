/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ProductFamilyCode } from "@/lib/savedDevices/store";

/** The longest label the header can spare beside the page title on a 320 px screen. */
export const SHORT_DEVICE_LABEL_MAX_CHARS = 10;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * A name for the device short enough for the header of a phone, from its saved label (the user's
 * own name for it, which is at most ten characters, or its host): the label itself when it is short,
 * else the product it is. Never an IP address, which truncated to "192.168.1.…" names nothing.
 */
export const buildDeviceShortLabel = (savedLabel: string, product: ProductFamilyCode | null): string | null => {
  const label = savedLabel.trim().replace(/:\d+$/, "");
  const firstPart = IPV4.test(label) ? "" : (label.split(".")[0] ?? "");
  if (firstPart && firstPart.length <= SHORT_DEVICE_LABEL_MAX_CHARS) return firstPart;
  return product;
};
