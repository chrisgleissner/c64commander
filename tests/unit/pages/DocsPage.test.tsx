import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DocsPage from "@/pages/DocsPage";

vi.mock("framer-motion", () => ({
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
        div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    },
}));

vi.mock("@/components/AppBar", () => ({
    AppBar: ({ title }: { title: React.ReactNode }) => <div data-testid="docs-app-bar">{title}</div>,
}));

vi.mock("@/components/layout/AppChromeContext", () => ({
    usePrimaryPageShellClassName: () => "docs-shell",
}));

vi.mock("@/components/layout/PageContainer", () => ({
    PageContainer: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/lib/tracing/userTrace", () => ({
    wrapUserEvent: (handler: () => void) => handler,
}));

describe("DocsPage", () => {
    it("renders the docs shell and expands help sections on demand", () => {
        render(<DocsPage />);

        expect(screen.getByTestId("docs-app-bar")).toHaveTextContent("Docs");
        expect(screen.queryByText("Connect in 4 steps:")).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId("docs-toggle-getting-started"));

        expect(screen.getByText("Connect in 4 steps:")).toBeInTheDocument();
        expect(screen.getByText(/Save & Connect/)).toBeInTheDocument();
    });

    it("renders diagnostics guidance and upstream resource links", () => {
        render(<DocsPage />);

        fireEvent.click(screen.getByTestId("docs-toggle-diagnostics"));

        expect(screen.getByText(/Closing a deep-linked diagnostics view returns to Settings/)).toBeInTheDocument();
        expect(screen.getByTestId("docs-external-resource-docs")).toHaveAttribute(
            "href",
            "https://1541u-documentation.readthedocs.io/",
        );
        expect(screen.getByTestId("docs-external-resource-api")).toHaveAttribute(
            "href",
            "https://1541u-documentation.readthedocs.io/en/latest/api/api_calls.html",
        );
        expect(screen.getByTestId("docs-external-resource-site")).toHaveAttribute("href", "https://ultimate64.com/");
    });
});
