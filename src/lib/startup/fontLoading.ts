/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isNativePlatform } from "@/lib/native/platform";

export const GOOGLE_FONTS_STYLESHEET =
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap";

export const shouldLoadRemoteFonts = () => {
  if (import.meta.env.VITE_ENABLE_TEST_PROBES === "1") return false;
  return !isNativePlatform();
};

export const loadRemoteFonts = (doc: Document = document) => {
  if (!shouldLoadRemoteFonts()) return false;
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = GOOGLE_FONTS_STYLESHEET;
  doc.head.appendChild(link);
  return true;
};
