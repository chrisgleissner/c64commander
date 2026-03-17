/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PathWrap } from "@/components/PathWrap";

describe("PathWrap", () => {
  it("renders null for an empty path", () => {
    const { container } = render(<PathWrap path="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders path segments separated by forward slashes", () => {
    render(<PathWrap path="foo/bar/baz" />);
    expect(screen.getByText("foo")).toBeInTheDocument();
    expect(screen.getByText("baz")).toBeInTheDocument();
  });

  it("renders path segments separated by backslashes", () => {
    render(<PathWrap path="foo\\bar\\baz" />);
    expect(screen.getByText("foo")).toBeInTheDocument();
    expect(screen.getByText("baz")).toBeInTheDocument();
  });
});
