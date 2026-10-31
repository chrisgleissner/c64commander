/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";
import { HvscManager } from "@/pages/playFiles/components/HvscManager";
import type { HvscLibraryState } from "@/pages/playFiles/hooks/useHvscLibrary";

const build = (state: string, errorReason: string | null = null) => {
  const handleHvscInstall = vi.fn(async () => undefined);
  const hvsc = {
    hvscAvailable: true,
    hvscUpdating: false,
    hvscInProgress: false,
    hvscCanIngest: false,
    hvscStatus: null,
    hvscPreparationState: state,
    hvscPreparationErrorReason: errorReason,
    hvscPreparationStatusLabel: "Not downloaded",
    formatHvscDuration: () => "",
    formatHvscTimestamp: () => "",
    handleHvscInstall,
    handleHvscIngest: vi.fn(),
    handleHvscCancel: vi.fn(),
    handleHvscReindex: vi.fn(),
    handleHvscReset: vi.fn(),
  } as unknown as HvscLibraryState;
  return { hvsc, handleHvscInstall };
};

vi.mock("framer-motion", () => {
  const Plain = ({ children, ...rest }: Record<string, unknown> & { children?: ReactNode }) => {
    const { animate: _a, initial: _i, exit: _e, transition: _t, onAnimationComplete: _o, ...dom } = rest;
    return <div {...dom}>{children}</div>;
  };
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: new Proxy({} as Record<string, unknown>, { get: () => Plain }),
  };
});

const open = () => fireEvent.click(screen.getByTestId("play-section-toggle-hvsc"));

describe("the HVSC panel's Download button", () => {
  afterEach(() => {
    saveStartupModeByUser("default");
    localStorage.clear();
  });

  it("SPM-START-02 asks first in SID Player instead of downloading", () => {
    saveStartupModeByUser("sid-player");
    const { hvsc, handleHvscInstall } = build("NOT_PRESENT");
    const onOpenPreparation = vi.fn();
    render(<HvscManager hvscControlsEnabled hvsc={hvsc} onOpenPreparation={onOpenPreparation} />);
    open();

    expect(screen.getByText("Choose Download to get the free C64 music collection.")).toBeInTheDocument();
    expect(screen.getByText("Choose Download to get the free C64 music collection.").textContent).not.toMatch(
      /\b(REST|FTP|Telnet|host|IP|PAL|NTSC|dB|KERNAL|BASIC)\b/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Download HVSC" }));

    expect(onOpenPreparation).toHaveBeenCalledTimes(1);
    expect(handleHvscInstall).not.toHaveBeenCalled();
  });

  it("SPM-START-02 the Full App downloads straight away", () => {
    const { hvsc, handleHvscInstall } = build("NOT_PRESENT");
    const onOpenPreparation = vi.fn();
    render(<HvscManager hvscControlsEnabled hvsc={hvsc} onOpenPreparation={onOpenPreparation} />);
    open();

    expect(screen.getByText(/prepared automatically/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download HVSC" }));

    expect(handleHvscInstall).toHaveBeenCalledTimes(1);
    expect(onOpenPreparation).not.toHaveBeenCalled();
  });

  it("SPM-START-02 a canceled download reads as not downloaded and the button asks again", () => {
    saveStartupModeByUser("sid-player");
    const { hvsc, handleHvscInstall } = build("ERROR", "Canceled");
    const onOpenPreparation = vi.fn();
    render(<HvscManager hvscControlsEnabled hvsc={hvsc} onOpenPreparation={onOpenPreparation} />);
    open();

    expect(screen.getByText("Status: Not downloaded")).toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download HVSC" }));

    expect(onOpenPreparation).toHaveBeenCalledTimes(1);
    expect(handleHvscInstall).not.toHaveBeenCalled();
  });

  it("SPM-START-02 a real failure still reads as failed", () => {
    saveStartupModeByUser("sid-player");
    const { hvsc } = build("ERROR", "Network error");
    render(<HvscManager hvscControlsEnabled hvsc={hvsc} onOpenPreparation={vi.fn()} />);
    open();

    expect(screen.getByText("Network error")).toBeInTheDocument();
  });
});
