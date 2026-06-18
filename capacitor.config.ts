/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { CapacitorConfig } from "@capacitor/cli";
import { variant } from "./src/generated/variant";

const config: CapacitorConfig = {
  // Capacitor's appId drives iOS; on Android the Gradle applicationId from
  // src/generated/variant.json governs. Android-only variants omit the iOS
  // block, so fall back to the Android application id.
  appId: variant.platform.ios?.bundleId ?? variant.platform.android.applicationId,
  appName: variant.displayName,
  webDir: "dist",
  server: {
    androidScheme: "http",
  },
  plugins: {
    // CAPACITOR_HTTP_EXEMPTION
    //
    // Verified on Pixel 4 against u64 (2026-05-07): the C64U firmware does
    // not send Access-Control-Allow-Origin headers, so direct WebView fetch
    // from http://localhost (Capacitor) to http://<device-ip> is blocked
    // by CORS with "TypeError: Failed to fetch". CapacitorHttp routes the
    // request through a native HTTP client that bypasses CORS, which is
    // load-bearing for every REST call to the device.
    //
    // Until the firmware exposes CORS headers (out of scope) or a custom
    // native HTTP plugin replaces this path, CapacitorHttp must stay on.
    // The cookie-plugin overhead (R-HTTP-2) is mitigated below.
    CapacitorHttp: {
      enabled: true,
    },
    // The C64U has no cookie state. Disabling the CapacitorCookies plugin
    // removes a per-request "Getting cookies at: ..." JNI hop that the
    // research flagged as overhead.
    CapacitorCookies: {
      enabled: false,
    },
  },
};

export default config;
