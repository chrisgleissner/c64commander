/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_BOOT_MENU_KEY,
  DEFAULT_BOOT_SETTLE_MS,
  DEFAULT_STREAM_AUDIO_PORT,
  DEFAULT_STREAM_VIDEO_PORT,
  loadBootMenuAnswerEnabled,
  loadBootMenuKey,
  loadBootSettleMs,
  loadSearchInsideDisks,
  loadStreamAudioPort,
  loadStreamVideoPort,
  saveBootMenuAnswerEnabled,
  saveBootMenuKey,
  saveBootSettleMs,
  saveSearchInsideDisks,
  saveStreamAudioPort,
  saveStreamVideoPort,
} from "@/lib/config/appSettings";

describe("Content Explorer app settings", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("boot-menu answer defaults off and round-trips", () => {
    expect(loadBootMenuAnswerEnabled()).toBe(false);
    saveBootMenuAnswerEnabled(true);
    expect(loadBootMenuAnswerEnabled()).toBe(true);
  });

  it("boot-menu key defaults to F7 and normalizes an invalid value", () => {
    expect(loadBootMenuKey()).toBe(DEFAULT_BOOT_MENU_KEY);
    saveBootMenuKey("F3");
    expect(loadBootMenuKey()).toBe("F3");
    localStorage.setItem("c64u_boot_menu_key", "NOPE");
    expect(loadBootMenuKey()).toBe(DEFAULT_BOOT_MENU_KEY);
  });

  it("boot settle clamps to [1000, 8000] rounded to 100ms", () => {
    expect(loadBootSettleMs()).toBe(DEFAULT_BOOT_SETTLE_MS);
    saveBootSettleMs(500);
    expect(loadBootSettleMs()).toBe(1000);
    saveBootSettleMs(99999);
    expect(loadBootSettleMs()).toBe(8000);
    saveBootSettleMs(3040);
    expect(loadBootSettleMs()).toBe(3000);
  });

  it("search-inside-disks defaults off and round-trips", () => {
    expect(loadSearchInsideDisks()).toBe(false);
    saveSearchInsideDisks(true);
    expect(loadSearchInsideDisks()).toBe(true);
  });

  it("stream ports default 11000/11001 and clamp to [1, 65535]", () => {
    expect(loadStreamVideoPort()).toBe(DEFAULT_STREAM_VIDEO_PORT);
    expect(loadStreamAudioPort()).toBe(DEFAULT_STREAM_AUDIO_PORT);
    saveStreamVideoPort(21000);
    expect(loadStreamVideoPort()).toBe(21000);
    saveStreamAudioPort(70000);
    expect(loadStreamAudioPort()).toBe(65535);
    saveStreamVideoPort(0);
    expect(loadStreamVideoPort()).toBe(1);
  });

  it("stream port load falls back to the default on a corrupt stored value", () => {
    localStorage.setItem("c64u_stream_video_port", "not-a-number");
    expect(loadStreamVideoPort()).toBe(DEFAULT_STREAM_VIDEO_PORT);
  });
});
