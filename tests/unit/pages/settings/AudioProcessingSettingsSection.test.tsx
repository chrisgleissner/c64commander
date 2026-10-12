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
vi.mock("@/lib/audio/useAudioFxAvailable", () => ({ useAudioFxAvailable: () => available.value }));

import { AudioProcessingSettingsSection } from "@/pages/settings/AudioProcessingSettingsSection";
import { loadAudioProcessing, saveAudioEqBand } from "@/lib/config/audioProcessingSettings";

const openSection = () => {
  render(<AudioProcessingSettingsSection />);
  const root = screen.getByTestId("settings-audio-processing");
  if (!screen.queryByTestId("settings-audio-levelling")) {
    fireEvent.click(within(root).getAllByRole("button")[0]);
  }
};

const thumbOf = (id: string) => within(screen.getByTestId(`settings-audio-eq-${id}-row`)).getByRole("slider");

describe("AudioProcessingSettingsSection", () => {
  beforeEach(() => {
    localStorage.clear();
    available.value = true;
  });

  it("renders nothing where the phone cannot process its own sound", () => {
    available.value = false;
    render(<AudioProcessingSettingsSection />);
    expect(screen.queryByTestId("settings-audio-processing")).not.toBeInTheDocument();
  });

  it("starts flat and off, with no On badge and Reset disabled", () => {
    openSection();
    expect(screen.queryByText("On")).not.toBeInTheDocument();
    expect(screen.getByTestId("settings-audio-eq-reset")).toBeDisabled();
    expect(screen.getByTestId("settings-audio-eq-bass-value")).toHaveTextContent("0 dB");
    expect(screen.getByTestId("settings-audio-stereo-off")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("settings-audio-reverb-off")).toHaveAttribute("aria-pressed", "true");
  });

  it("persists the Normalize volume switch and shows the On badge", () => {
    openSection();
    fireEvent.click(screen.getByTestId("settings-audio-levelling"));
    expect(loadAudioProcessing().levelling).toBe(true);
    expect(screen.getByText("On")).toBeInTheDocument();
  });

  it.each([
    ["bass", "bassDb"],
    ["mid", "midDb"],
    ["treble", "trebleDb"],
  ] as const)("moves the %s slider from the keyboard and shows the signed value", (id, key) => {
    openSection();
    const thumb = thumbOf(id);
    act(() => thumb.focus());
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(loadAudioProcessing()[key]).toBeGreaterThan(0);
    expect(screen.getByTestId(`settings-audio-eq-${id}-value`).textContent).toMatch(/^\+\d+ dB$/);
    fireEvent.keyDown(thumb, { key: "Home" });
    expect(loadAudioProcessing()[key]).toBe(-12);
  });

  it("resets the equalizer and leaves stereo width and reverb alone", () => {
    saveAudioEqBand("bassDb", 5);
    saveAudioEqBand("trebleDb", -4);
    openSection();
    fireEvent.click(screen.getByTestId("settings-audio-reverb-hall"));
    const reset = screen.getByTestId("settings-audio-eq-reset");
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    expect(loadAudioProcessing()).toMatchObject({ bassDb: 0, midDb: 0, trebleDb: 0, reverb: 55 });
    expect(screen.getByTestId("settings-audio-eq-reset")).toBeDisabled();
  });

  it("stores the stereo width and reverb presets and highlights the chosen one", () => {
    openSection();
    fireEvent.click(screen.getByTestId("settings-audio-stereo-wide"));
    fireEvent.click(screen.getByTestId("settings-audio-reverb-room"));
    expect(loadAudioProcessing()).toMatchObject({ stereoWidth: 70, reverb: 25 });
    expect(screen.getByTestId("settings-audio-stereo-wide")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("settings-audio-stereo-off")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("settings-audio-reverb-room")).toHaveAttribute("aria-pressed", "true");
  });

  it("highlights the nearest preset for a stored value from a finer control", () => {
    localStorage.setItem("c64u_audio_stereo_width", "40");
    openSection();
    expect(screen.getByTestId("settings-audio-stereo-subtle")).toHaveAttribute("aria-pressed", "true");
  });
});
