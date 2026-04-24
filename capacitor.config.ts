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
  appId: variant.platform.ios.bundleId,
  appName: variant.displayName,
  webDir: "dist",
  server: {
    androidScheme: "http",
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
