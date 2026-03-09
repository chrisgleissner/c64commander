import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { TabBar } from "@/components/TabBar";

describe("TabBar", () => {
    it("exposes tab labels as accessibility labels", () => {
        render(
            <MemoryRouter initialEntries={["/"]}>
                <TabBar />
            </MemoryRouter>,
        );

        expect(screen.getByLabelText("Home")).toHaveAttribute("data-testid", "tab-home");
        expect(screen.getByLabelText("Play")).toHaveAttribute("data-testid", "tab-play");
        expect(screen.getByLabelText("Settings")).toHaveAttribute("data-testid", "tab-settings");
    });

    it("marks the active tab with aria-current", () => {
        render(
            <MemoryRouter initialEntries={["/play"]}>
                <TabBar />
            </MemoryRouter>,
        );

        expect(screen.getByLabelText("Play")).toHaveAttribute("aria-current", "page");
        expect(screen.getByLabelText("Home")).not.toHaveAttribute("aria-current");
    });
});
