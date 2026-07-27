/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SidRadioLauncherSheet } from "@/pages/playFiles/components/SidRadioLauncherSheet";

const setup = (likeCount: number) => {
  const onStartStyle = vi.fn();
  const onStartTaste = vi.fn();
  const onSurprise = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <SidRadioLauncherSheet
      open
      onOpenChange={onOpenChange}
      likeCount={likeCount}
      onStartStyle={onStartStyle}
      onStartTaste={onStartTaste}
      onSurprise={onSurprise}
    />,
  );
  return { onStartStyle, onStartTaste, onSurprise, onOpenChange };
};

describe("SidRadioLauncherSheet", () => {
  it("renders the 9 style tiles", () => {
    setup(0);
    for (let bit = 0; bit < 9; bit += 1) {
      expect(screen.getByTestId(`sid-radio-style-${bit}`)).toBeInTheDocument();
    }
  });

  it("starts a broad style station and closes the sheet", () => {
    const { onStartStyle, onOpenChange } = setup(0);
    fireEvent.click(screen.getByTestId("sid-radio-style-0"));
    expect(onStartStyle).toHaveBeenCalledWith(0, "Fast-Paced", false);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("composes 'from my likes' when the toggle is on (D10)", () => {
    const { onStartStyle } = setup(3);
    fireEvent.click(screen.getByTestId("sid-radio-likes-toggle"));
    fireEvent.click(screen.getByTestId("sid-radio-style-0"));
    expect(onStartStyle).toHaveBeenCalledWith(0, "Fast-Paced", true);
  });

  it("locks Taste below the like threshold with a hint (D1)", () => {
    const locked = setup(3);
    expect(screen.getByTestId("sid-radio-taste")).toBeDisabled();
    expect(screen.getByTestId("sid-radio-taste-hint")).toHaveTextContent("3/5");
    fireEvent.click(screen.getByTestId("sid-radio-taste"));
    expect(locked.onStartTaste).not.toHaveBeenCalled();
  });

  it("unlocks Taste at the like threshold (D1)", () => {
    const unlocked = setup(5);
    expect(screen.getByTestId("sid-radio-taste")).not.toBeDisabled();
    expect(screen.queryByTestId("sid-radio-taste-hint")).toBeNull();
    fireEvent.click(screen.getByTestId("sid-radio-taste"));
    expect(unlocked.onStartTaste).toHaveBeenCalledTimes(1);
  });

  it("fires Surprise", () => {
    const { onSurprise } = setup(0);
    fireEvent.click(screen.getByTestId("sid-radio-surprise"));
    expect(onSurprise).toHaveBeenCalledTimes(1);
  });
});
