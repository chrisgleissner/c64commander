/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockLabel = vi.fn(() => "some/label");

vi.mock("@/lib/ui/pathDisplay", () => ({
    useResponsivePathLabel: (source: string) => ({
        elementRef: { current: null },
        label: mockLabel(source),
    }),
}));

import { ResponsivePathText } from "@/components/ResponsivePathText";

describe("ResponsivePathText", () => {
    it("uses fallback when path is whitespace-only", () => {
        mockLabel.mockReturnValueOnce("—");
        render(<ResponsivePathText path="  " mode="full" />);
        expect(screen.getByTitle("—")).toBeInTheDocument();
    });

    it("renders fallback when label is empty", () => {
        mockLabel.mockReturnValueOnce("");
        render(<ResponsivePathText path="/some/path" mode="full" fallback="n/a" />);
        expect(screen.getByText("n/a")).toBeInTheDocument();
    });
});
