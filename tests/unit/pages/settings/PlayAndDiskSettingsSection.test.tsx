/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FeatureFlagsProvider } from "@/hooks/useFeatureFlags";
import { PlayAndDiskSettingsSection } from "@/pages/settings/PlayAndDiskSettingsSection";
import { writeSectionState } from "@/lib/ui/collapsibleSectionStore";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";
import {
  loadBootMenuAnswerEnabled,
  loadBootMenuKey,
  loadBootSettleMs,
  loadDiskAutostartMode,
  loadFriendlySidNames,
  loadSearchInsideDisks,
  loadStreamAudioPort,
  loadStreamInputPriority,
  loadStreamNativeAudio,
  loadStreamNativeVideoAssembly,
  loadStreamNetworkBufferMs,
  loadStreamVideoBadges,
  loadStreamVideoPort,
} from "@/lib/config/appSettings";
import { getListPreviewLimit } from "@/lib/uiPreferences";
import { featureFlagManager } from "@/lib/config/featureFlags";

const renderOpen = () => {
  writeSectionState("settings", "play-and-disk", true);
  return render(
    <FeatureFlagsProvider>
      <PlayAndDiskSettingsSection />
    </FeatureFlagsProvider>,
  );
};

describe("PlayAndDiskSettingsSection", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => saveStartupModeByUser("default"));

  it("SPM-SET-02 SID Player keeps list preview and friendly names only, under the title Play", () => {
    saveStartupModeByUser("sid-player");
    renderOpen();

    expect(screen.getByText("Play")).toBeInTheDocument();
    expect(screen.queryByText("Play and disk")).toBeNull();
    expect(screen.getByLabelText("List preview limit")).toBeInTheDocument();
    expect(screen.getByTestId("settings-friendly-sid-names")).toBeInTheDocument();
    expect(screen.queryByLabelText("Disk first-PRG load")).toBeNull();
    expect(screen.queryByTestId("settings-autofire-rate-slider")).toBeNull();
    expect(screen.queryByTestId("settings-launch-safety")).toBeNull();
    expect(screen.queryByText(/Autofire rate/)).toBeNull();
  });

  it("SPM-SET-02 the Full App keeps every row under Play and disk", () => {
    renderOpen();

    expect(screen.getByText("Play and disk")).toBeInTheDocument();
    expect(screen.getByLabelText("List preview limit")).toBeInTheDocument();
    expect(screen.getByText("Disk first-PRG load")).toBeInTheDocument();
    expect(screen.getByTestId("settings-autofire-rate-slider")).toBeInTheDocument();
  });

  it("commits the clamped list preview limit when Enter is pressed", () => {
    renderOpen();
    const input = screen.getByLabelText("List preview limit");

    fireEvent.change(input, { target: { value: "250" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(getListPreviewLimit()).toBe(200);
    expect(input).toHaveValue(200);
  });

  it("persists friendly SID names when the switch is enabled", () => {
    localStorage.setItem("c64u_friendly_sid_names", "0");
    renderOpen();

    fireEvent.click(screen.getByTestId("settings-friendly-sid-names"));

    expect(loadFriendlySidNames()).toBe(true);
  });

  it("persists DMA when the disk first-PRG load mode is selected", () => {
    renderOpen();
    fireEvent.click(screen.getByLabelText("Disk first-PRG load"));
    fireEvent.click(screen.getByText("DMA"));

    expect(loadDiskAutostartMode()).toBe("dma");
  });

  it("persists searching inside disk images when enabled", async () => {
    await featureFlagManager.load();
    await featureFlagManager.applyBootstrapOverride("in_image_search_enabled", true);
    renderOpen();

    fireEvent.click(screen.getByTestId("settings-search-inside-disks"));

    expect(loadSearchInsideDisks()).toBe(true);
    await featureFlagManager.clearOverride("in_image_search_enabled");
  });

  it("persists cartridge boot-menu answering when enabled", () => {
    renderOpen();

    fireEvent.click(screen.getByTestId("settings-boot-menu-answer"));

    expect(loadBootMenuAnswerEnabled()).toBe(true);
    expect(screen.getByTestId("settings-boot-menu-key")).toBeInTheDocument();
  });

  it("persists the selected cartridge boot-menu key", () => {
    localStorage.setItem("c64u_boot_menu_answer_enabled", "1");
    renderOpen();
    fireEvent.click(screen.getByTestId("settings-boot-menu-key"));
    fireEvent.click(screen.getByText("SPACE"));

    expect(loadBootMenuKey()).toBe("SPACE");
  });

  it("persists the edited cartridge boot settle time", () => {
    localStorage.setItem("c64u_boot_menu_answer_enabled", "1");
    renderOpen();
    const input = screen.getByTestId("settings-boot-settle");

    fireEvent.change(input, { target: { value: "1500" } });
    fireEvent.blur(input);

    expect(loadBootSettleMs()).toBe(1500);
  });

  it("persists the edited video stream port", () => {
    renderOpen();
    const input = screen.getByTestId("settings-stream-video-port");

    fireEvent.change(input, { target: { value: "12000" } });
    fireEvent.blur(input);

    expect(loadStreamVideoPort()).toBe(12000);
  });

  it("persists the edited audio stream port", () => {
    renderOpen();
    const input = screen.getByTestId("settings-stream-audio-port");

    fireEvent.change(input, { target: { value: "12001" } });
    fireEvent.blur(input);

    expect(loadStreamAudioPort()).toBe(12001);
  });

  it("persists the edited audio network buffer", () => {
    renderOpen();
    const input = screen.getByTestId("settings-stream-network-buffer");

    fireEvent.change(input, { target: { value: "90" } });
    fireEvent.blur(input);

    expect(loadStreamNetworkBufferMs()).toBe(90);
  });

  it("persists native video assembly when enabled", () => {
    localStorage.setItem("c64u_stream_native_video_assembly", "0");
    renderOpen();

    fireEvent.click(screen.getByTestId("settings-stream-native-assembly"));

    expect(loadStreamNativeVideoAssembly()).toBe(true);
  });

  it("persists video badges when disabled", () => {
    localStorage.setItem("c64u_stream_video_badges", "1");
    renderOpen();

    fireEvent.click(screen.getByTestId("settings-stream-video-badges"));

    expect(loadStreamVideoBadges()).toBe(false);
  });

  it("persists instant input priority when enabled", () => {
    localStorage.setItem("c64u_stream_input_priority", "0");
    renderOpen();

    fireEvent.click(screen.getByTestId("settings-stream-input-priority"));

    expect(loadStreamInputPriority()).toBe(true);
  });

  it("persists native low-latency audio when enabled", () => {
    localStorage.setItem("c64u_stream_native_audio", "0");
    renderOpen();

    fireEvent.click(screen.getByTestId("settings-stream-native-audio"));

    expect(loadStreamNativeAudio()).toBe(true);
  });

  it("persists the autofire button visibility when enabled", () => {
    renderOpen();

    fireEvent.click(screen.getByTestId("settings-show-autofire"));

    expect(localStorage.getItem("c64u_remote_input_show_autofire")).toBe("1");
  });

  it("updates and persists the autofire rate from the slider", () => {
    renderOpen();
    fireEvent.click(screen.getByTestId("settings-show-autofire"));
    const slider = screen.getByTestId("settings-autofire-rate-slider");

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyUp(slider, { key: "ArrowRight" });

    expect(screen.getByText(/Autofire rate: 6\/s/)).toBeInTheDocument();
    expect(localStorage.getItem("c64u_remote_input_autofire_rate_hz")).toBe("6");
  });

  it("reloads disk autostart mode after its settings-updated event", () => {
    renderOpen();
    localStorage.setItem("c64u_disk_autostart_mode", "dma");
    window.dispatchEvent(new CustomEvent("c64u-app-settings-updated", { detail: { key: "c64u_disk_autostart_mode" } }));

    expect(loadDiskAutostartMode()).toBe("dma");
    expect(screen.getByText("Play and disk")).toBeInTheDocument();
  });
});
