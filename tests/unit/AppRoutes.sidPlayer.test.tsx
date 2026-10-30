/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { HiddenRouteRedirect } from "@/components/HiddenRouteRedirect";
import { normalizeInitialLocation } from "@/lib/navigation/hiddenRoutes";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";
import { addLog } from "@/lib/logging";

vi.mock("@/lib/logging", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging")>()),
  addLog: vi.fn(),
}));

const Where = () => <span data-testid="where">{useLocation().pathname}</span>;

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <HiddenRouteRedirect />
      <Where />
    </MemoryRouter>,
  );

describe("hidden routes in SID Player", () => {
  beforeEach(() => {
    localStorage.clear();
    saveStartupModeByUser("default");
    vi.mocked(addLog).mockClear();
    window.history.replaceState(null, "", "/");
  });

  it.each(["/", "/disks", "/config", "/disks/anything"])(
    "SPM-NAV-04 a hidden route in SID Player redirects to Play: %s",
    (path) => {
      saveStartupModeByUser("sid-player");
      renderAt(path);
      expect(screen.getByTestId("where")).toHaveTextContent("/play");
      expect(vi.mocked(addLog)).toHaveBeenCalledWith(
        "info",
        "Hidden route redirected",
        expect.objectContaining({ path: path === "/disks/anything" ? path : path }),
      );
    },
  );

  it.each(["/play", "/settings", "/docs", "/settings/open-source-licenses", "/diagnostics"])(
    "SPM-NAV-04 a visible route stays in SID Player: %s",
    (path) => {
      saveStartupModeByUser("sid-player");
      renderAt(path);
      expect(screen.getByTestId("where")).toHaveTextContent(path);
    },
  );

  it.each(["/", "/disks", "/config"])("SPM-NAV-04 the Full App keeps %s", (path) => {
    renderAt(path);
    expect(screen.getByTestId("where")).toHaveTextContent(path);
  });

  it("SPM-NAV-04 launching at / in SID Player opens Play without painting Home", () => {
    saveStartupModeByUser("sid-player");
    window.history.replaceState(null, "", "/");
    normalizeInitialLocation();
    expect(window.location.pathname).toBe("/play");
  });

  it("SPM-NAV-04 launching at / in the Full App keeps Home", () => {
    window.history.replaceState(null, "", "/");
    normalizeInitialLocation();
    expect(window.location.pathname).toBe("/");
  });
});
