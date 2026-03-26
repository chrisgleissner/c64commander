/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FileOriginIcon } from "@/components/FileOriginIcon";

describe("FileOriginIcon", () => {
  it("renders the ultimate icon as image", () => {
    render(<FileOriginIcon origin="ultimate" />);
    const icon = screen.getByTestId("file-origin-icon");
    expect(icon.tagName).toBe("IMG");
    expect(icon).toHaveAttribute("alt", "C64U file");
  });

  it("renders the local icon as image", () => {
    render(<FileOriginIcon origin="local" />);
    const icon = screen.getByTestId("file-origin-icon");
    expect(icon.tagName).toBe("IMG");
    expect(icon).toHaveAttribute("alt", "Local file");
  });

  it("renders the hvsc icon as music notes symbol ♫", () => {
    render(<FileOriginIcon origin="hvsc" />);
    const icon = screen.getByTestId("file-origin-icon");
    expect(icon.tagName).toBe("SPAN");
    expect(icon).toHaveAttribute("aria-label", "HVSC file");
    expect(icon).toHaveAttribute("role", "img");
    expect(icon.textContent?.trim()).toBe("♫");
  });

  it("renders the commoserve icon as stacked-records svg", () => {
    render(<FileOriginIcon origin="commoserve" />);
    const icon = screen.getByTestId("file-origin-icon");
    expect(icon.tagName).toBe("svg");
    expect(icon).toHaveAttribute("aria-label", "Online archive file");
    expect(screen.getByLabelText("Online archive file")).toBeVisible();
  });

  it("accepts a custom label override for ultimate", () => {
    render(<FileOriginIcon origin="ultimate" label="Custom label" />);
    const icon = screen.getByTestId("file-origin-icon");
    expect(icon).toHaveAttribute("alt", "Custom label");
  });

  it("accepts a custom label override for hvsc", () => {
    render(<FileOriginIcon origin="hvsc" label="My HVSC" />);
    const icon = screen.getByTestId("file-origin-icon");
    expect(icon).toHaveAttribute("aria-label", "My HVSC");
  });

  it("accepts a custom label override for commoserve", () => {
    render(<FileOriginIcon origin="commoserve" label="My archive" />);
    const icon = screen.getByTestId("file-origin-icon");
    expect(icon).toHaveAttribute("aria-label", "My archive");
  });
});
