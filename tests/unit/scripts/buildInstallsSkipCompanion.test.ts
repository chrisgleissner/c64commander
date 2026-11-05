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

const buildScript = readFileSync(path.resolve(__dirname, "../../../build"), "utf8");

describe("./build --install-apk", () => {
  it("installs the Skip companion of the same build variant right after the app", () => {
    const installBlock = buildScript.slice(buildScript.indexOf('if [[ "$RUN_INSTALL_APK" == "true" ]]; then'));
    const appInstall = installBlock.indexOf('install -r "$APK_PATH"');
    const companionInstall = installBlock.indexOf('install -r "$SKIP_APK_PATH"');
    const launch = installBlock.indexOf('log "Launching app"');

    expect(installBlock).toContain(
      'SKIP_APK_PATH="$ROOT_DIR/android/skip-to-next/build/outputs/apk/$APK_VARIANT/skip-to-next-$APK_VARIANT.apk"',
    );
    expect(appInstall).toBeGreaterThan(-1);
    expect(companionInstall).toBeGreaterThan(appInstall);
    expect(launch).toBeGreaterThan(companionInstall);
  });
});
