/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { resolveVideoStartAction, shouldReturnAudioToWifi, shouldUseWifiForAudio } from "@/lib/streams/audioRoute";

describe("audioRoute", () => {
  describe("shouldUseWifiForAudio", () => {
    it("uses Wi‑Fi for audio-only under dynamic and wifi policies", () => {
      expect(shouldUseWifiForAudio({ policy: "dynamic", videoActive: false })).toBe(true);
      expect(shouldUseWifiForAudio({ policy: "wifi", videoActive: false })).toBe(true);
    });

    it("never uses Wi‑Fi while video is active (audio joins the Ethernet route)", () => {
      expect(shouldUseWifiForAudio({ policy: "dynamic", videoActive: true })).toBe(false);
      expect(shouldUseWifiForAudio({ policy: "wifi", videoActive: true })).toBe(false);
    });

    it("never uses Wi‑Fi under the ethernet policy", () => {
      expect(shouldUseWifiForAudio({ policy: "ethernet", videoActive: false })).toBe(false);
      expect(shouldUseWifiForAudio({ policy: "ethernet", videoActive: true })).toBe(false);
    });
  });

  describe("resolveVideoStartAction", () => {
    it("starts video directly when audio is not on Wi‑Fi", () => {
      expect(resolveVideoStartAction({ policy: "dynamic", audioOnWifi: false })).toBe("start");
      expect(resolveVideoStartAction({ policy: "ethernet", audioOnWifi: false })).toBe("start");
      expect(resolveVideoStartAction({ policy: "wifi", audioOnWifi: false })).toBe("start");
    });

    it("converts audio to Ethernet first under the dynamic policy", () => {
      expect(resolveVideoStartAction({ policy: "dynamic", audioOnWifi: true })).toBe("convert-audio-then-start");
    });

    it("blocks video under the wifi policy (keeps audio on Wi‑Fi)", () => {
      expect(resolveVideoStartAction({ policy: "wifi", audioOnWifi: true })).toBe("blocked");
    });
  });

  describe("shouldReturnAudioToWifi", () => {
    it("returns audio to Wi‑Fi on video stop only under dynamic, and only if we moved it", () => {
      expect(shouldReturnAudioToWifi({ policy: "dynamic", audioForcedToEthernet: true })).toBe(true);
      expect(shouldReturnAudioToWifi({ policy: "dynamic", audioForcedToEthernet: false })).toBe(false);
      expect(shouldReturnAudioToWifi({ policy: "wifi", audioForcedToEthernet: true })).toBe(false);
      expect(shouldReturnAudioToWifi({ policy: "ethernet", audioForcedToEthernet: true })).toBe(false);
    });
  });
});
