/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const available = vi.hoisted(() => ({ value: true }));
const playback = vi.hoisted(() => ({ value: { local: false, remote: false, any: false } }));
const mirror = vi.hoisted(() => ({ value: { audioLive: false } }));
vi.mock("@/lib/audio/useAudioFxAvailable", () => ({ useAudioFxAvailable: () => available.value }));
vi.mock("@/hooks/useActivePlayback", () => ({ useActivePlayback: () => playback.value }));
const connection = vi.hoisted(() => ({ state: "REAL_CONNECTED" }));
vi.mock("@/hooks/useAvMirror", () => ({ useAvMirror: () => mirror.value }));
vi.mock("@/hooks/useConnectionState", () => ({ useConnectionState: () => ({ state: connection.state }) }));

import { PlaybackSoundCard, SOUND_ON_C64_MESSAGE, SoundCard, phoneSounds } from "@/components/playback/SoundCard";
import { AMBIANCE_PRESETS } from "@/lib/audio/tone/ambiancePresets";
import { soundAccent } from "@/lib/audio/tone/soundPalette";
import { loadAudioProcessing, loadAudioProcessingRecord } from "@/lib/config/audioProcessingSettings";

const openBody = () => {
  if (!screen.queryByTestId("sound-body")) fireEvent.click(screen.getByTestId("play-section-toggle-sound"));
};

describe("SoundCard", () => {
  beforeEach(() => {
    localStorage.clear();
    available.value = true;
    playback.value = { local: false, remote: false, any: false };
    mirror.value = { audioLive: false };
  });

  it("renders nothing where the phone cannot process its own sound", () => {
    available.value = false;
    render(<SoundCard c64Plays={false} />);
    expect(screen.queryByTestId("play-section-sound")).not.toBeInTheDocument();
  });

  it("closed, shows only the accent dot, the active name and the switch, with no chip row", () => {
    render(<SoundCard c64Plays={false} />);
    expect(screen.getByTestId("sound-accent-dot")).toBeInTheDocument();
    expect(screen.getByTestId("sound-active-name")).toHaveTextContent("Original");
    expect(screen.getByTestId("sound-switch")).toBeChecked();
    expect(screen.queryByTestId("sound-body")).not.toBeInTheDocument();
    for (const id of ["sound-chip-row", "sound-prev", "sound-next", "sound-back", "sound-unavailable"]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
  });

  it("lists every ambiance once open and marks the active one", () => {
    render(<SoundCard c64Plays={false} />);
    openBody();
    for (const preset of AMBIANCE_PRESETS) expect(screen.getByTestId(`sound-chip-${preset.id}`)).toBeInTheDocument();
    expect(screen.getByTestId("sound-chip-original")).toHaveAttribute("aria-pressed", "true");
  });

  it("wears the accent of the active ambiance, the custom one after a manual change and a neutral one when off", () => {
    const { container } = render(<SoundCard c64Plays={false} />);
    const scope = () => container.querySelector<HTMLElement>("[data-sound-accent]")!;
    openBody();
    const seen = new Set<string>();
    for (const preset of AMBIANCE_PRESETS) {
      fireEvent.click(screen.getByTestId(`sound-chip-${preset.id}`));
      expect(scope().dataset.soundAccent).toBe(preset.id);
      expect(scope().style.getPropertyValue("--snd-accent-l")).toBe(soundAccent(preset.id).accent.light);
      seen.add(scope().style.getPropertyValue("--snd-accent-d"));
    }
    expect(seen.size).toBe(AMBIANCE_PRESETS.length);
    fireEvent.click(screen.getByTestId("sound-reverb-notch-hall"));
    expect(scope().dataset.soundAccent).toBe("custom");
    fireEvent.click(screen.getByTestId("sound-switch"));
    expect(scope().dataset.soundAccent).toBe("off");
  });

  it("applies an ambiance with one tap and names it", () => {
    render(<SoundCard c64Plays={false} />);
    openBody();
    fireEvent.click(screen.getByTestId("sound-chip-hall"));
    expect(loadAudioProcessing()).toMatchObject({ stereoWidth: 70, reverb: 55 });
    expect(screen.getByTestId("sound-active-name")).toHaveTextContent("Hall");
    expect(screen.getByTestId("sound-chip-hall")).toHaveAttribute("aria-pressed", "true");
  });

  it("steps with the arrows and goes back to the previous sound", () => {
    render(<SoundCard c64Plays={false} />);
    openBody();
    expect(screen.getByTestId("sound-back")).toBeDisabled();
    fireEvent.click(screen.getByTestId("sound-next"));
    expect(screen.getByTestId("sound-active-name")).toHaveTextContent(AMBIANCE_PRESETS[1].label);
    fireEvent.click(screen.getByTestId("sound-next"));
    fireEvent.click(screen.getByTestId("sound-back"));
    expect(screen.getByTestId("sound-active-name")).toHaveTextContent(AMBIANCE_PRESETS[1].label);
    fireEvent.click(screen.getByTestId("sound-prev"));
    expect(screen.getByTestId("sound-active-name")).toHaveTextContent("Original");
  });

  it("compares with the original sound by switching off and on without losing settings, reading Off meanwhile", () => {
    render(<SoundCard c64Plays={false} />);
    openBody();
    fireEvent.click(screen.getByTestId("sound-chip-hall"));
    fireEvent.click(screen.getByTestId("sound-switch"));
    expect(loadAudioProcessing().reverb).toBe(0);
    expect(screen.getByTestId("sound-active-name")).toHaveTextContent("Off");
    fireEvent.click(screen.getByTestId("sound-switch"));
    expect(loadAudioProcessing().reverb).toBe(55);
    expect(screen.getByTestId("sound-active-name")).toHaveTextContent("Hall");
  });

  it("reads Custom after a manual change in the expanded card", () => {
    render(<SoundCard c64Plays={false} />);
    openBody();
    fireEvent.click(screen.getByTestId("sound-reverb-notch-room"));
    expect(screen.getByTestId("sound-active-name")).toHaveTextContent("Custom");
    expect(loadAudioProcessingRecord().sound.reverb).toBe(25);
  });

  it("applies a tone preset and highlights it", () => {
    render(<SoundCard c64Plays={false} />);
    openBody();
    fireEvent.click(screen.getByTestId("sound-tone-preset-bass-boost"));
    expect(loadAudioProcessingRecord().sound.bandsDb).toEqual([6, 6, 5, 3, 1, 0, 0, 0, 0, 0]);
    expect(screen.getByTestId("sound-tone-preset-bass-boost")).toHaveAttribute("aria-pressed", "true");
  });

  it("sets normalize volume with its switch, and stereo width and reverb with notched sliders only", () => {
    render(<SoundCard c64Plays={false} />);
    openBody();
    fireEvent.click(screen.getByTestId("sound-levelling"));
    expect(loadAudioProcessing().levelling).toBe(true);
    for (const id of ["sound-stereo-fine", "sound-stereo-amount", "sound-stereo-subtle", "sound-reverb-room"]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
    const thumb = within(screen.getByTestId("sound-stereo")).getByRole("slider");
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(loadAudioProcessing().stereoWidth).toBe(35);
    fireEvent.click(screen.getByTestId("sound-reverb-notch-hall"));
    expect(loadAudioProcessing().reverb).toBe(55);
  });

  it("saves, renames and deletes a user sound", () => {
    render(<SoundCard c64Plays={false} />);
    openBody();
    fireEvent.click(screen.getByTestId("sound-chip-hall"));
    fireEvent.click(screen.getByTestId("sound-save-preset"));
    expect(screen.getByTestId("sound-preset-name-save")).toBeDisabled();
    fireEvent.change(screen.getByTestId("sound-preset-name"), { target: { value: "Evening" } });
    fireEvent.click(screen.getByTestId("sound-preset-name-save"));
    expect(screen.getByTestId("sound-chip-user-1")).toHaveTextContent("Evening");
    fireEvent.click(screen.getByTestId("sound-user-user-1-rename"));
    fireEvent.change(screen.getByTestId("sound-preset-name"), { target: { value: "Late" } });
    fireEvent.keyDown(screen.getByTestId("sound-preset-name"), { key: "Enter" });
    expect(screen.getByTestId("sound-chip-user-1")).toHaveTextContent("Late");
    fireEvent.click(screen.getByTestId("sound-save-preset"));
    fireEvent.click(screen.getByTestId("sound-preset-name-cancel"));
    expect(screen.queryByTestId("sound-preset-name")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("sound-user-user-1-delete"));
    expect(screen.queryByTestId("sound-chip-user-1")).not.toBeInTheDocument();
  });

  it("stops offering to save at five user sounds", () => {
    render(<SoundCard c64Plays={false} />);
    openBody();
    for (let n = 1; n <= 5; n += 1) {
      fireEvent.click(screen.getByTestId("sound-save-preset"));
      fireEvent.change(screen.getByTestId("sound-preset-name"), { target: { value: `Mine ${n}` } });
      fireEvent.click(screen.getByTestId("sound-preset-name-save"));
    }
    expect(screen.getByTestId("sound-save-preset")).toBeDisabled();
    expect(screen.getByTestId("sound-save-preset")).toHaveTextContent("Limit reached");
  });

  it("explains itself and disables every control while the C64 plays the sound", () => {
    render(<SoundCard c64Plays />);
    openBody();
    expect(screen.getByTestId("sound-unavailable")).toHaveTextContent(SOUND_ON_C64_MESSAGE);
    for (const id of ["sound-switch", "sound-prev", "sound-next", "sound-chip-hall", "sound-reverb-notch-room"]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
    expect(screen.getByTestId("sound-reverb-thumb")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("sound-reverb-thumb")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByTestId("sound-tone-plot")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByTestId("sound-chip-hall"));
    expect(loadAudioProcessing().reverb).toBe(0);
  });
});

describe("phoneSounds", () => {
  const idle = { local: false, remote: false, mirrorAudio: false };
  it.each([
    ["Listen on is the C64 and nothing plays", { engine: "c64", connectionState: "REAL_CONNECTED", ...idle }, false],
    ["Listen on is here and nothing plays", { engine: "local", connectionState: "REAL_CONNECTED", ...idle }, true],
    [
      "Listen on is the C64 with no device in reach",
      { engine: "c64", connectionState: "OFFLINE_NO_DEMO", ...idle },
      true,
    ],
    ["Listen on is the C64 in Demo Mode", { engine: "c64", connectionState: "DEMO_ACTIVE", ...idle }, true],
    ["a tune plays on the C64", { engine: "c64", connectionState: "REAL_CONNECTED", ...idle, remote: true }, false],
    [
      "a tune plays on the C64 with its sound mirrored here",
      { engine: "c64", connectionState: "REAL_CONNECTED", ...idle, remote: true, mirrorAudio: true },
      true,
    ],
    ["a tune carried on here", { engine: "c64", connectionState: "REAL_CONNECTED", ...idle, local: true }, true],
  ] as const)("answers correctly when %s", (_name, sources, expected) => {
    expect(phoneSounds(sources)).toBe(expected);
  });
});

describe("PlaybackSoundCard", () => {
  beforeEach(() => {
    localStorage.clear();
    available.value = true;
    mirror.value = { audioLive: false };
    connection.state = "REAL_CONNECTED";
  });

  it("is disabled with its explanation while Listen on is the C64 and nothing plays yet", () => {
    localStorage.setItem("c64u_playback_engine", "c64");
    playback.value = { local: false, remote: false, any: false };
    render(<PlaybackSoundCard />);
    openBody();
    expect(screen.getByTestId("sound-unavailable")).toHaveTextContent(SOUND_ON_C64_MESSAGE);
    expect(screen.getByTestId("sound-switch")).toBeDisabled();
  });

  it.each([
    ["nothing is playing and Listen on is here", { local: false, remote: false, any: false }, false, false],
    ["a tune plays on this phone", { local: true, remote: false, any: true }, false, false],
    ["a tune plays on the C64", { local: false, remote: true, any: true }, false, true],
    [
      "a tune plays on the C64 and Live View plays its sound here",
      { local: false, remote: true, any: true },
      true,
      false,
    ],
  ])("when %s", (_name, active, audioLive, disabled) => {
    localStorage.setItem("c64u_playback_engine", "local");
    playback.value = active;
    mirror.value = { audioLive };
    render(<PlaybackSoundCard />);
    openBody();
    expect(screen.queryByTestId("sound-unavailable") !== null).toBe(disabled);
    expect(screen.getByTestId("sound-switch")).toHaveProperty("disabled", disabled);
  });
});
