import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Slider } from "@/components/ui/slider";

describe("Slider", () => {
    it("normalizes NaN controlled values to the slider minimum", () => {
        render(<Slider value={[Number.NaN]} min={0} max={10} onValueChange={vi.fn()} />);

        expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "0");
    });

    it("ignores invalid midpoint values instead of rendering NaN percentages", () => {
        render(
            <Slider value={[5]} min={0} max={10} midpoint={{ value: Number.NaN, notch: true }} onValueChange={vi.fn()} />,
        );

        expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "5");
    });

    it("falls back to a safe range when the caller provides an invalid max value", () => {
        render(<Slider value={[5]} min={0} max={Number.NaN} onValueChange={vi.fn()} />);

        expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "5");
    });

    it("widens zero-width ranges so single-option sliders do not produce NaN layout", () => {
        render(<Slider value={[0]} min={0} max={0} onValueChange={vi.fn()} />);

        expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "0");
    });
});
