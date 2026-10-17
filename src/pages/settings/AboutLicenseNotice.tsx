/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { variant } from "@/generated/variant";

export const SOURCE_CODE_URL = "https://github.com/chrisgleissner/c64commander";
export const GPL_V3_URL = "https://www.gnu.org/licenses/gpl-3.0.html";

export const AboutLicenseNotice = () => (
  <p className="text-xs text-muted-foreground" data-testid="settings-about-license-notice">
    {variant.displayName} is free software under the{" "}
    <a
      href={GPL_V3_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="hit-area-44 text-primary hover:underline"
      data-testid="settings-about-license-text"
    >
      GNU GPL v3 or later
    </a>
    , with no warranty.{" "}
    <a
      href={SOURCE_CODE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="hit-area-44 text-primary hover:underline"
      data-testid="settings-about-source-code"
    >
      Get the source code
    </a>
    .
  </p>
);
