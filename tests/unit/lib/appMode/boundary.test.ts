/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { rulesHit } from "../../../helpers/lintText";
// @ts-expect-error The config is plain JavaScript.
import { APP_MODE_INTERNALS, APP_MODE_INTERNALS_ALLOWED_IMPORTERS } from "../../../../eslint.config.js";

const ROOT = process.cwd();

describe("the app mode boundary", () => {
  const importOfInternal = `import { switchToFullApp } from "@/lib/appMode/appModeTransitions";\nexport const x = switchToFullApp;\n`;

  it("forbids importing the mode machinery from a page", async () => {
    expect(await rulesHit(importOfInternal, "src/pages/SettingsPage.tsx")).toContain("no-restricted-imports");
  });

  it("allows the mode module and the mode dialogs to import it", async () => {
    expect(await rulesHit(importOfInternal, "src/components/appMode/ModeDialogs.tsx")).not.toContain(
      "no-restricted-imports",
    );
    expect(await rulesHit(importOfInternal, "src/lib/appMode/surfaces.ts")).not.toContain("no-restricted-imports");
  });

  it("allows the public API anywhere", async () => {
    const code = `import { useAppMode } from "@/lib/appMode/appModeStore";\nexport const x = useAppMode;\n`;
    expect(await rulesHit(code, "src/pages/SettingsPage.tsx")).not.toContain("no-restricted-imports");
  });

  it("lists as importers only files that still import an internal module", () => {
    const stale = APP_MODE_INTERNALS_ALLOWED_IMPORTERS.filter((entry: string) => !entry.endsWith("/**")).filter(
      (file: string) =>
        !APP_MODE_INTERNALS.some((internal: string) => readFileSync(path.join(ROOT, file), "utf8").includes(internal)),
    );

    expect(stale).toEqual([]);
  });
});
