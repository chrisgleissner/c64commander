/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { shouldEnterGameModeOnLaunch } from "@/lib/remoteInput/gameModeLaunch";
import {
  addThenMaybeLaunch,
  PICKER_ADD_LABEL,
  PICKER_PLAY_LABEL,
  resolvePickerConfirm,
} from "@/pages/playFiles/playFilesUtils";
import { resolveGuidanceLabels, type GuidanceState } from "@/lib/input/guidance";

const launch = (overrides: Partial<Parameters<typeof shouldEnterGameModeOnLaunch>[0]> = {}) =>
  shouldEnterGameModeOnLaunch({
    category: "prg",
    origin: "user",
    sheetAlreadyOpen: false,
    enabled: true,
    ...overrides,
  });

// GM-18. A rule of four conditions is where a later change silently drops one, so
// each gets its own test rather than sharing a table row.
describe("shouldEnterGameModeOnLaunch", () => {
  it("enters for a program, cartridge or disk image the user started", () => {
    expect(launch({ category: "prg" })).toBe(true);
    expect(launch({ category: "crt" })).toBe(true);
    expect(launch({ category: "disk" })).toBe(true);
  });

  it("does not enter for a tune", () => {
    expect(launch({ category: "sid" })).toBe(false);
    expect(launch({ category: "mod" })).toBe(false);
  });

  it("does not enter when a playlist moved on by itself", () => {
    expect(launch({ origin: "auto" })).toBe(false);
  });

  it("does not enter when the sheet is already open", () => {
    expect(launch({ sheetAlreadyOpen: true })).toBe(false);
  });

  it("does not enter when the setting is off", () => {
    expect(launch({ enabled: false })).toBe(false);
  });
});

// GM-20.
describe("resolvePickerConfirm", () => {
  it("offers Play, and launches, for exactly one game", () => {
    expect(resolvePickerConfirm([{ type: "file", path: "/games/boulder.prg" }])).toEqual({
      label: PICKER_PLAY_LABEL,
      launches: true,
    });
    expect(resolvePickerConfirm([{ type: "file", path: "/games/epyx.crt" }]).launches).toBe(true);
    expect(resolvePickerConfirm([{ type: "file", path: "/games/summer.d64" }]).launches).toBe(true);
  });

  it("keeps queueing for a tune, because a tune is what a queue is for", () => {
    expect(resolvePickerConfirm([{ type: "file", path: "/music/commando.sid" }])).toEqual({
      label: PICKER_ADD_LABEL,
      launches: false,
    });
  });

  // Online Archive results are `"<id>/<numeric archive category>"`, and what the entry holds is
  // not known until it has been fetched. The button must not promise Play before then.
  it("keeps queueing for an Online Archive result, whose contents are not yet known", () => {
    expect(resolvePickerConfirm([{ type: "file", path: "31337/1" }])).toEqual({
      label: PICKER_ADD_LABEL,
      launches: false,
    });
  });

  it("keeps queueing for several files", () => {
    expect(
      resolvePickerConfirm([
        { type: "file", path: "/games/a.prg" },
        { type: "file", path: "/games/b.prg" },
      ]),
    ).toEqual({ label: PICKER_ADD_LABEL, launches: false });
  });

  it("keeps queueing for a folder", () => {
    expect(resolvePickerConfirm([{ type: "dir", path: "/games" }])).toEqual({
      label: PICKER_ADD_LABEL,
      launches: false,
    });
  });

  it("keeps queueing for an empty selection and for a file it cannot classify", () => {
    expect(resolvePickerConfirm([]).launches).toBe(false);
    expect(resolvePickerConfirm([{ type: "file", path: "/games/readme.txt" }]).launches).toBe(false);
  });
});

// GM-17: the shortcut has to be discoverable, and the guidance bar is on screen
// exactly when the user is driving by keys.
describe("the guidance bar's Game Mode hint", () => {
  const state = (overrides: Partial<GuidanceState> = {}): GuidanceState => ({
    enabled: true,
    modality: "key-navigation",
    hasCurrent: true,
    currentKind: "button",
    breadcrumb: ["Quick Actions"],
    atRoot: true,
    fieldEngaged: false,
    layerOpen: false,
    hasMenu: false,
    gameModeShortcut: true,
    ...overrides,
  });

  it("names the action where the shortcut applies", () => {
    expect(resolveGuidanceLabels(state()).shortcut).toBe("Game Mode");
  });

  it("is hidden where it does not", () => {
    expect(resolveGuidanceLabels(state({ gameModeShortcut: false })).shortcut).toBeNull();
  });

  it("does not disturb the soft-key labels", () => {
    const labels = resolveGuidanceLabels(state());
    expect(labels.left).toBe("Back");
    expect(labels.center).toBe("Activate");
    expect(labels.right).toBeNull();
  });
});

describe("addThenMaybeLaunch", () => {
  const stub = (overrides: Partial<Parameters<typeof addThenMaybeLaunch<string>>[0]> = {}) => ({
    launches: true,
    add: () => Promise.resolve(true),
    takeLaunchTarget: () => "the-item" as string | undefined,
    launch: () => Promise.resolve(),
    ...overrides,
  });

  it("launches the added item when confirming means Play", async () => {
    const launched: string[] = [];
    const added = await addThenMaybeLaunch(stub({ launch: (item) => (launched.push(item), Promise.resolve()) }));
    expect(added).toBe(true);
    expect(launched).toEqual(["the-item"]);
  });

  it("does not launch when confirming only queues", async () => {
    const launched: string[] = [];
    await addThenMaybeLaunch(stub({ launches: false, launch: (item) => (launched.push(item), Promise.resolve()) }));
    expect(launched).toEqual([]);
  });

  it("does not launch when the add itself failed", async () => {
    const launched: string[] = [];
    const added = await addThenMaybeLaunch(
      stub({ add: () => Promise.resolve(false), launch: (item) => (launched.push(item), Promise.resolve()) }),
    );
    expect(added).toBe(false);
    expect(launched).toEqual([]);
  });

  // The defect this guards: the item is already in the playlist when the launch runs, so a
  // launch failure that rejected out of here made the picker report "Add items failed" over an
  // add that had worked. The launch reports its own failure with the real reason.
  it("still reports the add as successful when the launch fails", async () => {
    await expect(
      addThenMaybeLaunch(stub({ launch: () => Promise.reject(new Error("Host unreachable")) })),
    ).resolves.toBe(true);
  });

  it("does nothing beyond the add when there is no item to launch", async () => {
    await expect(addThenMaybeLaunch(stub({ takeLaunchTarget: () => undefined }))).resolves.toBe(true);
  });
});
