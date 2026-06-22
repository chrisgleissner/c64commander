/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Auto-advance is a critical feature that must keep working when the user
 * navigates away from the Play page, backgrounds the app, locks the screen, or
 * lets the screensaver / flip-cover engage. The hard wiring that makes that
 * possible lives in PlayFilesPage, and a single mis-routed prop silently breaks
 * it (TypeScript flags it, but the project has no `tsc` CI gate, so a contract
 * test is the regression guard).
 *
 * These assertions lock down the wiring that connects the JS auto-advance guard
 * to (1) persistence — so a track that becomes due while the process is dead
 * resumes correctly — and (2) the native background watchdog — so the device is
 * advanced while the WebView's foreground timer is frozen (screen off / locked).
 */
const testFilePath = fileURLToPath(import.meta.url);
const pagePath = resolve(dirname(testFilePath), "../../../../src/pages/PlayFilesPage.tsx");
const pageSource = readFileSync(pagePath, "utf8");

const sliceHookCall = (hookName: string): string => {
  const start = pageSource.indexOf(`${hookName}({`);
  expect(start, `expected PlayFilesPage to call ${hookName}({ ... })`).toBeGreaterThanOrEqual(0);
  const end = pageSource.indexOf("});", start);
  expect(end, `expected ${hookName}({ ... }) call to terminate`).toBeGreaterThan(start);
  return pageSource.slice(start, end);
};

// Matches a prop line that passes the auto-advance VALUE (not the `set...` setter).
const passesAutoAdvanceValue = /\n\s*autoAdvanceDueAtMs,/;
const passesAutoAdvanceSetter = /\n\s*setAutoAdvanceDueAtMs,/;

describe("PlayFilesPage auto-advance wiring", () => {
  it("routes the auto-advance due-time VALUE to persistence, not the controller", () => {
    const controllerCall = sliceHookCall("usePlaybackController");
    const persistenceCall = sliceHookCall("usePlaybackPersistence");

    // Persistence must receive the absolute due-time so it is written to the
    // session snapshot; on resume an overdue track advances immediately instead
    // of restarting a full remaining-time timer (the kill/background case).
    expect(persistenceCall).toMatch(passesAutoAdvanceValue);

    // The controller derives the due-time itself and only needs the setter; it
    // must NOT be handed the value (that was the regression — the value went to
    // the controller, so persistence silently received `undefined`).
    expect(controllerCall).not.toMatch(passesAutoAdvanceValue);
  });

  it("gives both the controller and persistence the setter so either can re-arm the guard", () => {
    expect(sliceHookCall("usePlaybackController")).toMatch(passesAutoAdvanceSetter);
    expect(sliceHookCall("usePlaybackPersistence")).toMatch(passesAutoAdvanceSetter);
  });

  it("mirrors the JS due-time to the native background watchdog so it survives a frozen WebView", () => {
    // When the screen is off/locked the foreground 1s timer is throttled; the
    // native foreground-service watchdog must be told the absolute due-time so it
    // can broadcast `backgroundAutoSkipDue` and drive the next track.
    expect(pageSource).toContain("void queueBackgroundDueAtUpdate(autoAdvanceDueAtMs);");
    expect(pageSource).toContain("await BackgroundExecution.setDueAtMs({ dueAtMs: nextDueAtMs });");
  });

  it("keeps the background guard alive across Play-page unmount while still playing", () => {
    // Navigating away must NOT release the wake lock / clear the watchdog while a
    // track is still playing, otherwise auto-advance dies the moment you leave
    // the page. The unmount cleanup must early-return in that case.
    const unmountCleanup = pageSource.slice(
      pageSource.indexOf("Leaving background playback guard active across Play page unmount"),
      pageSource.indexOf("Leaving background playback guard active across Play page unmount") + 400,
    );
    expect(unmountCleanup).toContain("return;");
  });
});
