/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { variant } from "@/generated/variant";
import { AboutLicenseNotice, GPL_V3_URL, SOURCE_CODE_URL } from "@/pages/settings/AboutLicenseNotice";

describe("AboutLicenseNotice", () => {
  it("names the license and warranty terms and links the source code and license text", () => {
    render(<AboutLicenseNotice />);
    const notice = screen.getByTestId("settings-about-license-notice");
    expect(notice).toHaveTextContent(`${variant.displayName} is free software under the GNU GPL v3 or later`);
    expect(notice).toHaveTextContent(/no warranty/);
    expect(screen.getByTestId("settings-about-source-code")).toHaveAttribute("href", SOURCE_CODE_URL);
    expect(screen.getByTestId("settings-about-license-text")).toHaveAttribute("href", GPL_V3_URL);
  });
});
