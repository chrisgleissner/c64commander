/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/docs/externalResources", () => ({ externalLinksOpen: () => false }));

import { AboutLicenseNotice } from "@/pages/settings/AboutLicenseNotice";

describe("AboutLicenseNotice on a phone that cannot open links", () => {
  it("names the license as text and still links the source code with its address printed", () => {
    render(<AboutLicenseNotice />);

    const license = screen.getByTestId("settings-about-license-text");
    expect(license.tagName).toBe("SPAN");
    expect(license).toHaveTextContent("GNU GPL v3 or later");
    expect(screen.getByTestId("settings-about-license-notice")).toHaveTextContent(
      "github.com/chrisgleissner/c64commander",
    );
  });
});
