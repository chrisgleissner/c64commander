/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("SID Player wiring at the app root", () => {
  const app = source("src/App.tsx");

  it("SPM-NAV-04 the app mounts the hidden-route redirect inside the router", () => {
    const router = app.indexOf("<BrowserRouter");
    expect(router).toBeGreaterThan(-1);
    expect(app.indexOf("<HiddenRouteRedirect />")).toBeGreaterThan(router);
  });

  it("SPM-SWT-01 the app mounts the mode dialogs once", () => {
    expect(app.match(/<ModeDialogs \/>/g)).toHaveLength(1);
  });

  it("SPM-NAV-04 the entry point normalizes the launch location before it renders", () => {
    const main = source("src/main.tsx");
    const normalize = main.indexOf("normalizeInitialLocation();");
    expect(normalize).toBeGreaterThan(-1);
    expect(normalize).toBeLessThan(main.indexOf("createRoot("));
  });
});
