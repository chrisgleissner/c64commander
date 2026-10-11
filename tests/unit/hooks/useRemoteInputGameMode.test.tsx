/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScreenActivityProvider } from "@/hooks/useScreenActivity";
import { useRemoteInputGameMode } from "@/hooks/useRemoteInputGameMode";
import { requestGameMode, resetPendingGameModeRequest } from "@/lib/remoteInput/gameModeLaunch";
import type { AvMirrorSession } from "@/lib/streams/avMirrorSession";

const session = { stopVideo: vi.fn(), stopAudio: vi.fn() } as unknown as AvMirrorSession;

const Sheet = ({ requestSheetOpen }: { requestSheetOpen: () => void }) => {
  useRemoteInputGameMode({
    open: false,
    joystickAvailable: true,
    tierResolved: true,
    outputMode: "type",
    setOutputMode: () => undefined,
    requestSheetOpen,
    session,
  });
  return null;
};

const SheetInSlot = ({ active, requestSheetOpen }: { active: boolean; requestSheetOpen: () => void }) => (
  <ScreenActivityProvider active={active}>
    <Sheet requestSheetOpen={requestSheetOpen} />
  </ScreenActivityProvider>
);

describe("useRemoteInputGameMode request claim", () => {
  afterEach(() => {
    resetPendingGameModeRequest();
  });

  it("opens only the sheet of the page on screen when Home and Play are both mounted", () => {
    const openHomeSheet = vi.fn();
    const openPlaySheet = vi.fn();
    render(
      <>
        <SheetInSlot active={false} requestSheetOpen={openHomeSheet} />
        <SheetInSlot active requestSheetOpen={openPlaySheet} />
      </>,
    );

    act(() => requestGameMode());

    expect(openPlaySheet).toHaveBeenCalledTimes(1);
    expect(openHomeSheet).not.toHaveBeenCalled();
  });

  it("leaves a request raised while its page is hidden for when that page is shown", () => {
    const openSheet = vi.fn();
    const { rerender } = render(<SheetInSlot active={false} requestSheetOpen={openSheet} />);

    act(() => requestGameMode());
    expect(openSheet).not.toHaveBeenCalled();

    rerender(<SheetInSlot active requestSheetOpen={openSheet} />);
    expect(openSheet).toHaveBeenCalledTimes(1);
  });
});
